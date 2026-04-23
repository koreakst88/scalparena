// src/engine/signalDetector.js

const TechnicalIndicators = require('./indicators');

/**
 * Dynamic Momentum Scalping Strategy - ADAPTIVE MODE
 *
 * Оптимизирован под рынок 2026:
 * - Импульсы 2-5% вместо 10-20%
 * - Адаптивный TP (0.5% / 1%)
 * - Динамический SL (0.3% - 1%)
 * - Альтернативный триггер: сильный импульс + экстремальный RSI
 */

// ─────────────────────────────────────────
// CONSTANTS (ADAPTIVE)
// ─────────────────────────────────────────

const MIN_IMPULSE = 2.5;   // минимальный импульс %
const MAX_IMPULSE = 15;    // максимальный импульс %
const MIN_RETRACE = 0.5;   // минимальный откат от high %
const MIN_VOLUME  = 105;   // минимальный volume spike %
const RSI_ENTRY   = 65;    // RSI порог для стандартного входа
const RSI_STRONG  = 70;    // RSI порог для агрессивного входа
const RSI_EXIT    = 75;    // RSI порог для выхода

// Адаптивный порог импульса по ATR
const ATR_THRESHOLDS = [
  { maxAtr: 1,        minImpulse: 1.5 },
  { maxAtr: 2,        minImpulse: 2.5 },
  { maxAtr: 4,        minImpulse: 4   },
  { maxAtr: 7,        minImpulse: 6   },
  { maxAtr: Infinity, minImpulse: 10  }
];

// Динамический Stop Loss (уже на низком ATR)
const SL_TIERS = [
  { maxAtr: 1,        slPercent: 0.003  }, // 0.3%
  { maxAtr: 2,        slPercent: 0.005  }, // 0.5%
  { maxAtr: 5,        slPercent: 0.0075 }, // 0.75%
  { maxAtr: Infinity, slPercent: 0.01   }  // 1.0%
];

// ─────────────────────────────────────────
// MAIN SIGNAL DETECTOR
// ─────────────────────────────────────────

class SignalDetector {

  /**
   * Сканировать одну пару и вернуть сигнал или null
   */
  static detectSignal(pair, candles) {
    if (!candles || candles.length < 5) {
      return null;
    }

    const current = candles[candles.length - 1];
    const prices  = candles.map(c => c.close);

    // Индикаторы
    const atr        = TechnicalIndicators.calculateATR(candles, 14);
    const rsi        = TechnicalIndicators.calculateRSI(prices, 14);
    const volume     = TechnicalIndicators.calculateVolumeProfile(candles, 20);
    const atrPercent = (atr / current.close) * 100;

    // Импульс часовой свечи
    const hourOpen     = current.open;
    const hourHigh     = current.high;
    const currentPrice = current.close;
    const impulse      = ((currentPrice - hourOpen) / hourOpen) * 100;
    const retrace      = ((hourHigh - currentPrice) / hourHigh) * 100;

    // Динамический порог
    const threshold = this._getDynamicThreshold(atrPercent);

    // Проверка условий
    const checks = this._runChecks({
      impulse,
      retrace,
      rsi,
      volume,
      threshold,
      atrPercent
    });

    if (!checks.passed) return null;

    // Расчёт SL и адаптивного TP
    const stopLoss   = this._calculateStopLoss(hourHigh, atrPercent);
    const tpPercent  = this._getTpPercent(impulse);
    const takeProfit = parseFloat((currentPrice * (1 - tpPercent)).toFixed(8));

    // RR проверка после расчёта TP
    const slDistance = Math.abs(stopLoss - currentPrice);
    const tpDistance = Math.abs(currentPrice - takeProfit);
    const riskReward = parseFloat((tpDistance / slDistance).toFixed(2));

    // Дополнительная проверка RR (порог 1.1 для адаптивного режима)
    if (riskReward < 1.1) return null;

    // Confidence score
    const confidence = this._calculateConfidence(impulse, rsi, volume, atrPercent);

    return {
      pair,
      type:       'SHORT',
      entryPrice: currentPrice,
      hourHigh,
      hourOpen,

      stopLoss,
      takeProfit,
      tpPercent:  parseFloat((tpPercent * 100).toFixed(2)),
      riskReward,
      maxRisk:    null,

      impulse:      parseFloat(impulse.toFixed(2)),
      retrace:      parseFloat(retrace.toFixed(2)),
      rsi:          parseFloat(rsi.toFixed(2)),
      volume:       parseFloat(volume.toFixed(2)),
      atr:          parseFloat(atr.toFixed(6)),
      atrPercent:   parseFloat(atrPercent.toFixed(2)),

      confidence,
      checks,
      entryMode:    checks.strong_momentum_entry ? 'STRONG' : 'STANDARD',

      generatedAt: new Date(),
      expiresAt:   new Date(Date.now() + 30 * 60 * 1000),
      status:      'ACTIVE'
    };
  }

