class ExtremeWideFormatter {
  static format(scan, limit = 10) {
    const top = scan.reports.slice(0, limit);
    const rows = top.length
      ? top.flatMap((report, index) => [
        `${index + 1}. ${report.pair} | ${report.score}/100 | ${this._label(report.anomalyType)}`,
        `24ч ${this._signed(report.priceChange24hPercent)}% | диапазон ${report.range24hPercent}% | funding ${this._signedNullable(report.fundingPercent)}%`,
        `Оборот ${this._money(report.turnover24h)} | OI ${this._money(report.openInterestUsd)} | spread ${report.spreadPercent ?? 'n/a'}%`,
      ])
      : ['Подходящих ликвидных инструментов не найдено.'];

    return [
      '⚡ EXTREME WIDE RADAR · DIAGNOSTIC',
      '━━━━━━━━━━━━━━━━━━━━',
      `Источник universe: ${scan.marketSource}`,
      `Проверено контрактов: ${scan.scannedPairs}`,
      `После фильтра ликвидности: ${scan.eligiblePairs}`,
      `Диагностических аномалий: ${scan.anomalyCount}`,
      `Порог: score >= ${scan.anomalyScore} | turnover >= ${this._money(scan.minTurnoverUsd)}`,
      '',
      ...rows,
      '',
      `Диагностический снимок сохранён: ${scan.diagnosticSaved ? 'YES' : 'NO'}`,
      'Состояния WATCH/ARMED: не создаются',
      'Extreme events: 0',
      'Paper-сигналы: 0',
      'Telegram-алерты: OFF',
    ].join('\n');
  }

  static _label(value) {
    const labels = {
      SHORT_SQUEEZE_PRESSURE: 'давление на шорты',
      LONG_LIQUIDATION_RISK: 'риск ликвидации лонгов',
      FUNDING_DISLOCATION: 'аномальный funding',
      VOLATILITY_EXPANSION: 'расширение волатильности',
      MARKET_ANOMALY: 'рыночная аномалия',
    };
    return labels[value] || value;
  }

  static _signed(value) {
    const number = Number(value || 0);
    return `${number >= 0 ? '+' : ''}${number}`;
  }

  static _signedNullable(value) {
    return value == null ? 'n/a' : this._signed(value);
  }

  static _money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    if (number >= 1000000000) return `$${(number / 1000000000).toFixed(1)}B`;
    if (number >= 1000000) return `$${(number / 1000000).toFixed(1)}M`;
    if (number >= 1000) return `$${(number / 1000).toFixed(1)}K`;
    return `$${number.toFixed(0)}`;
  }
}

module.exports = ExtremeWideFormatter;
