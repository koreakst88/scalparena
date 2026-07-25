const CURRENT_PAPER_EXPERIMENT_ID = process.env.PAPER_SIGNAL_EXPERIMENT_ID ||
  'SCALPARENA_V2_20260719';
const CANDIDATE_V3_EXPERIMENT_ID = process.env.CANDIDATE_V3_EXPERIMENT_ID ||
  'CANDIDATE_V3_20260720';
const PUMP_V2_EXPERIMENT_ID = process.env.PUMP_V2_EXPERIMENT_ID ||
  'PUMP_V2_ATR13_20260725';
const EXTREME_EXPERIMENT_ID = process.env.EXTREME_EXPERIMENT_ID ||
  'EXTREME_V1_RESEARCH_20260725';
const LEGACY_PAPER_EXPERIMENT_ID = 'LEGACY_PRE_20260719';

const PAPER_PROJECTS = {
  CANDIDATE: 'CANDIDATE',
  CANDIDATE_V2_SHADOW: 'CANDIDATE_V2_SHADOW',
  CANDIDATE_V3: 'CANDIDATE_V3',
  PUMP: 'PUMP',
  PUMP_V2_SHADOW: 'PUMP_V2_SHADOW',
  EXTREME: 'EXTREME',
  HYBRID: 'HYBRID',
};

const PAPER_STRATEGY_VERSIONS = {
  BREAKOUT: 'candidate_breakout_v1',
  BREAKOUT_V2_SHADOW: 'candidate_breakout_v2_shadow',
  BREAKOUT_V3_SHADOW: 'candidate_breakout_v3_retest',
  TREND_PULLBACK: 'candidate_trend_pullback_v1_tightened',
  MEAN_REVERSION: 'candidate_mean_reversion_v1_restricted',
  PUMP_HUNTER: 'pump_continuation_v2_dynamic_exits',
  PUMP_STATE_V2_SHADOW: 'pump_state_machine_v2_shadow',
  PUMP_STATE_V2_1_SHADOW: 'pump_state_machine_v2_1_atr13',
  EXTREME_SQUEEZE_LONG: 'extreme_squeeze_long_v1_research',
  EXTREME_CASCADE_SHORT: 'extreme_cascade_short_v1_research',
};

function getPaperProject(signal = {}, source = '') {
  if (
    ['EXTREME_SQUEEZE_LONG', 'EXTREME_CASCADE_SHORT'].includes(signal.strategy) ||
    source === 'EXTREME_RADAR'
  ) {
    return PAPER_PROJECTS.EXTREME;
  }

  if (signal.strategy === 'BREAKOUT_V3_SHADOW' || source === 'CANDIDATE_V3') {
    return PAPER_PROJECTS.CANDIDATE_V3;
  }

  if (signal.strategy === 'BREAKOUT_V2_SHADOW' || source === 'CANDIDATE_V2_SHADOW') {
    return PAPER_PROJECTS.CANDIDATE_V2_SHADOW;
  }

  if (
    ['PUMP_STATE_V2_SHADOW', 'PUMP_STATE_V2_1_SHADOW'].includes(signal.strategy) ||
    source === 'PUMP_V2_SHADOW'
  ) {
    return PAPER_PROJECTS.PUMP_V2_SHADOW;
  }

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
  CANDIDATE_V3_EXPERIMENT_ID,
  PUMP_V2_EXPERIMENT_ID,
  EXTREME_EXPERIMENT_ID,
  LEGACY_PAPER_EXPERIMENT_ID,
  PAPER_PROJECTS,
  PAPER_STRATEGY_VERSIONS,
  getPaperProject,
  getPaperStrategyVersion,
};
