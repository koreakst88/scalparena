// tests/unit/marketRegime.test.js

const MarketRegimeDetector = require('../../src/engine/marketRegimeDetector');

console.log('🧪 Market Regime Detector Test\n');

function buildCandles(closes, volume = 1000) {
  return closes.map((close, index) => {
    const previous = closes[index - 1] || close;
    const open = previous;
    const high = Math.max(open, close) * 1.002;
    const low = Math.min(open, close) * 0.998;

    return {
      open,
      high,
      low,
      close,
      volume,
      timestamp: Date.now() - (closes.length - index) * 60 * 60 * 1000,
      confirm: true,
    };
  });
}

const rangePrices = Array.from({ length: 50 }, (_, index) => {
  return 100 + Math.sin(index / 2) * 0.6;
});

const trendUpPrices = Array.from({ length: 50 }, (_, index) => {
  return 100 + index * 0.18 + Math.sin(index / 3) * 0.15;
});

const trendDownPrices = Array.from({ length: 50 }, (_, index) => {
  return 110 - index * 0.18 + Math.sin(index / 3) * 0.15;
});

const noisePrices = Array.from({ length: 50 }, (_, index) => {
  return 100 + Math.sin(index) * 5 + (index % 2 === 0 ? 2 : -2);
});

const cases = [
  { label: 'Range', candles: buildCandles(rangePrices), expectedStrategy: 'MEAN_REVERSION' },
  { label: 'Trend Up', candles: buildCandles(trendUpPrices), expectedRegime: 'TREND_UP' },
  { label: 'Trend Down', candles: buildCandles(trendDownPrices), expectedRegime: 'TREND_DOWN' },
  { label: 'Noise', candles: buildCandles(noisePrices), expectedStrategy: 'SKIP' },
];

const results = cases.map((testCase) => {
  const regime = MarketRegimeDetector.detect(testCase.candles);
  console.log(`   ${testCase.label}: ${regime.regime} / ${regime.strategy}`);
  console.log(`      ${regime.reason}`);
  return { ...testCase, regime };
});

console.log('\n🎯 Checks:');
const checks = [
  {
    name: 'Range использует Mean Reversion',
    pass: results.find((r) => r.label === 'Range').regime.strategy === 'MEAN_REVERSION',
  },
  {
    name: 'Trend Up определяется как TREND_UP',
    pass: results.find((r) => r.label === 'Trend Up').regime.regime === 'TREND_UP',
  },
  {
    name: 'Trend Down определяется как TREND_DOWN',
    pass: results.find((r) => r.label === 'Trend Down').regime.regime === 'TREND_DOWN',
  },
  {
    name: 'Noise пропускается',
    pass: results.find((r) => r.label === 'Noise').regime.strategy === 'SKIP',
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
