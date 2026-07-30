class StructureAuditFormatter {
  static format(report) {
    const venueRows = Object.values(report.venues).flatMap((venue) => (
      [
        '',
        `${venue.venue}: ${venue.usableTimeframes}/${report.timeframes.length} таймфреймов` +
          `${venue.complete ? ' | COMPLETE' : ''}`,
        ...report.timeframes.map((timeframe) => (
          this._formatTimeframe(venue.timeframes[timeframe.label])
        )),
      ]
    ));

    return [
      '🏗 STRUCTURE · DATA AUDIT',
      '━━━━━━━━━━━━━━━━━━━━',
      `Пара: ${report.pair}`,
      `Эксперимент: ${report.experimentId}`,
      `Требование: ≥${report.minConfirmed} подтверждённых свечей на каждом TF`,
      `Основной источник: ${report.primaryVenue || 'не найден'}`,
      `Готовность: ${report.readyForLevelResearch ? 'READY для Level Engine' : 'NOT READY'}`,
      `Время проверки: ${(report.durationMs / 1000).toFixed(1)} сек`,
      ...venueRows,
      '',
      'Level Engine: OFF',
      'Wide scan: OFF',
      'Events: OFF',
      'Paper-сигналы: OFF',
      'Telegram-алерты: OFF',
      'Это только аудит свечей. Уровни и торговые решения не рассчитывались.',
    ].join('\n');
  }

  static _formatTimeframe(result) {
    if (!result) return '❌ неизвестный таймфрейм';

    const icon = result.usable ? '✅' : '❌';
    const quality = [
      `${result.confirmed} confirmed`,
      `volume ${result.volumeCoverage}%`,
      `gaps ${result.gaps}`,
      result.ageMinutes == null ? 'age n/a' : `age ${result.ageMinutes}m`,
      `${result.latencyMs} ms`,
    ].join(' | ');
    const error = result.error ? ` | ${this._truncate(result.error)}` : '';

    return `${icon} ${result.label}: ${quality}${error}`;
  }

  static _truncate(value, maxLength = 110) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
  }
}

module.exports = StructureAuditFormatter;
