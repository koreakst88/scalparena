const RiskManager = require('../engine/riskManager');
const FeeCalculator = require('../engine/feeCalculator');
const { PAPER_SIGNAL_SLIPPAGE_BPS } = require('../config/paperSignals');

class PaperSignalStats {
  static filterByExperiment(signals = [], scope = 'current', currentExperimentId = null) {
    const normalized = String(scope || 'current').toLowerCase();

    if (normalized === 'history') return signals;

    if (normalized === 'legacy') {
      return signals.filter((signal) => (
        signal.is_legacy === true ||
        String(signal.experiment_id || '').startsWith('LEGACY_')
      ));
    }

    return signals.filter((signal) => (
      signal.is_legacy === false &&
      (!currentExperimentId || signal.experiment_id === currentExperimentId)
    ));
  }

  static filterByProject(signals = [], project = 'all') {
    const normalized = String(project || 'all').toLowerCase();

    if (normalized === 'pump') {
      return signals.filter((signal) => (
        signal.project === 'PUMP' ||
        signal.strategy === 'PUMP_HUNTER' ||
        ['PUMP_HUNTER', 'PUMP_AUTO'].includes(signal.source)
      ));
    }

    if (normalized === 'candidates' || normalized === 'candidate') {
      return signals.filter((signal) => (
        signal.project === 'CANDIDATE' ||
        ['CANDIDATE_ENGINE', 'CANDIDATE_AUTO'].includes(signal.source)
      ));
    }

    if (normalized === 'hybrid' || normalized === 'scan') {
      return signals.filter((signal) => (
        signal.project === 'HYBRID' ||
        ['AUTO_SCAN', 'MANUAL_SCAN'].includes(signal.source)
      ));
    }

    return signals;
  }

