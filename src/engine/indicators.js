// src/engine/indicators.js

/**
 * Technical Indicators Calculator
 * Все индикаторы работают с массивом цен/свечей
 */

class TechnicalIndicators {
  /**
   * ATR (Average True Range) - мера волатильности
   * @param {Array} candles - массив свечей с high, low, close
   * @param {Number} period - период расчёта (обычно 14)
   * @returns {Number} ATR значение
   */
  static calculateATR(candles, period = 14) {
    if (candles.length < period + 1) {
      console.warn(`Not enough candles for ATR (need ${period + 1}, got ${candles.length})`);
      return 0;
    }

    const trueRanges = [];

    // Вычислить True Range для каждой свечи
    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const previous = candles[i - 1];

      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      );

      trueRanges.push(tr);
    }

    // Взять последние 'period' значений и вычислить среднее
    const recentTR = trueRanges.slice(-period);
    const atr = recentTR.reduce((a, b) => a + b, 0) / period;

    return atr;
  }

  /**
   * RSI (Relative Strength Index) - измеряет перекупленность/перепроданность
   * @param {Array} prices - массив цен (close prices)
   * @param {Number} period - период расчёта (обычно 14)
   * @returns {Number} RSI значение (0-100)
   */
  static calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) {
      console.warn(`Not enough prices for RSI (need ${period + 1}, got ${prices.length})`);
      return 50;
    }

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    // Разделить на gains (положительные) и losses (отрицательные)
    const gains = changes.map((c) => (c > 0 ? c : 0));
    const losses = changes.map((c) => (c < 0 ? -c : 0));

    // Взять последние 'period' значений
    const recentGains = gains.slice(-period);
    const recentLosses = losses.slice(-period);

    const avgGain = recentGains.reduce((a, b) => a + b, 0) / period;
    const avgLoss = recentLosses.reduce((a, b) => a + b, 0) / period;

    // Защита от деления на ноль
    if (avgLoss === 0) {
      return avgGain === 0 ? 50 : 99;
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return Math.round(rsi * 100) / 100;
  }

  /**
   * ROC (Rate of Change) - скорость изменения цены
   * @param {Array} prices - массив цен
   * @param {Number} period - период сравнения (обычно 12)
   * @returns {Number} ROC в процентах
   */
  static calculateROC(prices, period = 12) {
    if (prices.length < period + 1) {
      console.warn(`Not enough prices for ROC (need ${period + 1}, got ${prices.length})`);
      return 0;
    }

    const current = prices[prices.length - 1];
    const previous = prices[prices.length - 1 - period];

    if (previous === 0) return 0;

    const roc = ((current - previous) / previous) * 100;
    return Math.round(roc * 100) / 100;
  }

  /**
   * MACD (Moving Average Convergence Divergence) - тренд и импульс
   * @param {Array} prices - массив цен
   * @returns {Object} { macd, signal, histogram }
   */
  static calculateMACD(prices) {
    if (prices.length < 35) {
      console.warn(`Not enough prices for MACD (need 35, got ${prices.length})`);
      return { macd: 0, signal: 0, histogram: 0 };
    }

    const ema12Series = this.calculateEMASeries(prices, 12);
    const ema26Series = this.calculateEMASeries(prices, 26);

    // MACD line = EMA12 - EMA26 для каждой доступной точки
    const macdSeries = [];
    for (let i = 0; i < prices.length; i++) {
      if (ema12Series[i] === null || ema26Series[i] === null) {
        continue;
      }
      macdSeries.push(ema12Series[i] - ema26Series[i]);
    }

    if (macdSeries.length < 9) {
      console.warn(`Not enough MACD values for signal line (need 9, got ${macdSeries.length})`);
      return { macd: 0, signal: 0, histogram: 0 };
    }

    const signalSeries = this.calculateEMASeries(macdSeries, 9);
    const macdLine = macdSeries[macdSeries.length - 1];
    const signalLine = signalSeries[signalSeries.length - 1];

    const histogram = macdLine - signalLine;

    return {
      macd: Math.round(macdLine * 10000) / 10000,
      signal: Math.round(signalLine * 10000) / 10000,
      histogram: Math.round(histogram * 10000) / 10000,
    };
  }

  /**
   * Bollinger Bands - волатильность и уровни поддержки/сопротивления
   * @param {Array} prices - массив цен
   * @param {Number} period - период SMA (обычно 20)
   * @param {Number} stdDev - множитель стандартного отклонения (обычно 2)
   * @returns {Object} { upper, middle, lower }
   */
  static calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) {
      console.warn(`Not enough prices for BB (need ${period}, got ${prices.length})`);
      return { upper: 0, middle: 0, lower: 0 };
    }

    // Middle Band = SMA
    const recentPrices = prices.slice(-period);
    const middleBand = recentPrices.reduce((a, b) => a + b, 0) / period;

    // Standard Deviation
    const variance =
      recentPrices.reduce((sum, price) => {
        return sum + Math.pow(price - middleBand, 2);
      }, 0) / period;
    const standardDeviation = Math.sqrt(variance);

    const upperBand = middleBand + standardDeviation * stdDev;
    const lowerBand = middleBand - standardDeviation * stdDev;

    return {
      upper: Math.round(upperBand * 100) / 100,
      middle: Math.round(middleBand * 100) / 100,
      lower: Math.round(lowerBand * 100) / 100,
    };
  }

  /**
   * Volume Profile - анализ объёма
   * @param {Array} candles - массив свечей
   * @param {Number} avgPeriod - период усреднения (обычно 20)
   * @returns {Number} процент превышения над среднеим
   */
  static calculateVolumeProfile(candles, avgPeriod = 20) {
    if (candles.length < avgPeriod) {
      console.warn(`Not enough candles for volume (need ${avgPeriod}, got ${candles.length})`);
      return 100;
    }

    const currentVolume = candles[candles.length - 1].volume;
    const recentVolumes = candles.slice(-avgPeriod).map((c) => c.volume);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / avgPeriod;

    if (avgVolume === 0) return 100;

    const volumeSpike = (currentVolume / avgVolume) * 100;
    return Math.round(volumeSpike * 100) / 100;
  }

  /**
   * EMA (Exponential Moving Average) - вспомогательная функция
   * @param {Array} prices - массив цен
   * @param {Number} period - период EMA
   * @returns {Number} EMA значение
   */
  static calculateEMA(prices, period) {
    if (prices.length < period) {
      console.warn(`Not enough prices for EMA (need ${period}, got ${prices.length})`);
      return prices[prices.length - 1] || 0;
    }

    const multiplier = 2 / (period + 1);

    // SMA для первого значения
    const firstSMA = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let ema = firstSMA;

    // Вычислить EMA для остальных значений
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * EMA series - возвращает массив EMA значений по всей серии.
   * Для позиций, где EMA ещё нельзя посчитать, возвращает null.
   * @param {Array} prices - массив цен
   * @param {Number} period - период EMA
   * @returns {Array} массив EMA значений
   */
  static calculateEMASeries(prices, period) {
    if (prices.length < period) {
      console.warn(`Not enough prices for EMA series (need ${period}, got ${prices.length})`);
      return prices.map(() => null);
    }

    const series = Array(prices.length).fill(null);
    const multiplier = 2 / (period + 1);

    const firstSMA = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let ema = firstSMA;
    series[period - 1] = ema;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
      series[i] = ema;
    }

    return series;
  }

  /**
   * Calculate all indicators at once (удобно для сигналов)
   * @param {Array} candles - массив свечей
   * @returns {Object} все индикаторы
   */
  static calculateAll(candles) {
    const prices = candles.map((c) => c.close);

    return {
      atr: this.calculateATR(candles, 14),
      rsi: this.calculateRSI(prices, 14),
      roc: this.calculateROC(prices, 12),
      macd: this.calculateMACD(prices),
      bollingerBands: this.calculateBollingerBands(prices, 20, 2),
      volume: this.calculateVolumeProfile(candles, 20),

      // Helper для импульса (от open до close)
      momentum:
        ((candles[candles.length - 1].close - candles[0].open) / candles[0].open) * 100,
    };
  }
}

module.exports = TechnicalIndicators;
