// src/engine/signalDetector.js

const TechnicalIndicators = require('./indicators');

/**
 * Dynamic Momentum Scalping - BIDIRECTIONAL MODE
 *
 * SHORT: рынок вырос → ждём откат вниз
 * LONG: рынок упал → ждём отскок вверх
 */

const MIN_IMPULSE = 1.5;
const MAX_IMPULSE = 20;
const MIN_RETRACE = 0.3;
const MIN_VOLUME = 102;
const RSI_SHORT = 60;
const RSI_LONG = 40;
const RSI_STRONG_S = 65;
const RSI_STRONG_L = 35;
const MIN_RR = 1.0;

const ATR_THRESHOLDS = [
  { maxAtr: 1, minImpulse: 1.5 },
  { maxAtr: 2, minImpulse: 2.5 },
  { maxAtr: 4, minImpulse: 4 },
  { maxAtr: 7, minImpulse: 6 },
  { maxAtr: Infinity, minImpulse: 10 },
];

const SL_TIERS = [
  { maxAtr: 1, slPercent: 0.003 },
  { maxAtr: 2, slPercent: 0.005 },
  { maxAtr: 5, slPercent: 0.0075 },
  { maxAtr: Infinity, slPercent: 0.01 },
];

class SignalDetector {
  static detectSignal(pair, candles) {
    if (!candles || candles.length < 5) return null;

    const current = candles[candles.length - 1];
    const prices = candles.map((candle) => candle.close);
    const atrPeriod = Math.min(14, Math.max(candles.length - 1, 1));
    const rsiPeriod = Math.min(14, Math.max(prices.length - 1, 2));
    const volumePeriod = Math.min(20, Math.max(candles.length, 2));
    const atr = TechnicalIndicators.calculateATR(candles, atrPeriod);
    const rsi = TechnicalIndicators.calculateRSI(prices, rsiPeriod);
    const volume = TechnicalIndicators.calculateVolumeProfile(candles, volumePeriod);
    const atrPercent = (atr / current.close) * 100;
    const threshold = this._getDynamicThreshold(atrPercent);

    const hourOpen = current.open;
    const hourHigh = current.high;
    const hourLow = current.low;
    const currentPrice = current.close;
    const impulse = ((currentPrice - hourOpen) / hourOpen) * 100;

    const direction = this._getDirection(impulse, rsi, threshold);
    if (!direction) return null;

    const checks = this._runChecks({
      impulse,
      rsi,
      volume,
      threshold,
      direction,
      hourHigh,
      hourLow,
      currentPrice,
    });

    if (!checks.passed) return null;

    const slPercent = this._getSlPercent(atrPercent);
    const tpPercent = this._getTpPercent(impulse);

    let stopLoss;
    let takeProfit;

    if (direction === 'SHORT') {
      stopLoss = parseFloat((hourHigh * (1 + slPercent)).toFixed(8));
      takeProfit = parseFloat((currentPrice * (1 - tpPercent)).toFixed(8));
    } else {
      stopLoss = parseFloat((hourLow * (1 - slPercent)).toFixed(8));
      takeProfit = parseFloat((currentPrice * (1 + tpPercent)).toFixed(8));
    }

    const slDist = Math.abs(currentPrice - stopLoss);
    const tpDist = Math.abs(currentPrice - takeProfit);
    const riskReward = parseFloat((tpDist / slDist).toFixed(2));
    if (riskReward < MIN_RR) return null;

    const confidence = this._calculateConfidence(impulse, rsi, volume, atrPercent, direction);

    return {
      pair,
      type: direction,
      entryPrice: currentPrice,
      hourHigh,
      hourLow,
      hourOpen,

      stopLoss,
      takeProfit,
      tpPercent: parseFloat((tpPercent * 100).toFixed(2)),
      riskReward,
      maxRisk: null,

      impulse: parseFloat(impulse.toFixed(2)),
      rsi: parseFloat(rsi.toFixed(2)),
      volume: parseFloat(volume.toFixed(2)),
      atr: parseFloat(atr.toFixed(6)),
      atrPercent: parseFloat(atrPercent.toFixed(2)),

      confidence,
      checks,
      entryMode: checks.strong_entry ? 'STRONG' : 'STANDARD',

      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      status: 'ACTIVE',
    };
  }

