const TechnicalIndicators = require('./indicators');

const MIN_CANDLES = 50;

class MarketContextV1 {
  static analyze(rawCandles = [], options = {}) {
    const candles = this._normalizeCandles(rawCandles);
    const timeframe = String(options.timeframe || '1');
    const source = options.source || 'BYBIT_WEBSOCKET';

    if (candles.length < MIN_CANDLES) {
      return {
        version: 'market_context_v1',
        state: 'UNKNOWN',
        reason: `need ${MIN_CANDLES} confirmed BTC candles, got ${candles.length}`,
        timeframe,
        source,
        candleCount: candles.length,
      };
    }

    const prices = candles.map((candle) => candle.close);
    const current = candles[candles.length - 1].close;
    const ema20 = TechnicalIndicators.calculateEMA(prices, 20);
    const ema50 = TechnicalIndicators.calculateEMA(prices, 50);
    const emaSpread = current > 0 ? (ema20 - ema50) / current * 100 : 0;
    const roc12 = TechnicalIndicators.calculateROC(prices, 12);
    const atr = TechnicalIndicators.calculateATR(candles, 14);
    const atrPercent = current > 0 ? atr / current * 100 : 0;
    const macd = TechnicalIndicators.calculateMACD(prices);
    const macdBias = this._macdBias(macd);
    const thresholds = this._thresholds(timeframe);

    let state = 'NEUTRAL';
    if (atrPercent >= thresholds.highVolAtrPercent) {
      state = 'HIGH_VOL';
    } else if (
      emaSpread >= thresholds.emaSpread &&
      roc12 >= thresholds.roc12 &&
      macdBias === 'BULLISH'
    ) {
      state = 'RISK_ON';
    } else if (
      emaSpread <= -thresholds.emaSpread &&
      roc12 <= -thresholds.roc12 &&
      macdBias === 'BEARISH'
    ) {
      state = 'RISK_OFF';
    }

    return {
      version: 'market_context_v1',
      state,
      reason: `${state}: BTC EMA spread ${this._round(emaSpread, 3)}%, ` +
        `ROC12 ${this._round(roc12, 3)}%, ATR ${this._round(atrPercent, 3)}%, MACD ${macdBias}`,
      timeframe,
      source,
      candleCount: candles.length,
      ema20: this._round(ema20, 8),
      ema50: this._round(ema50, 8),
      emaSpread: this._round(emaSpread, 3),
      roc12: this._round(roc12, 3),
      atrPercent: this._round(atrPercent, 3),
      macdBias,
    };
  }

  static assess(context = {}, direction = 'LONG') {
    const state = context.state || 'UNKNOWN';
    const normalizedDirection = String(direction || 'LONG').toUpperCase();
    let decision = 'CAUTION';
    let decisionReason = 'BTC context is neutral';

    if (state === 'UNKNOWN') {
      decision = 'UNKNOWN';
      decisionReason = 'BTC context has insufficient confirmed candles';
    } else if (state === 'HIGH_VOL') {
      decision = 'BLOCK';
      decisionReason = 'BTC volatility is abnormally high';
    } else if (state === 'RISK_ON') {
      decision = normalizedDirection === 'LONG' ? 'ALLOW' : 'BLOCK';
      decisionReason = normalizedDirection === 'LONG'
        ? 'LONG is aligned with BTC risk-on trend'
        : 'SHORT is against BTC risk-on trend';
    } else if (state === 'RISK_OFF') {
      decision = normalizedDirection === 'SHORT' ? 'ALLOW' : 'BLOCK';
      decisionReason = normalizedDirection === 'SHORT'
        ? 'SHORT is aligned with BTC risk-off trend'
        : 'LONG is against BTC risk-off trend';
    }

    return {
      ...context,
      decision,
      decisionReason,
    };
  }

  static attach(candidate, context) {
    if (!candidate) return candidate;
    return {
      ...candidate,
      marketContext: this.assess(context, candidate.direction),
    };
  }

  static _thresholds(timeframe) {
    const minutes = Math.max(1, Number.parseInt(timeframe, 10) || 1);
    if (minutes >= 15) {
      return { emaSpread: 0.2, roc12: 0.6, highVolAtrPercent: 1.5 };
    }
    if (minutes >= 5) {
      return { emaSpread: 0.1, roc12: 0.3, highVolAtrPercent: 1 };
    }
    return { emaSpread: 0.05, roc12: 0.15, highVolAtrPercent: 0.7 };
  }

  static _normalizeCandles(candles = []) {
    const byTimestamp = new Map();

    candles.forEach((raw) => {
      const candle = {
        timestamp: Number(raw.timestamp),
        open: Number(raw.open),
        high: Number(raw.high),
        low: Number(raw.low),
        close: Number(raw.close),
        volume: Number(raw.volume),
        confirm: raw.confirm,
      };
      const valid = (
        Number.isFinite(candle.timestamp) &&
        Number.isFinite(candle.open) && candle.open > 0 &&
        Number.isFinite(candle.high) && candle.high > 0 &&
        Number.isFinite(candle.low) && candle.low > 0 &&
        Number.isFinite(candle.close) && candle.close > 0 &&
        Number.isFinite(candle.volume) && candle.volume > 0 &&
        candle.confirm !== false
      );
      if (valid) byTimestamp.set(candle.timestamp, candle);
    });

    return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  static _macdBias(macd) {
    if (macd.histogram > 0 && macd.macd > macd.signal) return 'BULLISH';
    if (macd.histogram < 0 && macd.macd < macd.signal) return 'BEARISH';
    return 'MIXED';
  }

  static _round(value, digits) {
    const multiplier = 10 ** digits;
    return Math.round(Number(value) * multiplier) / multiplier;
  }
}

module.exports = MarketContextV1;
