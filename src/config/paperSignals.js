const DEFAULT_TTL_MINUTES = 90;
const DEFAULT_TRACK_INTERVAL_MS = 60 * 1000;

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  PAPER_SIGNAL_TRACKING_ENABLED: parseBoolean(process.env.PAPER_SIGNAL_TRACKING_ENABLED, false),
  PAPER_SIGNAL_ALERTS_ENABLED: parseBoolean(process.env.PAPER_SIGNAL_ALERTS_ENABLED, true),
  PAPER_SIGNAL_AUTO_LOG_ENABLED: parseBoolean(process.env.PAPER_SIGNAL_AUTO_LOG_ENABLED, false),
  PAPER_SIGNAL_TTL_MINUTES: parsePositiveInt(process.env.PAPER_SIGNAL_TTL_MINUTES, DEFAULT_TTL_MINUTES),
  PAPER_SIGNAL_TRACK_INTERVAL_MS: parsePositiveInt(
    process.env.PAPER_SIGNAL_TRACK_INTERVAL_MS,
    DEFAULT_TRACK_INTERVAL_MS
  ),
};
