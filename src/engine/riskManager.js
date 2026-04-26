// src/engine/riskManager.js

/**
 * Risk Management System
 *
 * Rules:
 * - Fixed margin by balance tiers
 * - Max daily risk: 5% of balance
 * - Max concurrent positions: 2
 * - Cool-off: 30 min after 2 losses, 60 min after 3 losses
 * - Leverage: adaptive (10x < $500, 5x < $1000, 2x >= $1000)
 */

// ─────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────

const DAILY_RISK_LIMIT = 0.05;
const MAX_POSITIONS = 2;
const TP_PERCENT = 0.01;
const COMMISSION = 0.002;

const MARGIN_TIERS = [
  { maxBalance: 500, margin: 10 },
  { maxBalance: 1000, margin: 20 },
  { maxBalance: Infinity, margin: 30 },
];

const LEVERAGE_TIERS = [
  { maxBalance: 500, leverage: 10 },
  { maxBalance: 1000, leverage: 10 },
  { maxBalance: Infinity, leverage: 5 },
];

const SL_TIERS = [
  { maxAtr: 2, slPercent: 0.005 },
  { maxAtr: 5, slPercent: 0.0075 },
  { maxAtr: Infinity, slPercent: 0.01 },
];

const COOLOFF_RULES = [
  { losses: 2, minutes: 30 },
  { losses: 3, minutes: 60 },
];

// ─────────────────────────────────────────
// MAIN RISK MANAGER
// ─────────────────────────────────────────

class RiskManager {
  /**
   * Рассчитать полные параметры позиции
   * Margin задаётся фиксированными тирами, а не через risk-per-trade.
   * @param {number} currentBalance - текущий баланс
   * @param {number} entryPrice - цена входа
   * @param {number} atrPercent - ATR в процентах
   * @param {Object} overrides - optional { slPercent, tpPercent } as decimal fractions
   * @returns {Object} параметры позиции
   */
  static calculatePosition(currentBalance, entryPrice, atrPercent, overrides = {}) {
    const leverage = this.getLeverage(currentBalance);
    const margin = this.getMargin(currentBalance);
    const notional = margin * leverage;
    const slPercent = overrides.slPercent ?? this.getSlPercent(atrPercent);
    const tpPercent = overrides.tpPercent ?? TP_PERCENT;

    const maxLoss = parseFloat((notional * slPercent + margin * COMMISSION).toFixed(4));

    // SL и TP цены (для SHORT)
    const stopLoss = parseFloat((entryPrice * (1 + slPercent)).toFixed(8));
    const takeProfit = parseFloat((entryPrice * (1 - tpPercent)).toFixed(8));

    const expectedProfit = parseFloat((notional * tpPercent - margin * COMMISSION).toFixed(4));
    const riskReward = parseFloat((expectedProfit / maxLoss).toFixed(2));

    return {
      margin,
      notional,
      positionSize: margin,
      leverage,
      maxLoss,
      stopLoss,
      takeProfit,
      slPercent: parseFloat((slPercent * 100).toFixed(2)),
      tpPercent: parseFloat((tpPercent * 100).toFixed(2)),
      expectedProfit,
      riskReward,
      commission: parseFloat((margin * COMMISSION).toFixed(4)),
      currentBalance: parseFloat(currentBalance.toFixed(2)),
      dailyLimit: parseFloat((currentBalance * DAILY_RISK_LIMIT).toFixed(2)),
    };
  }

  /**
   * Обновить баланс после сделки
   * @param {number} currentBalance - текущий баланс
   * @param {number} profitLoss - P&L сделки
   * @returns {number} новый баланс
   */
  static updateBalance(currentBalance, profitLoss) {
    const newBalance = currentBalance + profitLoss;
    return parseFloat(newBalance.toFixed(8));
  }

  /**
   * Проверить можно ли открыть новую позицию
   * @param {Object} dailyStats - дневная статистика пользователя
   * @param {number} newRisk - риск новой позиции
   * @param {number} openPositions - количество открытых позиций
   * @returns {Object} { allowed, reason }
   */
  static validateEntry(dailyStats, newRisk, openPositions) {
    const balance = dailyStats.starting_balance || 200;
    const dailyLimit = balance * DAILY_RISK_LIMIT;
    const usedRisk = dailyStats.daily_risk_used || 0;
    const remainingRisk = dailyLimit - usedRisk;

    // Проверка 1: Лимит позиций
    if (openPositions >= MAX_POSITIONS) {
      return {
        allowed: false,
        reason: `MAX_POSITIONS: ${openPositions}/${MAX_POSITIONS} позиций открыто`,
        code: 'MAX_POSITIONS',
      };
    }

    // Проверка 2: Дневной риск исчерпан
    if (remainingRisk <= 0) {
      return {
        allowed: false,
        reason: `DAILY_LIMIT: дневной риск исчерпан ($${usedRisk.toFixed(2)}/$${dailyLimit.toFixed(2)})`,
        code: 'DAILY_LIMIT',
      };
    }

    // Проверка 3: Новый риск превышает остаток
    if (newRisk > remainingRisk) {
      return {
        allowed: false,
        reason: `RISK_EXCEEDS: риск $${newRisk.toFixed(2)} > остаток $${remainingRisk.toFixed(2)}`,
        code: 'RISK_EXCEEDS',
        canOverride: true,
      };
    }

    return {
      allowed: true,
      remainingRisk: parseFloat(remainingRisk.toFixed(4)),
      usedPercent: parseFloat(((usedRisk / dailyLimit) * 100).toFixed(1)),
      dailyLimit: parseFloat(dailyLimit.toFixed(4)),
    };
  }

