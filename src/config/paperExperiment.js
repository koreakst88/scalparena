const CURRENT_PAPER_EXPERIMENT_ID = process.env.PAPER_SIGNAL_EXPERIMENT_ID ||
  'SCALPARENA_V2_20260719';
const LEGACY_PAPER_EXPERIMENT_ID = 'LEGACY_PRE_20260719';

const PAPER_PROJECTS = {
  CANDIDATE: 'CANDIDATE',
  PUMP: 'PUMP',
  HYBRID: 'HYBRID',
};

const PAPER_STRATEGY_VERSIONS = {
  BREAKOUT: 'candidate_breakout_v1',
  TREND_PULLBACK: 'candidate_trend_pullback_v1_tightened',
  MEAN_REVERSION: 'candidate_mean_reversion_v1_restricted',
  PUMP_HUNTER: 'pump_continuation_v2_dynamic_exits',
};

function getPaperProject(signal = {}, source = '') {
  if (signal.strategy === 'PUMP_HUNTER' || ['PUMP_HUNTER', 'PUMP_AUTO'].includes(source)) {
    return PAPER_PROJECTS.PUMP;
  }

  if (['CANDIDATE_ENGINE', 'CANDIDATE_AUTO'].includes(source)) {
    return PAPER_PROJECTS.CANDIDATE;
  }

  return PAPER_PROJECTS.HYBRID;
}

function getPaperStrategyVersion(signal = {}) {
  return PAPER_STRATEGY_VERSIONS[signal.strategy] || 'hybrid_v2_restricted_mr_pullback';
}

module.exports = {
  CURRENT_PAPER_EXPERIMENT_ID,
  LEGACY_PAPER_EXPERIMENT_ID,
  PAPER_PROJECTS,
  PAPER_STRATEGY_VERSIONS,
  getPaperProject,
  getPaperStrategyVersion,
};
