const StructureWideRadar = require('../../src/engine/structureWideRadar');

console.log('Structure Priority Follow-up Test\n');

function candles(intervalMinutes) {
  const intervalMs = intervalMinutes * 60000;
  const start = Date.now() - 200 * intervalMs;
  return Array.from({ length: 200 }, (_, index) => {
    const close = 100 + Math.sin(index * Math.PI / 6) * 5;
    return {
      timestamp: start + index * intervalMs,
      open: close - 0.1,
      high: close + 0.7,
      low: close - 0.7,
      close: index === 199 ? 105.2 : close,
      volume: 1000,
      confirm: true,
    };
  });
}

const analyzed = [];
const provider = {
  getGateSpotSymbols: async () => ['TOPUSDT', 'ACTIVEUSDT'],
  getGateFuturesTickers: async () => [
    {
      symbol: 'TOPUSDT',
      lastPrice: 105.2,
      turnover24h: 50000000,
      bidPrice: 105.19,
      askPrice: 105.2,
    },
    {
      symbol: 'ACTIVEUSDT',
      lastPrice: 105.2,
      turnover24h: 100000,
      bidPrice: 104,
      askPrice: 105.2,
    },
  ],
  getGateFuturesKlines: async (pair, interval) => {
    analyzed.push(pair);
    return candles(Number(interval));
  },
};

StructureWideRadar.scan(provider, {
  scanLimit: 1,
  concurrency: 1,
  minTurnoverUsd: 5000000,
  maxSpreadPercent: 0.3,
  priorityPairs: ['ACTIVEUSDT'],
})
  .then((scan) => {
    const activeReport = scan.reports.find(
      (report) => report.pair === 'ACTIVEUSDT'
    );
    const checks = [
      {
        name: 'Active event is analyzed beyond the normal deep-scan limit',
        pass: scan.deepScanSelected === 2 &&
          analyzed.filter((pair) => pair === 'ACTIVEUSDT').length === 3,
      },
      {
        name: 'Priority follow-up can survive temporary liquidity deterioration',
        pass: Boolean(activeReport) &&
          activeReport.rejectionReason === 'PRIORITY_FOLLOW_UP_ONLY',
      },
      {
        name: 'Follow-up-only pair cannot create a fresh candidate',
        pass: !scan.candidates.some((report) => report.pair === 'ACTIVEUSDT'),
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
