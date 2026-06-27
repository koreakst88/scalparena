// tests/unit/paperSignalStats.test.js

const PaperSignalStats = require('../../src/analytics/paperSignalStats');

console.log('🧪 Paper Signal Stats Test\n');

const signals = [
  {
    pair: 'SOLUSDT',
    strategy: 'TREND_PULLBACK',
    status: 'TP_HIT',
    time_to_result_minutes: 24,
  },
  {
    pair: 'SOLUSDT',
    strategy: 'TREND_PULLBACK',
    status: 'SL_HIT',
    time_to_result_minutes: 18,
  },
  {
    pair: 'BTCUSDT',
    strategy: 'MEAN_REVERSION',
    status: 'WATCHING',
  },
  {
    pair: 'ETHUSDT',
    strategy: 'MEAN_REVERSION',
    status: 'TIMEOUT',
    time_to_result_minutes: 90,
  },
];

const stats = PaperSignalStats.calculate(signals);
const message = PaperSignalStats.format(stats, 'последние 7 дн.');

console.log(message);

const checks = [
  { name: 'total = 4', pass: stats.total === 4 },
  { name: 'watching = 1', pass: stats.watching === 1 },
  { name: 'tp = 1', pass: stats.tp === 1 },
  { name: 'sl = 1', pass: stats.sl === 1 },
  { name: 'timeout = 1', pass: stats.timeout === 1 },
  { name: 'winRate = 50%', pass: stats.winRate === 50 },
  { name: 'avgTimeToResult = 44', pass: stats.avgTimeToResult === 44 },
  { name: 'message includes PAPER SIGNALS', pass: message.includes('PAPER SIGNALS') },
  { name: 'strategy grouping exists', pass: stats.byStrategy[0].total === 2 },
];

console.log('\n🎯 Final checks:');
checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
