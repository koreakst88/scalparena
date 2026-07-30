const STRUCTURE_TIMEFRAMES = Object.freeze([
  { label: '4H', interval: '240', minutes: 240 },
  { label: '1H', interval: '60', minutes: 60 },
  { label: '15m', interval: '15', minutes: 15 },
]);

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  STRUCTURE_PROJECT: 'STRUCTURE',
  STRUCTURE_EXPERIMENT_ID: 'STRUCTURE_V1_DATA_AUDIT_20260731',
  STRUCTURE_LEVEL_EXPERIMENT_ID: 'STRUCTURE_V1_LEVEL_RESEARCH_20260731',
  STRUCTURE_WIDE_EXPERIMENT_ID: 'STRUCTURE_V1_WIDE_DIAGNOSTIC_20260731',
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
  STRUCTURE_EVENT_TRACKING_ENABLED: false,
  STRUCTURE_PAPER_SIGNALS_ENABLED: false,
  STRUCTURE_ALERTS_ENABLED: false,
};
