process.env.EXTREME_EVENT_TRACKING_ENABLED = 'true';

const ExtremeEventTracker = require('../../src/engine/extremeEventTracker');

console.log('Extreme Event Tracker Test\n');

const events = [];
let createdCount = 0;
let updateCount = 0;

const db = {
  getActiveExtremeEvents: async () => events.filter((event) => (
    ['WATCH', 'ARMED', 'TRIGGERED'].includes(event.state)
  )),
  createExtremeEvent: async (payload) => {
    createdCount += 1;
    const event = {
      id: `event-${createdCount}`,
      created_at: payload.first_seen_at,
      updated_at: payload.first_seen_at,
      ...payload,
    };
    events.push(event);
    return event;
  },
  updateExtremeEvent: async (id, updates) => {
    updateCount += 1;
    const event = events.find((item) => item.id === id);
    Object.assign(event, updates, {
      updated_at: updates.metrics?.last_seen_at || updates.resolved_at || event.updated_at,
    });
    return event;
  },
};

const tracker = new ExtremeEventTracker(db, {
  enabled: true,
  armScore: 55,
  armObservations: 3,
  triggerMovePercent: 2,
  staleMinutes: 15,
  maxHours: 12,
  historyLimit: 20,
});

function scan(price, overrides = {}) {
  const report = {
    pair: 'DEXEUSDT',
    score: 70,
    anomalyType: 'SHORT_SQUEEZE_PRESSURE',
    marketSource: 'GATE',
    lastPrice: price,
    priceChange24hPercent: 30,
    range24hPercent: 45,
    fundingPercent: -0.2,
    turnover24h: 50000000,
    openInterestUsd: 3000000,
    spreadPercent: 0.05,
    reasons: ['24H_MOVE_UP', 'EXTREME_FUNDING'],
    riskFlags: ['EXTREME_INTRADAY_RANGE'],
    ...overrides,
  };
  return {
    marketSource: 'GATE',
    anomalies: [report],
  };
}

(async () => {
  const t0 = new Date('2026-07-28T00:00:00.000Z');
  const first = await tracker.processScan(scan(100), t0);
  const second = await tracker.processScan(
    scan(100.5),
    new Date(t0.getTime() + 3 * 60 * 1000)
  );
  const third = await tracker.processScan(
    scan(101),
    new Date(t0.getTime() + 6 * 60 * 1000)
  );
  const fourth = await tracker.processScan(
    scan(103.1),
    new Date(t0.getTime() + 9 * 60 * 1000)
  );
  const expired = await tracker.processScan(
    { marketSource: 'GATE', anomalies: [] },
    new Date(t0.getTime() + 25 * 60 * 1000)
  );

  const event = events[0];
  const transitions = event.transition_history.map((item) => item.to);
  const checks = [
    {
      name: 'First directional anomaly creates one WATCH event',
      pass: first.created === 1 &&
        events.length === 1 &&
        transitions[0] === 'WATCH',
    },
    {
      name: 'Repeated scans update the same event instead of duplicating it',
      pass: second.created === 0 &&
        createdCount === 1 &&
        updateCount === 4 &&
        event.metrics.observation_count === 4,
    },
    {
      name: 'Three persistent observations arm the event',
      pass: third.armed === 1 && transitions.includes('ARMED'),
    },
    {
      name: 'A post-arm move of at least two percent triggers research state',
      pass: fourth.triggered === 1 &&
        transitions.includes('TRIGGERED') &&
        event.metrics.favorable_from_armed_percent >= 2,
    },
    {
      name: 'Missing anomaly expires the event without creating a signal',
      pass: expired.expired === 1 &&
        event.state === 'EXPIRED' &&
        transitions.at(-1) === 'EXPIRED' &&
        event.paper_signal_id == null,
    },
    {
      name: 'Price, funding and OI history is retained for analysis',
      pass: event.metrics.observations.length === 4 &&
        event.metrics.observations.every((item) => (
          item.price != null &&
          item.funding_percent != null &&
          item.open_interest_usd != null
        )),
    },
    {
      name: 'Opposite directional pressure maps to CASCADE_SHORT',
      pass: tracker._scenarioFor({
        anomalyType: 'FUNDING_DISLOCATION',
        fundingPercent: 0.2,
        priceChange24hPercent: -10,
      }) === 'CASCADE_SHORT',
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
