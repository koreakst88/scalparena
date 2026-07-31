process.env.STRUCTURE_EVENT_TRACKING_ENABLED = 'true';

const StructureEventTracker = require('../../src/engine/structureEventTracker');

console.log('Structure Retest Lifecycle Test\n');

const events = [];
const db = {
  getActiveStructureEvents: async () => events.filter((event) => (
    ['WATCH', 'ARMED', 'TRIGGERED'].includes(event.state)
  )),
  createStructureEvent: async (payload) => {
    const created = {
      id: 'structure-retest-1',
      created_at: payload.first_seen_at,
      ...payload,
    };
    events.push(created);
    return created;
  },
  updateStructureEvent: async (id, updates) => {
    const current = events.find((event) => event.id === id);
    Object.assign(current, updates);
    return current;
  },
};
const tracker = new StructureEventTracker(db, {
  enabled: true,
  armScore: 70,
  armObservations: 2,
  triggerBufferPercent: 0.15,
  retestTolerancePercent: 0.25,
  invalidationPercent: 1.5,
});

function report(price, candidate = true) {
  return {
    pair: 'TESTUSDT',
    candidate,
    score: 85,
    setup: 'COMPRESSED_BELOW_RESISTANCE',
    location: 'RESISTANCE',
    currentPrice: price,
    zoneDistancePercent: 0.2,
    zone: { lower: 100, upper: 101, score: 90 },
    structure: { state: 'UPTREND' },
    compression: { state: 'COMPRESSED' },
    atr1h: 1,
    structuralZones: {
      resistance: [{ lower: 106, upper: 107, score: 80 }],
      support: [{ lower: 96, upper: 97, score: 75 }],
    },
    turnover24h: 50000000,
    spreadPercent: 0.02,
    reasons: ['1H_COMPRESSION'],
  };
}

function scan(item, candidate = true) {
  return {
    marketSource: 'GATE',
    marketScope: 'GATE_FUTURES_SPOT_INTERSECTION',
    reports: [item],
    candidates: candidate ? [item] : [],
  };
}

(async () => {
  const t0 = new Date('2026-07-31T00:00:00.000Z');
  await tracker.processScan(scan(report(100.5)), t0);
  const trigger = await tracker.processScan(
    scan(report(100.8)),
    new Date(t0.getTime() + 5 * 60000)
  );
  await tracker.processScan(
    scan(report(101.3, false), false),
    new Date(t0.getTime() + 10 * 60000)
  );
  const retest = await tracker.processScan(
    scan(report(100.9, false), false),
    new Date(t0.getTime() + 15 * 60000)
  );
  const reconfirm = await tracker.processScan(
    scan(report(101.4, false), false),
    new Date(t0.getTime() + 20 * 60000)
  );
  const event = events[0];

  const checks = [
    {
      name: 'Initial breakout does not create an immediate paper entry',
      pass: trigger.paperReady === 0 &&
        retest.paperReady === 0,
    },
    {
      name: 'Return to original zone records a retest without paper readiness',
      pass: Boolean(event.metrics.retest_seen_at) &&
        event.metrics.retest_price === 100.9 &&
        retest.paperReady === 0,
    },
    {
      name: 'A later direction reconfirmation marks exactly one paper-ready event',
      pass: reconfirm.paperReady === 1 &&
        reconfirm.readyEvents.length === 1 &&
        event.metrics.paper_direction === 'LONG' &&
        event.metrics.paper_entry_price === 101.4,
    },
  ];

  checks.forEach((check) => {
    console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`);
  });
  const allPassed = checks.every((check) => check.pass);
  console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
  process.exit(allPassed ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
