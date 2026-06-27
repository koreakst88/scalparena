class CandidateFormatter {
  static formatTop(reports, actionable = []) {
    const lines = [
      '🧠 КАНДИДАТЫ РЫНКА',
      '━━━━━━━━━━━━━━━━━━━━',
      `Проверено: ${reports.length} пар`,
      `Готовых входов: ${actionable.length}`,
      '',
    ];

    if (!actionable.length) {
      lines.push('Сильных входов сейчас нет. Ниже лучшие сценарии для наблюдения.');
      lines.push('');
    }

    const topReports = reports.slice(0, 5);
    topReports.forEach((report, index) => {
      lines.push(this._formatReportSummary(report, index + 1));
      lines.push('');
    });

    return lines.join('\n').trim();
  }

  static formatFull(reports) {
    const lines = [
      '🧠 MARKET CANDIDATES FULL',
      '════════════════════════════════',
      '',
    ];

    reports.forEach((report, index) => {
      lines.push(this._formatReportSummary(report, index + 1));
      lines.push(`Причины: ${this._join(report.best.reasons)}`);
      lines.push(`Риски: ${this._join(report.best.risks)}`);

      const next = report.candidates
        .filter((candidate) => candidate !== report.best)
        .slice(0, 2)
        .map((candidate) => `${candidate.strategy} ${candidate.direction || ''} ${candidate.score}/100`.trim());

      if (next.length) {
        lines.push(`Альтернативы: ${next.join(' | ')}`);
      }

      lines.push('');
    });

    return lines.join('\n').trim();
  }

  static formatPaperResult(tracked) {
    if (!tracked.length) {
      return '🧪 В paper ничего не записано: сейчас нет готовых входов с оценкой >= 70 и RR >= 1.0';
    }

    const lines = [
      `🧪 В paper записано: ${tracked.length}`,
      '━━━━━━━━━━━━━━━━━━━━',
    ];

    tracked.forEach((candidate, index) => {
      lines.push(`${index + 1}. ${candidate.pair} ${this._directionLabel(candidate.direction)} ${this._strategyLabel(candidate.strategy)} ${candidate.score}/100`);
    });

    return lines.join('\n');
  }

  static _formatReportSummary(report, index) {
    const candidate = report.bestTrade || report.best;

    if (!candidate || candidate.action === 'NO_TRADE') {
      return `${index}. ${report.pair}: ждать\n${this._cleanSummary(report.best.summary)}`;
    }

    const status = candidate.score >= 70 ? 'ГОТОВЫЙ ВХОД' : 'НАБЛЮДАТЬ';
    const decision = report.best.action === 'NO_TRADE'
      ? this._cleanSummary(report.best.summary)
      : status;

    return [
      `${index}. ${candidate.pair} ${this._directionLabel(candidate.direction)} | ${status}`,
      `${this._strategyLabel(candidate.strategy)} | оценка ${candidate.score}/100 | RR ${candidate.riskReward}`,
      `Вход $${candidate.entryPrice} | TP $${candidate.takeProfit} | SL $${candidate.stopLoss}`,
      `${this._regimeLabel(candidate.context.marketRegime)} | RSI ${candidate.context.rsi} | Vol ${candidate.context.volume}% | MACD ${this._macdLabel(candidate.context.macdBias)}`,
      `Решение: ${decision}`,
    ].join('\n');
  }

  static _join(values = []) {
    return values.length ? values.join('; ') : 'нет';
  }

  static _directionLabel(direction) {
    if (direction === 'LONG') return 'LONG';
    if (direction === 'SHORT') return 'SHORT';
    return direction || '-';
  }

  static _strategyLabel(strategy) {
    const labels = {
      TREND_PULLBACK: 'Откат по тренду',
      MEAN_REVERSION: 'Возврат к среднему',
      BREAKOUT: 'Пробой',
    };

    return labels[strategy] || strategy;
  }

  static _regimeLabel(regime) {
    const labels = {
      TREND_UP: 'тренд вверх',
      TREND_DOWN: 'тренд вниз',
      LOW_VOL_RANGE: 'боковик',
      HIGH_VOL: 'высокая волатильность',
      NOISE: 'шум',
    };

    return labels[regime] || regime;
  }

  static _macdLabel(macdBias) {
    const labels = {
      BULLISH: 'бычий',
      BEARISH: 'медвежий',
      MIXED: 'смешанный',
    };

    return labels[macdBias] || macdBias;
  }

  static _cleanSummary(summary = '') {
    return String(summary)
      .replace(/^NO_TRADE:\s*/i, '')
      .replace(/not enough candles/i, 'недостаточно свечей')
      .replace(/TREND_PULLBACK/g, 'откат по тренду')
      .replace(/MEAN_REVERSION/g, 'возврат к среднему')
      .replace(/BREAKOUT/g, 'пробой')
      .replace(/score/g, 'оценка')
      .trim();
  }
}

module.exports = CandidateFormatter;
