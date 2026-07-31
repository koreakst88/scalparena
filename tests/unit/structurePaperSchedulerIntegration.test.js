process.env.PAPER_SIGNAL_TRACKING_ENABLED = 'true';
process.env.STRUCTURE_PAPER_SIGNALS_ENABLED = 'true';

const Scheduler = require('../../src/engine/scheduler');

console.log('Structure Paper Scheduler Integration Test\n');

const saved = [];
const resolved = [];
const bot = {
  _trackPaperSignal: async (userId, signal, source) => {
    const row = { id: `paper-${saved.length + 1}`, userId, signal, source };
    saved.push(row);
    return row;
  },
};
const usersQuery = {
  select() { return this; },
  eq() { return this; },
  then(resolve) {
    return Promise.resolve({
      data: [{ telegram_id: '42', auto_scan_enabled: true }],
      error: null,
    }).then(resolve);
  },
};
const db = {
  client: {
    from(table) {
      if (table !== 'users') throw new Error(`Unexpected table ${table}`);
      return usersQuery;
    },
  },
  getActivePaperSignals: async () => [],
};
const scheduler = new Scheduler(bot, db, {});
scheduler.structureEventTracker = {
  markPaperRecorded: async (event, signals, _now, reason) => {
    resolved.push({ event, signals, reason });
    return event;
  },
};
const readyEvent = {
  id: 'structure-event-ready',
  experiment_id: 'STRUCTURE_V1_EVENT_RESEARCH_20260731',
  pair: 'TESTUSDT',
  scenario: 'RESISTANCE_TEST',
  state: 'TRIGGERED',
  primary_venue: 'GATE',
  score: 90,
  zone_lower: 100,
  zone_upper: 101,
  zone_score: 94,
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
        support: [],
      },
    },
  },
};

scheduler._recordStructurePaperSignals([readyEvent])
  .then((summary) => {
    const checks = [
      {
        name: 'One retest-confirmed event creates one paper signal',
        pass: summary.saved === 1 &&
          saved.length === 1 &&
          resolved.length === 1,
      },
      {
        name: 'Paper signal is tagged with isolated source and experiment',
        pass: saved[0].source === 'STRUCTURE_RETEST_SHADOW' &&
          saved[0].signal.strategy ===
            'STRUCTURE_BREAKOUT_RETEST_V1_SHADOW' &&
          saved[0].signal.experimentId ===
            'STRUCTURE_V1_RETEST_SHADOW_20260731',
      },
      {
        name: 'Research event is resolved only after paper recording',
        pass: resolved[0].signals.length === 1 &&
          resolved[0].reason === 'RETEST_PAPER_RECORDED',
      },
    ];

    checks.forEach((check) => {
      console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`);
    });
    const allPassed = checks.every((check) => check.pass);
    console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
