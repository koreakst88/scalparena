class PaperSignalStats {
  static filterByProject(signals = [], project = 'all') {
    const normalized = String(project || 'all').toLowerCase();

    if (normalized === 'pump') {
      return signals.filter((signal) => (
        signal.strategy === 'PUMP_HUNTER' ||
        ['PUMP_HUNTER', 'PUMP_AUTO'].includes(signal.source)
      ));
    }

    if (normalized === 'candidates' || normalized === 'candidate') {
      return signals.filter((signal) => (
        ['CANDIDATE_ENGINE', 'CANDIDATE_AUTO'].includes(signal.source)
      ));
    }

    if (normalized === 'hybrid' || normalized === 'scan') {
      return signals.filter((signal) => (
        ['AUTO_SCAN', 'MANUAL_SCAN'].includes(signal.source)
      ));
    }

    return signals;
  }

  static calculate(signals = []) {
    const resolved = signals.filter((signal) => signal.status !== 'WATCHING');
    const tp = resolved.filter((signal) => signal.status === 'TP_HIT');
    const sl = resolved.filter((signal) => signal.status === 'SL_HIT');
    const timeout = resolved.filter((signal) => signal.status === 'TIMEOUT');

    return {
      total: signals.length,
      watching: signals.length - resolved.length,
      resolved: resolved.length,
      tp: tp.length,
      sl: sl.length,
      timeout: timeout.length,
      winRate: this._rate(tp.length, tp.length + sl.length),
      outcomeRate: this._rate(tp.length, resolved.length),
      avgTimeToResult: this._avg(
        resolved
          .map((signal) => Number(signal.time_to_result_minutes))
          .filter((value) => Number.isFinite(value))
      ),
      byStrategy: this._group(signals, (signal) => signal.strategy || 'UNKNOWN'),
      byPair: this._group(signals, (signal) => signal.pair || 'UNKNOWN'),
    };
  }

  static format(stats, periodTitle = 'период') {
    if (!stats.total) {
      return `📭 PAPER SIGNALS\n\nЗа ${periodTitle} сигналов пока нет.`;
    }

    const lines = [
      '📊 PAPER SIGNALS',
      '════════════════════════════════',
      `Период: ${periodTitle}`,
      '',
      `Всего: ${stats.total}`,
      `Наблюдаются: ${stats.watching}`,
      `Resolved: ${stats.resolved}`,
      `TP first: ${stats.tp}`,
      `SL first: ${stats.sl}`,
      `Timeout: ${stats.timeout}`,
      `WR TP/SL: ${this._formatPercent(stats.winRate)}`,
      `TP share resolved: ${this._formatPercent(stats.outcomeRate)}`,
    ];

    if (stats.avgTimeToResult != null) {
      lines.push(`Avg time: ${stats.avgTimeToResult} мин`);
    }

    lines.push('', '🧠 Стратегии:');
    lines.push(...this._formatRows(stats.byStrategy));
    lines.push('', '📊 Пары:');
    lines.push(...this._formatRows(stats.byPair));

    return lines.join('\n');
  }

  static formatWatching(signals = [], title = 'активные paper-сигналы') {
    const watching = signals
      .filter((signal) => signal.status === 'WATCHING')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (!watching.length) {
      return `📭 PAPER WATCHING\n\n${title}: активных наблюдений нет.`;
    }

    const lines = [
      '👀 PAPER WATCHING',
      '════════════════════════════════',
      title,
      '',
      `Всего наблюдается: ${watching.length}`,
      '',
    ];

    watching.slice(0, 15).forEach((signal, index) => {
      lines.push(
        `${index + 1}. ${signal.pair} ${signal.direction} | ${signal.strategy || 'UNKNOWN'} | ${signal.source || 'UNKNOWN'}`
      );
      lines.push(`Entry $${signal.entry_price} | TP $${signal.take_profit} | SL $${signal.stop_loss}`);
    });

    if (watching.length > 15) {
      lines.push('', `Показано 15 из ${watching.length}.`);
    }

    return lines.join('\n');
  }

  static _group(signals, getKey) {
    const groups = {};

    signals.forEach((signal) => {
      const key = getKey(signal);
      if (!groups[key]) {
        groups[key] = { label: key, total: 0, tp: 0, sl: 0, timeout: 0, watching: 0 };
      }

      groups[key].total += 1;

      if (signal.status === 'TP_HIT') groups[key].tp += 1;
      else if (signal.status === 'SL_HIT') groups[key].sl += 1;
      else if (signal.status === 'TIMEOUT') groups[key].timeout += 1;
      else groups[key].watching += 1;
    });

    return Object.values(groups)
      .map((group) => ({
        ...group,
        winRate: this._rate(group.tp, group.tp + group.sl),
      }))
      .sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return (b.winRate || 0) - (a.winRate || 0);
      });
  }

  static _formatRows(rows) {
    if (!rows.length) return ['нет данных'];

    return rows.slice(0, 5).map((row, index) => {
      return `${index + 1}. ${row.label}: ${row.tp}/${row.sl} TP/SL | WR ${this._formatPercent(row.winRate)} | N:${row.total}`;
    });
  }

  static _rate(part, total) {
    if (!total) return null;
    return parseFloat(((part / total) * 100).toFixed(1));
  }

  static _avg(values) {
    if (!values.length) return null;
    return parseFloat((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
  }

  static _formatPercent(value) {
    return value == null ? 'n/a' : `${value}%`;
  }
}

module.exports = PaperSignalStats;
