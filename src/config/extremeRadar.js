const {
  EXTREME_EXPERIMENT_ID,
  PAPER_PROJECTS,
} = require('./paperExperiment');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const EXTREME_EVENT_STATES = Object.freeze({
  WATCH: 'WATCH',
  ARMED: 'ARMED',
  TRIGGERED: 'TRIGGERED',
  EXPIRED: 'EXPIRED',
  INVALIDATED: 'INVALIDATED',
  RESOLVED: 'RESOLVED',
});

const EXTREME_SCENARIOS = Object.freeze({
  SQUEEZE_LONG: 'SQUEEZE_LONG',
  CASCADE_SHORT: 'CASCADE_SHORT',
});

module.exports = {
  EXTREME_RADAR_ENABLED: false,
  EXTREME_AUTO_SCAN_ENABLED: false,
  EXTREME_PAPER_SIGNALS_ENABLED: false,
  EXTREME_USE_TESTNET: false,
  EXTREME_PROJECT: PAPER_PROJECTS.EXTREME,
  EXTREME_EXPERIMENT_ID,
  EXTREME_EVENT_STATES,
  EXTREME_SCENARIOS,
  EXTREME_AUDIT_SYMBOL: process.env.EXTREME_AUDIT_SYMBOL || 'BTCUSDT',
  EXTREME_AUDIT_TIMEOUT_MS: parsePositiveInt(
    process.env.EXTREME_AUDIT_TIMEOUT_MS,
    6000
  ),
};
