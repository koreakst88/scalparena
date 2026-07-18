class PumpHunterFormatter {
  static formatTop(reports, actionable = []) {
    if (!reports.length) {
      return this._formatDataUnavailable();
    }

    const lines = [
      '🚀 PUMP HUNTER LAB',
      '━━━━━━━━━━━━━━━━━━━━',
      `Источник данных: ${this._formatMarketSource(reports)}`,
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
    if (!reports.length) {
      return this._formatDataUnavailable();
    }

    const lines = [
      '🚀 PUMP HUNTER FULL',
      '━━━━━━━━━━━━━━━━━━━━',
      `Источник данных: ${this._formatMarketSource(reports)}`,
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
      return '🧪 В paper ничего не записано: нет новых pump-входов для записи. Возможная причина: вход уже наблюдается в paper.';
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
      `Pump score ${report.score}/100 | RR ${report.riskReward} | ${report.exitProfile || 'dynamic'}`,
      `Вход $${report.entryPrice} | Main TP $${report.takeProfit} (+${report.tpPercent}%) | SL $${report.stopLoss} (-${report.slPercent}%)`,
      `TP1 $${report.tp1} (+${report.tp1Percent || 2}%) | TP2 $${report.tp2} (+${report.tp2Percent || 3}%) | Stretch $${report.stretchTakeProfit} (+${report.stretchTpPercent || 8}%)`,
      `Moon TP $${report.moonTakeProfit} (+${report.moonTpPercent || 20}%) — только бонус`,
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

  static _formatMarketSource(reports) {
    const source = reports.find((report) => report?.marketSource)?.marketSource || 'BYBIT';
    if (source === 'BINANCE_FUTURES_FALLBACK') return 'Binance futures fallback';
    if (source === 'OKX_SWAP_FALLBACK') return 'OKX swap fallback';
    return 'Bybit futures';
  }

  static _formatDataUnavailable() {
    return [
      '🚀 PUMP HUNTER LAB',
      '━━━━━━━━━━━━━━━━━━━━',
      'Данные Bybit не получены.',
      '',
      'Это не значит, что pump-входов нет. Сканер не получил список futures tickers.',
      '',
      'Проверь в Railway logs сообщения Bybit tickers request failed / retCode.',
      'Также проверь переменную PUMP_HUNTER_USE_TESTNET=false.',
    ].join('\n');
  }
}

module.exports = PumpHunterFormatter;
