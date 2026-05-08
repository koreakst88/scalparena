// tests/unit/formatters.test.js

const { formatDetailedAnalytics } = require('../../src/analytics/formatters');
const GptAnalyzer = require('../../src/analytics/gptAnalyzer');

console.log('🧪 Analytics Formatters Test\n');

const analytics = {
  topPairs: [
    { pair: 'SOLUSDT', win_rate: 66.67, trades: 3, total_pnl: 1.23 },
  ],
  worstPairs: [
    { pair: 'RENDERUSDT', win_rate: 0, trades: 3, total_pnl: -1.44 },
  ],
  regimes: [
    { regime: 'LOW_VOL_RANGE', win_rate: 60, trades: 5, total_pnl: 0.5 },
    { market_regime: 'TREND_DOWN', win_rate: 40, trades: 2, total_pnl: -0.2 },
    { regime: 'NULL_REGIME', win_rate: 0, trades: 1, total_pnl: -0.1 },
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
  exitReasons: [
    {
      exit_reason: 'TIMEOUT_HARD',
      trades: 22,
      win_rate: 31.8,
      avg_win: 0.2,
      avg_loss: -0.4,
      total_pnl: -4.15,
    },
    {
      exit_reason: 'MANUAL',
      trades: 16,
      win_rate: 93.8,
      avg_win: 0.35,
      avg_loss: -0.1,
      total_pnl: 4.01,
    },
  ],
};

const message = formatDetailedAnalytics(analytics, 7);
const analyzer = new GptAnalyzer();
const sanitized = analyzer._sanitizeTelegramText('**bad_markdown** [x] `code`');
console.log(message);

console.log('\n🎯 Checks:');
const checks = [
  { name: 'Header есть', pass: message.includes('ДЕТАЛЬНАЯ АНАЛИТИКА ЗА 7 ДНЕЙ') },
  { name: 'Top pair есть', pass: message.includes('SOLUSDT') },
  { name: 'Regime из поля regime выводится как есть', pass: message.includes('LOW_VOL_RANGE') },
  { name: 'Regime из поля market_regime выводится как есть', pass: message.includes('TREND_DOWN') },
  { name: 'NULL_REGIME не превращается в UNKNOWN', pass: message.includes('NULL_REGIME') && !message.includes('UNKNOWN') },
  { name: 'Strategy label форматируется', pass: message.includes('MEAN REVERSION') },
  { name: 'Hold time bucket есть', pass: message.includes('15 30M') },
  { name: 'Exit reasons section есть', pass: message.includes('EXIT REASONS') },
  { name: 'Exit reason share считается', pass: message.includes('TIMEOUT_HARD: 57.9%') },
  { name: 'GPT sanitizer убирает markdown', pass: sanitized === 'badmarkdown x code' },
];

checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