  /**
   * Проверить нужен ли cool-off
   * @param {Array} recentTrades - последние сделки (от новых к старым)
   * @returns {Object} { needed, minutes, reason }
   */
  static checkCooloff(recentTrades) {
    if (!recentTrades || recentTrades.length === 0) {
      return { needed: false };
    }

    // Считать подряд идущие убытки с конца
    let consecutiveLosses = 0;
    for (const trade of recentTrades) {
      if (trade.profit_loss < 0) consecutiveLosses++;
      else break;
    }

    // Найти подходящее правило
    const rule = [...COOLOFF_RULES].reverse().find((entry) => consecutiveLosses >= entry.losses);

    if (!rule) return { needed: false };

    return {
      needed: true,
      minutes: rule.minutes,
      losses: consecutiveLosses,
      reason: `${consecutiveLosses} убытка подряд → пауза ${rule.minutes} мин`,
      endsAt: new Date(Date.now() + rule.minutes * 60 * 1000),
    };
  }

  /**
   * Рассчитать статистику дня в реальном времени
   * @param {Array} trades - все сделки за день
   * @param {number} startingBalance - баланс на начало дня
   * @returns {Object} дневная статистика
   */
  static calcDailyStats(trades, startingBalance) {
    const closed = trades.filter((trade) => trade.status === 'CLOSED');

    if (closed.length === 0) {
      return {
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        win_rate: 0,
        total_pnl: 0,
        avg_win: 0,
        avg_loss: 0,
        profit_factor: 0,
        daily_risk_used: 0,
        daily_risk_limit: startingBalance * DAILY_RISK_LIMIT,
        starting_balance: startingBalance,
      };
    }

    const wins = closed.filter((trade) => trade.profit_loss > 0);
    const losses = closed.filter((trade) => trade.profit_loss < 0);

    const totalPnl = closed.reduce((sum, trade) => sum + (trade.profit_loss || 0), 0);
    const avgWin = wins.length
      ? wins.reduce((sum, trade) => sum + trade.profit_loss, 0) / wins.length
      : 0;
    const avgLoss = losses.length
      ? losses.reduce((sum, trade) => sum + trade.profit_loss, 0) / losses.length
      : 0;
    const profitFactor = Math.abs(avgLoss) > 0 ? Math.abs(avgWin / avgLoss) : 0;
    const riskUsed = closed.reduce((sum, trade) => sum + (trade.max_risk || 0), 0);

    return {
      total_trades: closed.length,
      winning_trades: wins.length,
      losing_trades: losses.length,
      win_rate: parseFloat(((wins.length / closed.length) * 100).toFixed(1)),
      total_pnl: parseFloat(totalPnl.toFixed(4)),
      avg_win: parseFloat(avgWin.toFixed(4)),
      avg_loss: parseFloat(avgLoss.toFixed(4)),
      profit_factor: parseFloat(profitFactor.toFixed(2)),
      daily_risk_used: parseFloat(riskUsed.toFixed(4)),
      daily_risk_limit: parseFloat((startingBalance * DAILY_RISK_LIMIT).toFixed(4)),
      starting_balance: startingBalance,
    };
  }

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  static getLeverage(balance) {
    for (const tier of LEVERAGE_TIERS) {
      if (balance < tier.maxBalance) return tier.leverage;
    }
    return 2;
  }

  static getMargin(balance) {
    for (const tier of MARGIN_TIERS) {
      if (balance < tier.maxBalance) return tier.margin;
    }
    return 50;
  }

  static getSlPercent(atrPercent) {
    for (const tier of SL_TIERS) {
      if (atrPercent <= tier.maxAtr) return tier.slPercent;
    }
    return 0.01;
  }

  /**
   * Рассчитать дневной лимит риска
   * ВСЕГДА от баланса на 08:00 (не текущего!)
   * @param {number} balanceAt8am - баланс зафиксированный в 08:00
   * @returns {number} дневной лимит в $
   */
  static getDailyLimit(balanceAt8am) {
    return parseFloat((balanceAt8am * DAILY_RISK_LIMIT).toFixed(4));
  }

  static getDailyRiskLimit(balance) {
    return this.getDailyLimit(balance);
  }

  static getMaxPositions() {
    return MAX_POSITIONS;
  }
}

module.exports = RiskManager;
