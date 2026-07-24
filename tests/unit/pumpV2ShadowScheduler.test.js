process.env.PAPER_SIGNAL_TRACKING_ENABLED = 'true';
process.env.PUMP_V2_SHADOW_ENABLED = 'true';
process.env.PUMP_V2_SHADOW_MAX_PER_CYCLE = '2';

const Scheduler = require('../../src/engine/scheduler');

console.log('Pump V2 Shadow Scheduler Test\n');

const reports = ['AUSDT', 'BUSDT', 'CUSDT'].map((pair, index) => ({
  pair,
  shadowV2: {
    pair,
    action: 'SHADOW_TRADE',
    state: 'ENTRY_READY',
    strategy: 'PUMP_STATE_V2_1_SHADOW',
    entryMode: 'IGNITION_BREAKOUT_RETEST_RECLAIM',
    direction: 'LONG',
    score: 90 - index,
    entryPrice: 100,
    stopLoss: 97,
    takeProfit: 105.4,
    slPercent: 3,
    tpPercent: 5.4,
    riskReward: 1.8,
    rsi: 65,
    ignitionVolumeRatio: 3,
    atrPercent: 1,
    marketSource: 'OKX_SWAP_FALLBACK',
    timeframe: '15',
    summary: 'test state sequence',
    marketContext: {
      version: 'market_context_v1',
      state: index === 0 ? 'RISK_OFF' : index === 1 ? 'RISK_ON' : 'NEUTRAL',
      decision: index === 0 ? 'BLOCK' : index === 1 ? 'ALLOW' : 'CAUTION',
    },
  },
}));

const tracked = [];
let telegramMessages = 0;
let activeFilter = null;
const scheduler = new Scheduler(
  {
    _trackPaperSignal: async (userId, signal, source) => {
      tracked.push({ userId, signal, source });
      return { id: `${userId}-${signal.pair}` };
    },
    _sendPlain: async () => { telegramMessages += 1; },
  },
  {
    getActivePaperSignals: async (_userId, filters) => {
      activeFilter = filters;
      return [];
    },
  },
  {}
);

scheduler._recordPumpV2Shadow([{ telegram_id: '42' }], reports)
  .then(() => {
    const checks = [
      { name: 'Shadow cycle respects max two records', pass: tracked.length === 2 },
      {
        name: 'BTC BLOCK is removed before the cycle limit is applied',
        pass: tracked.map((item) => item.signal.pair).join(',') === 'BUSDT,CUSDT',
      },
      {
        name: 'Records use the isolated Pump V2 source',
        pass: tracked.every((item) => item.source === 'PUMP_V2_SHADOW'),
      },
      {
        name: 'Active lookup is isolated by Pump V2 project and experiment',
        pass: activeFilter?.project === 'PUMP_V2_SHADOW' &&
          activeFilter?.experimentId === 'PUMP_V2_ATR13_20260725',
      },
      { name: 'Shadow recording sends no Telegram messages', pass: telegramMessages === 0 },
      {
        name: 'New rows start a clean ATR 1.3 experiment',
        pass: tracked.every((item) => (
          item.signal.experimentId === 'PUMP_V2_ATR13_20260725'
        )),
      },
      {
        name: 'Market context research tag reaches paper metadata',
        pass: tracked.map(
          (item) => item.signal.signalMetadata?.marketContext?.decision
        ).join(',') === 'ALLOW,CAUTION',
      },
    ];

    checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
    const allPassed = checks.every((check) => check.pass);
    console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
