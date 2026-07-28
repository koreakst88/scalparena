process.env.EXTREME_WIDE_SCAN_ENABLED = 'true';
process.env.EXTREME_EVENT_TRACKING_ENABLED = 'false';

const Scheduler = require('../../src/engine/scheduler');

const saved = [];
let botCalls = 0;
const scheduler = new Scheduler(
  new Proxy({}, {
    get() {
      return () => {
        botCalls += 1;
      };
    },
  }),
  {
    createResearchScanDiagnostic: async (payload) => {
      saved.push(payload);
      return payload;
    },
  },
  {
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
  }
);

scheduler._extremeWideDiagnosticScan()
  .then((scan) => {
    const checks = [
      {
        name: 'Enabled scheduler stores one research diagnostic',
        pass: saved.length === 1 &&
          saved[0].project === 'EXTREME' &&
          saved[0].strategy === 'EXTREME_WIDE_RADAR_V1',
      },
      {
        name: 'Scheduled scan creates no events, paper rows or Telegram calls',
        pass: scan.eventsCreated === 0 &&
          scan.signalsGenerated === 0 &&
          botCalls === 0,
      },
      {
        name: 'Scheduler exposes the last diagnostic scan timestamp',
        pass: scheduler.lastExtremeWideScanTime instanceof Date,
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
