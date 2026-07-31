process.env.STRUCTURE_AUTO_RESEARCH_ENABLED = 'true';
process.env.STRUCTURE_EVENT_TRACKING_ENABLED = 'true';

const Scheduler = require('../../src/engine/scheduler');

console.log('Structure Event Scheduler Integration Test\n');

function buildCandles(intervalMinutes, count = 200) {
  const intervalMs = intervalMinutes * 60 * 1000;
  const start = Date.now() - count * intervalMs;
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index * Math.PI / 6) * 5;
    return {
      timestamp: start + index * intervalMs,
      open: close - 0.1,
      high: close + 0.7,
      low: close - 0.7,
      close: index === count - 1 ? 105.2 : close,
      volume: 1000,
      confirm: true,
    };
  });
}

const diagnostics = [];
const events = [];
let telegramCalls = 0;
let paperCalls = 0;

const bot = new Proxy({}, {
  get(_target, property) {
    if (property === '_trackPaperSignal') {
      return async () => { paperCalls += 1; };
    }
    return async () => { telegramCalls += 1; };
  },
});
const db = {
  getActiveStructureEvents: async () => events.filter((event) => (
    ['WATCH', 'ARMED', 'TRIGGERED'].includes(event.state)
  )),
  createStructureEvent: async (payload) => {
    const event = { id: `event-${events.length + 1}`, ...payload };
    events.push(event);
    return event;
  },
  updateStructureEvent: async (id, updates) => {
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
  getGateSpotSymbols: async () => ['TESTUSDT'],
  getGateFuturesTickers: async () => [{
    symbol: 'TESTUSDT',
    lastPrice: 105.2,
    turnover24h: 50000000,
    bidPrice: 105.19,
    askPrice: 105.2,
    priceChange24hPercent: 1,
  }],
  getGateFuturesKlines: async (_pair, interval) => (
    buildCandles(Number(interval))
  ),
};
const scheduler = new Scheduler(bot, db, provider);

scheduler._structureWideResearchScan()
  .then((scan) => {
    const checks = [
      {
        name: 'Automatic research scan creates one isolated WATCH event',
        pass: events.length === 1 &&
          events[0].state === 'WATCH' &&
          events[0].scenario === 'RESISTANCE_TEST',
      },
      {
        name: 'Diagnostic records Structure lifecycle counters',
        pass: diagnostics.length === 1 &&
          diagnostics[0].project === 'STRUCTURE' &&
          diagnostics[0].market_context.mode ===
            'STRUCTURE_WIDE_RESEARCH_LIFECYCLE' &&
          diagnostics[0].market_context.eventsCreated === 1,
      },
      {
        name: 'Scheduler exposes scan and lifecycle status',
        pass: scan.eventTracking.created === 1 &&
          scan.eventsCreated === 1 &&
          scheduler.lastStructureWideScanTime instanceof Date &&
          scheduler.getStatus().structureAutoResearchEnabled === true,
      },
      {
        name: 'Background Structure research sends no Telegram or paper calls',
        pass: telegramCalls === 0 &&
          paperCalls === 0 &&
          scan.paperSignalsCreated === 0 &&
          scan.alertsSent === 0,
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
