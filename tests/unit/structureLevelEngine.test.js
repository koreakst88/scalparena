const StructureLevelEngine = require('../../src/engine/structureLevelEngine');
const StructureLevelFormatter = require('../../src/analytics/structureLevelFormatter');

function buildOscillatingCandles(intervalMinutes, count = 200) {
  const intervalMs = intervalMinutes * 60 * 1000;
  const start = Date.now() - count * intervalMs;

  return Array.from({ length: count }, (_, index) => {
    const cycle = Math.sin(index * Math.PI / 6) * 5;
    const trend = index * 0.015;
    const close = 100 + cycle + trend;
    const open = close - Math.cos(index) * 0.2;

    return {
      timestamp: start + index * intervalMs,
      open,
      high: Math.max(open, close) + 0.7,
      low: Math.min(open, close) - 0.7,
      close,
      volume: 1000 + (index % 12) * 20,
      confirm: true,
    };
  });
}

console.log('Structure Level Engine Test\n');

const report = StructureLevelEngine.analyzeCandleSets('BTCUSDT', {
  '4H': buildOscillatingCandles(240),
  '1H': buildOscillatingCandles(60),
  '15m': buildOscillatingCandles(15),
}, {
  source: 'TEST',
});
const message = StructureLevelFormatter.format(report);

const checks = [
  {
    name: 'Level engine finds clustered support and resistance zones',
    pass: report.status === 'LEVELS_FOUND' &&
      report.support.length > 0 &&
      report.resistance.length > 0,
  },
  {
    name: 'Market structure and compression are diagnostic outputs',
    pass: Boolean(report.structure?.state) &&
      Boolean(report.compression?.state),
  },
  {
    name: 'Zone quality includes touches and a bounded score',
    pass: [...report.support, ...report.resistance].every((zone) => (
      zone.touches >= 2 &&
      zone.score >= 0 &&
      zone.score <= 100
    )),
  },
  {
    name: 'Adjacent output zones do not overlap as duplicates',
    pass: [report.support, report.resistance].every((zones) => (
      zones.every((zone, index) => (
        index === 0 || zones[index - 1].upper < zone.lower ||
        zones[index - 1].lower > zone.upper
      ))
    )),
  },
  {
    name: 'Level research creates no events, paper signals or trade signals',
    pass: report.signalsGenerated === 0 &&
      report.eventsCreated === 0 &&
      report.paperSignalsCreated === 0 &&
      message.includes('Сигналы: OFF | Events: OFF | Paper: OFF | Alerts: OFF'),
  },
  {
    name: 'Formatter explains that score is not trade probability',
    pass: message.includes('Score показывает качество зоны') &&
      message.includes('Вход, TP и SL не рассчитывались'),
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
