function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

module.exports = {
  PUMP_HUNTER_SCAN_LIMIT: parsePositiveInt(process.env.PUMP_HUNTER_SCAN_LIMIT, 40),
  PUMP_HUNTER_KLINE_INTERVAL: process.env.PUMP_HUNTER_KLINE_INTERVAL || '15',
  PUMP_HUNTER_KLINE_LIMIT: parsePositiveInt(process.env.PUMP_HUNTER_KLINE_LIMIT, 96),
  PUMP_HUNTER_ACTIONABLE_LIMIT: parsePositiveInt(process.env.PUMP_HUNTER_ACTIONABLE_LIMIT, 3),
  PUMP_HUNTER_FALLBACK_MARKET: process.env.PUMP_HUNTER_FALLBACK_MARKET || 'binance,okx',
  PUMP_HUNTER_SIGNAL_TTL_MINUTES: parsePositiveInt(
    process.env.PUMP_HUNTER_SIGNAL_TTL_MINUTES,
    240
  ),
  PUMP_AUTO_SCAN_ENABLED: parseBoolean(process.env.PUMP_AUTO_SCAN_ENABLED, false),
  PUMP_AUTO_SCAN_INTERVAL_MS: parsePositiveInt(
    process.env.PUMP_AUTO_SCAN_INTERVAL_MS,
    15 * 60 * 1000
  ),
  PUMP_AUTO_MIN_SCORE: parsePositiveInt(process.env.PUMP_AUTO_MIN_SCORE, 80),
  PUMP_AUTO_COOLDOWN_MINUTES: parsePositiveInt(process.env.PUMP_AUTO_COOLDOWN_MINUTES, 180),
  PUMP_AUTO_MAX_ALERTS: parsePositiveInt(process.env.PUMP_AUTO_MAX_ALERTS, 1),
};
