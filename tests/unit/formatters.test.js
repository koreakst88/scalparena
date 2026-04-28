// tests/unit/formatters.test.js

const { formatDetailedAnalytics } = require('../../src/analytics/formatters');

console.log('🧪 Analytics Formatters Test\n');

const analytics = {
  topPairs: [
    { pair: 'SOLUSDT', win_rate: 66.67, trades: 3, total_pnl: 1.23 },
  ],
  worstPairs: [
    { pair: 'RENDERUSDT', win_rate: 0, trades: 3, total_pnl: -1.44 },
  ],
  regimes: [
    { market_regime: 'LOW_VOL_RANGE', win_rate: 60, trades: 5, total_pnl: 0.5 },
  ],
  strategies: [
    { strategy: 'MEAN_REVERSION', win_rate: 55, trades: 10, total_pnl: -0.2 },
  ],
  macdBias: [
    { macd_bias: 'BEARISH', win_rate: 50, trades: 4, total_pnl: 0.12 },
  ],
  rsiZones: [
    { rsi_zone: 'OVERSOLD_LT_30', win_rate: 75, trades: 4, total_pnl: 0.9 },
  ],
  holdTimes: [
    { hold_time_bucket: '15_30M', win_rate: 50, trades: 2, total_pnl: -0.1, avg_hold_minutes: 22.5 },
  ],
};

const message = formatDetailedAnalytics(analytics, 7);
console.log(message);

console.log('\n🎯 Checks:');
const checks = [
  { name: 'Header есть', pass: message.includes('ДЕТАЛЬНАЯ АНАЛИТИКА ЗА 7 ДНЕЙ') },
  { name: 'Top pair есть', pass: message.includes('SOLUSDT') },
  { name: 'Regime label форматируется', pass: message.includes('LOW VOL RANGE') },
  { name: 'Strategy label форматируется', pass: message.includes('MEAN REVERSION') },
  { name: 'Hold time bucket есть', pass: message.includes('15 30M') },
];

checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
