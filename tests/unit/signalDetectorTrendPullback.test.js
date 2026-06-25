// tests/unit/signalDetectorTrendPullback.test.js

const SignalDetector = require('../../src/engine/signalDetector');

console.log('🧪 Signal Detector Trend Pullback Test\n');

const baseContext = {
  volume: 140,
  rsi: 50,
  macdBias: 'BULLISH',
  currentPrice: 100.2,
  market: {
    regime: 'TREND_UP',
    ema20: 100,
    emaSpread: 0.6,
    roc12: 1.6,
  },
};

const shortContext = {
  volume: 145,
  rsi: 52,
  macdBias: 'BEARISH',
  currentPrice: 99.8,
  market: {
    regime: 'TREND_DOWN',
    ema20: 100,
    emaSpread: -0.7,
    roc12: -1.7,
  },
};

const checks = [
  {
    name: 'LONG pullback проходит по тренду, RSI, MACD и EMA20',
    pass: SignalDetector._isTrendPullbackEntryValid('LONG', baseContext),
  },
  {
    name: 'SHORT pullback проходит по тренду, RSI, MACD и EMA20',
    pass: SignalDetector._isTrendPullbackEntryValid('SHORT', shortContext),
  },
  {
    name: 'Pullback блокирует слабый volume',
    pass: !SignalDetector._isTrendPullbackEntryValid('LONG', {
      ...baseContext,
      volume: 119,
    }),
  },
  {
    name: 'Pullback блокирует RSI вне 40-60',
    pass: !SignalDetector._isTrendPullbackEntryValid('LONG', {
      ...baseContext,
      rsi: 70,
    }),
  },
  {
    name: 'Pullback блокирует MACD против направления',
    pass: !SignalDetector._isTrendPullbackEntryValid('LONG', {
      ...baseContext,
      macdBias: 'BEARISH',
    }),
  },
  {
    name: 'Pullback блокирует цену далеко от EMA20',
    pass: !SignalDetector._isTrendPullbackEntryValid('LONG', {
      ...baseContext,
      currentPrice: 102,
    }),
  },
  {
    name: 'Confidence TREND_PULLBACK в рабочем диапазоне',
    pass: SignalDetector._calculateTrendPullbackConfidence('LONG', baseContext) >= 70,
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
