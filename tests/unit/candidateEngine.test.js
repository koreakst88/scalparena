// tests/unit/candidateEngine.test.js

const CandidateEngine = require('../../src/engine/candidateEngine');

function buildContext(overrides = {}) {
  return {
    currentPrice: 100,
    rsi: 52,
    volume: 145,
    atr: 1.1,
    atrPercent: 1.1,
    bbPosition: 62,
    bbWidth: 3,
    macd: { macd: 1, signal: 0.8, histogram: 0.2 },
    macdBias: 'BULLISH',
    candleImpulse: 0.35,
    market: {
      regime: 'TREND_UP',
      strategy: 'MOMENTUM',
      ema20: 99.6,
      ema50: 98,
      emaSpread: 1.6,
      roc12: 1.8,
      reason: 'test regime',
    },
    ...overrides,
  };
}

console.log('🧪 Candidate Engine Test\n');

const noDataReport = CandidateEngine.analyzePair('SOLUSDT', []);
const trendContext = buildContext();
const shortTrendContext = buildContext({
  currentPrice: 100,
  rsi: 48,
  volume: 150,
  macd: { macd: -1, signal: -0.8, histogram: -0.2 },
  macdBias: 'BEARISH',
  market: {
    regime: 'TREND_DOWN',
    strategy: 'MOMENTUM',
    ema20: 100.4,
    ema50: 102,
    emaSpread: -1.5,
    roc12: -1.9,
    reason: 'test downtrend',
  },
});
const weakContext = buildContext({
  rsi: 76,
  volume: 70,
  macdBias: 'BEARISH',
  market: {
    regime: 'NOISE',
    strategy: 'SKIP',
    ema20: 94,
    ema50: 94,
    emaSpread: 0,
    roc12: 0.2,
    reason: 'noise',
  },
});
const mrContext = buildContext({
  rsi: 82,
  volume: 180,
  bbPosition: 92,
  macd: { macd: -1, signal: -0.8, histogram: -0.2 },
  macdBias: 'BEARISH',
  market: {
    regime: 'LOW_VOL_RANGE',
    strategy: 'MEAN_REVERSION',
    ema20: 100,
    ema50: 100,
    emaSpread: 0,
    roc12: 0.1,
    reason: 'low vol',
  },
});

const longPullback = CandidateEngine._buildTrendPullbackCandidate('BTCUSDT', trendContext);
const shortPullback = CandidateEngine._buildTrendPullbackCandidate('ETHUSDT', shortTrendContext);
const weakPullback = CandidateEngine._buildTrendPullbackCandidate('XRPUSDT', weakContext);
const mrCandidate = CandidateEngine._buildMeanReversionCandidate('SOLUSDT', mrContext);
const noTrade = CandidateEngine._buildNoTradeCandidate('XRPUSDT', weakContext, weakPullback);
const paperSignal = CandidateEngine.toPaperSignal(longPullback);

const checks = [
  { name: 'No-data report returns NO_TRADE', pass: noDataReport.best.action === 'NO_TRADE' },
  { name: 'TREND_UP produces strong LONG pullback', pass: longPullback.direction === 'LONG' && longPullback.score >= 70 },
  { name: 'TREND_DOWN produces strong SHORT pullback', pass: shortPullback.direction === 'SHORT' && shortPullback.score >= 70 },
  { name: 'Weak context lowers pullback score', pass: weakPullback.score < 60 },
  { name: 'Strict bearish MR can score actionable', pass: mrCandidate.direction === 'SHORT' && mrCandidate.score >= 70 },
  { name: 'NO_TRADE can beat weak setup', pass: noTrade.action === 'NO_TRADE' && noTrade.score > weakPullback.score },
  { name: 'Candidate converts to paper signal shape', pass: paperSignal.type === 'LONG' && paperSignal.strategy === 'TREND_PULLBACK' },
  { name: 'Actionable filter keeps strong candidates', pass: CandidateEngine.getActionableCandidates([{ best: longPullback }]).length === 1 },
];

console.log('🎯 Final checks:');
checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
