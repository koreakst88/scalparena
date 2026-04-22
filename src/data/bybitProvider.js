// src/data/bybitProvider.js

const WebSocket = require('ws');
const https = require('https');

const TRADING_PAIRS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'AVAXUSDT',
  'NEARUSDT',
  'RENDERUSDT',
  '1000PEPEUSDT',
  'SHIB1000USDT',
  'JUPUSDT',
  'WIFUSDT',
  'OPUSDT',
  'ARBUSDT',
  'TRUMPUSDT',
];

const RECONNECT_DELAY = 5000;
const PING_INTERVAL = 20000;
const BUFFER_SIZE = 100;

class BybitDataProvider {
  constructor() {
    this.isTestnet = process.env.BYBIT_TESTNET === 'true';
    this.wsUrl = this.isTestnet
      ? 'wss://stream-testnet.bybit.com/v5/public/linear'
      : 'wss://stream.bybit.com/v5/public/linear';
    this.restBase = this.isTestnet ? 'api-testnet.bybit.com' : 'api.bybit.com';

    this.ws = null;
    this.candleBuffer = {};
    this.currentCandle = {};
    this.validPairs = [];
    this.isConnected = false;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.listeners = [];

    console.log(`✅ BybitDataProvider initialized (${this.isTestnet ? 'TESTNET' : 'MAINNET'})`);
  }

  // ─────────────────────────────────────────
  // STEP 1: VALIDATE PAIRS VIA REST
  // ─────────────────────────────────────────

