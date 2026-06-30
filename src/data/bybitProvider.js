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
    this.publicMarketRestBase = process.env.PUMP_HUNTER_USE_TESTNET === 'true'
      ? this.restBase
      : 'api.bybit.com';
    this.publicMarketRestBases = this._getPublicMarketRestBases();
    this.lastPublicMarketHost = null;
    this.lastPublicMarketError = null;
    this.lastSupabaseProxyError = null;
    this.lastSupabaseProxyVersion = null;
    this.supabaseProxyUrl = process.env.SUPABASE_PROXY_URL;
    this.supabaseProxyKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';

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

  async getLinearTickers() {
    this._resetPublicMarketDiagnostics();

    try {
      const response = await this._requestPublicMarket('/v5/market/tickers', {
        category: 'linear',
      });

      if (response.data?.retCode !== 0) {
        console.warn(
          `⚠️ Bybit tickers returned retCode=${response.data?.retCode}: ${response.data?.retMsg || 'unknown'}`
        );
        const retry = await this._retryPublicMarketViaProxy('/v5/market/tickers', { category: 'linear' });
        return retry?.data?.result?.list || [];
      }

      const tickers = response.data?.result?.list || [];
      if (!tickers.length) {
        console.warn(`⚠️ Bybit tickers returned empty list from ${this.publicMarketRestBase}`);
        const retry = await this._retryPublicMarketViaProxy('/v5/market/tickers', { category: 'linear' });
        return retry?.data?.result?.list || [];
      }

      return tickers;
    } catch (error) {
      this.lastPublicMarketError = this._formatAxiosError(error);
      console.error(
        `❌ Bybit tickers request failed via ${this.publicMarketRestBase}:`,
        error.response?.status || error.message
      );
      return [];
    }
  }

  async getRestKlines(pair, interval = '15', limit = 96) {
    this._resetPublicMarketDiagnostics();

    try {
      const response = await this._requestPublicMarket('/v5/market/kline', {
        category: 'linear',
        symbol: pair,
        interval,
        limit,
      });

      if (response.data?.retCode !== 0) {
        console.warn(
          `⚠️ Bybit klines returned retCode=${response.data?.retCode} for ${pair}: ${response.data?.retMsg || 'unknown'}`
        );
        const retry = await this._retryPublicMarketViaProxy('/v5/market/kline', {
          category: 'linear',
          symbol: pair,
          interval,
          limit,
        });
        if (!retry) return [];
        return this._mapBybitKlines(retry.data?.result?.list || []);
      }

      return this._mapBybitKlines(response.data?.result?.list || []);
    } catch (error) {
      this.lastPublicMarketError = this._formatAxiosError(error);
      console.error(`❌ Bybit klines request failed for ${pair}:`, error.message);
      return [];
    }
  }

  async _requestPublicMarket(path, params) {
    let lastError = null;

    for (const host of this.publicMarketRestBases) {
      try {
        const response = await axios.get(`https://${host}${path}`, {
          params,
          timeout: 15000,
        });
        this.lastPublicMarketHost = host;
        return response;
      } catch (error) {
        lastError = error;
        this.lastPublicMarketError = this._formatAxiosError(error);
        console.warn(
          `⚠️ Direct Bybit request failed via ${host}:`,
          error.response?.status || error.message
        );
      }
    }

    if (this.supabaseProxyUrl) {
      console.warn('⚠️ Direct Bybit hosts failed, retrying Supabase proxy');
      return this._requestSupabaseProxy(path, params);
    }

    throw lastError;
  }

  async _retryPublicMarketViaProxy(path, params) {
    if (!this.supabaseProxyUrl) return null;

    try {
      console.warn(`⚠️ Retrying Bybit public market via Supabase proxy: ${path}`);
      return await this._requestSupabaseProxy(path, params);
    } catch (error) {
      this.lastSupabaseProxyError = this._formatAxiosError(error);
      console.error('❌ Supabase proxy retry failed:', error.response?.status || error.message);
      return null;
    }
  }

  async _requestSupabaseProxy(path, params) {
    try {
      const response = await axios.get(this.supabaseProxyUrl, {
        params: {
          path,
          params: new URLSearchParams(
            Object.entries(params).map(([key, value]) => [key, String(value)])
          ).toString(),
        },
        headers: this._getSupabaseProxyHeaders(),
        timeout: 20000,
      });
      this.lastSupabaseProxyVersion = response.headers?.['x-scalparena-proxy-version'] || null;
      response.data = this._normalizeProxyResponseData(response.data);
      this.lastPublicMarketHost = 'supabase-proxy';
      return response;
    } catch (error) {
      this.lastSupabaseProxyError = this._formatAxiosError(error);
      const detail =
        error.response?.data?.error ||
        error.response?.data?.message ||
        error.response?.status ||
        error.message;
      console.error('❌ Supabase proxy request failed:', detail);
      throw error;
    }
  }

  _resetPublicMarketDiagnostics() {
    this.lastPublicMarketHost = null;
    this.lastPublicMarketError = null;
    this.lastSupabaseProxyError = null;
    this.lastSupabaseProxyVersion = null;
  }

  _formatAxiosError(error) {
    const data = error.response?.data || {};
    return {
      status: error.response?.status || null,
      message: data.error || data.message || error.message,
      attempts: Array.isArray(data.attempts) ? data.attempts.slice(0, 3) : [],
    };
  }

  _normalizeProxyResponseData(data) {
    if (typeof data !== 'string') return data;

    try {
      return JSON.parse(data);
    } catch (error) {
      const preview = data.replace(/\s+/g, ' ').trim().slice(0, 220);
      throw new Error(`Supabase proxy returned invalid JSON: ${error.message}; preview=${preview}`);
    }
  }

  _getSupabaseProxyHeaders() {
    if (!this.supabaseProxyKey) return {};

    return {
      apikey: this.supabaseProxyKey,
      Authorization: `Bearer ${this.supabaseProxyKey}`,
    };
  }

  _mapBybitKlines(rawCandles) {
    return rawCandles
      .map((candle) => ({
        timestamp: Number(candle[0]),
        open: Number(candle[1]),
        high: Number(candle[2]),
        low: Number(candle[3]),
        close: Number(candle[4]),
        volume: Number(candle[5]),
        turnover: Number(candle[6]),
        confirm: true,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  _getPublicMarketRestBases() {
    if (process.env.PUMP_HUNTER_USE_TESTNET === 'true') return [this.restBase];

    const configured = String(process.env.PUMP_HUNTER_REST_BASES || '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean);

    return configured.length
      ? configured
      : ['api.bybit.com', 'api.bytick.com', 'api.bytick.nl', 'api.bybit-tr.com', 'api.bybit.kz'];
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
