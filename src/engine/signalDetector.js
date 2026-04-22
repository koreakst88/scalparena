// src/engine/signalDetector.js

const TechnicalIndicators = require('./indicators');
const RiskManager = require('./riskManager');

/**
 * Dynamic Momentum Scalping Strategy
 *
 * Entry conditions:
 * 1. Impulse >= dynamic threshold (based on ATR)
 * 2. Retracement -1% from hour high OR RSI > 75
 * 3. Volume spike > 25% above average
 * 4. Impulse in range 10-20% (hard cap)
 */

// ─────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────

const MIN_IMPULSE = 10;
const MAX_IMPULSE = 20;
const MIN_RETRACE = 1.0;
const MIN_VOLUME = 125;
const RSI_ENTRY = 75;
const RSI_EXIT = 75;

// Динамический порог импульса по ATR
const ATR_THRESHOLDS = [
  { maxAtr: 2, minImpulse: 3 },
  { maxAtr: 5, minImpulse: 5 },
  { maxAtr: 10, minImpulse: 8 },
  { maxAtr: Infinity, minImpulse: 12 },
];

// ─────────────────────────────────────────
// MAIN SIGNAL DETECTOR
// ─────────────────────────────────────────

class SignalDetector {
  /**
   * Сканировать одну пару и вернуть сигнал или null
   * @param {string} pair - название пары (SOLUSDT)
   * @param {Array} candles - массив свечей (мин 30)
   * @returns {Object|null} signal или null
   */
  static detectSignal(pair, candles) {
    if (!candles || candles.length < 30) {
      return null;
    }

    const current = candles[candles.length - 1];
    const prices = candles.map((candle) => candle.close);

    // ── Индикаторы ──────────────────────────
    const atr = TechnicalIndicators.calculateATR(candles, 14);
    const rsi = TechnicalIndicators.calculateRSI(prices, 14);
    const volume = TechnicalIndicators.calculateVolumeProfile(candles, 20);
    const atrPercent = (atr / current.close) * 100;

    // ── Импульс часовой свечи ────────────────
    const hourOpen = current.open;
    const hourHigh = current.high;
    const currentPrice = current.close;
    const impulse = ((currentPrice - hourOpen) / hourOpen) * 100;

    // ── Откат от high ────────────────────────
    const retrace = ((hourHigh - currentPrice) / hourHigh) * 100;

    // ── Динамический порог ───────────────────
    const threshold = this._getDynamicThreshold(atrPercent);

    // ── Расчёт SL и TP ───────────────────────
    const stopLoss = this._calculateStopLoss(hourHigh, atrPercent);
    const takeProfit = parseFloat((currentPrice * (1 - 0.01)).toFixed(8));
    const position = RiskManager.calculatePosition(200, currentPrice, atrPercent);
    const riskReward = position.riskReward;

    // ─────────────────────────────────────────
    // ПРОВЕРКА УСЛОВИЙ ВХОДА
    // ─────────────────────────────────────────

    const checks = this._runChecks({
      impulse,
      retrace,
      rsi,
      volume,
      threshold,
      riskReward,
    });

    if (!checks.passed) {
      return null;
    }

    // ── Confidence score ─────────────────────
    const confidence = this._calculateConfidence(impulse, rsi, volume, atrPercent);

    return {
      pair,
      type: 'SHORT',
      entryPrice: currentPrice,
      hourHigh,
      hourOpen,

      // Параметры сделки
      stopLoss,
      takeProfit,
      maxRisk: null,
      riskReward,

      // Индикаторы
      impulse: parseFloat(impulse.toFixed(2)),
      retrace: parseFloat(retrace.toFixed(2)),
      rsi: parseFloat(rsi.toFixed(2)),
      volume: parseFloat(volume.toFixed(2)),
      atr: parseFloat(atr.toFixed(6)),
      atrPercent: parseFloat(atrPercent.toFixed(2)),

      // Scoring
      confidence,
      checks,

      // Мета
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      status: 'ACTIVE',
    };
  }

