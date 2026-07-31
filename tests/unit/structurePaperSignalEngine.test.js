const StructurePaperSignalEngine = require(
  '../../src/engine/structurePaperSignalEngine'
);

console.log('Structure Paper Signal Engine Test\n');

function event(overrides = {}) {
  return {
    id: 'structure-event-1',
    experiment_id: 'STRUCTURE_V1_EVENT_RESEARCH_20260731',
    pair: 'TESTUSDT',
    scenario: 'RESISTANCE_TEST',
    state: 'TRIGGERED',
    primary_venue: 'GATE',
    score: 88,
    zone_lower: 100,
    zone_upper: 101,
    zone_score: 92,
    metrics: {
      trigger_outcome: 'BREAKOUT_UP_CONFIRMED',
      trigger_price: 101.3,
      retest_seen_at: '2026-07-31T00:15:00.000Z',
      retest_price: 100.9,
      paper_ready_at: '2026-07-31T00:20:00.000Z',
      paper_entry_price: 102,
      paper_direction: 'LONG',
      latest: {
        atr_1h: 1,
        structure_4h: 'UPTREND',
        structural_zones: {
          resistance: [{ lower: 106, upper: 107, score: 80 }],
          support: [{ lower: 96, upper: 97, score: 75 }],
        },
      },
    },
    ...overrides,
  };
}

const long = StructurePaperSignalEngine.build(event());
const short = StructurePaperSignalEngine.build(event({
  scenario: 'SUPPORT_TEST',
  zone_lower: 99,
  zone_upper: 100,
  metrics: {
    trigger_outcome: 'BREAKDOWN_DOWN_CONFIRMED',
    trigger_price: 98.8,
    retest_seen_at: '2026-07-31T00:15:00.000Z',
    retest_price: 99.1,
    paper_ready_at: '2026-07-31T00:20:00.000Z',
    paper_entry_price: 98,
    paper_direction: 'SHORT',
    latest: {
      atr_1h: 1,
      structure_4h: 'DOWNTREND',
      structural_zones: {
        resistance: [{ lower: 103, upper: 104, score: 75 }],
        support: [{ lower: 93, upper: 94, score: 80 }],
      },
    },
  },
}));
const noTarget = StructurePaperSignalEngine.build(event({
  metrics: {
    ...event().metrics,
    latest: {
      ...event().metrics.latest,
      structural_zones: { resistance: [], support: [] },
    },
  },
}));
const poorRr = StructurePaperSignalEngine.build(event({
  metrics: {
    ...event().metrics,
    latest: {
      ...event().metrics.latest,
      structural_zones: {
        resistance: [{ lower: 103, upper: 104, score: 80 }],
        support: [],
      },
    },
  },
}));

const checks = [
  {
    name: 'Long paper entry uses retest confirmation and next resistance',
    pass: long.eligible &&
      long.signal.type === 'LONG' &&
      long.signal.entryPrice === 102 &&
      long.signal.stopLoss === 99.9 &&
      long.signal.takeProfit === 106 &&
      long.signal.riskReward >= 1.2,
  },
  {
    name: 'Short paper entry uses next support and stop beyond original zone',
    pass: short.eligible &&
      short.signal.type === 'SHORT' &&
      short.signal.stopLoss === 100.1 &&
      short.signal.takeProfit === 94,
  },
  {
    name: 'Signal is isolated into Structure shadow experiment metadata',
    pass: long.signal.strategy === 'STRUCTURE_BREAKOUT_RETEST_V1_SHADOW' &&
      long.signal.experimentId === 'STRUCTURE_V1_RETEST_SHADOW_20260731' &&
      long.signal.signalMetadata.structureEventId === 'structure-event-1',
  },
  {
    name: 'No next structural zone rejects the paper setup',
    pass: !noTarget.eligible &&
      noTarget.reason === 'NO_NEXT_STRUCTURAL_ZONE',
  },
  {
    name: 'Insufficient reward-to-risk rejects the paper setup',
    pass: !poorRr.eligible &&
      poorRr.reason === 'RR_BELOW_MINIMUM',
  },
];

checks.forEach((check) => {
  console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`);
});
const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
