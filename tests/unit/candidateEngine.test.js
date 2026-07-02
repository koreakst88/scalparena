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

const longPullback = CandidateEngine._buildTrendPullbackCandidate('JUPUSDT', trendContext);
const shortPullback = CandidateEngine._buildTrendPullbackCandidate('ETHUSDT', shortTrendContext);
const weakPullback = CandidateEngine._buildTrendPullbackCandidate('XRPUSDT', weakContext);
const breakoutCandidate = CandidateEngine._buildBreakoutCandidate('NEARUSDT', buildContext({
  rsi: 64,
  volume: 230,
  bbPosition: 86,
  market: {
    regime: 'TREND_UP',
    strategy: 'MOMENTUM',
    ema20: 99.6,
    ema50: 98,
    emaSpread: 1.6,
    roc12: 3,
    reason: 'strong breakout',
  },
}));
const btcPullback = CandidateEngine._buildTrendPullbackCandidate('BTCUSDT', trendContext);
const mrCandidate = CandidateEngine._buildMeanReversionCandidate('SOLUSDT', mrContext);
const noTrade = CandidateEngine._buildNoTradeCandidate('XRPUSDT', weakContext, weakPullback);
const paperSignal = CandidateEngine.toPaperSignal(longPullback);

const checks = [
  { name: 'No-data report returns NO_TRADE', pass: noDataReport.best.action === 'NO_TRADE' },
  { name: 'TREND_UP produces strong LONG pullback', pass: longPullback.direction === 'LONG' && longPullback.score >= 70 },
  { name: 'TREND_DOWN produces strong SHORT pullback', pass: shortPullback.direction === 'SHORT' && shortPullback.score >= 70 },
  { name: 'Weak context lowers pullback score', pass: weakPullback.score < 60 },
  { name: 'Breakout can become actionable from score 70', pass: CandidateEngine.isActionableCandidate(breakoutCandidate) },
  { name: 'Strict bearish MR is watch-only after stats review', pass: mrCandidate.direction === 'SHORT' && mrCandidate.score >= 70 && !CandidateEngine.isActionableCandidate(mrCandidate) },
  { name: 'Weak large-cap pairs are watch-only for Candidate Engine', pass: btcPullback.score >= 80 && !CandidateEngine.isActionableCandidate(btcPullback) },
  { name: 'NO_TRADE can beat weak setup', pass: noTrade.action === 'NO_TRADE' && noTrade.score > weakPullback.score },
  { name: 'Candidate converts to paper signal shape', pass: paperSignal.type === 'LONG' && paperSignal.strategy === 'TREND_PULLBACK' },
  { name: 'Actionable filter keeps strong candidates', pass: CandidateEngine.getActionableCandidates([{ best: longPullback }]).length === 1 },
  { name: 'Sort prefers stronger trade candidate over stronger NO_TRADE score', pass: CandidateEngine.sortReports([
    { pair: 'WEAK', best: { action: 'NO_TRADE', strategy: 'NO_TRADE', score: 85 }, bestTrade: { action: 'TRADE', score: 39, riskReward: 1 } },
    { pair: 'WATCH', best: { action: 'NO_TRADE', strategy: 'NO_TRADE', score: 79 }, bestTrade: { action: 'TRADE', score: 52, riskReward: 1 } },
  ])[0].pair === 'WATCH' },
];

console.log('🎯 Final checks:');
checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
