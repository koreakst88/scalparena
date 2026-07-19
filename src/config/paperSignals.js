const DEFAULT_TTL_MINUTES = 90;
const DEFAULT_TRACK_INTERVAL_MS = 60 * 1000;
const DEFAULT_CANDIDATE_AUTO_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_CANDIDATE_AUTO_MIN_SCORE = 75;
const DEFAULT_CANDIDATE_AUTO_MIN_RR = 1.2;
const DEFAULT_CANDIDATE_AUTO_COOLDOWN_MINUTES = 90;
const DEFAULT_CANDIDATE_AUTO_MAX_ALERTS = 2;
const DEFAULT_PAPER_SLIPPAGE_BPS = 5;

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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
  PAPER_SIGNAL_SLIPPAGE_BPS: parseNonNegativeNumber(
    process.env.PAPER_SIGNAL_SLIPPAGE_BPS,
    DEFAULT_PAPER_SLIPPAGE_BPS
  ),
  CANDIDATE_AUTO_SCAN_ENABLED: parseBoolean(process.env.CANDIDATE_AUTO_SCAN_ENABLED, false),
  CANDIDATE_AUTO_SCAN_INTERVAL_MS: parsePositiveInt(
    process.env.CANDIDATE_AUTO_SCAN_INTERVAL_MS,
    DEFAULT_CANDIDATE_AUTO_INTERVAL_MS
  ),
  CANDIDATE_AUTO_MIN_SCORE: parsePositiveInt(
    process.env.CANDIDATE_AUTO_MIN_SCORE,
    DEFAULT_CANDIDATE_AUTO_MIN_SCORE
  ),
  CANDIDATE_AUTO_MIN_RR: Number.isFinite(Number.parseFloat(process.env.CANDIDATE_AUTO_MIN_RR))
    ? Number.parseFloat(process.env.CANDIDATE_AUTO_MIN_RR)
    : DEFAULT_CANDIDATE_AUTO_MIN_RR,
  CANDIDATE_AUTO_COOLDOWN_MINUTES: parsePositiveInt(
    process.env.CANDIDATE_AUTO_COOLDOWN_MINUTES,
    DEFAULT_CANDIDATE_AUTO_COOLDOWN_MINUTES
  ),
  CANDIDATE_AUTO_MAX_ALERTS: parsePositiveInt(
    process.env.CANDIDATE_AUTO_MAX_ALERTS,
    DEFAULT_CANDIDATE_AUTO_MAX_ALERTS
  ),
};
