function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  EXTREME_RADAR_ENABLED: false,
  EXTREME_USE_TESTNET: false,
  EXTREME_AUDIT_SYMBOL: process.env.EXTREME_AUDIT_SYMBOL || 'BTCUSDT',
  EXTREME_AUDIT_TIMEOUT_MS: parsePositiveInt(
    process.env.EXTREME_AUDIT_TIMEOUT_MS,
    6000
  ),
};
