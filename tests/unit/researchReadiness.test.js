const ResearchReadiness = require('../../src/analytics/researchReadiness');

function buildSignal(project, status, decision, index) {
  return {
    pair: `TEST${index}USDT`,
    project,
    status,
    created_at: `2026-07-${String(19 + (index % 2)).padStart(2, '0')}T00:00:00Z`,
    signal_metadata: decision
      ? { marketContext: { state: 'RISK_ON', decision } }
      : {},
  };
}

console.log('Research Readiness Test\n');

const partialSignals = [
  buildSignal('CANDIDATE_V2_SHADOW', 'TP_HIT', 'ALLOW', 0),
  buildSignal('CANDIDATE_V2_SHADOW', 'WATCHING', 'BLOCK', 1),
  buildSignal('PUMP_V2_SHADOW', 'TIMEOUT', 'CAUTION', 2),
  buildSignal('PUMP_V2_SHADOW', 'SL_HIT', null, 3),
  buildSignal('CANDIDATE', 'TP_HIT', 'ALLOW', 4),
];
const partial = ResearchReadiness.calculate(partialSignals, {
  experimentId: 'TEST_V2',
  projectTarget: 2,
  decisionTarget: 1,
});
const partialMessage = ResearchReadiness.format(partial);

const readySignals = [
  buildSignal('CANDIDATE_V2_SHADOW', 'TP_HIT', 'ALLOW', 0),
  buildSignal('CANDIDATE_V2_SHADOW', 'SL_HIT', 'BLOCK', 1),
  buildSignal('PUMP_V2_SHADOW', 'TP_HIT', 'CAUTION', 2),
  buildSignal('PUMP_V2_SHADOW', 'TIMEOUT', 'ALLOW', 3),
];
const ready = ResearchReadiness.calculate(readySignals, {
  projectTarget: 2,
  decisionTarget: 1,
});

const checks = [
  { name: 'Only V2 shadow projects enter the research sample', pass: partial.projects[0].total === 2 && partial.projects[1].total === 2 },
  { name: 'WATCHING rows do not count as resolved decision evidence', pass: partial.decisions.BLOCK === 0 },
  { name: 'Rows created before context tagging are reported as UNTAGGED', pass: partial.projects[1].untaggedResolved === 1 },
  { name: 'Partial sample is not marked ready', pass: partial.ready === false },
  { name: 'Report explains fixed targets and research-only status', pass: partialMessage.includes('≥2 resolved') && partialMessage.includes('research-only') },
  { name: 'Report keeps the first signal date', pass: partial.startedAt === '2026-07-19' },
  { name: 'Complete project and decision cohorts become ready', pass: ready.ready === true },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
