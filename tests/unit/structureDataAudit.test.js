const StructureDataAudit = require('../../src/engine/structureDataAudit');
const StructureAuditFormatter = require('../../src/analytics/structureAuditFormatter');

function buildCandles(intervalMinutes, count = 200) {
  const intervalMs = intervalMinutes * 60 * 1000;
  const currentBucket = Math.floor(Date.now() / intervalMs) * intervalMs;

  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.01;
    return {
      timestamp: currentBucket - (count - index) * intervalMs,
      open: close - 0.05,
      high: close + 0.1,
      low: close - 0.1,
      close,
      volume: 1000 + index,
      confirm: true,
    };
  });
}

const minutesByInterval = {
  240: 240,
  60: 60,
  15: 15,
};

const provider = {
  getGateFuturesKlines: async (_pair, interval) => (
    buildCandles(minutesByInterval[interval])
  ),
  getOkxSwapKlines: async (_pair, interval) => (
    interval === '240' ? [] : buildCandles(minutesByInterval[interval])
  ),
};

console.log('Structure Data Audit Test\n');

StructureDataAudit.run(provider, 'dexe/usdt')
  .then((report) => {
    const message = StructureAuditFormatter.format(report);
    const checks = [
      {
        name: 'Pair is normalized for futures sources',
        pass: report.pair === 'DEXEUSDT',
      },
      {
        name: 'One venue must provide all three timeframes',
        pass: report.primaryVenue === 'GATE' &&
          report.venues.GATE.complete &&
          !report.venues.OKX.complete,
      },
      {
        name: 'Candle quality is checked per timeframe',
        pass: report.venues.GATE.timeframes['4H'].confirmed === 200 &&
          report.venues.GATE.timeframes['1H'].volumeCoverage === 100 &&
          report.venues.GATE.timeframes['15m'].gaps === 0,
      },
      {
        name: 'Complete multi-timeframe data is research-ready',
        pass: report.readyForLevelResearch === true,
      },
      {
        name: 'Audit keeps every trading action disabled',
        pass: message.includes('Level Engine: не запускался этой командой') &&
          message.includes('Wide scan: OFF') &&
          message.includes('Paper-сигналы: OFF') &&
          message.includes('Telegram-алерты: OFF'),
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
