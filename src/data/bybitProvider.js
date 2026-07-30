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
const BUFFER_SIZE = 125;
const COINGECKO_OHLC_DAYS = '1';
const COINGECKO_REQUEST_DELAY_MS = 2500;
const COINGECKO_RETRY_DELAY_MS = 30000;
const COINGECKO_MAX_RETRIES = 2;
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const OKX_PUBLIC_BASE = 'https://www.okx.com';
const GATE_FUTURES_BASE = 'https://api.gateio.ws/api/v4/futures/usdt';
const EXTREME_AUDIT_DEFAULT_TIMEOUT_MS = 6000;

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
    this.extremeAuditUseTestnet = process.env.EXTREME_USE_TESTNET === 'true';
    this.extremeAuditRestBases = this.extremeAuditUseTestnet
      ? ['api-testnet.bybit.com']
      : this._getExtremeAuditRestBases();
    this.extremeAuditWsUrl = this.extremeAuditUseTestnet
      ? 'wss://stream-testnet.bybit.com/v5/public/linear'
      : 'wss://stream.bybit.com/v5/public/linear';
    this.lastPublicMarketHost = null;
    this.lastPublicMarketError = null;
    this.lastSupabaseProxyError = null;
    this.lastSupabaseProxyVersion = null;
    this.lastBinanceMarketError = null;
    this.lastOkxMarketError = null;
    this.lastGateMarketError = null;
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

  async getBinanceFuturesTickers() {
    this.lastBinanceMarketError = null;

    try {
      const response = await axios.get(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr`, {
        timeout: 20000,
      });

      this.lastPublicMarketHost = 'binance-futures';
      return (response.data || []).map((ticker) => ({
        symbol: ticker.symbol,
        price24hPcnt: String(Number.parseFloat(ticker.priceChangePercent || 0) / 100),
        turnover24h: ticker.quoteVolume,
        lastPrice: ticker.lastPrice,
      }));
    } catch (error) {
      this.lastBinanceMarketError = this._formatAxiosError(error);
      console.error('❌ Binance futures tickers request failed:', error.response?.status || error.message);
      return [];
    }
  }

  async getBinanceFuturesKlines(pair, interval = '15', limit = 96) {
    try {
      const response = await axios.get(`${BINANCE_FUTURES_BASE}/fapi/v1/klines`, {
        params: {
          symbol: pair,
          interval: this._toBinanceInterval(interval),
          limit,
        },
        timeout: 20000,
      });

      return (response.data || []).map((candle) => ({
        timestamp: Number(candle[0]),
        open: Number(candle[1]),
        high: Number(candle[2]),
        low: Number(candle[3]),
        close: Number(candle[4]),
        volume: Number(candle[5]),
        turnover: Number(candle[7]),
        confirm: true,
      }));
    } catch (error) {
      this.lastBinanceMarketError = this._formatAxiosError(error);
      console.error(`❌ Binance futures klines request failed for ${pair}:`, error.response?.status || error.message);
      return [];
    }
  }

  async getOkxSwapTickers() {
    this.lastOkxMarketError = null;

    try {
      const response = await axios.get(`${OKX_PUBLIC_BASE}/api/v5/market/tickers`, {
        params: { instType: 'SWAP' },
        timeout: 20000,
      });

      if (response.data?.code !== '0') {
        throw new Error(`OKX retCode ${response.data?.code}: ${response.data?.msg || 'unknown'}`);
      }

      this.lastPublicMarketHost = 'okx-swap';
      return (response.data?.data || [])
        .filter((ticker) => String(ticker.instId || '').endsWith('-USDT-SWAP'))
        .map((ticker) => {
          const last = Number.parseFloat(ticker.last || 0);
          const open24h = Number.parseFloat(ticker.open24h || 0);
          const volumeCurrency24h = Number.parseFloat(ticker.volCcy24h || ticker.vol24h || 0);

          return {
            symbol: this._okxInstIdToSymbol(ticker.instId),
            okxInstId: ticker.instId,
            price24hPcnt: open24h > 0 ? String((last - open24h) / open24h) : '0',
            turnover24h: String(volumeCurrency24h * last),
            lastPrice: ticker.last,
          };
        });
    } catch (error) {
      this.lastOkxMarketError = this._formatAxiosError(error);
      console.error('❌ OKX swap tickers request failed:', error.response?.status || error.message);
      return [];
    }
  }

  async getOkxSwapKlines(pair, interval = '15', limit = 96) {
    try {
      const response = await axios.get(`${OKX_PUBLIC_BASE}/api/v5/market/candles`, {
        params: {
          instId: this._symbolToOkxInstId(pair),
          bar: this._toOkxBar(interval),
          limit,
        },
        timeout: 20000,
      });

      if (response.data?.code !== '0') {
        throw new Error(`OKX retCode ${response.data?.code}: ${response.data?.msg || 'unknown'}`);
      }

      return (response.data?.data || [])
        .map((candle) => ({
          timestamp: Number(candle[0]),
          open: Number(candle[1]),
          high: Number(candle[2]),
          low: Number(candle[3]),
          close: Number(candle[4]),
          volume: Number(candle[5]),
          turnover: Number(candle[7] || candle[6] || 0),
          confirm: candle[8] === '1',
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      this.lastOkxMarketError = this._formatAxiosError(error);
      console.error(`❌ OKX swap klines request failed for ${pair}:`, error.response?.status || error.message);
      return [];
    }
  }

  async getOkxSwapPrice(pair) {
    try {
      const response = await axios.get(`${OKX_PUBLIC_BASE}/api/v5/market/ticker`, {
        params: {
          instId: this._symbolToOkxInstId(pair),
        },
        timeout: 15000,
      });

      if (response.data?.code !== '0') {
        throw new Error(`OKX retCode ${response.data?.code}: ${response.data?.msg || 'unknown'}`);
      }

      const ticker = response.data?.data?.[0];
      const price = Number(ticker?.last);
      return Number.isFinite(price) && price > 0 ? price : null;
    } catch (error) {
      this.lastOkxMarketError = this._formatAxiosError(error);
      console.error(`❌ OKX swap price request failed for ${pair}:`, error.response?.status || error.message);
      return null;
    }
  }

  async getGateFuturesTickers() {
    try {
      const response = await axios.get(`${GATE_FUTURES_BASE}/tickers`, {
        timeout: 20000,
        headers: {
          Accept: 'application/json',
        },
      });

      return (response.data || [])
        .filter((ticker) => String(ticker.contract || '').endsWith('_USDT'))
        .map((ticker) => {
          const lastPrice = Number(ticker.last);
          const multiplier = Number(ticker.quanto_multiplier);
          const totalSize = Number(ticker.total_size);
          const openInterestUsd = (
            Number.isFinite(lastPrice) &&
            Number.isFinite(multiplier) &&
            Number.isFinite(totalSize)
          ) ? lastPrice * multiplier * totalSize : null;

          return {
            symbol: this._gateContractToSymbol(ticker.contract),
            contract: ticker.contract,
            lastPrice,
            high24h: Number(ticker.high_24h),
            low24h: Number(ticker.low_24h),
            priceChange24hPercent: Number(ticker.change_percentage),
            turnover24h: Number(ticker.volume_24h_quote || ticker.volume_24h_settle),
            fundingRate: Number(ticker.funding_rate),
            openInterestUsd,
            bidPrice: Number(ticker.highest_bid),
            askPrice: Number(ticker.lowest_ask),
            marketSource: 'GATE',
          };
        });
    } catch (error) {
      console.error(
        '❌ Gate futures tickers request failed:',
        error.response?.status || error.message
      );
      return [];
    }
  }

  async getGateSpotSymbols() {
    try {
      const response = await axios.get('https://api.gateio.ws/api/v4/spot/currency_pairs', {
        timeout: 20000,
        headers: {
          Accept: 'application/json',
        },
      });

      return (response.data || [])
        .map((pair) => String(pair.id || '').toUpperCase())
        .filter((pair) => pair.endsWith('_USDT'))
        .map((pair) => this._gateContractToSymbol(pair));
    } catch (error) {
      console.error(
        '❌ Gate spot symbols request failed:',
        error.response?.status || error.message
      );
      return [];
    }
  }

  async getGateFuturesKlines(pair, interval = '15', limit = 200) {
    this.lastGateMarketError = null;

    try {
      const response = await axios.get(`${GATE_FUTURES_BASE}/candlesticks`, {
        params: {
          contract: this._symbolToGateContract(pair),
          interval: this._toGateInterval(interval),
          limit,
        },
        timeout: 20000,
        headers: {
          Accept: 'application/json',
        },
      });
      const intervalMs = this._intervalMinutes(interval) * 60 * 1000;
      const currentBucket = Math.floor(Date.now() / intervalMs) * intervalMs;

      return (response.data || [])
        .map((candle) => {
          const timestamp = Number(candle.t) * 1000;
          return {
            timestamp,
            open: Number(candle.o),
            high: Number(candle.h),
            low: Number(candle.l),
            close: Number(candle.c),
            volume: Number(candle.v),
            turnover: Number(candle.sum || 0),
            confirm: timestamp < currentBucket,
          };
        })
        .sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      this.lastGateMarketError = this._formatAxiosError(error);
      console.error(
        `❌ Gate futures klines request failed for ${pair}:`,
        error.response?.status || error.message
      );
      return [];
    }
  }

  async auditBybitExtremeData(pair, options = {}) {
    const timeoutMs = options.timeoutMs || EXTREME_AUDIT_DEFAULT_TIMEOUT_MS;
    const [restProbes, websocketProbes] = await Promise.all([
      Promise.all([
        this._probeBybitRest('ticker', '/v5/market/tickers', {
          category: 'linear',
          symbol: pair,
        }, timeoutMs),
        this._probeBybitRest('candles', '/v5/market/kline', {
          category: 'linear',
          symbol: pair,
          interval: '5',
          limit: 3,
        }, timeoutMs),
        this._probeBybitRest('funding', '/v5/market/funding/history', {
          category: 'linear',
          symbol: pair,
          limit: 3,
        }, timeoutMs),
        this._probeBybitRest('openInterest', '/v5/market/open-interest', {
          category: 'linear',
          symbol: pair,
          intervalTime: '5min',
          limit: 3,
        }, timeoutMs),
        this._probeBybitRest('orderbook', '/v5/market/orderbook', {
          category: 'linear',
          symbol: pair,
          limit: 25,
        }, timeoutMs),
      ]),
      this._probeBybitExtremeStream(pair, timeoutMs),
    ]);
    const restByCapability = Object.fromEntries(
      restProbes.map((probe) => [probe.capability, probe])
    );
    const merged = {};

    for (const capability of [
      'ticker',
      'candles',
      'funding',
      'openInterest',
      'orderbook',
      'liquidations',
    ]) {
      const rest = restByCapability[capability];
      const websocket = websocketProbes[capability];
      merged[capability] = rest?.available ? rest : websocket?.available ? websocket : rest || websocket;
    }

    merged._meta = {
      restAvailable: restProbes.filter((probe) => probe.available).length,
      websocketAvailable: Object.values(websocketProbes)
        .filter((probe) => probe.available).length,
    };
    return merged;
  }

  async auditOkxExtremeData(pair, options = {}) {
    const timeoutMs = options.timeoutMs || EXTREME_AUDIT_DEFAULT_TIMEOUT_MS;
    const instId = this._symbolToOkxInstId(pair);
    const uly = `${String(pair).replace(/USDT$/, '')}-USDT`;
    const probes = await Promise.all([
      this._probeOkxRest('ticker', '/api/v5/market/ticker', { instId }, timeoutMs),
      this._probeOkxRest('candles', '/api/v5/market/candles', {
        instId,
        bar: '5m',
        limit: 3,
      }, timeoutMs),
      this._probeOkxRest('funding', '/api/v5/public/funding-rate-history', {
        instId,
        limit: 3,
      }, timeoutMs),
      this._probeOkxRest('openInterest', '/api/v5/public/open-interest', {
        instType: 'SWAP',
        instId,
      }, timeoutMs),
      this._probeOkxRest('orderbook', '/api/v5/market/books', {
        instId,
        sz: 25,
      }, timeoutMs),
      this._probeOkxRest('liquidations', '/api/v5/public/liquidation-orders', {
        instType: 'SWAP',
        uly,
        state: 'filled',
        limit: 20,
      }, timeoutMs, { emptyIsAvailable: true }),
    ]);

    return Object.fromEntries(probes.map((probe) => [probe.capability, probe]));
  }

  async auditGateExtremeData(pair, options = {}) {
    const timeoutMs = options.timeoutMs || EXTREME_AUDIT_DEFAULT_TIMEOUT_MS;
    const contract = this._symbolToGateContract(pair);
    const [ticker, candles, contractProbe, orderbook, liquidations] = await Promise.all([
      this._probeGateRest('ticker', '/tickers', { contract }, timeoutMs),
      this._probeGateRest('candles', '/candlesticks', {
        contract,
        interval: '5m',
        limit: 3,
      }, timeoutMs),
      this._probeGateContract(contract, timeoutMs),
      this._probeGateRest('orderbook', '/order_book', {
        contract,
        limit: 25,
      }, timeoutMs),
      this._probeGateRest('liquidations', '/liq_orders', {
        contract,
        limit: 20,
      }, timeoutMs, { emptyIsAvailable: true }),
    ]);

    return {
      ticker,
      candles,
      funding: contractProbe.funding,
      openInterest: contractProbe.openInterest,
      orderbook,
      liquidations,
    };
  }

  async _probeBybitRest(capability, path, params, timeoutMs) {
    const startedAt = Date.now();

    try {
      const response = await this._requestBybitAudit(path, params, timeoutMs);
      const payload = this._normalizeProxyResponseData(response.data);
      const records = this._countBybitRecords(capability, payload);

      if (payload?.retCode !== 0) {
        throw new Error(`Bybit retCode ${payload?.retCode}: ${payload?.retMsg || 'unknown'}`);
      }

      return this._buildAuditProbe({
        capability,
        available: records > 0,
        source: response.source,
        records,
        latencyMs: Date.now() - startedAt,
        error: records > 0 ? null : 'empty response',
      });
    } catch (error) {
      return this._buildAuditProbe({
        capability,
        available: false,
        source: null,
        records: 0,
        latencyMs: Date.now() - startedAt,
        error: this._formatAuditError(error),
      });
    }
  }

  async _probeOkxRest(capability, path, params, timeoutMs, options = {}) {
    const startedAt = Date.now();

    try {
      const response = await axios.get(`${OKX_PUBLIC_BASE}${path}`, {
        params,
        timeout: timeoutMs,
      });
      const payload = response.data;

      if (payload?.code !== '0') {
        throw new Error(`OKX code ${payload?.code}: ${payload?.msg || 'unknown'}`);
      }

      const records = this._countOkxRecords(capability, payload);
      const available = records > 0 || options.emptyIsAvailable === true;

      return this._buildAuditProbe({
        capability,
        available,
        source: 'OKX',
        records,
        latencyMs: Date.now() - startedAt,
        error: available ? null : 'empty response',
        note: available && records === 0 ? 'endpoint available; no recent events' : null,
      });
    } catch (error) {
      return this._buildAuditProbe({
        capability,
        available: false,
        source: 'OKX',
        records: 0,
        latencyMs: Date.now() - startedAt,
        error: this._formatAuditError(error),
      });
    }
  }

  async _probeGateRest(capability, path, params, timeoutMs, options = {}) {
    const startedAt = Date.now();

    try {
      const response = await axios.get(`${GATE_FUTURES_BASE}${path}`, {
        params,
        timeout: timeoutMs,
        headers: {
          Accept: 'application/json',
        },
      });
      const records = this._countGateRecords(capability, response.data);
      const available = records > 0 || options.emptyIsAvailable === true;

      return this._buildAuditProbe({
        capability,
        available,
        source: 'GATE',
        records,
        latencyMs: Date.now() - startedAt,
        error: available ? null : 'empty response',
        note: available && records === 0 ? 'endpoint available; no recent events' : null,
      });
    } catch (error) {
      return this._buildAuditProbe({
        capability,
        available: false,
        source: 'GATE',
        records: 0,
        latencyMs: Date.now() - startedAt,
        error: this._formatAuditError(error),
      });
    }
  }

  async _probeGateContract(contract, timeoutMs) {
    const startedAt = Date.now();

    try {
      const response = await axios.get(`${GATE_FUTURES_BASE}/contracts/${contract}`, {
        timeout: timeoutMs,
        headers: {
          Accept: 'application/json',
        },
      });
      const payload = response.data || {};
      const latencyMs = Date.now() - startedAt;
      const hasFunding = payload.funding_rate != null &&
        payload.funding_rate !== '' &&
        Number.isFinite(Number(payload.funding_rate));
      const hasOpenInterest = payload.position_size != null &&
        payload.position_size !== '' &&
        Number.isFinite(Number(payload.position_size));

      return {
        funding: this._buildAuditProbe({
          capability: 'funding',
          available: hasFunding,
          source: 'GATE',
          records: hasFunding ? 1 : 0,
          latencyMs,
          error: hasFunding ? null : 'funding_rate missing',
        }),
        openInterest: this._buildAuditProbe({
          capability: 'openInterest',
          available: hasOpenInterest,
          source: 'GATE',
          records: hasOpenInterest ? 1 : 0,
          latencyMs,
          error: hasOpenInterest ? null : 'position_size missing',
        }),
      };
    } catch (error) {
      const probeError = this._formatAuditError(error);
      const latencyMs = Date.now() - startedAt;
      return {
        funding: this._buildAuditProbe({
          capability: 'funding',
          available: false,
          source: 'GATE',
          records: 0,
          latencyMs,
          error: probeError,
        }),
        openInterest: this._buildAuditProbe({
          capability: 'openInterest',
          available: false,
          source: 'GATE',
          records: 0,
          latencyMs,
          error: probeError,
        }),
      };
    }
  }

  async _requestBybitAudit(path, params, timeoutMs) {
    const attempts = [];

    if (this.supabaseProxyUrl) {
      try {
        const response = await axios.get(this.supabaseProxyUrl, {
          params: {
            path,
            params: new URLSearchParams(
              Object.entries(params).map(([key, value]) => [key, String(value)])
            ).toString(),
          },
          headers: this._getSupabaseProxyHeaders(),
          timeout: timeoutMs,
        });
        return { data: response.data, source: 'BYBIT_PROXY' };
      } catch (error) {
        attempts.push(`proxy:${error.response?.status || error.message}`);
      }
    }

    for (const host of this.extremeAuditRestBases) {
      try {
        const response = await axios.get(`https://${host}${path}`, {
          params,
          timeout: timeoutMs,
        });
        return { data: response.data, source: `BYBIT:${host}` };
      } catch (error) {
        attempts.push(`${host}:${error.response?.status || error.message}`);
      }
    }

    throw new Error(`all routes failed (${attempts.join(', ')})`);
  }

  _probeBybitExtremeStream(pair, timeoutMs) {
    const startedAt = Date.now();
    const capabilities = [
      'ticker',
      'candles',
      'funding',
      'openInterest',
      'orderbook',
      'liquidations',
    ];

    return new Promise((resolve) => {
      let settled = false;
      let ws = null;
      const probes = Object.fromEntries(capabilities.map((capability) => [
        capability,
        this._buildAuditProbe({
          capability,
          available: false,
          source: 'BYBIT_WS',
          records: 0,
          latencyMs: 0,
          error: 'no websocket data received',
        }),
      ]));

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ws) {
          ws.removeAllListeners();
          ws.terminate();
        }
        const latencyMs = Date.now() - startedAt;
        Object.values(probes).forEach((probe) => {
          if (!probe.latencyMs) probe.latencyMs = latencyMs;
        });
        resolve(probes);
      };

      const markAvailable = (capability, records, note = null) => {
        probes[capability] = this._buildAuditProbe({
          capability,
          available: true,
          source: 'BYBIT_WS',
          records,
          latencyMs: Date.now() - startedAt,
          error: null,
          note,
        });
      };

      const maybeFinish = () => {
        if (capabilities.every((capability) => probes[capability].available)) {
          finish();
        }
      };

      const timer = setTimeout(() => {
        finish();
      }, timeoutMs);

      try {
        ws = new WebSocket(this.extremeAuditWsUrl);
        ws.on('open', () => {
          ws.send(JSON.stringify({
            op: 'subscribe',
            args: [
              `tickers.${pair}`,
              `kline.5.${pair}`,
              `orderbook.50.${pair}`,
              `allLiquidation.${pair}`,
            ],
          }));
        });
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.op === 'subscribe') {
              if (message.success) {
                markAvailable(
                  'liquidations',
                  0,
                  'subscription available; no event required'
                );
                maybeFinish();
              } else {
                capabilities.forEach((capability) => {
                  probes[capability].error = message.ret_msg || 'subscription rejected';
                });
                finish();
              }
            } else if (message.topic === `tickers.${pair}`) {
              const ticker = message.data || {};
              markAvailable('ticker', 1);
              if (ticker.fundingRate != null && ticker.fundingRate !== '') {
                markAvailable('funding', 1);
              }
              if (ticker.openInterest != null && ticker.openInterest !== '') {
                markAvailable('openInterest', 1);
              }
              maybeFinish();
            } else if (message.topic === `kline.5.${pair}`) {
              markAvailable('candles', Array.isArray(message.data) ? message.data.length : 0);
              maybeFinish();
            } else if (message.topic === `orderbook.50.${pair}`) {
              const book = message.data || {};
              markAvailable(
                'orderbook',
                (Array.isArray(book.b) ? book.b.length : 0) +
                  (Array.isArray(book.a) ? book.a.length : 0)
              );
              maybeFinish();
            } else if (message.topic === `allLiquidation.${pair}`) {
              markAvailable(
                'liquidations',
                Array.isArray(message.data) ? message.data.length : 0
              );
              maybeFinish();
            }
          } catch (error) {
            capabilities
              .filter((capability) => !probes[capability].available)
              .forEach((capability) => {
                probes[capability].error = `invalid websocket JSON: ${error.message}`;
              });
            finish();
          }
        });
        ws.on('error', (error) => {
          capabilities
            .filter((capability) => !probes[capability].available)
            .forEach((capability) => {
              probes[capability].error = error.message;
            });
          finish();
        });
        ws.on('close', () => {
          capabilities
            .filter((capability) => !probes[capability].available)
            .forEach((capability) => {
              probes[capability].error = 'connection closed before data arrived';
            });
          finish();
        });
      } catch (error) {
        capabilities.forEach((capability) => {
          probes[capability].error = error.message;
        });
        finish();
      }
    });
  }

  _countGateRecords(capability, payload) {
    if (capability === 'orderbook') {
      return (payload?.bids || []).length + (payload?.asks || []).length;
    }

    if (capability === 'ticker' || capability === 'candles' || capability === 'liquidations') {
      return Array.isArray(payload) ? payload.length : 0;
    }

    return payload ? 1 : 0;
  }

  _symbolToGateContract(symbol) {
    const base = String(symbol || '').replace(/USDT$/, '');
    return `${base}_USDT`;
  }

  _gateContractToSymbol(contract) {
    return String(contract || '').replace(/_USDT$/, 'USDT').replace(/_/g, '');
  }

  _countBybitRecords(capability, payload) {
    if (capability === 'orderbook') {
      const bids = payload?.result?.b || [];
      const asks = payload?.result?.a || [];
      return bids.length + asks.length;
    }

    return Array.isArray(payload?.result?.list) ? payload.result.list.length : 0;
  }

  _countOkxRecords(capability, payload) {
    if (capability === 'orderbook') {
      const book = payload?.data?.[0] || {};
      return (book.bids || []).length + (book.asks || []).length;
    }

    if (capability === 'liquidations') {
      return (payload?.data || []).reduce(
        (count, group) => count + (Array.isArray(group.details) ? group.details.length : 0),
        0
      );
    }

    return Array.isArray(payload?.data) ? payload.data.length : 0;
  }

  _buildAuditProbe({
    capability,
    available,
    source,
    records,
    latencyMs,
    error = null,
    note = null,
  }) {
    return {
      capability,
      available: available === true,
      source,
      records: Number(records || 0),
      latencyMs: Number(latencyMs || 0),
      error,
      note,
    };
  }

  _formatAuditError(error) {
    const status = error.response?.status;
    const data = error.response?.data || {};
    const message = data.error || data.message || error.message || 'unknown error';
    return [status, message].filter(Boolean).join(' ');
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
      this.lastSupabaseProxyVersion = error.response?.headers?.['x-scalparena-proxy-version'] || null;
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
    this.lastBinanceMarketError = null;
    this.lastOkxMarketError = null;
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

  _toBinanceInterval(interval) {
    const value = String(interval);
    if (value.endsWith('m') || value.endsWith('h') || value.endsWith('d') || value.endsWith('w')) {
      return value;
    }

    const map = {
      1: '1m',
      3: '3m',
      5: '5m',
      15: '15m',
      30: '30m',
      60: '1h',
      120: '2h',
      240: '4h',
      D: '1d',
    };

    return map[value] || '15m';
  }

  _toOkxBar(interval) {
    const value = String(interval);
    if (value.endsWith('m') || value.endsWith('H') || value.endsWith('D') || value.endsWith('W')) {
      return value;
    }

    const map = {
      1: '1m',
      3: '3m',
      5: '5m',
      15: '15m',
      30: '30m',
      60: '1H',
      120: '2H',
      240: '4H',
      D: '1D',
    };

    return map[value] || '15m';
  }

  _toGateInterval(interval) {
    const value = String(interval);
    if (value.endsWith('m') || value.endsWith('h') || value.endsWith('d')) {
      return value.toLowerCase();
    }

    const map = {
      1: '1m',
      5: '5m',
      15: '15m',
      30: '30m',
      60: '1h',
      240: '4h',
      D: '1d',
    };

    return map[value] || '15m';
  }

  _intervalMinutes(interval) {
    const value = String(interval);
    if (/^\d+m$/i.test(value)) return Number.parseInt(value, 10);
    if (/^\d+h$/i.test(value)) return Number.parseInt(value, 10) * 60;
    if (/^\d+d$/i.test(value)) return Number.parseInt(value, 10) * 1440;
    if (value === 'D') return 1440;
    return Number.parseInt(value, 10) || 15;
  }

  _okxInstIdToSymbol(instId) {
    return String(instId || '').replace('-USDT-SWAP', 'USDT').replace(/-/g, '');
  }

  _symbolToOkxInstId(symbol) {
    const base = String(symbol || '').replace(/USDT$/, '');
    return `${base}-USDT-SWAP`;
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

  _getExtremeAuditRestBases() {
    const configured = String(process.env.EXTREME_REST_BASES || '')
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