  static scanAll(provider) {
    const signals = [];
    const pairs = provider.getPairs();

    for (const pair of pairs) {
      const candles = provider.getCandles(pair, 50);
      if (!provider.hasEnoughData(pair, 5)) continue;

      const signal = this.detectSignal(pair, candles);
      if (signal) signals.push(signal);
    }

    signals.sort((a, b) => b.confidence - a.confidence);
    return signals;
  }

  static _getDirection(impulse, rsi, threshold) {
    const absImpulse = Math.abs(impulse);

    if (absImpulse < MIN_IMPULSE || absImpulse > MAX_IMPULSE) return null;

    if (impulse > threshold && rsi >= RSI_SHORT) return 'SHORT';
    if (impulse < -threshold && rsi <= RSI_LONG) return 'LONG';

    if (impulse > 5 && rsi >= RSI_STRONG_S) return 'SHORT';
    if (impulse < -5 && rsi <= RSI_STRONG_L) return 'LONG';

    return null;
  }

  static _runChecks({
    impulse,
    rsi,
    volume,
    threshold,
    direction,
    hourHigh,
    hourLow,
    currentPrice,
  }) {
    const absImpulse = Math.abs(impulse);
    const retraceShort = ((hourHigh - currentPrice) / hourHigh) * 100;
    const retraceLong = ((currentPrice - hourLow) / hourLow) * 100;
    const retrace = direction === 'SHORT' ? retraceShort : retraceLong;

    const standardEntry = absImpulse >= threshold && retrace >= MIN_RETRACE && volume >= MIN_VOLUME;
    const strongEntry =
      absImpulse >= 5 &&
      volume >= 120 &&
      (direction === 'SHORT' ? rsi >= RSI_STRONG_S : rsi <= RSI_STRONG_L);

    const checks = {
      impulse_in_range: absImpulse >= MIN_IMPULSE && absImpulse <= MAX_IMPULSE,
      volume_ok: volume >= MIN_VOLUME,
      standard_entry: standardEntry,
      strong_entry: strongEntry,
      entry_condition: standardEntry || strongEntry,
      direction_rsi_ok: direction === 'SHORT' ? rsi >= RSI_SHORT : rsi <= RSI_LONG,
    };

    const required = ['impulse_in_range', 'entry_condition'];
    checks.passed = required.every((key) => checks[key]);

    checks.failed_reasons = required
      .filter((key) => !checks[key])
      .map((key) => {
        if (key === 'impulse_in_range') {
          return `Impulse ${impulse.toFixed(1)}% out of [${MIN_IMPULSE}%, ${MAX_IMPULSE}%]`;
        }
        if (key === 'entry_condition') {
          return `No entry: retrace=${retrace.toFixed(1)}% vol=${volume.toFixed(0)}% rsi=${rsi.toFixed(0)}`;
        }
        return key;
      });

    return checks;
  }

  static _getDynamicThreshold(atrPercent) {
    for (const threshold of ATR_THRESHOLDS) {
      if (atrPercent <= threshold.maxAtr) return threshold.minImpulse;
    }
    return 10;
  }

  static _getSlPercent(atrPercent) {
    for (const tier of SL_TIERS) {
      if (atrPercent <= tier.maxAtr) return tier.slPercent;
    }
    return 0.01;
  }

  static _getTpPercent(impulse) {
    return Math.abs(impulse) < 4 ? 0.005 : 0.01;
  }

  static _calculateConfidence(impulse, rsi, volume, atrPercent, direction) {
    let score = 40;

    score += Math.min(Math.abs(impulse) / 10, 1) * 20;

    if (direction === 'SHORT') {
      if (rsi >= 75) score += 15;
      else if (rsi >= 70) score += 10;
      else if (rsi >= 65) score += 5;
    } else if (rsi <= 25) {
      score += 15;
    } else if (rsi <= 30) {
      score += 10;
    } else if (rsi <= 35) {
      score += 5;
    }

    score += Math.max(Math.min((volume - 100) / 50, 1), 0) * 15;

    if (atrPercent >= 3) score += 10;
    else if (atrPercent >= 1.5) score += 5;

    return Math.round(Math.min(score, 100));
  }
}

module.exports = SignalDetector;
