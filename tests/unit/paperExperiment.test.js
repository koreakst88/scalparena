const {
  CURRENT_PAPER_EXPERIMENT_ID,
  CANDIDATE_V3_EXPERIMENT_ID,
  PUMP_V2_EXPERIMENT_ID,
  EXTREME_EXPERIMENT_ID,
  STRUCTURE_PAPER_EXPERIMENT_ID,
  getPaperProject,
  getPaperStrategyVersion,
} = require('../../src/config/paperExperiment');

console.log('Paper Experiment Config Test\n');

const checks = [
  {
    name: 'Structure retest shadow owns an isolated paper cohort',
    pass: STRUCTURE_PAPER_EXPERIMENT_ID ===
        'STRUCTURE_V1_RETEST_SHADOW_20260731' &&
      getPaperProject(
        { strategy: 'STRUCTURE_BREAKOUT_RETEST_V1_SHADOW' },
        'STRUCTURE_RETEST_SHADOW'
      ) === 'STRUCTURE' &&
      getPaperStrategyVersion({
        strategy: 'STRUCTURE_BREAKOUT_RETEST_V1_SHADOW',
      }) === 'structure_breakout_retest_v1_shadow',
  },
  {
    name: 'Extreme Radar owns an isolated research cohort',
    pass: EXTREME_EXPERIMENT_ID === 'EXTREME_V1_RESEARCH_20260725' &&
      getPaperProject({ strategy: 'EXTREME_SQUEEZE_LONG' }, 'EXTREME_RADAR') ===
        'EXTREME' &&
      getPaperStrategyVersion({ strategy: 'EXTREME_SQUEEZE_LONG' }) ===
        'extreme_squeeze_long_v1_research',
  },
  {
    name: 'Pump V2.1 starts a clean ATR 1.3 cohort',
    pass: PUMP_V2_EXPERIMENT_ID === 'PUMP_V2_ATR13_20260725' &&
      getPaperProject({ strategy: 'PUMP_STATE_V2_1_SHADOW' }, 'PUMP_V2_SHADOW') ===
        'PUMP_V2_SHADOW' &&
      getPaperStrategyVersion({ strategy: 'PUMP_STATE_V2_1_SHADOW' }) ===
        'pump_state_machine_v2_1_atr13',
  },
  {
    name: 'Candidate V3 starts a clean project-specific cohort',
    pass: CANDIDATE_V3_EXPERIMENT_ID === 'CANDIDATE_V3_20260720' &&
      getPaperProject({ strategy: 'BREAKOUT_V3_SHADOW' }, 'CANDIDATE_V3') === 'CANDIDATE_V3' &&
      getPaperStrategyVersion({ strategy: 'BREAKOUT_V3_SHADOW' }) ===
        'candidate_breakout_v3_retest',
  },
  {
    name: 'Current experiment has a stable id',
    pass: CURRENT_PAPER_EXPERIMENT_ID === 'SCALPARENA_V2_20260719',
  },
  {
    name: 'Pump source maps to Pump project',
    pass: getPaperProject({ strategy: 'PUMP_HUNTER' }, 'PUMP_AUTO') === 'PUMP',
  },
  {
    name: 'Candidate source maps to Candidate project',
    pass: getPaperProject({ strategy: 'BREAKOUT' }, 'CANDIDATE_AUTO') === 'CANDIDATE',
  },
  {
    name: 'Manual scan remains Hybrid project',
    pass: getPaperProject({ strategy: 'TREND_PULLBACK' }, 'MANUAL_SCAN') === 'HYBRID',
  },
  {
    name: 'Candidate V2 shadow has an isolated project and version',
    pass: getPaperProject({ strategy: 'BREAKOUT_V2_SHADOW' }, 'CANDIDATE_V2_SHADOW') ===
      'CANDIDATE_V2_SHADOW' &&
      getPaperStrategyVersion({ strategy: 'BREAKOUT_V2_SHADOW' }) ===
      'candidate_breakout_v2_shadow',
  },
  {
    name: 'Pump State V2 shadow has an isolated project and version',
    pass: getPaperProject({ strategy: 'PUMP_STATE_V2_SHADOW' }, 'PUMP_V2_SHADOW') ===
      'PUMP_V2_SHADOW' &&
      getPaperStrategyVersion({ strategy: 'PUMP_STATE_V2_SHADOW' }) ===
      'pump_state_machine_v2_shadow',
  },
  {
    name: 'Each paper strategy gets an explicit version',
    pass: getPaperStrategyVersion({ strategy: 'BREAKOUT' }) === 'candidate_breakout_v1' &&
      getPaperStrategyVersion({ strategy: 'PUMP_HUNTER' }) === 'pump_continuation_v2_dynamic_exits',
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
