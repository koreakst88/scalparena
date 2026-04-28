// src/analytics/formatters.js

function formatDetailedAnalytics(analytics, days = 7) {
  const sections = [];

  sections.push(`📊 ДЕТАЛЬНАЯ АНАЛИТИКА ЗА ${days} ДНЕЙ`);
  sections.push('════════════════════════════════');
  sections.push('');

  appendRows(sections, '💎 ТОП ПАРЫ ПО WIN RATE:', analytics.topPairs, (pair, index) => {
    return `${index + 1}. ${formatLabel(pair.pair)}: ${formatPercent(pair.win_rate)} WR | ${formatCount(pair.trades)} сделок | ${formatMoney(pair.total_pnl)}`;
  });

  appendRows(sections, '📉 ПРОБЛЕМНЫЕ ПАРЫ:', analytics.worstPairs, (pair, index) => {
    return `${index + 1}. ${formatLabel(pair.pair)}: ${formatPercent(pair.win_rate)} WR | ${formatCount(pair.trades)} сделок | ${formatMoney(pair.total_pnl)}`;
  });

  appendRows(sections, '🌍 РЕЖИМЫ РЫНКА:', analytics.regimes, (regime) => {
    return `${formatLabel(regime.market_regime)}: ${formatPercent(regime.win_rate)} WR | ${formatCount(regime.trades)} сделок | ${formatMoney(regime.total_pnl)}`;
  });

  appendRows(sections, '⚡ СТРАТЕГИИ:', analytics.strategies, (strategy) => {
    return `${formatLabel(strategy.strategy)}: ${formatPercent(strategy.win_rate)} WR | ${formatCount(strategy.trades)} сделок | ${formatMoney(strategy.total_pnl)}`;
  });

  appendRows(sections, '🎯 MACD BIAS:', analytics.macdBias, (bias) => {
    return `${formatLabel(bias.macd_bias)}: ${formatPercent(bias.win_rate)} WR | ${formatCount(bias.trades)} сделок | ${formatMoney(bias.total_pnl)}`;
  });

  appendRows(sections, '📍 RSI ЗОНЫ (при входе):', analytics.rsiZones, (zone) => {
    return `${formatLabel(zone.rsi_zone)}: ${formatPercent(zone.win_rate)} WR | ${formatCount(zone.trades)} сделок | ${formatMoney(zone.total_pnl)}`;
  });

  appendRows(sections, '⏱️ ВРЕМЯ УДЕРЖАНИЯ:', analytics.holdTimes, (time) => {
    const avgHold = time.avg_hold_minutes !== undefined
      ? ` | avg ${Number(time.avg_hold_minutes).toFixed(1)} мин`
      : '';
    return `${formatLabel(time.hold_time_bucket)}: ${formatPercent(time.win_rate)} WR | ${formatCount(time.trades)} сделок | ${formatMoney(time.total_pnl)}${avgHold}`;
  });

  if (!hasAnyRows(analytics)) {
    sections.push('Пока мало данных для детальной аналитики.');
    sections.push('');
  }

  sections.push('💡 Используй эти данные для оптимизации стратегии.');

  return sections.join('\n').trim();
}

function appendRows(sections, title, rows = [], formatter) {
  if (!rows || rows.length === 0) return;

  sections.push(title);
  rows.forEach((row, index) => sections.push(formatter(row, index)));
  sections.push('');
}

function hasAnyRows(analytics) {
  return [
    analytics.topPairs,
    analytics.worstPairs,
    analytics.regimes,
    analytics.strategies,
    analytics.macdBias,
    analytics.rsiZones,
    analytics.holdTimes,
  ].some((rows) => rows && rows.length > 0);
}

function formatLabel(value) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatCount(value) {
  return Number(value || 0);
}

function formatMoney(value) {
  const number = Number(value || 0);
  const sign = number >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(number).toFixed(2)}`;
}

module.exports = {
  formatDetailedAnalytics,
};