  /**
   * Сканировать все пары и вернуть отсортированный список сигналов
   * @param {Object} provider - BybitDataProvider
   * @returns {Array} отсортированные сигналы
   */
  static scanAll(provider) {
    const signals = [];
    const pairs = provider.getPairs();

    for (const pair of pairs) {
      const candles = provider.getCandles(pair, 50);

      if (!provider.hasEnoughData(pair, 30)) {
        continue;
      }

      const signal = this.detectSignal(pair, candles);

      if (signal) {
        signals.push(signal);
      }
    }

    signals.sort((a, b) => b.confidence - a.confidence);

    return signals;
  }

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  /**
   * Проверить все условия входа
   */
  static _runChecks({ impulse, retrace, rsi, volume, threshold, riskReward }) {
    const checks = {
      // Обязательные условия
      impulse_sufficient: Math.abs(impulse) >= threshold,
      impulse_in_range:
        Math.abs(impulse) >= MIN_IMPULSE && Math.abs(impulse) <= MAX_IMPULSE,
      volume_spike: volume >= MIN_VOLUME,
      entry_condition: retrace >= MIN_RETRACE || rsi >= RSI_ENTRY,
      risk_reward_ok: riskReward >= 1.5,

      // Дополнительные (не блокируют сигнал)
      rsi_elevated: rsi >= 65,
      strong_impulse: Math.abs(impulse) >= 15,
      high_volume: volume >= 150,
    };

    const required = [
      'impulse_sufficient',
      'impulse_in_range',
      'volume_spike',
      'entry_condition',
      'risk_reward_ok',
    ];

    checks.passed = required.every((key) => checks[key]);
    checks.failed_reasons = required
      .filter((key) => !checks[key])
      .map((key) =>
        this._getFailReason(key, { impulse, retrace, rsi, volume, threshold, riskReward })
      );

    return checks;
  }

  /**
   * Динамический порог импульса на основе ATR
   */
  static _getDynamicThreshold(atrPercent) {
    for (const threshold of ATR_THRESHOLDS) {
      if (atrPercent <= threshold.maxAtr) return threshold.minImpulse;
    }
    return 12;
  }

  /**
   * Динамический Stop Loss на основе ATR
   */
  static _calculateStopLoss(hourHigh, atrPercent) {
    let slPercent;

    if (atrPercent < 2) slPercent = 0.005;
    else if (atrPercent < 5) slPercent = 0.0075;
    else slPercent = 0.01;

    return parseFloat((hourHigh * (1 + slPercent)).toFixed(8));
  }

  /**
   * Confidence score (0-100)
   */
  static _calculateConfidence(impulse, rsi, volume, atrPercent) {
    let score = 40;

    // Импульс (0-20 очков)
    const impulseNorm = Math.min(Math.abs(impulse) / MAX_IMPULSE, 1);
    score += impulseNorm * 20;

    // RSI (0-15 очков)
    if (rsi >= 80) score += 15;
    else if (rsi >= 75) score += 10;
    else if (rsi >= 65) score += 5;

    // Volume (0-15 очков)
    const volNorm = Math.min((volume - 100) / 100, 1);
    score += Math.max(volNorm, 0) * 15;

    // ATR бонус (0-10 очков) — высокая волатильность = лучше
    if (atrPercent >= 3) score += 10;
    else if (atrPercent >= 2) score += 5;

    return Math.round(Math.min(score, 100));
  }

  /**
   * Причина почему условие не прошло (для логов/сообщений)
   */
  static _getFailReason(key, data) {
    const { impulse, retrace, rsi, volume, threshold, riskReward } = data;
    switch (key) {
      case 'impulse_sufficient':
        return `Impulse ${impulse.toFixed(1)}% < threshold ${threshold}%`;
      case 'impulse_in_range':
        return `Impulse ${impulse.toFixed(1)}% out of range [${MIN_IMPULSE}%-${MAX_IMPULSE}%]`;
      case 'volume_spike':
        return `Volume ${volume.toFixed(0)}% < ${MIN_VOLUME}%`;
      case 'entry_condition':
        return `No entry: retrace ${retrace.toFixed(1)}% < ${MIN_RETRACE}% AND RSI ${rsi.toFixed(0)} < ${RSI_ENTRY}`;
      case 'risk_reward_ok':
        return `RR ${riskReward.toFixed(2)} < 1.5 (SL слишком широкий для этого ATR)`;
      default:
        return key;
    }
  }
}

module.exports = SignalDetector;
