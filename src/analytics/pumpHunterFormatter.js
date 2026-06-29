class PumpHunterFormatter {
  static formatTop(reports, actionable = []) {
    const lines = [
      '🚀 PUMP HUNTER LAB',
      '━━━━━━━━━━━━━━━━━━━━',
      `Проверено: ${reports.length} монет`,
      `Готовых pump-входов: ${actionable.length}`,
      '',
    ];

    if (!actionable.length) {
      lines.push('Сильных pump-входов сейчас нет. Ниже лучшие кандидаты для наблюдения.');
      lines.push('');
    }

    reports.slice(0, 5).forEach((report, index) => {
      lines.push(this._formatReport(report, index + 1));
      lines.push('');
    });

    return lines.join('\n').trim();
  }

  static formatFull(reports) {
    const lines = [
      '🚀 PUMP HUNTER FULL',
      '━━━━━━━━━━━━━━━━━━━━',
      '',
    ];

    reports.forEach((report, index) => {
      lines.push(this._formatReport(report, index + 1));
      lines.push(`Причины: ${this._join(report.reasons)}`);
      lines.push(`Риски: ${this._join(report.risks)}`);
      lines.push('');
    });

    return lines.join('\n').trim();
  }

  static formatPaperResult(tracked) {
    if (!tracked.length) {
      return '🧪 В paper ничего не записано: сейчас нет готовых pump-входов.';
    }

    const lines = [
      `🧪 PumpHunter записал в paper: ${tracked.length}`,
      '━━━━━━━━━━━━━━━━━━━━',
    ];

    tracked.forEach((candidate, index) => {
      lines.push(`${index + 1}. ${candidate.pair} LONG score ${candidate.score}/100 fresh +${candidate.freshFromLow}%`);
    });

    return lines.join('\n');
  }

  static _formatReport(report, index) {
    if (!report || report.action === 'NO_TRADE') {
      return `${index}. ${report?.pair || 'UNKNOWN'}: ждать\n${report?.summary || 'нет данных'}`;
    }

    const status = report.action === 'TRADE' ? 'ГОТОВЫЙ PUMP-ВХОД' : 'НАБЛЮДАТЬ';

    return [
      `${index}. ${report.pair} LONG | ${status}`,
      `Pump score ${report.score}/100 | RR ${report.riskReward}`,
      `Вход $${report.entryPrice} | TP $${report.takeProfit} (+20%) | SL $${report.stopLoss} (-15%)`,
      `Fresh +${report.freshFromLow}% от low | 24h ${this._signed(report.priceChange24h)}% | volume x${report.volumeBoost}`,
      `Turnover 24h $${this._formatMoney(report.turnover24h)} | от high -${report.distanceFromHigh}%`,
      `Решение: ${report.summary}`,
    ].join('\n');
  }

  static _join(values = []) {
    return values.length ? values.join('; ') : 'нет';
  }

  static _signed(value) {
    return value >= 0 ? `+${value}` : String(value);
  }

  static _formatMoney(value) {
    if (!Number.isFinite(value)) return 'n/a';
    if (value >= 1000000) return `${Math.round(value / 100000) / 10}M`;
    if (value >= 1000) return `${Math.round(value / 100) / 10}K`;
    return String(Math.round(value));
  }
}

module.exports = PumpHunterFormatter;