  /**
   * Сканировать все пары
   */
  static scanAll(provider) {
    const signals = [];
    const pairs   = provider.getPairs();

    for (const pair of pairs) {
      const candles = provider.getCandles(pair, 50);
      if (!provider.hasEnoughData(pair, 5)) continue;

      const signal = this.detectSignal(pair, candles);
      if (signal) signals.push(signal);
    }

    signals.sort((a, b) => b.confidence - a.confidence);
    return signals;
  }

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  /**
   * Проверить условия входа (два варианта: стандартный и сильный)
   */
  static _runChecks({ impulse, retrace, rsi, volume, threshold, atrPercent }) {
    // СТАНДАРТНЫЙ вход: импульс + откат
    const standardEntry =
      Math.abs(impulse) >= threshold &&
      retrace >= MIN_RETRACE &&
      rsi >= RSI_ENTRY &&
      volume >= MIN_VOLUME;

    // СИЛЬНЫЙ вход: высокий импульс + экстремальный RSI (без отката)
    const strongMomentumEntry =
      Math.abs(impulse) >= 5 &&
      rsi >= RSI_STRONG &&
      volume >= 120;

    const checks = {
      impulse_sufficient: Math.abs(impulse) >= threshold,
      impulse_in_range:   Math.abs(impulse) >= MIN_IMPULSE && Math.abs(impulse) <= MAX_IMPULSE,
      volume_spike:       volume >= MIN_VOLUME,
      standard_entry:     standardEntry,
      strong_momentum_entry: strongMomentumEntry,
      entry_condition:    standardEntry || strongMomentumEntry,

      rsi_elevated:       rsi >= 65,
      strong_impulse:     Math.abs(impulse) >= 8,
      high_volume:        volume >= 150,
    };

    const required = ['impulse_in_range', 'entry_condition'];

    checks.passed = required.every(key => checks[key]);
    checks.failed_reasons = required
      .filter(key => !checks[key])
      .map(key => this._getFailReason(key, { impulse, retrace, rsi, volume, threshold }));

    return checks;
  }

  /**
   * Динамический порог импульса
   */
  static _getDynamicThreshold(atrPercent) {
    for (const t of ATR_THRESHOLDS) {
      if (atrPercent <= t.maxAtr) return t.minImpulse;
    }
    return 10;
  }

  /**
   * Динамический Stop Loss
   */
  static _calculateStopLoss(hourHigh, atrPercent) {
    let slPercent = 0.01;
    for (const tier of SL_TIERS) {
      if (atrPercent <= tier.maxAtr) {
        slPercent = tier.slPercent;
        break;
      }
    }
    return parseFloat((hourHigh * (1 + slPercent)).toFixed(8));
  }

  /**
   * Адаптивный Take Profit
   * - Слабый импульс (< 4%) → TP 0.5%
   * - Нормальный импульс (>= 4%) → TP 1.0%
   */
  static _getTpPercent(impulse) {
    return Math.abs(impulse) < 4 ? 0.005 : 0.01;
  }

  /**
   * Confidence score
   */
  static _calculateConfidence(impulse, rsi, volume, atrPercent) {
    let score = 40;

    const impulseNorm = Math.min(Math.abs(impulse) / 10, 1);
    score += impulseNorm * 20;

    if (rsi >= 75)      score += 15;
    else if (rsi >= 70) score += 10;
    else if (rsi >= 65) score += 5;

    const volNorm = Math.min((volume - 100) / 50, 1);
    score += Math.max(volNorm, 0) * 15;

    if (atrPercent >= 3) score += 10;
    else if (atrPercent >= 1.5) score += 5;

    return Math.round(Math.min(score, 100));
  }

  static _getFailReason(key, data) {
    const { impulse, retrace, rsi, volume, threshold } = data;
    switch (key) {
      case 'impulse_in_range':
        return `Impulse ${impulse.toFixed(1)}% out of range [${MIN_IMPULSE}%-${MAX_IMPULSE}%]`;
      case 'entry_condition':
        return `No entry: neither standard (retrace+rsi) nor strong momentum met`;
      default:
        return key;
    }
  }
}

module.exports = SignalDetector;
