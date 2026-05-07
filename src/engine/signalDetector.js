// src/engine/signalDetector.js

const TechnicalIndicators = require('./indicators');
const MarketRegimeDetector = require('./marketRegimeDetector');

/**
 * Hybrid Strategy
 *
 * RANGE / LOW VOL -> Mean Reversion
 * TREND_UP / TREND_DOWN -> Momentum
 * NOISE -> skip
 */

const MIN_VOLUME = 80;
const MIN_MR_VOLUME = 150;
const MIN_BB_WIDTH = 0.5;
const MR_LONG_RSI_MAX = 25;
const MR_SHORT_RSI_MIN = 72;

const MR_TP_PERCENT = 0.008;
const MR_SL_PERCENT = 0.008;
const MOMENTUM_TP_PERCENT = 0.012;
const MOMENTUM_SL_PERCENT = 0.008;
const LOW_VOL_MACD_ALIGNED_BONUS = 10;
const LOW_VOL_MACD_AGAINST_PENALTY = 15;

class SignalDetector {
  static detectSignal(pair, candles) {
    if (!candles || candles.length < 20) return null;

    const context = this._buildContext(candles);
    if (!context) return null;

    if (context.market.strategy === 'SKIP') return null;

    if (context.market.strategy === 'MOMENTUM') {
      return this._detectMomentum(pair, context);
    }

    return this._detectMeanReversion(pair, context);
  }

  static scanAll(provider) {
    const signals = [];
    const pairs = provider.getPairs();

    for (const pair of pairs) {
      const candles = provider.getCandles(pair, 50);
      if (!provider.hasEnoughData(pair, 20)) continue;

      const signal = this.detectSignal(pair, candles);
      if (signal) signals.push(signal);
    }

    signals.sort((a, b) => this._compareSignals(a, b));
    return signals;
  }

  static _compareSignals(a, b) {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }

    const rsiDiff = this._getRsiExtremeness(b) - this._getRsiExtremeness(a);
    if (rsiDiff !== 0) return rsiDiff;

    const bbDiff = this._getBbExtremeness(b) - this._getBbExtremeness(a);
    if (bbDiff !== 0) return bbDiff;

