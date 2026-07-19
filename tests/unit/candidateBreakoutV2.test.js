const CandidateBreakoutV2 = require('../../src/engine/candidateBreakoutV2');

function buildConfirmedBreakout() {
  const candles = [];
  const start = Date.UTC(2026, 6, 19);

  for (let index = 0; index < 35; index += 1) {
    const close = 100 + Math.sin(index * 1.4) * 0.18 + index * 0.004;
    const open = close - Math.sin(index) * 0.03;
    candles.push({
      timestamp: start + index * 60000,
      open,
      high: Math.max(open, close) + 0.08,
      low: Math.min(open, close) - 0.08,
      close,
      volume: 100 + index % 4 * 3,
      confirm: true,
    });
  }

  const level = Math.max(...candles.slice(-20).map((candle) => candle.high));
  candles.push({
    timestamp: start + 35 * 60000,
    open: level - 0.12,
    high: level + 0.25,
    low: level - 0.14,
    close: level + 0.2,
    volume: 240,
    confirm: true,
  });
  candles.push({
    timestamp: start + 36 * 60000,
    open: level + 0.17,
    high: level + 0.23,
    low: level + 0.05,
    close: level + 0.12,
    volume: 120,
    confirm: true,
  });
  candles.push({
    timestamp: start + 37 * 60000,
    open: level + 0.11,
    high: level + 0.19,
    low: level + 0.06,
    close: level + 0.15,
    volume: 115,
    confirm: true,
  });

  return candles;
}

console.log('Candidate Breakout V2 Shadow Test\n');

const candles = buildConfirmedBreakout();
const report = CandidateBreakoutV2.analyzePair('TESTUSDT', candles);
const candidate = report.candidate;
candidate.marketContext = { version: 'market_context_v1', state: 'RISK_ON', decision: 'ALLOW' };
const paperSignal = CandidateBreakoutV2.toPaperSignal(candidate);
const shortReport = CandidateBreakoutV2.analyzePair(
  'SHORTUSDT',
  candles.map((candle) => ({
    ...candle,
    open: 200 - candle.open,
    high: 200 - candle.low,
    low: 200 - candle.high,
    close: 200 - candle.close,
  }))
);
const zeroVolumeReport = CandidateBreakoutV2.analyzePair(
  'BACKFILLUSDT',
  candles.map((candle) => ({ ...candle, volume: 0 }))
);
const unconfirmedReport = CandidateBreakoutV2.analyzePair(
  'OPENUSDT',
  candles.map((candle) => ({ ...candle, confirm: false }))
);
const weakVolume = buildConfirmedBreakout();
weakVolume[35].volume = 105;
const weakVolumeReport = CandidateBreakoutV2.analyzePair('WEAKVOLUSDT', weakVolume);

const checks = [
  {
    name: 'Real range break and hold creates a shadow candidate',
    pass: report.action === 'SHADOW_TRADE' && candidate?.direction === 'LONG',
  },
  {
    name: 'Candidate requires a strong breakout volume ratio',
    pass: candidate?.volumeRatio >= 1.5,
  },
  {
    name: 'Confirmed downside break creates a SHORT shadow candidate',
    pass: shortReport.action === 'SHADOW_TRADE' && shortReport.candidate?.direction === 'SHORT',
  },
  {
    name: 'Dynamic exits preserve RR 1.8',
    pass: candidate?.riskReward === 1.8 && candidate?.tpPercent > candidate?.slPercent,
  },
  {
    name: 'Paper signal is explicitly isolated as V2 shadow',
    pass: paperSignal?.strategy === 'BREAKOUT_V2_SHADOW' &&
      paperSignal?.entryMode === 'CONFIRMED_RANGE_BREAKOUT_V2',
  },
  {
    name: 'Breakout diagnostics are preserved in signal metadata',
    pass: paperSignal?.signalMetadata?.breakoutLevel > 0 &&
      paperSignal?.signalMetadata?.triggerAgeCandles === 2,
  },
  {
    name: 'Market context research tag is preserved in signal metadata',
    pass: paperSignal?.signalMetadata?.marketContext?.decision === 'ALLOW',
  },
  {
    name: 'Zero-volume backfill candles cannot qualify',
    pass: zeroVolumeReport.reason === 'NOT_ENOUGH_LIVE_CANDLES',
  },
  {
    name: 'Unconfirmed candles cannot qualify',
    pass: unconfirmedReport.reason === 'NOT_ENOUGH_LIVE_CANDLES',
  },
  {
    name: 'Rejected real breakouts expose a concrete filter reason',
    pass: weakVolumeReport.reason === 'REJECT_VOLUME' &&
      weakVolumeReport.diagnostic.rejectionReasons.includes('REJECT_VOLUME'),
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
