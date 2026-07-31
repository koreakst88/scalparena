process.env.STRUCTURE_EVENT_TRACKING_ENABLED = 'true';

const StructureEventTracker = require('../../src/engine/structureEventTracker');

console.log('Structure Event Tracker Test\n');

const events = [];
let createdCount = 0;
let updateCount = 0;

const db = {
  getActiveStructureEvents: async () => events.filter((event) => (
    ['WATCH', 'ARMED', 'TRIGGERED'].includes(event.state)
  )),
  createStructureEvent: async (payload) => {
    createdCount += 1;
    const event = {
      id: `structure-${createdCount}`,
      created_at: payload.first_seen_at,
      updated_at: payload.first_seen_at,
      ...payload,
    };
    events.push(event);
    return event;
  },
  updateStructureEvent: async (id, updates) => {
    updateCount += 1;
    const event = events.find((item) => item.id === id);
    Object.assign(event, updates, {
      updated_at: updates.metrics?.last_seen_at ||
        updates.resolved_at ||
        event.updated_at,
    });
    return event;
  },
};

const tracker = new StructureEventTracker(db, {
  enabled: true,
  armScore: 70,
  armObservations: 2,
  triggerBufferPercent: 0.15,
  invalidationPercent: 1.5,
  staleMinutes: 20,
  maxHours: 6,
  historyLimit: 20,
});

function report(price, overrides = {}) {
  return {
    pair: 'TESTUSDT',
    candidate: true,
    score: 82,
    setup: 'COMPRESSED_BELOW_RESISTANCE',
    location: 'RESISTANCE',
    currentPrice: price,
    zoneDistancePercent: 0.3,
    zone: {
      lower: 100,
      upper: 101,
      score: 90,
      touches: 7,
      timeframes: ['4H', '1H'],
    },
    structure: { state: 'RANGE_OR_TRANSITION' },
    compression: { state: 'COMPRESSED' },
    turnover24h: 50000000,
    spreadPercent: 0.02,
    reasons: ['1H_COMPRESSION', '4H_1H_CONFLUENCE'],
    ...overrides,
  };
}

function scan(currentReport, asCandidate = true) {
  return {
    marketSource: 'GATE',
    marketScope: 'GATE_FUTURES_SPOT_INTERSECTION',
    reports: currentReport ? [currentReport] : [],
    candidates: currentReport && asCandidate ? [currentReport] : [],
  };
}

(async () => {
  const t0 = new Date('2026-07-31T00:00:00.000Z');
  const first = await tracker.processScan(scan(report(100.5)), t0);
  const second = await tracker.processScan(
    scan(report(100.8)),
    new Date(t0.getTime() + 5 * 60 * 1000)
  );
  const third = await tracker.processScan(
    scan(report(101.2), false),
    new Date(t0.getTime() + 10 * 60 * 1000)
  );
  const expired = await tracker.processScan(
    scan(null),
    new Date(t0.getTime() + 35 * 60 * 1000)
  );

  const event = events[0];
  const transitions = event.transition_history.map((item) => item.to);
  const checks = [
    {
      name: 'First qualified zone creates one WATCH event',
      pass: first.created === 1 &&
        event.scenario === 'RESISTANCE_TEST' &&
        transitions[0] === 'WATCH',
    },
    {
      name: 'Repeated confirmation arms the same event without duplication',
      pass: second.armed === 1 &&
        createdCount === 1 &&
        transitions.includes('ARMED'),
    },
    {
      name: 'Crossing the original resistance boundary triggers research state',
      pass: third.triggered === 1 &&
        transitions.includes('TRIGGERED') &&
        event.metrics.trigger_outcome === 'BREAKOUT_UP_CONFIRMED',
    },
    {
      name: 'Tracker follows analyzed reports even after candidate gate clears',
      pass: third.updated === 1 &&
        event.metrics.observation_count === 3,
    },
    {
      name: 'Missing deep-scan observations expire stale research events',
      pass: expired.expired === 1 &&
        event.state === 'EXPIRED' &&
        transitions.at(-1) === 'EXPIRED',
    },
    {
      name: 'Lifecycle contains no paper or live trading fields',
      pass: event.paper_signal_id == null &&
        event.take_profit == null &&
        event.stop_loss == null &&
        updateCount === 3,
    },
    {
      name: 'Support and inside-zone candidates map to separate research scenarios',
      pass: tracker._scenarioFor({ location: 'SUPPORT' }) === 'SUPPORT_TEST' &&
        tracker._scenarioFor({ location: 'INSIDE_ZONE' }) === 'ZONE_COMPRESSION',
    },
  ];

  checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
  const allPassed = checks.every((check) => check.pass);
  console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
  process.exit(allPassed ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
