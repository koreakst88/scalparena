const LABELS = {
  ticker: 'Цена/оборот',
  candles: 'Свечи',
  funding: 'Funding',
  openInterest: 'Open Interest',
  orderbook: 'Стакан',
  liquidations: 'Ликвидации',
};

class ExtremeAuditFormatter {
  static format(report) {
    const effectiveRows = Object.entries(report.effective)
      .map(([capability, probe]) => this._formatEffectiveRow(capability, probe));
    const unavailable = Object.entries(report.effective)
      .filter(([, probe]) => !probe.available)
      .map(([capability]) => LABELS[capability] || capability);

    return [
      '⚡ EXTREME RADAR · DATA AUDIT',
      '━━━━━━━━━━━━━━━━━━━━',
      `Пара: ${report.pair}`,
      `Готовность: ${report.availableCount}/${report.totalCapabilities}`,
      `Статус: ${report.readyForResearch ? 'данных достаточно для research-этапа' : 'данных пока недостаточно'}`,
      `Основной рынок: ${report.primaryVenue}`,
      `Единая биржа: ${report.singleVenueComplete && !report.mixedVenues ? 'YES' : 'NO'}`,
      `Время проверки: ${(report.durationMs / 1000).toFixed(1)} сек`,
      '',
      'Эффективные источники:',
      ...effectiveRows,
      '',
      `Bybit: ${this._countAvailable(report.bybit)}/6` +
        this._formatBybitTransports(report.bybit),
      ...this._formatFailures(report.bybit),
      `OKX fallback: ${this._countAvailable(report.okx)}/6`,
      ...this._formatFailures(report.okx),
      `Gate fallback: ${this._countAvailable(report.gate)}/6`,
      ...this._formatFailures(report.gate),
      '',
      unavailable.length
        ? `Недоступно: ${unavailable.join(', ')}`
        : 'Все необходимые типы данных доступны.',
      '',
      'Сигналы: OFF',
      'Автосканирование: OFF',
      'Paper-записи: OFF',
      'Это только проверка источников. Торговая логика не запускалась.',
    ].join('\n');
  }

  static _formatEffectiveRow(capability, probe) {
    const label = LABELS[capability] || capability;
    if (!probe.available) return `❌ ${label}: недоступно`;

    const records = capability === 'liquidations'
      ? `${probe.records} событий`
      : `${probe.records} записей`;
    return `✅ ${label}: ${probe.source} | ${records} | ${probe.latencyMs} ms`;
  }

  static _countAvailable(probes = {}) {
    return Object.values(probes)
      .filter((probe) => probe?.capability)
      .filter((probe) => probe.available).length;
  }

  static _formatFailures(probes = {}) {
    const failures = Object.values(probes)
      .filter((probe) => probe?.capability)
      .filter((probe) => !probe.available)
      .slice(0, 3)
      .map((probe) => {
        const label = LABELS[probe.capability] || probe.capability;
        return `  · ${label}: ${this._truncate(probe.error || 'нет данных')}`;
      });

    return failures.length ? failures : ['  · ошибок нет'];
  }

  static _formatBybitTransports(probes = {}) {
    const meta = probes._meta;
    if (!meta) return '';

    return ` | REST ${meta.restAvailable}/5 | WS ${meta.websocketAvailable}/6`;
  }

  static _truncate(value, maxLength = 160) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
  }
}

module.exports = ExtremeAuditFormatter;
