class StructureEventFormatter {
  static format(events = [], limit = 10) {
    const active = events.slice(0, limit);
    const rows = active.length
      ? active.flatMap((event, index) => [
        `${index + 1}. ${event.pair} | ${event.state} | ${this._scenario(event.scenario)}`,
        `Зона ${this._price(event.zone_lower)}–${this._price(event.zone_upper)}` +
          ` | score ${this._number(event.zone_score)}/100`,
        `Цена: старт ${this._price(event.reference_price)}` +
          ` | последняя ${this._price(event.metrics?.last_price)}` +
          ` | наблюдений ${Number(event.metrics?.observation_count || 0)}`,
        ...(event.metrics?.trigger_outcome
          ? [`Результат: ${this._outcome(event.metrics.trigger_outcome)}`]
          : []),
      ])
      : ['Активных Structure research-событий нет.'];

    return [
      '🏗 STRUCTURE EVENTS · RESEARCH',
      '━━━━━━━━━━━━━━━━━━━━',
      `Активных: ${events.length}`,
      '',
      ...rows,
      '',
      'Это наблюдения за зонами, а не сигналы на вход.',
      'Paper: OFF | Alerts: OFF | Live: OFF',
    ].join('\n');
  }

  static _scenario(value) {
    const labels = {
      RESISTANCE_TEST: 'тест сопротивления',
      SUPPORT_TEST: 'тест поддержки',
      ZONE_COMPRESSION: 'сжатие внутри зоны',
    };
    return labels[value] || value;
  }

  static _outcome(value) {
    const labels = {
      BREAKOUT_UP_CONFIRMED: 'выход вверх подтверждён',
      BREAKDOWN_DOWN_CONFIRMED: 'выход вниз подтверждён',
      ZONE_EXIT_UP_CONFIRMED: 'выход из зоны вверх подтверждён',
      ZONE_EXIT_DOWN_CONFIRMED: 'выход из зоны вниз подтверждён',
    };
    return labels[value] || value;
  }

  static _price(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    if (number >= 1000) return `$${number.toFixed(2)}`;
    if (number >= 1) return `$${number.toFixed(4)}`;
    return `$${number.toFixed(8)}`;
  }

  static _number(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 'n/a';
  }
}

module.exports = StructureEventFormatter;