  static calculate(signals = [], options = {}) {
    const resolved = signals.filter((signal) => signal.status !== 'WATCHING');
    const tp = resolved.filter((signal) => signal.status === 'TP_HIT');
    const sl = resolved.filter((signal) => signal.status === 'SL_HIT');
    const timeout = resolved.filter((signal) => signal.status === 'TIMEOUT');

    const resolution = this._calculateResolutionQuality(resolved);
    const money = this._calculateRealizedPortfolio(resolved, options);

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
      resolution,
      money,
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

    if (stats.resolution?.measured > 0) {
      lines.push(
        `Path quality: candle ${stats.resolution.candlePath} | snapshot ${stats.resolution.snapshot} | ` +
        `timeout ${stats.resolution.timeout} | ambiguous ${stats.resolution.ambiguous}`
      );
    }

    if (stats.money) {
      lines.push(
        '',
        '💵 PAPER P&L:',
        `Модель: старт $${stats.money.startBalance} | max ${stats.money.maxPositions} позиции | ` +
        `slippage ${stats.money.slippageBps} bps/сторону`,
        `Принято: ${stats.money.accepted} | пропущено из-за лимита: ${stats.money.skippedByCapacity} | ` +
        `нет цены выхода: ${stats.money.missingExit}`,
        `Net: ${stats.money.netPnl >= 0 ? '+' : ''}$${stats.money.netPnl} | ` +
        `баланс $${stats.money.endBalance} | return ${this._formatPercent(stats.money.returnPercent)}`,
        `Wins/Losses: ${stats.money.wins}/${stats.money.losses} | PF ${stats.money.profitFactor ?? 'n/a'} | ` +
        `fees $${stats.money.totalFees} | slippage $${stats.money.slippageCost}`
      );
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

  static formatEdge(signals = [], title = 'период', options = {}) {
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
    const moneyModel = this._buildMoneyModel(enriched, options);
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

    lines.push('', '💵 Potential by MFE:');
    lines.push(...this._formatVirtualTpRows(enriched, moneyModel));

    lines.push('', '🏆 Лучшие движения:');
    lines.push(...this._formatEdgeSignals(enriched.slice().sort((a, b) => (b.mfePercent || 0) - (a.mfePercent || 0)).slice(0, 7)));

    lines.push('', '🧯 Худшие движения:');
    lines.push(...this._formatEdgeSignals(enriched.slice().sort((a, b) => (a.mfePercent || 0) - (b.mfePercent || 0)).slice(0, 7)));

    return lines.join('\n');
  }

  static _calculateResolutionQuality(signals = []) {
    const measured = signals.filter((signal) => signal.resolution_method);

    return {
      measured: measured.length,
      candlePath: measured.filter((signal) => signal.resolution_method === 'CANDLE_PATH').length,
      snapshot: measured.filter((signal) => signal.resolution_method === 'PRICE_SNAPSHOT').length,
      timeout: measured.filter((signal) => signal.resolution_method === 'TIMEOUT').length,
      ambiguous: measured.filter((signal) => signal.first_hit_ambiguous === true).length,
    };
  }

  static _calculateRealizedPortfolio(signals = [], options = {}) {
    const startBalance = Number(options.balance);
    if (!Number.isFinite(startBalance) || startBalance <= 0) return null;
    if (signals.length === 0) return null;

    const maxPositions = Number.isFinite(Number(options.maxPositions))
      ? Math.max(1, Number.parseInt(options.maxPositions, 10))
      : RiskManager.getMaxPositions();
    const slippageBps = Number.isFinite(Number(options.slippageBps))
      ? Math.max(0, Number(options.slippageBps))
      : PAPER_SIGNAL_SLIPPAGE_BPS;
    const ordered = signals
      .map((signal) => ({
        signal,
        entryAt: this._signalDate(signal.created_at || signal.generated_at),
        exitAt: this._signalDate(signal.resolved_at || signal.expires_at),
      }))
      .filter((item) => item.entryAt && item.exitAt)
      .sort((a, b) => {
        const timeDiff = a.entryAt - b.entryAt;
        if (timeDiff !== 0) return timeDiff;
        return Number(b.signal.confidence || 0) - Number(a.signal.confidence || 0);
      });

    let balance = startBalance;
    let skippedByCapacity = 0;
    let missingExit = signals.length - ordered.length;
    let accepted = 0;
    let wins = 0;
    let losses = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let totalFees = 0;
    let slippageCost = 0;
    const activeEnds = [];

    ordered.forEach(({ signal, entryAt, exitAt }) => {
      for (let index = activeEnds.length - 1; index >= 0; index -= 1) {
        if (activeEnds[index] <= entryAt) activeEnds.splice(index, 1);
      }

      if (activeEnds.length >= maxPositions) {
        skippedByCapacity += 1;
        return;
      }

      activeEnds.push(exitAt);
      accepted += 1;

      const entryPrice = this._positiveNumber(signal.entry_price);
      const exitPrice = this._getRealizedExitPrice(signal);
      if (!entryPrice || !exitPrice) {
        missingExit += 1;
        return;
      }

      const direction = String(signal.direction || 'LONG').toUpperCase();
      const adjusted = this._applyAdverseSlippage(entryPrice, exitPrice, direction, slippageBps);
      const riskBalance = Math.max(1, balance);
      const margin = RiskManager.getMargin(riskBalance);
      const leverage = RiskManager.getLeverage(riskBalance);
      const ideal = FeeCalculator.calculatePnL({
        entryPrice,
        exitPrice,
        margin,
        leverage,
        direction,
      });
      const realistic = FeeCalculator.calculatePnL({
        entryPrice: adjusted.entryPrice,
        exitPrice: adjusted.exitPrice,
        margin,
        leverage,
        direction,
      });

      balance += realistic.netPnl;
      totalFees += realistic.totalFees;
      slippageCost += ideal.netPnl - realistic.netPnl;

      if (realistic.netPnl > 0) {
        wins += 1;
        grossProfit += realistic.netPnl;
      } else if (realistic.netPnl < 0) {
        losses += 1;
        grossLoss += Math.abs(realistic.netPnl);
      }
    });

    const netPnl = balance - startBalance;

    return {
      startBalance: this._round(startBalance, 2),
      endBalance: this._round(balance, 2),
      netPnl: this._round(netPnl, 2),
      returnPercent: this._round((netPnl / startBalance) * 100, 2),
      accepted,
      skippedByCapacity,
      missingExit,
      wins,
      losses,
      profitFactor: grossLoss > 0 ? this._round(grossProfit / grossLoss, 2) : null,
      totalFees: this._round(totalFees, 2),
      slippageCost: this._round(Math.max(0, slippageCost), 2),
      slippageBps,
      maxPositions,
    };
  }

  static _getRealizedExitPrice(signal) {
    if (signal.status === 'TP_HIT') return this._positiveNumber(signal.take_profit);
    if (signal.status === 'SL_HIT') return this._positiveNumber(signal.stop_loss);
    if (signal.status === 'TIMEOUT') return this._positiveNumber(signal.hit_price);
    return this._positiveNumber(signal.hit_price);
  }

  static _applyAdverseSlippage(entryPrice, exitPrice, direction, slippageBps) {
    const rate = slippageBps / 10000;

    if (direction === 'SHORT') {
      return {
        entryPrice: entryPrice * (1 - rate),
        exitPrice: exitPrice * (1 + rate),
      };
    }

    return {
      entryPrice: entryPrice * (1 + rate),
      exitPrice: exitPrice * (1 - rate),
    };
  }

  static _signalDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  static _positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
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

  static _formatVirtualTpRows(signals, moneyModel) {
    const levels = [2, 3, 5, 8];
    const lines = [];

    if (moneyModel) {
      lines.push(
        `Модель: баланс $${moneyModel.balance} | margin $${moneyModel.margin} | leverage ${moneyModel.leverage}x | notional $${moneyModel.notional}`
      );
    } else {
      lines.push('Модель: только %; баланс пользователя недоступен');
    }

    lines.push('Важно: это MFE-потенциал, не точный first-hit порядок.');

    levels.forEach((level) => {
      const hitCount = signals.filter((signal) => Number.isFinite(signal.mfePercent) && signal.mfePercent >= level).length;
      const hitRate = this._formatPercent(this._rate(hitCount, signals.length));
      const pnl = moneyModel ? this._calculateVirtualPnl(signals, level, moneyModel) : null;
      const money = pnl
        ? ` | net $${pnl.netPnl} | avg $${pnl.avgPnl}`
        : '';

      lines.push(`TP +${level}%: ${hitCount}/${signals.length} (${hitRate})${money}`);
    });

    return lines;
  }

  static _buildMoneyModel(signals, options = {}) {
    const balance = Number(options.balance);
    if (!Number.isFinite(balance) || balance <= 0) return null;

    const margin = RiskManager.getMargin(balance);
    const leverage = RiskManager.getLeverage(balance);

    return {
      balance: this._round(balance, 2),
      margin,
      leverage,
      notional: margin * leverage,
    };
  }

  static _calculateVirtualPnl(signals, targetPercent, moneyModel) {
    const values = signals.map((signal) => {
      const entry = Number(signal.entry_price);
      if (!Number.isFinite(entry) || entry <= 0) return 0;

      const direction = signal.direction || 'LONG';
      let exitPrice;

      if (Number.isFinite(signal.mfePercent) && signal.mfePercent >= targetPercent) {
        exitPrice = direction === 'SHORT'
          ? entry * (1 - targetPercent / 100)
          : entry * (1 + targetPercent / 100);
      } else if (signal.status === 'SL_HIT' && Number.isFinite(Number(signal.stop_loss))) {
        exitPrice = Number(signal.stop_loss);
      } else if (Number.isFinite(Number(signal.hit_price))) {
        exitPrice = Number(signal.hit_price);
      } else {
        exitPrice = entry;
      }

      return FeeCalculator.calculatePnL({
        entryPrice: entry,
        exitPrice,
        margin: moneyModel.margin,
        leverage: moneyModel.leverage,
        direction,
      }).netPnl;
    });

    const total = values.reduce((sum, value) => sum + value, 0);
    const avg = values.length ? total / values.length : 0;

    return {
      netPnl: this._round(total, 2),
      avgPnl: this._round(avg, 2),
    };
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
