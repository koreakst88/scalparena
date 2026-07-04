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

    if (stats.watching > 0) {
      lines.push('', '👀 Активные наблюдения: /signals open | /signals open pump | /signals open candidates');
    }

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

  static formatDetail(signals = [], title = 'период') {
    if (!signals.length) {
      return `📭 PAPER DETAIL\n\nЗа ${title} сигналов пока нет.`;
    }

    const enriched = signals.map((signal) => this._enrichSignal(signal));
    const resolved = enriched.filter((signal) => signal.status !== 'WATCHING');
    const lines = [
      '🔬 PAPER DETAIL',
      '════════════════════════════════',
      `Период: ${title}`,
      '',
      `Всего: ${signals.length}`,
      `Resolved: ${resolved.length}`,
      `Avg MFE: ${this._formatPercent(this._avg(enriched.map((signal) => signal.mfePercent).filter(Number.isFinite)))}`,
      `Avg MAE: ${this._formatPercent(this._avg(enriched.map((signal) => signal.maePercent).filter(Number.isFinite)))}`,
      `Avg TP progress: ${this._formatPercent(this._avg(enriched.map((signal) => signal.tpProgress).filter(Number.isFinite)))}`,
      `Avg SL pressure: ${this._formatPercent(this._avg(enriched.map((signal) => signal.slPressure).filter(Number.isFinite)))}`,
      '',
      '🧠 По стратегиям:',
    ];

    lines.push(...this._formatDetailRows(this._detailGroup(enriched, (signal) => signal.strategy || 'UNKNOWN')));
    lines.push('', '📊 По парам:');
    lines.push(...this._formatDetailRows(this._detailGroup(enriched, (signal) => signal.pair || 'UNKNOWN')));

    const weakest = enriched
      .filter((signal) => signal.status === 'SL_HIT' || signal.status === 'TIMEOUT')
      .sort((a, b) => (a.tpProgress || 0) - (b.tpProgress || 0))
      .slice(0, 5);

    if (weakest.length) {
      lines.push('', '🧯 Слабые последние/худшие кейсы:');
      weakest.forEach((signal, index) => {
        lines.push(
          `${index + 1}. ${signal.pair} ${signal.strategy || 'UNKNOWN'} ${signal.status} | ` +
          `MFE ${this._formatPercent(signal.mfePercent)} | MAE ${this._formatPercent(signal.maePercent)} | ` +
          `TP prog ${this._formatPercent(signal.tpProgress)}`
        );
      });
    }

    return lines.join('\n');
  }

  static formatEdge(signals = [], title = 'период') {
    if (!signals.length) {
      return `📭 PAPER EDGE\n\nЗа ${title} сигналов пока нет.`;
    }

    const enriched = signals.map((signal) => this._enrichSignal(signal));
    const resolved = enriched.filter((signal) => signal.status !== 'WATCHING');
    const thresholds = [0.5, 1, 2, 3, 5, 8, 10, 15, 20];
    const avgMfe = this._avg(enriched.map((signal) => signal.mfePercent).filter(Number.isFinite));
    const avgMae = this._avg(enriched.map((signal) => signal.maePercent).filter(Number.isFinite));
    const positive = enriched.filter((signal) => Number.isFinite(signal.mfePercent) && signal.mfePercent > 0);
    const strong = enriched.filter((signal) => Number.isFinite(signal.mfePercent) && signal.mfePercent >= 5);
    const moon = enriched.filter((signal) => Number.isFinite(signal.mfePercent) && signal.mfePercent >= 20);
    const lines = [
      '📈 PAPER EDGE',
      '════════════════════════════════',
      `Период: ${title}`,
      '',
      `Всего: ${signals.length}`,
      `Resolved: ${resolved.length}`,
      `Хоть раз в плюс: ${positive.length}/${signals.length} (${this._formatPercent(this._rate(positive.length, signals.length))})`,
      `>=5% MFE: ${strong.length}/${signals.length} (${this._formatPercent(this._rate(strong.length, signals.length))})`,
      `>=20% moon: ${moon.length}/${signals.length} (${this._formatPercent(this._rate(moon.length, signals.length))})`,
      `Avg MFE: ${this._formatPercent(avgMfe)}`,
      `Avg MAE: ${this._formatPercent(avgMae)}`,
      '',
      '🎯 MFE пороги:',
    ];

    thresholds.forEach((threshold) => {
      const count = enriched.filter((signal) => Number.isFinite(signal.mfePercent) && signal.mfePercent >= threshold).length;
      lines.push(`>=${threshold}%: ${count}/${signals.length} (${this._formatPercent(this._rate(count, signals.length))})`);
    });

    lines.push('', '🏆 Лучшие движения:');
    lines.push(...this._formatEdgeSignals(enriched.slice().sort((a, b) => (b.mfePercent || 0) - (a.mfePercent || 0)).slice(0, 7)));

    lines.push('', '🧯 Худшие движения:');
    lines.push(...this._formatEdgeSignals(enriched.slice().sort((a, b) => (a.mfePercent || 0) - (b.mfePercent || 0)).slice(0, 7)));

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

  static _detailGroup(signals, getKey) {
    const groups = {};

    signals.forEach((signal) => {
      const key = getKey(signal);
      if (!groups[key]) {
        groups[key] = {
          label: key,
          total: 0,
          tp: 0,
          sl: 0,
          timeout: 0,
          watching: 0,
          mfeValues: [],
          maeValues: [],
          tpProgressValues: [],
          slPressureValues: [],
        };
      }

      const group = groups[key];
      group.total += 1;
      if (signal.status === 'TP_HIT') group.tp += 1;
      else if (signal.status === 'SL_HIT') group.sl += 1;
      else if (signal.status === 'TIMEOUT') group.timeout += 1;
      else group.watching += 1;

      if (Number.isFinite(signal.mfePercent)) group.mfeValues.push(signal.mfePercent);
      if (Number.isFinite(signal.maePercent)) group.maeValues.push(signal.maePercent);
      if (Number.isFinite(signal.tpProgress)) group.tpProgressValues.push(signal.tpProgress);
      if (Number.isFinite(signal.slPressure)) group.slPressureValues.push(signal.slPressure);
    });

    return Object.values(groups)
      .map((group) => ({
        ...group,
        winRate: this._rate(group.tp, group.tp + group.sl),
        avgMfe: this._avg(group.mfeValues),
        avgMae: this._avg(group.maeValues),
        avgTpProgress: this._avg(group.tpProgressValues),
        avgSlPressure: this._avg(group.slPressureValues),
      }))
      .sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return (b.winRate || 0) - (a.winRate || 0);
      });
  }

  static _formatRows(rows) {
    if (!rows.length) return ['нет данных'];

    return rows.slice(0, 5).map((row, index) => {
      return `${index + 1}. ${row.label}: ${row.tp}/${row.sl} TP/SL | WR ${this._formatPercent(row.winRate)} | W:${row.watching} | N:${row.total}`;
    });
  }

  static _formatDetailRows(rows) {
    if (!rows.length) return ['нет данных'];

    return rows.slice(0, 7).map((row, index) => (
      `${index + 1}. ${row.label}: ${row.tp}/${row.sl} TP/SL | TO:${row.timeout} | W:${row.watching} | ` +
      `WR ${this._formatPercent(row.winRate)} | MFE ${this._formatPercent(row.avgMfe)} | ` +
      `MAE ${this._formatPercent(row.avgMae)} | TPp ${this._formatPercent(row.avgTpProgress)} | N:${row.total}`
    ));
  }

  static _formatEdgeSignals(signals) {
    if (!signals.length) return ['нет данных'];

    return signals.map((signal, index) => (
      `${index + 1}. ${signal.pair} ${signal.status} | MFE ${this._formatPercent(signal.mfePercent)} | ` +
      `MAE ${this._formatPercent(signal.maePercent)} | TPp ${this._formatPercent(signal.tpProgress)}`
    ));
  }

  static _enrichSignal(signal) {
    const entry = Number(signal.entry_price);
    const tp = Number(signal.take_profit);
    const sl = Number(signal.stop_loss);
    const favorable = Number(signal.max_favorable_price || signal.entry_price);
    const adverse = Number(signal.max_adverse_price || signal.entry_price);
    const direction = signal.direction || 'LONG';

    if (![entry, tp, sl].every((value) => Number.isFinite(value)) || entry <= 0) {
      return { ...signal, mfePercent: null, maePercent: null, tpProgress: null, slPressure: null };
    }

    const tpDistance = Math.abs(tp - entry);
    const slDistance = Math.abs(entry - sl);
    const mfeRaw = direction === 'SHORT' ? entry - favorable : favorable - entry;
    const maeRaw = direction === 'SHORT' ? adverse - entry : entry - adverse;
    const mfePercent = (Math.max(0, mfeRaw) / entry) * 100;
    const maePercent = (Math.max(0, maeRaw) / entry) * 100;
    const tpProgress = tpDistance > 0 ? (Math.max(0, mfeRaw) / tpDistance) * 100 : null;
    const slPressure = slDistance > 0 ? (Math.max(0, maeRaw) / slDistance) * 100 : null;

    return {
      ...signal,
      mfePercent: this._round(mfePercent),
      maePercent: this._round(maePercent),
      tpProgress: this._round(tpProgress == null ? null : Math.min(999, tpProgress)),
      slPressure: this._round(slPressure == null ? null : Math.min(999, slPressure)),
    };
  }

  static _rate(part, total) {
    if (!total) return null;
    return parseFloat(((part / total) * 100).toFixed(1));
  }

  static _avg(values) {
    if (!values.length) return null;
    return parseFloat((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
  }

  static _round(value, decimals = 1) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  static _formatPercent(value) {
    return value == null ? 'n/a' : `${value}%`;
  }
}

module.exports = PaperSignalStats;
