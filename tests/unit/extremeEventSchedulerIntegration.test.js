process.env.EXTREME_WIDE_SCAN_ENABLED = 'true';
process.env.EXTREME_EVENT_TRACKING_ENABLED = 'true';

const Scheduler = require('../../src/engine/scheduler');

console.log('Extreme Event Scheduler Integration Test\n');

const diagnostics = [];
const events = [];
let botCalls = 0;
let paperCalls = 0;

const bot = new Proxy({}, {
  get(_target, property) {
    if (property === '_trackPaperSignal') {
      return async () => {
        paperCalls += 1;
      };
    }
    return async () => {
      botCalls += 1;
    };
  },
});
const db = {
  getActiveExtremeEvents: async () => events.filter((event) => (
    ['WATCH', 'ARMED', 'TRIGGERED'].includes(event.state)
  )),
  createExtremeEvent: async (payload) => {
    const event = { id: 'event-1', ...payload };
    events.push(event);
    return event;
  },
  updateExtremeEvent: async (id, updates) => {
    const event = events.find((item) => item.id === id);
    Object.assign(event, updates);
    return event;
  },
  createResearchScanDiagnostic: async (payload) => {
    diagnostics.push(payload);
    return payload;
  },
};
const provider = {
  getGateFuturesTickers: async () => [{
    symbol: 'DEXEUSDT',
    lastPrice: 4.4,
    high24h: 6.4,
    low24h: 2.5,
    priceChange24hPercent: 70,
    turnover24h: 150000000,
    fundingRate: -0.004,
    openInterestUsd: 3000000,
    bidPrice: 4.39,
    askPrice: 4.40,
    marketSource: 'GATE',
  }],
};
const scheduler = new Scheduler(bot, db, provider);

scheduler._extremeWideDiagnosticScan()
  .then((scan) => {
    const checks = [
      {
        name: 'Automatic wide scan creates one deduplicated research event',
        pass: events.length === 1 &&
          events[0].state === 'WATCH' &&
          events[0].scenario === 'SQUEEZE_LONG',
      },
      {
        name: 'Diagnostic records the lifecycle result',
        pass: diagnostics.length === 1 &&
          diagnostics[0].market_context.mode === 'WIDE_RESEARCH_LIFECYCLE' &&
          diagnostics[0].market_context.eventsCreated === 1,
      },
      {
        name: 'Scan exposes event counters without generating signals',
        pass: scan.eventTracking.created === 1 &&
          scan.eventsCreated === 1 &&
          scan.signalsGenerated === 0,
      },
      {
        name: 'Research lifecycle never calls Telegram or paper tracking',
        pass: botCalls === 0 && paperCalls === 0,
      },
    ];

    checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
    const allPassed = checks.every((check) => check.pass);
    console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
