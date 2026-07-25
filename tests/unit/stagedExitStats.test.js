const PaperSignalStats = require('../../src/analytics/paperSignalStats');

console.log('Staged Exit Stats Test\n');

function profile(status, tp1Hit, legs, ambiguous = false) {
  return {
    status,
    tp1Hit,
    ambiguous,
    legs,
  };
}

function signal(pair, profiles) {
  return {
    pair,
    direction: 'LONG',
    entry_price: 100,
    signal_metadata: {
      stagedExitSimulation: {
        version: 'staged_exit_v1',
        profiles,
      },
    },
  };
}

const signals = [
  signal('TARGETUSDT', {
    TP1_2_BE: profile('TARGET_HIT', true, [
      { fraction: 0.5, price: 102 },
      { fraction: 0.5, price: 106 },
    ]),
    TP1_3_BE: profile('TARGET_HIT', true, [
      { fraction: 0.5, price: 103 },
      { fraction: 0.5, price: 106 },
    ]),
  }),
  signal('BEUSDT', {
    TP1_2_BE: profile('BE_HIT', true, [
      { fraction: 0.5, price: 102 },
      { fraction: 0.5, price: 100 },
    ]),
    TP1_3_BE: profile('SL_HIT', false, [
      { fraction: 1, price: 96 },
    ]),
  }),
  signal('WATCHUSDT', {
    TP1_2_BE: profile('WATCHING', true, [
      { fraction: 0.5, price: 102 },
    ]),
    TP1_3_BE: profile('WATCHING', false, []),
  }),
];

const report = PaperSignalStats.formatStagedExitStudy(
  signals,
  'последние 30 дн. | Pump V2.1',
  { balance: 200, slippageBps: 5 }
);
const summary2 = PaperSignalStats._summarizeStagedProfile(
  signals,
  { key: 'TP1_2_BE', tp1Percent: 2 },
  PaperSignalStats._buildMoneyModel(signals, { balance: 200 }),
  { slippageBps: 5 }
);

const checks = [
  {
    name: 'Report clearly says the simulation does not change active exits',
    pass: report.includes('Research-only: действующие TP/SL не изменены.'),
  },
  {
    name: 'Report compares both TP1 profiles',
    pass: report.includes('TP1 +2%') && report.includes('TP1 +3%'),
  },
  {
    name: 'Summary separates target, breakeven and watching outcomes',
    pass: summary2.measured === 3 &&
      summary2.resolved === 2 &&
      summary2.watching === 1 &&
      summary2.target === 1 &&
      summary2.be === 1,
  },
  {
    name: 'Money model includes partial exits, fees and slippage',
    pass: summary2.money.netPnl > 0 &&
      summary2.money.totalFees > 0 &&
      report.includes('slippage 5 bps'),
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