  async validatePairs() {
    console.log('🔍 Validating pairs via REST...');

    return new Promise((resolve) => {
      const path = '/v5/market/instruments-info?category=linear&limit=1000';

      const options = {
        hostname: this.restBase,
        path,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const available = json.result?.list?.map((instrument) => instrument.symbol) || [];

            this.validPairs = TRADING_PAIRS.filter((pair) => {
              const isValid = available.includes(pair);
              if (!isValid) {
                console.warn(`⚠️  Pair NOT found on exchange: ${pair}`);
              }
              return isValid;
            });

            console.log(`✅ Valid pairs: ${this.validPairs.length}/${TRADING_PAIRS.length}`);
            console.log(`   ${this.validPairs.join(', ')}`);
            resolve(this.validPairs);
          } catch (e) {
            console.error('❌ Failed to parse instruments:', e.message);
            this.validPairs = [...TRADING_PAIRS];
            resolve(this.validPairs);
          }
        });
      });

      req.on('error', (e) => {
        console.error('❌ REST request failed:', e.message);
        this.validPairs = [...TRADING_PAIRS];
        resolve(this.validPairs);
      });

      req.end();
    });
  }

  // ─────────────────────────────────────────
  // STEP 2: REST BACKFILL
  // ─────────────────────────────────────────

  async backfillCandles(pair, interval = '60', limit = 50) {
    return new Promise((resolve) => {
      const path = `/v5/market/kline?category=linear&symbol=${pair}&interval=${interval}&limit=${limit}`;

      const options = {
        hostname: this.restBase,
        path,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const rawCandles = json.result?.list || [];

            const candles = rawCandles.reverse().map((candle) => ({
              timestamp: parseInt(candle[0], 10),
              open: parseFloat(candle[1]),
              high: parseFloat(candle[2]),
              low: parseFloat(candle[3]),
              close: parseFloat(candle[4]),
              volume: parseFloat(candle[5]),
              confirm: true,
            }));

            if (!this.candleBuffer[pair]) this.candleBuffer[pair] = [];
            this.candleBuffer[pair] = candles;

            console.log(`📥 Backfilled ${candles.length} candles for ${pair}`);
            resolve(candles);
          } catch (e) {
            console.error(`❌ Backfill failed for ${pair}:`, e.message);
            resolve([]);
          }
        });
      });

      req.on('error', (e) => {
        console.error(`❌ Backfill request failed for ${pair}:`, e.message);
        resolve([]);
      });

      req.end();
    });
  }

  async backfillAll(interval = '60') {
    console.log(`\n📥 Starting backfill for ${this.validPairs.length} pairs...`);

    const batchSize = 3;
    for (let i = 0; i < this.validPairs.length; i += batchSize) {
      const batch = this.validPairs.slice(i, i + batchSize);
      await Promise.all(batch.map((pair) => this.backfillCandles(pair, interval)));

      if (i + batchSize < this.validPairs.length) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    const filled = Object.keys(this.candleBuffer).length;
    console.log(`✅ Backfill complete: ${filled} pairs ready\n`);
  }

  // ─────────────────────────────────────────
  // STEP 3: WEBSOCKET CONNECTION
  // ─────────────────────────────────────────

  connect() {
    if (this.isConnected) {
      console.warn('⚠️  Already connected, skipping');
      return;
    }

    console.log(`🔌 Connecting to ${this.wsUrl}...`);
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      console.log('✅ Bybit WebSocket connected');
      this.isConnected = true;
      this._subscribe();
      this._startPing();
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this._handleMessage(msg);
      } catch (e) {
        console.error('❌ Parse error:', e.message);
      }
    });

    this.ws.on('error', (err) => {
      console.error('❌ WebSocket error:', err.message);
    });

    this.ws.on('close', (code) => {
      console.warn(`⚠️  WebSocket closed (code: ${code}). Reconnecting...`);
      this.isConnected = false;
      this.ws = null;
      this._stopPing();
      this._scheduleReconnect();
    });
  }

  disconnect() {
    this._stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
    this.isConnected = false;
    console.log('🔌 Disconnected');
  }

  // ─────────────────────────────────────────
  // STEP 4: SUBSCRIBE
  // ─────────────────────────────────────────

  _subscribe() {
    const wsInterval = process.env.NODE_ENV === 'development' ? '1' : '60';

    const batchSize = 5;
    for (let i = 0; i < this.validPairs.length; i += batchSize) {
      const batch = this.validPairs.slice(i, i + batchSize);
      const args = batch.map((pair) => `kline.${wsInterval}.${pair}`);

      const msg = { op: 'subscribe', args };
      this.ws.send(JSON.stringify(msg));

      console.log(`📡 Subscribed batch ${Math.floor(i / batchSize) + 1}: ${batch.join(', ')}`);
    }
  }

  // ─────────────────────────────────────────
  // MESSAGE HANDLER
  // ─────────────────────────────────────────

  _handleMessage(msg) {
    if (msg.op === 'pong') return;

    if (msg.op === 'subscribe') {
      if (msg.success) {
        console.log(`✅ Subscription confirmed: ${msg.conn_id || ''}`);
      } else {
        console.error(`❌ Subscription failed: ${msg.ret_msg}`);
      }
      return;
    }

    if (msg.topic?.startsWith('kline.')) {
      const parts = msg.topic.split('.');
      const pair = parts[2];
      const raw = msg.data?.[0];

      if (!raw) return;

      const candle = {
        timestamp: parseInt(raw.start, 10),
        open: parseFloat(raw.open),
        high: parseFloat(raw.high),
        low: parseFloat(raw.low),
        close: parseFloat(raw.close),
        volume: parseFloat(raw.volume),
        confirm: raw.confirm,
      };

      this._updateBuffer(pair, candle);
      this._notifyListeners(pair, candle);
    }
  }

  // ─────────────────────────────────────────
  // BUFFER
  // ─────────────────────────────────────────

  _updateBuffer(pair, candle) {
    if (!this.candleBuffer[pair]) this.candleBuffer[pair] = [];

    const buffer = this.candleBuffer[pair];
    const last = buffer[buffer.length - 1];

    if (last && last.timestamp === candle.timestamp) {
      buffer[buffer.length - 1] = candle;
    } else {
      buffer.push(candle);
      if (buffer.length > BUFFER_SIZE) buffer.shift();
    }

    this.currentCandle[pair] = candle;
  }

  // ─────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────

  getCandles(pair, limit = 50) {
    return (this.candleBuffer[pair] || []).slice(-limit);
  }

  getCurrentCandle(pair) {
    return this.currentCandle[pair] || null;
  }

  hasEnoughData(pair, required = 30) {
    return (this.candleBuffer[pair] || []).length >= required;
  }

  getPairs() {
    return this.validPairs;
  }

  onCandleUpdate(callback) {
    this.listeners.push(callback);
  }

  getStatus() {
    return {
      connected: this.isConnected,
      pairs_valid: this.validPairs.length,
      pairs_with_data: Object.keys(this.candleBuffer).filter(
        (pair) => this.candleBuffer[pair].length > 0
      ).length,
      buffer_sizes: Object.fromEntries(
        this.validPairs.map((pair) => [pair, (this.candleBuffer[pair] || []).length])
      ),
    };
  }

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  _notifyListeners(pair, candle) {
    this.listeners.forEach((cb) => {
      try {
        cb(pair, candle);
      } catch (e) {
        console.error('❌ Listener error:', e.message);
      }
    });
  }

  _startPing() {
    this.pingTimer = setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.send(JSON.stringify({ op: 'ping' }));
      }
    }, PING_INTERVAL);
  }

  _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY);
  }
}

module.exports = { BybitDataProvider, TRADING_PAIRS };
