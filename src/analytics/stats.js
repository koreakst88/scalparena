// src/analytics/stats.js

const RiskManager = require('../engine/riskManager');

class StatsCalculator {
  /**
   * Посчитать полную статистику за период
   * @param {Array} trades - все сделки за период
   * @param {number} startingBalance - баланс на начало периода
   * @returns {Object} полная статистика
   */
  static calculate(trades, startingBalance) {
    const closed = trades.filter((trade) => trade.status === 'CLOSED');
    const base = RiskManager.calcDailyStats(closed, startingBalance);

    if (closed.length === 0) return base;

    // Дополнительные метрики
    const bestTrade = closed.reduce((a, b) => (a.profit_loss > b.profit_loss ? a : b));
    const worstTrade = closed.reduce((a, b) => (a.profit_loss < b.profit_loss ? a : b));

    // Среднее время удержания (в минутах)
    const tradesWithTime = closed.filter((trade) => trade.exit_time && trade.entry_time);
    const avgHoldTime =
      tradesWithTime.length > 0
        ? Math.round(
            tradesWithTime.reduce((sum, trade) => {
              return sum + (new Date(trade.exit_time) - new Date(trade.entry_time)) / 60000;
            }, 0) / tradesWithTime.length
          )
        : 0;

    // Статистика по парам
    const pairStats = {};
    closed.forEach((trade) => {
      if (!pairStats[trade.pair]) {
        pairStats[trade.pair] = { trades: 0, wins: 0, pnl: 0 };
      }
      pairStats[trade.pair].trades++;
      if (trade.profit_loss > 0) pairStats[trade.pair].wins++;
      pairStats[trade.pair].pnl += trade.profit_loss || 0;
    });

    // Топ и худшая пара
    const pairEntries = Object.entries(pairStats);
    const bestPairEntry =
      pairEntries.length > 0
        ? [...pairEntries].sort((a, b) => b[1].pnl - a[1].pnl)[0]
        : null;
    const worstPairEntry =
      pairEntries.length > 0
        ? [...pairEntries].sort((a, b) => a[1].pnl - b[1].pnl)[0]
        : null;

    // Exit reason breakdown
    const exitReasons = {};
    closed.forEach((trade) => {
      const reason = trade.exit_reason || 'UNKNOWN';
      exitReasons[reason] = (exitReasons[reason] || 0) + 1;
    });

    return {
      ...base,
      best_trade: { pair: bestTrade.pair, pnl: bestTrade.profit_loss },
      worst_trade: { pair: worstTrade.pair, pnl: worstTrade.profit_loss },
      avg_hold_time: avgHoldTime,
      pair_stats: pairStats,
      best_pair: bestPairEntry ? { pair: bestPairEntry[0], ...bestPairEntry[1] } : null,
      worst_pair: worstPairEntry ? { pair: worstPairEntry[0], ...worstPairEntry[1] } : null,
      exit_reasons: exitReasons,
    };
  }

  /**
   * Форматировать статистику для Telegram сообщения
   */
  static formatMessage(stats) {
    const pnlIcon = stats.total_pnl >= 0 ? '✅' : '❌';
    const pnlSign = stats.total_pnl >= 0 ? '+' : '';

    let message = `
📊 *СТАТИСТИКА ТОРГОВОГО ДНЯ*
════════════════════════════════

📈 *РЕЗУЛЬТАТЫ:*
Сделок: *${stats.total_trades}* (✅${stats.winning_trades} / ❌${stats.losing_trades})
Win Rate: *${stats.win_rate}%*

💰 *P&L:*
Total: *${pnlSign}$${stats.total_pnl}* ${pnlIcon}
Avg Win: *+$${stats.avg_win}*
Avg Loss: *$${stats.avg_loss}*
Profit Factor: *${stats.profit_factor}*
    `.trim();

    if (stats.best_trade) {
      message += `\n\nBest: *+$${stats.best_trade.pnl}* (${stats.best_trade.pair})`;
      message += `\nWorst: *$${stats.worst_trade.pnl}* (${stats.worst_trade.pair})`;
    }

    if (stats.avg_hold_time > 0) {
      message += `\n\n⏱️ Avg Hold: *${stats.avg_hold_time} мин*`;
    }

    message += `\n\n🛡️ *RM:*`;
    message += `\nDaily Risk: *$${stats.daily_risk_used}/$${stats.daily_risk_limit}*`;
    message += `\nRM Violations: *${stats.rm_violations || 0}*`;

    if (stats.exit_reasons) {
      const tp = stats.exit_reasons.TP_HIT || 0;
      const sl = stats.exit_reasons.STOP_HIT || 0;
      const timeout =
        (stats.exit_reasons.TIMEOUT_1H || 0) + (stats.exit_reasons.TIMEOUT_HARD || 0);
      message += `\n\n📋 *Exits:* TP:${tp} SL:${sl} Timeout:${timeout}`;
    }

    return message;
  }
}

module.exports = StatsCalculator;
