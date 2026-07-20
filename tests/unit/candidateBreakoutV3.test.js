const CandidateBreakoutV3 = require('../../src/engine/candidateBreakoutV3');

function buildRetestSetup(options = {}) {
  const direction = options.direction || 'LONG';
  const candles = [];
  const start = Date.UTC(2026, 6, 20);

  for (let index = 0; index < 96; index += 1) {
    const center = 100 + index * 0.025 + Math.sin(index) * 0.08;
    candles.push({
      timestamp: start + index * 60000,
      open: center - 0.04,
      high: center + 0.45,
      low: center - 0.45,
      close: center + 0.04,
      volume: 100,
      confirm: true,
    });
  }

  const level = Math.max(...candles.slice(76, 96).map((candle) => candle.high));
  candles.push({
    timestamp: start + 96 * 60000,
    open: level - 0.08,
    high: level + 0.72,
    low: level - 0.1,
    close: level + 0.62,
    volume: options.triggerVolume || 200,
    confirm: true,
  });
  candles.push({
    timestamp: start + 97 * 60000,
    open: level + 0.35,
    high: level + 0.42,
    low: level - 0.08,
    close: level + 0.08,
    volume: 100,
    confirm: true,
  });
  candles.push({
    timestamp: start + 98 * 60000,
    open: level + 0.08,
    high: level + 0.3,
    low: level + 0.02,
    close: level + 0.2,
    volume: 105,
    confirm: true,
  });
  candles.push({
    timestamp: start + 99 * 60000,
    open: level + 0.18,
    high: level + 0.38,
    low: level + 0.12,
    close: level + 0.3,
    volume: 115,
    confirm: true,
  });

  if (direction === 'SHORT') {
    return candles.map((candle) => ({
      ...candle,
      open: 205 - candle.open,
      high: 205 - candle.low,
      low: 205 - candle.high,
      close: 205 - candle.close,
    }));
  }
  return candles;
}

console.log('Candidate Breakout V3 Test\n');

const longReport = CandidateBreakoutV3.analyzePair('LONGUSDT', buildRetestSetup());
const shortReport = CandidateBreakoutV3.analyzePair('SHORTUSDT', buildRetestSetup({ direction: 'SHORT' }));
const hotVolumeReport = CandidateBreakoutV3.analyzePair(
  'HOTUSDT',
  buildRetestSetup({ triggerVolume: 400 })
);
const paperSignal = CandidateBreakoutV3.toPaperSignal({
  ...longReport.candidate,
  marketContext: { state: 'RISK_ON', decision: 'ALLOW' },
});

const checks = [
  {
    name: 'LONG requires a completed breakout, retest and reclaim sequence',
    pass: longReport.action === 'SHADOW_TRADE' &&
      longReport.candidate?.triggerAgeCandles === 3 &&
      longReport.candidate?.retestTimestamp > longReport.candidate?.triggerTimestamp,
  },
  {
    name: 'Five-minute downtrend supports a SHORT retest setup',
    pass: shortReport.action === 'SHADOW_TRADE' && shortReport.candidate?.direction === 'SHORT',
  },
  {
    name: 'Overheated breakout volume is rejected instead of rewarded',
    pass: hotVolumeReport.reason === 'REJECT_VOLUME',
  },
  {
    name: 'Stop is structural and target preserves RR 1.8',
    pass: longReport.candidate?.stopBasis > longReport.candidate?.stopLoss &&
      longReport.candidate?.riskReward === 1.8,
  },
  {
    name: 'Paper row is isolated as Candidate V3',
    pass: paperSignal?.strategy === 'BREAKOUT_V3_SHADOW' &&
      paperSignal?.entryMode === 'BREAKOUT_RETEST_RECLAIM_V3' &&
      paperSignal?.signalMetadata?.marketContext?.decision === 'ALLOW',
  },
  {
    name: 'LONG is blocked unless BTC context explicitly allows it',
    pass: CandidateBreakoutV3.isAllowedByMarketContext({
      direction: 'LONG', marketContext: { decision: 'CAUTION' },
    }) === false,
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
