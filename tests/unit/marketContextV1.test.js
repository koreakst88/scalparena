const MarketContextV1 = require('../../src/engine/marketContextV1');

function buildBtcCandles(mode = 'up', count = 60) {
  const start = Date.UTC(2026, 6, 19);

  return Array.from({ length: count }, (_, index) => {
    let close = 60000;
    if (mode === 'up') close *= 1 + (index ** 2) * 0.00005;
    else if (mode === 'down') close *= 1 - (index ** 2) * 0.00004;
    else close *= 1 + Math.sin(index) * 0.0001;

    const rangePercent = mode === 'volatile' ? 0.025 : 0.001;
    return {
      timestamp: start + index * 15 * 60000,
      open: close * 0.9998,
      high: close * (1 + rangePercent),
      low: close * (1 - rangePercent),
      close,
      volume: 1000 + index,
      confirm: true,
    };
  });
}

console.log('Market Context V1 Test\n');

const riskOn = MarketContextV1.analyze(buildBtcCandles('up'), { timeframe: '15' });
const riskOff = MarketContextV1.analyze(buildBtcCandles('down'), { timeframe: '15' });
const highVol = MarketContextV1.analyze(buildBtcCandles('volatile'), { timeframe: '15' });
const unknown = MarketContextV1.analyze(buildBtcCandles('up', 40), { timeframe: '15' });
const attached = MarketContextV1.attach({ pair: 'TESTUSDT', direction: 'LONG' }, riskOn);

const checks = [
  { name: 'Accelerating BTC trend is RISK_ON', pass: riskOn.state === 'RISK_ON' },
  { name: 'Accelerating BTC decline is RISK_OFF', pass: riskOff.state === 'RISK_OFF' },
  { name: 'Abnormal BTC ATR is HIGH_VOL', pass: highVol.state === 'HIGH_VOL' },
  { name: 'Insufficient confirmed candles are UNKNOWN', pass: unknown.state === 'UNKNOWN' },
  {
    name: 'Aligned LONG is tagged ALLOW without changing the candidate action',
    pass: attached.marketContext.decision === 'ALLOW' && attached.pair === 'TESTUSDT',
  },
  {
    name: 'Counter-trend direction is tagged BLOCK for research',
    pass: MarketContextV1.assess(riskOn, 'SHORT').decision === 'BLOCK',
  },
  {
    name: 'High volatility is tagged BLOCK for research',
    pass: MarketContextV1.assess(highVol, 'LONG').decision === 'BLOCK',
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
