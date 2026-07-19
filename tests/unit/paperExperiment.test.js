const {
  CURRENT_PAPER_EXPERIMENT_ID,
  getPaperProject,
  getPaperStrategyVersion,
} = require('../../src/config/paperExperiment');

console.log('Paper Experiment Config Test\n');

const checks = [
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
    name: 'Each paper strategy gets an explicit version',
    pass: getPaperStrategyVersion({ strategy: 'BREAKOUT' }) === 'candidate_breakout_v1' &&
      getPaperStrategyVersion({ strategy: 'PUMP_HUNTER' }) === 'pump_continuation_v2_dynamic_exits',
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
