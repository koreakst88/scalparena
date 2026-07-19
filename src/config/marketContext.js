function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

module.exports = {
  MARKET_CONTEXT_V1_ENABLED: parseBoolean(process.env.MARKET_CONTEXT_V1_ENABLED, true),
};
