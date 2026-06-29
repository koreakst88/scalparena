// tests/unit/pumpHunterEngine.test.js

const PumpHunterEngine = require('../../src/engine/pumpHunterEngine');

function buildCandles({ start = 1, end = 1.32, low = 1, high = 1.33, recentVolume = 7000, baseVolume = 1000 } = {}) {
  const candles = [];

  for (let i = 0; i < 36; i += 1) {
    const progress = i / 35;
    const close = start + (end - start) * progress;
    const isRecent = i >= 32;
    candles.push({
      timestamp: i,
      open: close * 0.995,
      high: Math.max(close * 1.01, i === 35 ? high : close),
      low: Math.min(close * 0.99, i === 0 ? low : close),
      close,
      volume: isRecent ? recentVolume : baseVolume,
      turnover: close * (isRecent ? recentVolume : baseVolume),
    });
  }

  return candles;
}

console.log('🧪 Pump Hunter Engine Test\n');

const strongTicker = {
  symbol: 'RAVEUSDT',
  price24hPcnt: '0.34',
  turnover24h: '5000000',
};
const weakTicker = {
  symbol: 'SLOWUSDT',
  price24hPcnt: '0.02',
  turnover24h: '200000',
};
const extendedTicker = {
  symbol: 'LATEUSDT',
  price24hPcnt: '1.4',
  turnover24h: '8000000',
};

const strong = PumpHunterEngine.analyzeSymbol('RAVEUSDT', strongTicker, buildCandles());
const weak = PumpHunterEngine.analyzeSymbol('SLOWUSDT', weakTicker, buildCandles({
  end: 1.05,
  high: 1.06,
  recentVolume: 900,
  baseVolume: 1000,
}));
const extended = PumpHunterEngine.analyzeSymbol('LATEUSDT', extendedTicker, buildCandles({
  end: 1.9,
  high: 1.95,
  recentVolume: 8000,
  baseVolume: 1000,
}));
const paperSignal = PumpHunterEngine.toPaperSignal(strong);

const checks = [
  { name: 'Fresh pump becomes TRADE', pass: strong.action === 'TRADE' && strong.score >= 70 },
  { name: 'Pump signal uses +20/-15 levels', pass: strong.tpPercent === 20 && strong.slPercent === 15 },
  { name: 'Weak move is not actionable', pass: weak.action !== 'TRADE' },
  { name: 'Too extended pump is not actionable', pass: extended.action !== 'TRADE' },
  { name: 'Paper signal shape is PUMP_HUNTER', pass: paperSignal.strategy === 'PUMP_HUNTER' && paperSignal.type === 'LONG' },
  { name: 'Actionable filter keeps only strong pump', pass: PumpHunterEngine.getActionable([strong, weak, extended]).length === 1 },
];

console.log('🎯 Final checks:');
checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
