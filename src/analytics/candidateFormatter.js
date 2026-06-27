class CandidateFormatter {
  static formatTop(reports, actionable = []) {
    const lines = [
      '🧠 MARKET CANDIDATES',
      '════════════════════════════════',
      `Проверено пар: ${reports.length}`,
      `Actionable: ${actionable.length}`,
      '',
    ];

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
      return '🧪 Paper candidates: нет кандидатов score >= 70 и RR >= 1.0';
    }

    const lines = [
      `🧪 Paper candidates записаны: ${tracked.length}`,
      '════════════════════════════════',
    ];

    tracked.forEach((candidate, index) => {
      lines.push(`${index + 1}. ${candidate.pair} ${candidate.direction} ${candidate.strategy} score ${candidate.score}/100`);
    });

    return lines.join('\n');
  }

  static _formatReportSummary(report, index) {
    const candidate = report.bestTrade || report.best;

    if (!candidate || candidate.action === 'NO_TRADE') {
      return `${index}. ${report.pair}: WAIT\n${report.best.summary}`;
    }

    const status = candidate.score >= 70 ? 'ACTIONABLE' : 'WATCH';
    const decision = report.best.action === 'NO_TRADE'
      ? `Decision: NO_TRADE (${report.best.summary.replace('NO_TRADE: ', '')})`
      : `Decision: ${status}`;

    return [
      `${index}. ${candidate.pair} ${candidate.direction} ${candidate.strategy} ${status}`,
      `Score: ${candidate.score}/100 | RR: ${candidate.riskReward}`,
      `Entry: $${candidate.entryPrice} | TP: $${candidate.takeProfit} | SL: $${candidate.stopLoss}`,
      `Context: ${candidate.context.marketRegime}, RSI ${candidate.context.rsi}, Vol ${candidate.context.volume}%, MACD ${candidate.context.macdBias}`,
      decision,
    ].join('\n');
  }

  static _join(values = []) {
    return values.length ? values.join('; ') : 'нет';
  }
}

module.exports = CandidateFormatter;
