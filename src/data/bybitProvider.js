// src/data/bybitProvider.js

const axios = require('axios');
const WebSocket = require('ws');

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
const COINGECKO_OHLC_DAYS = '1';
const COINGECKO_REQUEST_DELAY_MS = 2500;
const COINGECKO_RETRY_DELAY_MS = 30000;
const COINGECKO_MAX_RETRIES = 2;

class BybitDataProvider {
  constructor() {
    this.isTestnet = process.env.BYBIT_TESTNET === 'true';
    this.isProduction = process.env.NODE_ENV === 'production';
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

  async validatePairs() {
    console.log('📋 Using static pairs list');
    this.validPairs = [...TRADING_PAIRS];
    console.log(`✅ Valid pairs: ${this.validPairs.length}`);
    return this.validPairs;
  }

  // ─────────────────────────────────────────
  // STEP 2: COINGECKO BACKFILL
  // ─────────────────────────────────────────

  async backfillCandles(pair, interval = '60', limit = 50) {
    try {
      const coinId = this._getCoinGeckoId(pair);
      if (!coinId) {
        console.warn(`⚠️  No CoinGecko mapping for ${pair}`);
        return [];
      }

      const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${COINGECKO_OHLC_DAYS}`;
      const response = await this._requestCoinGecko(url, pair);

      const candles = response.data.map((candle) => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: 0,
        confirm: true,
      }));

      if (!this.candleBuffer[pair]) this.candleBuffer[pair] = [];
      this.candleBuffer[pair] = candles.slice(-limit);

      console.log(`📥 Backfilled ${candles.length} candles for ${pair} (CoinGecko)`);
      return candles;
    } catch (error) {
      console.error(`❌ Backfill failed for ${pair}:`, error.message);
      return [];
    }
  }

  async backfillAll(interval = '60') {
    console.log(`\n📥 Starting backfill for ${this.validPairs.length} pairs...`);

    for (let i = 0; i < this.validPairs.length; i += 1) {
      await this.backfillCandles(this.validPairs[i], interval);

      if (i + 1 < this.validPairs.length) {
        await this._sleep(COINGECKO_REQUEST_DELAY_MS);
      }
    }

    const filled = Object.keys(this.candleBuffer).filter(
      (pair) => (this.candleBuffer[pair] || []).length > 0
    ).length;
    console.log(`✅ Backfill complete: ${filled} pairs ready\n`);
  }

  _getCoinGeckoId(pair) {
    const map = {
      BTCUSDT: 'bitcoin',
      ETHUSDT: 'ethereum',
      SOLUSDT: 'solana',
      XRPUSDT: 'ripple',
      DOGEUSDT: 'dogecoin',
      AVAXUSDT: 'avalanche-2',
      NEARUSDT: 'near',
      RENDERUSDT: 'render-token',
      '1000PEPEUSDT': 'pepe',
      SHIB1000USDT: 'shiba-inu',
      JUPUSDT: 'jupiter-exchange-solana',
      WIFUSDT: 'dogwifcoin',
      OPUSDT: 'optimism',
      ARBUSDT: 'arbitrum',
      TRUMPUSDT: 'official-trump',
    };

    return map[pair] || null;
  }

  async _requestCoinGecko(url, pair) {
    for (let attempt = 0; attempt <= COINGECKO_MAX_RETRIES; attempt += 1) {
      try {
        return await axios.get(url, { timeout: 15000 });
      } catch (error) {
        if (error.response?.status !== 429 || attempt === COINGECKO_MAX_RETRIES) {
          throw error;
        }

        const delay = COINGECKO_RETRY_DELAY_MS * (attempt + 1);
        console.warn(`⚠️  CoinGecko rate limit for ${pair}, retrying in ${delay / 1000}s...`);
        await this._sleep(delay);
      }
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    const wsInterval = process.env.BYBIT_WS_INTERVAL || '1';

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
