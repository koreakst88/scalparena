class StructureLevelFormatter {
  static format(report) {
    if (report.status === 'DATA_NOT_READY') {
      return [
        '🏗 STRUCTURE · LEVEL ENGINE',
        '━━━━━━━━━━━━━━━━━━━━',
        `Пара: ${report.pair}`,
        'Статус: DATA NOT READY',
        `Причина: ${report.reason}`,
        '',
        'Уровни не рассчитывались. Сигналы: OFF',
      ].join('\n');
    }

    return [
      '🏗 STRUCTURE · LEVEL ENGINE',
      '━━━━━━━━━━━━━━━━━━━━',
      `Пара: ${report.pair}`,
      `Источник: ${report.source}`,
      `Цена: ${this._price(report.currentPrice)}`,
      `Структура 4H: ${this._structureLabel(report.structure)}`,
      `Волатильность 1H: ${this._compressionLabel(report.compression)}`,
      `Найдено pivot: 4H ${report.pivotCount['4H']} | 1H ${report.pivotCount['1H']}`,
      `Сильных зон: ${report.zoneCount}`,
      '',
      '🔴 Сопротивление:',
      ...this._formatZones(report.resistance, 'R'),
      '',
      '🟢 Поддержка:',
      ...this._formatZones(report.support, 'S'),
      ...(report.activeZones.length
        ? [
          '',
          '🟡 Цена внутри зоны:',
          ...this._formatZones(report.activeZones, 'Z'),
        ]
        : []),
      '',
      'Score показывает качество зоны, а не вероятность сделки.',
      'Сигналы: OFF | Events: OFF | Paper: OFF | Alerts: OFF',
      'Это диагностика структуры. Вход, TP и SL не рассчитывались.',
    ].join('\n');
  }

  static _formatZones(zones = [], prefix) {
    if (!zones.length) return ['— подходящих зон нет'];

    return zones.map((zone, index) => (
      `${prefix}${index + 1} ${this._price(zone.lower)}–${this._price(zone.upper)}` +
      ` | score ${zone.score}/100 | касаний ${zone.touches}` +
      ` | TF ${zone.timeframes.join('+')}` +
      ` | реакция ${zone.averageReactionAtr} ATR` +
      ` | расстояние ${zone.distancePercent}%`
    ));
  }

  static _structureLabel(structure = {}) {
    const labels = {
      UPTREND: 'тренд вверх',
      DOWNTREND: 'тренд вниз',
      RANGE_OR_TRANSITION: 'боковик/переход',
      UNDETERMINED: 'не определена',
    };
    return `${labels[structure.state] || structure.state} (${structure.sequence})`;
  }

  static _compressionLabel(compression = {}) {
    const labels = {
      COMPRESSED: 'сжатие',
      EXPANDING: 'расширение',
      NORMAL: 'обычная',
    };
    return `${labels[compression.state] || compression.state}` +
      ` | ATR ratio ${compression.atrRatio} | range ratio ${compression.rangeRatio}`;
  }

  static _price(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    if (number >= 1000) return `$${number.toFixed(2)}`;
    if (number >= 1) return `$${number.toFixed(4)}`;
    return `$${number.toFixed(8)}`;
  }
}

module.exports = StructureLevelFormatter;
