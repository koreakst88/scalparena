const PumpStateMachineV2 = require('../../src/engine/pumpStateMachineV2');

function buildSequence(stage = 'entry') {
  const candles = [];
  const start = Date.UTC(2026, 6, 19);

  for (let index = 0; index < 60; index += 1) {
    const close = 1 + Math.sin(index * 1.1) * 0.009 + index * 0.00005;
    const open = close - Math.sin(index * 0.7) * 0.002;
    candles.push({
      timestamp: start + index * 15 * 60000,
      open,
      high: Math.max(open, close) + 0.004,
      low: Math.min(open, close) - 0.004,
      close,
      volume: 1000 + index % 5 * 30,
      confirm: true,
    });
  }

  const level = Math.max(...candles.slice(-24).map((candle) => candle.high));
  candles.push({
    timestamp: start + 60 * 15 * 60000,
    open: level - 0.008,
    high: level + 0.035,
    low: level - 0.012,
    close: level + 0.03,
    volume: 3400,
    confirm: true,
  });
  if (stage === 'breakout') return candles;

  candles.push({
    timestamp: start + 61 * 15 * 60000,
    open: level + 0.028,
    high: level + 0.032,
    low: level + 0.001,
    close: level + 0.008,
    volume: 1400,
    confirm: true,
  });
  if (stage === 'retest') return candles;

  candles.push({
    timestamp: start + 62 * 15 * 60000,
    open: level + 0.01,
    high: level + 0.036,
    low: level + 0.006,
    close: level + 0.033,
    volume: 1900,
    confirm: true,
  });
  return candles;
}

console.log('Pump State Machine V2 Shadow Test\n');

const ticker = {
  symbol: 'STATEUSDT',
  turnover24h: '12000000',
  price24hPcnt: '0.12',
};
const options = { marketSource: 'OKX_SWAP_FALLBACK', timeframe: '15' };
const breakout = PumpStateMachineV2.analyzeSymbol('STATEUSDT', ticker, buildSequence('breakout'), options);
const retest = PumpStateMachineV2.analyzeSymbol('STATEUSDT', ticker, buildSequence('retest'), options);
const entry = PumpStateMachineV2.analyzeSymbol('STATEUSDT', ticker, buildSequence('entry'), options);
entry.marketContext = { version: 'market_context_v1', state: 'RISK_ON', decision: 'ALLOW' };
const paperSignal = PumpStateMachineV2.toPaperSignal(entry);
const strongReclaimCandles = buildSequence('entry');
strongReclaimCandles[strongReclaimCandles.length - 1].volume = 2600;
const strongReclaim = PumpStateMachineV2.analyzeSymbol(
  'RECLAIMUSDT',
  ticker,
  strongReclaimCandles,
  options
);
const unconfirmed = PumpStateMachineV2.analyzeSymbol(
  'OPENUSDT',
  ticker,
  buildSequence('entry').map((candle) => ({ ...candle, confirm: false })),
  options
);

const checks = [
  {
    name: 'Ignition breakout waits for a retest',
    pass: breakout.state === 'BREAKOUT_CONFIRMED' && breakout.action === 'NO_TRADE',
  },
  {
    name: 'Low-volume retest waits for a reclaim',
    pass: retest.state === 'RETEST_HELD' && retest.action === 'NO_TRADE',
  },
  {
    name: 'Only the full sequence reaches ENTRY_READY',
    pass: entry.state === 'ENTRY_READY' && entry.action === 'SHADOW_TRADE',
  },
  {
    name: 'State-machine entry uses structural dynamic exits and RR 1.8',
    pass: entry.slPercent >= 2 && entry.slPercent <= 6 &&
      entry.tpPercent > entry.slPercent && entry.riskReward === 1.8,
  },
  {
    name: 'Paper signal preserves state transitions and market source',
    pass: paperSignal?.strategy === 'PUMP_STATE_V2_SHADOW' &&
      paperSignal?.signalMetadata?.state === 'ENTRY_READY' &&
      paperSignal?.marketSource === 'OKX_SWAP_FALLBACK',
  },
  {
    name: 'Paper signal preserves Market Context research tag',
    pass: paperSignal?.signalMetadata?.marketContext?.decision === 'ALLOW',
  },
  {
    name: 'A strong reclaim is not mistaken for a brand-new ignition',
    pass: strongReclaim.state === 'ENTRY_READY',
  },
  {
    name: 'Open candles cannot advance the state machine',
    pass: unconfirmed.state === 'SCANNING' && unconfirmed.reason === 'NOT_ENOUGH_CONFIRMED_CANDLES',
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
