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

    const patternStats = this._buildPatternStats(closed);

    return {
      ...base,
      best_trade: { pair: bestTrade.pair, pnl: bestTrade.profit_loss },
      worst_trade: { pair: worstTrade.pair, pnl: worstTrade.profit_loss },
      avg_hold_time: avgHoldTime,
      pair_stats: pairStats,
      best_pair: bestPairEntry ? { pair: bestPairEntry[0], ...bestPairEntry[1] } : null,
      worst_pair: worstPairEntry ? { pair: worstPairEntry[0], ...worstPairEntry[1] } : null,
      exit_reasons: exitReasons,
      ...patternStats,
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

    if (stats.context_coverage?.trades_with_context > 0) {
      message += `\n\n🧪 *СЕТАПЫ:*`;
      message += `\nContext: *${stats.context_coverage.trades_with_context}/${stats.context_coverage.total_trades}* сделок`;

      if (stats.best_setup) {
        message += `\nBest Setup: *${this._formatLabel(stats.best_setup.label)}*`;
        message += `\n  P&L: *${this._formatMoney(stats.best_setup.pnl)}* | WR: *${stats.best_setup.win_rate}%* | N:${stats.best_setup.trades}`;
      }

      if (stats.worst_setup) {
        message += `\nWorst Setup: *${this._formatLabel(stats.worst_setup.label)}*`;
        message += `\n  P&L: *${this._formatMoney(stats.worst_setup.pnl)}* | WR: *${stats.worst_setup.win_rate}%* | N:${stats.worst_setup.trades}`;
      }

      if (stats.best_regime) {
        message += `\nRegime: *${this._formatLabel(stats.best_regime.label)}* (${this._formatMoney(stats.best_regime.pnl)})`;
      }

      if (stats.best_macd_bias) {
        message += `\nMACD: *${this._formatLabel(stats.best_macd_bias.label)}* (${this._formatMoney(stats.best_macd_bias.pnl)})`;
      }
    }

    return message;
  }

  /**
   * Форматировать отдельный отчёт по паттернам за период.
   */
  static formatPatternMessage(stats, days = 7) {
    if (!stats.total_trades) {
      return `
🧪 *PATTERN LAB: ${days}D*
════════════════════════════════

Пока нет закрытых сделок за период.
Соберём 20-30 сделок — и тут начнётся самое вкусное: какие сетапы кормят, а какие тихо кусают депозит.
      `.trim();
    }

    const coverage = stats.context_coverage || {
      total_trades: stats.total_trades,
      trades_with_context: 0,
    };

    let message = `
🧪 *PATTERN LAB: ${days}D*
════════════════════════════════

Сделок: *${stats.total_trades}*
P&L: *${this._formatMoney(stats.total_pnl)}*
Win Rate: *${stats.win_rate}%*
Context: *${coverage.trades_with_context}/${coverage.total_trades}*
    `.trim();

    if (!coverage.trades_with_context) {
      message += `\n\nНовые context-поля уже включены, но старые сделки их не содержат. Следующие сделки начнут заполнять Pattern Lab автоматически.`;
      return message;
    }

    message += `\n\n🏆 *ТОП СЕТАПЫ:*`;
    message += this._formatPatternRows(stats.setup_stats, 3);

    message += `\n\n⚠️ *СЛАБЫЕ СЕТАПЫ:*`;
    message += this._formatPatternRows([...(stats.setup_stats || [])].reverse(), 3);

    message += `\n\n🌡️ *REGIME:*`;
    message += this._formatPatternRows(stats.regime_stats, 4);

    message += `\n\n📉 *MACD BIAS:*`;
    message += this._formatPatternRows(stats.macd_bias_stats, 4);

    message += `\n\n💡 Минимум для вывода: *20-30 сделок*. До этого смотрим осторожно, без резких поворотов руля.`;

    return message;
  }

  static _buildPatternStats(closed) {
    const tradesWithContext = closed.filter((trade) => {
      return trade.strategy || trade.market_regime || trade.macd_bias || trade.rsi_at_entry;
    });

    if (tradesWithContext.length === 0) {
      return {
        context_coverage: {
          total_trades: closed.length,
          trades_with_context: 0,
        },
      };
    }

    const setupGroups = this._groupTrades(tradesWithContext, (trade) => {
      const strategy = trade.strategy || 'UNKNOWN_STRATEGY';
      const regime = trade.market_regime || 'UNKNOWN_REGIME';
      const macd = trade.macd_bias || 'UNKNOWN_MACD';
      return `${strategy} / ${regime} / ${macd}`;
    });

    const regimeGroups = this._groupTrades(
      tradesWithContext,
      (trade) => trade.market_regime || 'UNKNOWN_REGIME'
    );

    const macdGroups = this._groupTrades(
      tradesWithContext,
      (trade) => trade.macd_bias || 'UNKNOWN_MACD'
    );

    return {
      context_coverage: {
        total_trades: closed.length,
        trades_with_context: tradesWithContext.length,
      },
      setup_stats: setupGroups,
      regime_stats: regimeGroups,
      macd_bias_stats: macdGroups,
      best_setup: setupGroups[0] || null,
      worst_setup: setupGroups[setupGroups.length - 1] || null,
      best_regime: regimeGroups[0] || null,
      worst_regime: regimeGroups[regimeGroups.length - 1] || null,
      best_macd_bias: macdGroups[0] || null,
      worst_macd_bias: macdGroups[macdGroups.length - 1] || null,
    };
  }

  static _groupTrades(trades, getLabel) {
    const groups = {};

    trades.forEach((trade) => {
      const label = getLabel(trade);
      if (!groups[label]) {
        groups[label] = {
          label,
          trades: 0,
          wins: 0,
          losses: 0,
          pnl: 0,
        };
      }

      groups[label].trades++;
      if (trade.profit_loss > 0) groups[label].wins++;
      if (trade.profit_loss < 0) groups[label].losses++;
      groups[label].pnl += trade.profit_loss || 0;
    });

    return Object.values(groups)
      .map((group) => ({
        ...group,
        pnl: parseFloat(group.pnl.toFixed(4)),
        win_rate: parseFloat(((group.wins / group.trades) * 100).toFixed(1)),
        avg_pnl: parseFloat((group.pnl / group.trades).toFixed(4)),
      }))
      .sort((a, b) => b.pnl - a.pnl);
  }

  static _formatLabel(value) {
    return String(value || 'UNKNOWN').replace(/_/g, ' ');
  }

  static _formatMoney(value) {
    const number = Number(value) || 0;
    return `${number >= 0 ? '+' : ''}$${number.toFixed(4)}`;
  }

  static _formatPatternRows(rows = [], limit = 3) {
    const selected = rows.slice(0, limit);
    if (selected.length === 0) return `\nнет данных`;

    return selected
      .map((row, index) => {
        const label = this._formatLabel(row.label);
        return `\n${index + 1}. *${label}* | ${this._formatMoney(row.pnl)} | WR ${row.win_rate}% | N:${row.trades}`;
      })
      .join('');
  }
}

module.exports = StatsCalculator;
