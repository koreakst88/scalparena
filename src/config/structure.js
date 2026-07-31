const STRUCTURE_TIMEFRAMES = Object.freeze([
  { label: '4H', interval: '240', minutes: 240 },
  { label: '1H', interval: '60', minutes: 60 },
  { label: '15m', interval: '15', minutes: 15 },
]);

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const STRUCTURE_EVENT_STATES = Object.freeze({
  WATCH: 'WATCH',
  ARMED: 'ARMED',
  TRIGGERED: 'TRIGGERED',
  EXPIRED: 'EXPIRED',
  INVALIDATED: 'INVALIDATED',
  RESOLVED: 'RESOLVED',
});

const STRUCTURE_SCENARIOS = Object.freeze({
  RESISTANCE_TEST: 'RESISTANCE_TEST',
  SUPPORT_TEST: 'SUPPORT_TEST',
  ZONE_COMPRESSION: 'ZONE_COMPRESSION',
});

module.exports = {
  STRUCTURE_PROJECT: 'STRUCTURE',
  STRUCTURE_EXPERIMENT_ID: 'STRUCTURE_V1_DATA_AUDIT_20260731',
  STRUCTURE_LEVEL_EXPERIMENT_ID: 'STRUCTURE_V1_LEVEL_RESEARCH_20260731',
  STRUCTURE_WIDE_EXPERIMENT_ID: 'STRUCTURE_V1_WIDE_DIAGNOSTIC_20260731',
  STRUCTURE_EVENT_EXPERIMENT_ID: 'STRUCTURE_V1_EVENT_RESEARCH_20260731',
  STRUCTURE_EVENT_STATES,
  STRUCTURE_SCENARIOS,
  STRUCTURE_TIMEFRAMES,
  STRUCTURE_AUDIT_CANDLE_LIMIT: 200,
  STRUCTURE_AUDIT_MIN_CONFIRMED_CANDLES: 180,
  STRUCTURE_LEVEL_ENGINE_ENABLED: true,
  STRUCTURE_WIDE_SCAN_ENABLED: true,
  STRUCTURE_WIDE_SCAN_LIMIT: parsePositiveNumber(
    process.env.STRUCTURE_WIDE_SCAN_LIMIT,
    24
  ),
  STRUCTURE_WIDE_CONCURRENCY: parsePositiveNumber(
    process.env.STRUCTURE_WIDE_CONCURRENCY,
    3
  ),
  STRUCTURE_WIDE_MIN_TURNOVER_USD: parsePositiveNumber(
    process.env.STRUCTURE_WIDE_MIN_TURNOVER_USD,
    5000000
  ),
  STRUCTURE_WIDE_MAX_SPREAD_PERCENT: parsePositiveNumber(
    process.env.STRUCTURE_WIDE_MAX_SPREAD_PERCENT,
    0.3
  ),
  STRUCTURE_WIDE_MAX_ZONE_DISTANCE_PERCENT: parsePositiveNumber(
    process.env.STRUCTURE_WIDE_MAX_ZONE_DISTANCE_PERCENT,
    3
  ),
  STRUCTURE_WIDE_CANDIDATE_SCORE: parsePositiveNumber(
    process.env.STRUCTURE_WIDE_CANDIDATE_SCORE,
    65
  ),
  STRUCTURE_WIDE_REPORT_LIMIT: parsePositiveNumber(
    process.env.STRUCTURE_WIDE_REPORT_LIMIT,
    10
  ),
  STRUCTURE_AUTO_RESEARCH_ENABLED: parseBoolean(
    process.env.STRUCTURE_AUTO_RESEARCH_ENABLED,
    false
  ),
  STRUCTURE_AUTO_SCAN_INTERVAL_MS: parsePositiveNumber(
    process.env.STRUCTURE_AUTO_SCAN_INTERVAL_MS,
    5 * 60 * 1000
  ),
  STRUCTURE_EVENT_TRACKING_ENABLED: parseBoolean(
    process.env.STRUCTURE_EVENT_TRACKING_ENABLED,
    false
  ),
  STRUCTURE_EVENT_ARM_SCORE: parsePositiveNumber(
    process.env.STRUCTURE_EVENT_ARM_SCORE,
    70
  ),
  STRUCTURE_EVENT_ARM_OBSERVATIONS: parsePositiveNumber(
    process.env.STRUCTURE_EVENT_ARM_OBSERVATIONS,
    2
  ),
  STRUCTURE_EVENT_TRIGGER_BUFFER_PERCENT: parsePositiveNumber(
    process.env.STRUCTURE_EVENT_TRIGGER_BUFFER_PERCENT,
    0.15
  ),
  STRUCTURE_EVENT_INVALIDATION_PERCENT: parsePositiveNumber(
    process.env.STRUCTURE_EVENT_INVALIDATION_PERCENT,
    1.5
  ),
  STRUCTURE_EVENT_STALE_MINUTES: parsePositiveNumber(
    process.env.STRUCTURE_EVENT_STALE_MINUTES,
    20
  ),
  STRUCTURE_EVENT_MAX_HOURS: parsePositiveNumber(
    process.env.STRUCTURE_EVENT_MAX_HOURS,
    6
  ),
  STRUCTURE_EVENT_HISTORY_LIMIT: parsePositiveNumber(
    process.env.STRUCTURE_EVENT_HISTORY_LIMIT,
    100
  ),
  STRUCTURE_EVENT_RETEST_TOLERANCE_PERCENT: parsePositiveNumber(
    process.env.STRUCTURE_EVENT_RETEST_TOLERANCE_PERCENT,
    0.25
  ),
  STRUCTURE_PAPER_SIGNALS_ENABLED: parseBoolean(
    process.env.STRUCTURE_PAPER_SIGNALS_ENABLED,
    false
  ),
  STRUCTURE_PAPER_TTL_MINUTES: parsePositiveNumber(
    process.env.STRUCTURE_PAPER_TTL_MINUTES,
    360
  ),
  STRUCTURE_PAPER_MIN_RR: parsePositiveNumber(
    process.env.STRUCTURE_PAPER_MIN_RR,
    1.2
  ),
  STRUCTURE_PAPER_MAX_RISK_PERCENT: parsePositiveNumber(
    process.env.STRUCTURE_PAPER_MAX_RISK_PERCENT,
    3
  ),
  STRUCTURE_PAPER_STOP_ATR_BUFFER: parsePositiveNumber(
    process.env.STRUCTURE_PAPER_STOP_ATR_BUFFER,
    0.1
  ),
  STRUCTURE_ALERTS_ENABLED: false,
};
