// src/engine/marketRegimeDetector.js

const TechnicalIndicators = require('./indicators');

/**
 * Market Regime Detector
 *
 * RANGE -> Mean Reversion
 * TREND_UP / TREND_DOWN -> Momentum
 * NOISE -> skip
 */
class MarketRegimeDetector {
  static detect(candles) {
    if (!candles || candles.length < 20) {
      return this._buildUnknown();
    }

    const current = candles[candles.length - 1];
    const prices = candles.map((candle) => candle.close);
    const atr = TechnicalIndicators.calculateATR(candles, 14);
    const atrPercent = current.close ? (atr / current.close) * 100 : 0;
    const bollingerBands = TechnicalIndicators.calculateBollingerBands(prices, 20, 2);
    const bbRange = bollingerBands.upper - bollingerBands.lower;
    const bbWidth = bollingerBands.middle ? (bbRange / bollingerBands.middle) * 100 : 0;
    const roc12 = TechnicalIndicators.calculateROC(prices, 12);
    const ema20 = TechnicalIndicators.calculateEMA(prices, 20);
    const ema50 = prices.length >= 50 ? TechnicalIndicators.calculateEMA(prices, 50) : ema20;
    const emaSpread = current.close ? ((ema20 - ema50) / current.close) * 100 : 0;
    const macd = TechnicalIndicators.calculateMACD(prices);
    const macdBias = this._getMacdBias(macd);

    const trendScore = this._getTrendScore({ roc12, emaSpread, macdBias });
    const noiseScore = this._getNoiseScore({ atrPercent, bbWidth });

    let regime;
    let strategy;

    if (noiseScore >= 3) {
      regime = 'NOISE';
      strategy = 'SKIP';
    } else if (trendScore >= 2) {
      regime = 'TREND_UP';
      strategy = 'MOMENTUM';
    } else if (trendScore <= -2) {
      regime = 'TREND_DOWN';
      strategy = 'MOMENTUM';
    } else if (atrPercent < 1.2 && bbWidth < 3.5) {
      regime = 'LOW_VOL_RANGE';
      strategy = 'MEAN_REVERSION';
    } else {
      regime = 'ACTIVE_RANGE';
      strategy = 'MEAN_REVERSION';
    }

    return {
      regime,
      strategy,
      atr,
      atrPercent: this._round(atrPercent, 2),
      bbWidth: this._round(bbWidth, 2),
      roc12: this._round(roc12, 2),
      ema20: this._round(ema20, 8),
      ema50: this._round(ema50, 8),
      emaSpread: this._round(emaSpread, 2),
      macdBias,
      trendScore,
      noiseScore,
      reason: this._buildReason({ regime, atrPercent, bbWidth, roc12, emaSpread, macdBias }),
    };
  }

  static _getTrendScore({ roc12, emaSpread, macdBias }) {
    let score = 0;

    if (roc12 >= 1.2) score += 2;
    else if (roc12 <= -1.2) score -= 2;

    if (emaSpread >= 0.35) score += 1;
    else if (emaSpread <= -0.35) score -= 1;

    if (macdBias === 'BULLISH') score += 1;
    else if (macdBias === 'BEARISH') score -= 1;

    return score;
  }

  static _getNoiseScore({ atrPercent, bbWidth }) {
    let score = 0;

    if (atrPercent >= 4.5) score += 2;
    else if (atrPercent >= 3) score += 1;

    if (bbWidth >= 10) score += 2;
    else if (bbWidth >= 7) score += 1;

    if (atrPercent < 0.15 || bbWidth < 0.25) score += 2;

    return score;
  }

  static _getMacdBias(macd) {
    if (!macd || macd.macd === 0 && macd.signal === 0 && macd.histogram === 0) {
      return 'FLAT';
    }

    if (macd.histogram > 0 && macd.macd > macd.signal) return 'BULLISH';
    if (macd.histogram < 0 && macd.macd < macd.signal) return 'BEARISH';
    return 'MIXED';
  }

  static _buildReason({ regime, atrPercent, bbWidth, roc12, emaSpread, macdBias }) {
    return `${regime}: ATR ${atrPercent.toFixed(2)}%, BB width ${bbWidth.toFixed(2)}%, ROC12 ${roc12.toFixed(2)}%, EMA spread ${emaSpread.toFixed(2)}%, MACD ${macdBias}`;
  }

  static _buildUnknown() {
    return {
      regime: 'UNKNOWN',
      strategy: 'SKIP',
      atr: 0,
      atrPercent: 0,
      bbWidth: 0,
      roc12: 0,
      ema20: 0,
      ema50: 0,
      emaSpread: 0,
      macdBias: 'FLAT',
      trendScore: 0,
      noiseScore: 0,
      reason: 'Not enough candles for market regime detection',
    };
  }

  static _round(value, digits) {
    const multiplier = 10 ** digits;
    return Math.round((Number(value) || 0) * multiplier) / multiplier;
  }
}

module.exports = MarketRegimeDetector;