    return b.volume - a.volume;
  }

  static _getRsiExtremeness(signal) {
    return signal.type === 'SHORT' ? signal.rsi : 100 - signal.rsi;
  }

  static _getBbExtremeness(signal) {
    return signal.type === 'SHORT' ? signal.bbPosition : 100 - signal.bbPosition;
  }

  static _buildContext(candles) {
    const current = candles[candles.length - 1];
    const prices = candles.map((candle) => candle.close);
    const rsi = TechnicalIndicators.calculateRSI(prices, 14);
    const bollingerBands = TechnicalIndicators.calculateBollingerBands(prices, 20, 2);
    const volume = TechnicalIndicators.calculateVolumeProfile(candles, 20);
    const atr = TechnicalIndicators.calculateATR(candles, 14);
    const macd = TechnicalIndicators.calculateMACD(prices);
    const market = MarketRegimeDetector.detect(candles);

    const currentPrice = current.close;
    const atrPercent = currentPrice ? (atr / currentPrice) * 100 : 0;
    const bbRange = bollingerBands.upper - bollingerBands.lower;

    if (!Number.isFinite(bbRange) || bbRange <= 0 || bollingerBands.middle === 0) {
      return null;
    }

    const bbWidth = (bbRange / bollingerBands.middle) * 100;
    const bbPosition = ((currentPrice - bollingerBands.lower) / bbRange) * 100;
    const macdBias = this._getMacdBias(macd);
    const candleImpulse = current.open ? ((current.close - current.open) / current.open) * 100 : 0;

    return {
      candles,
      current,
      prices,
      currentPrice,
      rsi,
      bollingerBands,
      bbPosition,
      bbWidth,
      volume,
      atr,
      atrPercent,
      macd,
      macdBias,
      candleImpulse,
      market,
    };
  }

  static _detectMeanReversion(pair, context) {
    const direction = this._getMeanReversionDirection(
      context.rsi,
      context.bbPosition,
      context.bbWidth,
      context.volume
    );

    if (!direction) return null;

    const stopLoss = direction === 'LONG'
      ? parseFloat((context.currentPrice * (1 - MR_SL_PERCENT)).toFixed(8))
      : parseFloat((context.currentPrice * (1 + MR_SL_PERCENT)).toFixed(8));
    const takeProfit = direction === 'LONG'
      ? parseFloat((context.currentPrice * (1 + MR_TP_PERCENT)).toFixed(8))
      : parseFloat((context.currentPrice * (1 - MR_TP_PERCENT)).toFixed(8));

    const confidence = this._calculateMeanReversionConfidence(
      context.rsi,
      context.bbPosition,
      context.volume,
      direction,
      context
    );

    return this._buildSignal(pair, context, {
      direction,
      strategy: 'MEAN_REVERSION',
      entryMode: this._isExtreme(context.rsi) ? 'STRONG' : 'STANDARD',
      stopLoss,
      takeProfit,
      tpPercent: MR_TP_PERCENT,
      slPercent: MR_SL_PERCENT,
      confidence,
      setupReason: this._buildMeanReversionReason(direction, context),
      invalidationRule: this._buildInvalidationRule(direction, stopLoss),
    });
  }

  static _detectMomentum(pair, context) {
    const direction = context.market.regime === 'TREND_UP' ? 'LONG' : 'SHORT';
    const valid = this._isMomentumEntryValid(direction, context);

    if (!valid) return null;

    const stopLoss = direction === 'LONG'
      ? parseFloat((context.currentPrice * (1 - MOMENTUM_SL_PERCENT)).toFixed(8))
      : parseFloat((context.currentPrice * (1 + MOMENTUM_SL_PERCENT)).toFixed(8));
    const takeProfit = direction === 'LONG'
      ? parseFloat((context.currentPrice * (1 + MOMENTUM_TP_PERCENT)).toFixed(8))
      : parseFloat((context.currentPrice * (1 - MOMENTUM_TP_PERCENT)).toFixed(8));

    return this._buildSignal(pair, context, {
      direction,
      strategy: 'MOMENTUM',
      entryMode: 'TREND_FOLLOW',
      stopLoss,
      takeProfit,
      tpPercent: MOMENTUM_TP_PERCENT,
      slPercent: MOMENTUM_SL_PERCENT,
      confidence: this._calculateMomentumConfidence(direction, context),
      setupReason: this._buildMomentumReason(direction, context),
      invalidationRule: this._buildInvalidationRule(direction, stopLoss),
    });
  }

  static _buildSignal(pair, context, config) {
    const slDist = Math.abs(context.currentPrice - config.stopLoss);
    const tpDist = Math.abs(context.currentPrice - config.takeProfit);
    const riskReward = parseFloat((tpDist / slDist).toFixed(2));

    return {
      pair,
      type: config.direction,
      entryPrice: context.currentPrice,

      stopLoss: config.stopLoss,
      takeProfit: config.takeProfit,
      tpPercent: parseFloat((config.tpPercent * 100).toFixed(2)),
      slPercent: parseFloat((config.slPercent * 100).toFixed(2)),
      riskReward,
      maxRisk: null,

      rsi: parseFloat(context.rsi.toFixed(2)),
      volume: parseFloat(context.volume.toFixed(2)),
      atr: parseFloat(context.atr.toFixed(6)),
      atrPercent: parseFloat(context.atrPercent.toFixed(2)),
      bbPosition: parseFloat(context.bbPosition.toFixed(1)),
      bbWidth: parseFloat(context.bbWidth.toFixed(2)),
      macd: parseFloat(context.macd.macd.toFixed(4)),
      macdSignal: parseFloat(context.macd.signal.toFixed(4)),
      macdHistogram: parseFloat(context.macd.histogram.toFixed(4)),
      macdBias: context.macdBias,
      impulse: parseFloat(context.candleImpulse.toFixed(2)),
      roc12: context.market.roc12,
      emaSpread: context.market.emaSpread,

      confidence: config.confidence,
      strategy: config.strategy,
      entryMode: config.entryMode,
      marketRegime: context.market.regime,
      marketRegimeReason: context.market.reason,
      setupReason: config.setupReason,
      invalidationRule: config.invalidationRule,

      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      status: 'ACTIVE',
    };
  }

  static _getMeanReversionDirection(rsi, bbPosition, bbWidth, volume) {
    if (volume < MIN_MR_VOLUME) return null;
    if (bbWidth < MIN_BB_WIDTH) return null;

    if (rsi < MR_LONG_RSI_MAX && bbPosition <= 20) return 'LONG';
    if (rsi > MR_SHORT_RSI_MIN && bbPosition >= 80) return 'SHORT';

    return null;
  }

  static _isMomentumEntryValid(direction, context) {
    if (context.volume < MIN_VOLUME) return false;

    if (direction === 'LONG') {
      if (context.rsi < 45 || context.rsi > 78) return false;
      if (context.macdBias === 'BEARISH') return false;
      if (context.currentPrice < context.market.ema20) return false;
      return context.market.roc12 > 1.2 || context.candleImpulse > 0.25;
    }

    if (context.rsi > 55 || context.rsi < 22) return false;
    if (context.macdBias === 'BULLISH') return false;
    if (context.currentPrice > context.market.ema20) return false;
    return context.market.roc12 < -1.2 || context.candleImpulse < -0.25;
  }

  static _isExtreme(rsi) {
    return rsi < MR_LONG_RSI_MAX || rsi > MR_SHORT_RSI_MIN;
  }

  static _calculateMeanReversionConfidence(rsi, bbPosition, volume, direction, context = {}) {
    let score = 40;

    if (direction === 'LONG') {
      if (rsi < 20) score += 25;
      else if (rsi < MR_LONG_RSI_MAX) score += 20;
    } else {
      if (rsi > 80) score += 25;
      else if (rsi > MR_SHORT_RSI_MIN) score += 20;
    }

    if (direction === 'LONG' && bbPosition <= 10) score += 10;
    if (direction === 'SHORT' && bbPosition >= 90) score += 10;

    if (volume >= 200) score += 10;
    else if (volume >= MIN_MR_VOLUME) score += 5;

    score += this._getLowVolMacdAdjustment(direction, context);

    return Math.round(Math.min(Math.max(score, 0), 100));
  }

  static _getLowVolMacdAdjustment(direction, context = {}) {
    if (context.market?.regime !== 'LOW_VOL_RANGE') return 0;

    if (this._isMacdAlignedWithDirection(direction, context.macdBias)) {
      return LOW_VOL_MACD_ALIGNED_BONUS;
    }

    if (this._isMacdAgainstDirection(direction, context.macdBias)) {
      return -LOW_VOL_MACD_AGAINST_PENALTY;
    }

    return 0;
  }

  static _isMacdAlignedWithDirection(direction, macdBias) {
    return (
      direction === 'LONG' && macdBias === 'BULLISH' ||
      direction === 'SHORT' && macdBias === 'BEARISH'
    );
  }

  static _isMacdAgainstDirection(direction, macdBias) {
    return (
      direction === 'LONG' && macdBias === 'BEARISH' ||
      direction === 'SHORT' && macdBias === 'BULLISH'
    );
  }

  static _calculateMomentumConfidence(direction, context) {
    let score = 55;
    const rocBonus = Math.min(Math.abs(context.market.roc12) / 4, 1) * 15;
    const trendBonus = Math.min(Math.abs(context.market.emaSpread) / 1.5, 1) * 10;
    const volumeBonus = Math.max(Math.min((context.volume - 100) / 50, 1), 0) * 10;

    score += rocBonus + trendBonus + volumeBonus;

    if (direction === 'LONG' && context.macdBias === 'BULLISH') score += 10;
    if (direction === 'SHORT' && context.macdBias === 'BEARISH') score += 10;

    return Math.round(Math.min(score, 100));
  }

  static _getMacdBias(macd) {
    if (!macd || macd.macd === 0 && macd.signal === 0 && macd.histogram === 0) {
      return 'FLAT';
    }

    if (macd.histogram > 0 && macd.macd > macd.signal) return 'BULLISH';
    if (macd.histogram < 0 && macd.macd < macd.signal) return 'BEARISH';
    return 'MIXED';
  }

  static _buildMeanReversionReason(direction, context) {
    const rsiReason = direction === 'LONG'
      ? `RSI ${context.rsi.toFixed(1)} в зоне перепроданности`
      : `RSI ${context.rsi.toFixed(1)} в зоне перекупленности`;

    const bbReason = direction === 'LONG'
      ? `цена у нижней BB (${context.bbPosition.toFixed(1)}%)`
      : `цена у верхней BB (${context.bbPosition.toFixed(1)}%)`;

    return `${rsiReason}, ${bbReason}, ${this._formatLabel(context.market.regime)}, MACD ${context.macdBias}`;
  }

  static _buildMomentumReason(direction, context) {
    const trend = direction === 'LONG' ? 'восходящий тренд' : 'нисходящий тренд';
    return `${trend}: ROC12 ${context.market.roc12}%, EMA spread ${context.market.emaSpread}%, MACD ${context.macdBias}`;
  }

  static _buildInvalidationRule(direction, stopLoss) {
    return direction === 'LONG'
      ? `Сценарий отменяется при пробое ниже SL $${stopLoss}`
      : `Сценарий отменяется при пробое выше SL $${stopLoss}`;
  }

  static _formatLabel(value) {
    return String(value || 'UNKNOWN').replace(/_/g, ' ');
  }
}

module.exports = SignalDetector;
