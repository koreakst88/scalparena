function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  PUMP_HUNTER_SCAN_LIMIT: parsePositiveInt(process.env.PUMP_HUNTER_SCAN_LIMIT, 40),
  PUMP_HUNTER_KLINE_INTERVAL: process.env.PUMP_HUNTER_KLINE_INTERVAL || '15',
  PUMP_HUNTER_KLINE_LIMIT: parsePositiveInt(process.env.PUMP_HUNTER_KLINE_LIMIT, 96),
  PUMP_HUNTER_ACTIONABLE_LIMIT: parsePositiveInt(process.env.PUMP_HUNTER_ACTIONABLE_LIMIT, 3),
};
