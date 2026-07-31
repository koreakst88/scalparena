const PaperSignalTracker = require('../../src/engine/paperSignalTracker');

console.log('Structure Paper Tracker Source Test\n');

const now = Date.now();
let gateCalls = 0;
let websocketCalls = 0;
const gateCandles = [{
  timestamp: now - 60000,
  high: 102,
  low: 100,
  close: 101.5,
  confirm: true,
}];
const tracker = new PaperSignalTracker(
  { _sendPlain: async () => {} },
  {},
  {
    getGateFuturesKlines: async () => {
      gateCalls += 1;
      return gateCandles;
    },
    getCurrentCandle: () => {
      websocketCalls += 1;
      return { close: 999 };
    },
    getCandles: () => [],
  }
);
const signal = {
  project: 'STRUCTURE',
  strategy: 'STRUCTURE_BREAKOUT_RETEST_V1_SHADOW',
  source: 'STRUCTURE_RETEST_SHADOW',
  market_source: 'GATE',
  pair: 'TESTUSDT',
  direction: 'LONG',
  timeframe: '15',
  created_at: new Date(now - 5 * 60000).toISOString(),
  expires_at: new Date(now + 60 * 60000).toISOString(),
};

(async () => {
  const path = await tracker._getPricePath('TESTUSDT', signal, new Date(now));
  const price = await tracker._getCurrentPrice('TESTUSDT', signal);
  const checks = [
    {
      name: 'Structure candle path is read from Gate futures',
      pass: path.length === 1 && gateCalls >= 1,
    },
    {
      name: 'Structure current price prefers Gate over Bybit websocket cache',
      pass: price === 101.5 && websocketCalls === 0,
    },
    {
      name: 'Structure shadow outcomes remain silent',
      pass: tracker._isSilentShadowSignal(signal),
    },
  ];
  checks.forEach((check) => {
    console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`);
  });
  const allPassed = checks.every((check) => check.pass);
  console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
  process.exit(allPassed ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
