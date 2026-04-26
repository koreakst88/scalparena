// src/engine/signalDetector.js

const TechnicalIndicators = require('./indicators');

/**
 * Mean Reversion Strategy
 *
 * Идея: рынок не двигается линейно. После сильного движения
 * в одну сторону происходит откат к среднему.
 *
 * LONG: цена упала слишком сильно (RSI < 30) -> ждём отскок вверх
 * SHORT: цена выросла слишком сильно (RSI > 70) -> ждём откат вниз
 *
 * Работает в боковике и на спокойном рынке (когда Momentum молчит).
 */

const RSI_OVERSOLD = 32;
const RSI_OVERBOUGHT = 68;
const RSI_EXTREME_LOW = 25;
const RSI_EXTREME_HIGH = 75;

const BB_TOUCH_PERCENT = 1.5;
const MIN_VOLUME = 80;
const MIN_BB_WIDTH = 0.5;

const TP_PERCENT = 0.005;
const SL_PERCENT = 0.01;

class SignalDetector {
  static detectSignal(pair, candles) {
    if (!candles || candles.length < 20) return null;

    const current = candles[candles.length - 1];
    const prices = candles.map((candle) => candle.close);

    const rsi = TechnicalIndicators.calculateRSI(prices, 14);
    const bollingerBands = TechnicalIndicators.calculateBollingerBands(prices, 20, 2);
    const volume = TechnicalIndicators.calculateVolumeProfile(candles, 20);
    const atr = TechnicalIndicators.calculateATR(candles, 14);

    const currentPrice = current.close;
    const atrPercent = (atr / currentPrice) * 100;
    const bbRange = bollingerBands.upper - bollingerBands.lower;

    if (!Number.isFinite(bbRange) || bbRange <= 0 || bollingerBands.middle === 0) {
      return null;
    }

    const bbWidth = (bbRange / bollingerBands.middle) * 100;
    const bbPosition = ((currentPrice - bollingerBands.lower) / bbRange) * 100;

    const direction = this._getDirection(rsi, bbPosition, bbWidth, volume);
    if (!direction) return null;

    let stopLoss;
    let takeProfit;

    if (direction === 'LONG') {
      stopLoss = parseFloat((currentPrice * (1 - SL_PERCENT)).toFixed(8));
      takeProfit = parseFloat((currentPrice * (1 + TP_PERCENT)).toFixed(8));
    } else {
      stopLoss = parseFloat((currentPrice * (1 + SL_PERCENT)).toFixed(8));
      takeProfit = parseFloat((currentPrice * (1 - TP_PERCENT)).toFixed(8));
    }

    const slDist = Math.abs(currentPrice - stopLoss);
    const tpDist = Math.abs(currentPrice - takeProfit);
    const riskReward = parseFloat((tpDist / slDist).toFixed(2));
    const confidence = this._calculateConfidence(rsi, bbPosition, volume, direction);

    return {
      pair,
      type: direction,
      entryPrice: currentPrice,

      stopLoss,
      takeProfit,
      tpPercent: parseFloat((TP_PERCENT * 100).toFixed(2)),
      slPercent: parseFloat((SL_PERCENT * 100).toFixed(2)),
      riskReward,
      maxRisk: null,

      rsi: parseFloat(rsi.toFixed(2)),
      volume: parseFloat(volume.toFixed(2)),
      atr: parseFloat(atr.toFixed(6)),
      atrPercent: parseFloat(atrPercent.toFixed(2)),
      bbPosition: parseFloat(bbPosition.toFixed(1)),
      bbWidth: parseFloat(bbWidth.toFixed(2)),

      impulse: 0,

      confidence,
      strategy: 'MEAN_REVERSION',
      entryMode: this._isExtreme(rsi) ? 'STRONG' : 'STANDARD',

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
      if (!provider.hasEnoughData(pair, 20)) continue;

      const signal = this.detectSignal(pair, candles);
      if (signal) signals.push(signal);
    }

    signals.sort((a, b) => b.confidence - a.confidence);
    return signals;
  }

  static _getDirection(rsi, bbPosition, bbWidth, volume) {
    if (volume < MIN_VOLUME) return null;
    if (bbWidth < MIN_BB_WIDTH) return null;

    if (rsi <= RSI_EXTREME_LOW) return 'LONG';
    if (rsi >= RSI_EXTREME_HIGH) return 'SHORT';

    if (rsi <= RSI_OVERSOLD && bbPosition <= 20) {
      return 'LONG';
    }

    if (rsi >= RSI_OVERBOUGHT && bbPosition >= 80) {
      return 'SHORT';
    }

    return null;
  }

  static _isExtreme(rsi) {
    return rsi <= RSI_EXTREME_LOW || rsi >= RSI_EXTREME_HIGH;
  }

  static _calculateConfidence(rsi, bbPosition, volume, direction) {
    let score = 50;

    if (direction === 'LONG') {
      if (rsi <= 20) score += 25;
      else if (rsi <= 25) score += 20;
      else if (rsi <= 30) score += 15;
      else if (rsi <= 32) score += 10;
    } else {
      if (rsi >= 80) score += 25;
      else if (rsi >= 75) score += 20;
      else if (rsi >= 70) score += 15;
      else if (rsi >= 68) score += 10;
    }

    if (direction === 'LONG' && bbPosition <= 10) score += 10;
    if (direction === 'SHORT' && bbPosition >= 90) score += 10;

    if (volume >= 120) score += 10;
    else if (volume >= 100) score += 5;

    return Math.round(Math.min(score, 100));
  }
}

module.exports = SignalDetector;
