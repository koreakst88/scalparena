class StructureWideFormatter {
  static format(scan, limit = 10) {
    const top = scan.candidates.slice(0, limit);
    const rows = top.length
      ? top.flatMap((report, index) => [
        `${index + 1}. ${report.pair} | ${report.score}/100 | ${this._setup(report.setup)}`,
        `Цена ${this._price(report.currentPrice)} | зона ${this._zone(report.zone)}` +
          ` | расстояние ${report.zoneDistancePercent}%`,
        `4H ${this._structure(report.structure?.state)} | 1H ${this._compression(report.compression?.state)}` +
          ` | касаний ${report.zone?.touches || 0}`,
        `Оборот ${this._money(report.turnover24h)} | spread ${report.spreadPercent ?? 'n/a'}%`,
      ])
      : ['Диагностических Structure-кандидатов сейчас нет.'];

    return [
      '🏗 STRUCTURE WIDE RADAR · DIAGNOSTIC',
      '━━━━━━━━━━━━━━━━━━━━',
      `Источник universe: ${scan.marketSource}`,
      `Scope: ${scan.marketScope}`,
      `Проверка crypto spot: ${scan.spotVerificationEnabled ? `ON (${scan.spotPairs} USDT-пар)` : 'UNAVAILABLE'}`,
      `Увидено контрактов: ${scan.scannedPairs}`,
      `Прошли ликвидность/spread: ${scan.liquidPairs}`,
      `Выбрано для глубокого анализа: ${scan.deepScanSelected}`,
      `Полный Level Engine анализ: ${scan.analyzedPairs}`,
      `Диагностических кандидатов: ${scan.candidateCount}`,
      `Порог: score ≥ ${scan.settings.candidateScore}` +
        ` | зона ≤ ${scan.settings.maxZoneDistancePercent}%` +
        ` | turnover ≥ ${this._money(scan.settings.minTurnoverUsd)}`,
      `Время: ${(scan.durationMs / 1000).toFixed(1)} сек`,
      '',
      ...rows,
      '',
      `Диагностический снимок сохранён: ${scan.diagnosticSaved ? 'YES' : 'NO'}`,
      'Score показывает качество наблюдения, а не вероятность сделки.',
      'Events: 0 | Paper: 0 | Alerts: OFF | Live: OFF',
    ].join('\n');
  }

  static _setup(value) {
    const labels = {
      AT_KEY_ZONE: 'цена внутри сильной зоны',
      COMPRESSED_BELOW_RESISTANCE: 'сжатие под сопротивлением',
      NEAR_RESISTANCE: 'рядом с сопротивлением',
      COMPRESSED_ABOVE_SUPPORT: 'сжатие над поддержкой',
      NEAR_SUPPORT: 'рядом с поддержкой',
    };
    return labels[value] || value;
  }

  static _structure(value) {
    const labels = {
      UPTREND: 'тренд вверх',
      DOWNTREND: 'тренд вниз',
      RANGE_OR_TRANSITION: 'боковик/переход',
      UNDETERMINED: 'не определена',
    };
    return labels[value] || value;
  }

  static _compression(value) {
    const labels = {
      COMPRESSED: 'сжатие',
      NORMAL: 'обычная',
      EXPANDING: 'расширение',
    };
    return labels[value] || value;
  }

  static _zone(zone) {
    if (!zone) return 'n/a';
    return `${this._price(zone.lower)}–${this._price(zone.upper)}`;
  }

  static _price(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    if (number >= 1000) return `$${number.toFixed(2)}`;
    if (number >= 1) return `$${number.toFixed(4)}`;
    return `$${number.toFixed(8)}`;
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

module.exports = StructureWideFormatter;
