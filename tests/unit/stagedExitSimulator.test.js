const StagedExitSimulator = require('../../src/analytics/stagedExitSimulator');

console.log('Staged Exit Simulator Test\n');

const start = Date.now() - 60 * 60 * 1000;
const signal = {
  direction: 'LONG',
  entry_price: 100,
  stop_loss: 96,
  take_profit: 106,
  timeframe: '15',
};
const candle = (minutes, high, low, close = 100) => ({
  timestamp: start + minutes * 60 * 1000,
  high,
  low,
  close,
});

const breakeven = StagedExitSimulator.simulate(signal, [
  candle(15, 102.4, 100.2, 102),
  candle(30, 101.5, 99.8, 100),
]);
const finalTarget = StagedExitSimulator.simulate(signal, [
  candle(15, 102.4, 100.2, 102),
  candle(30, 106.2, 101, 105.8),
]);
const ambiguous = StagedExitSimulator.simulate(signal, [
  candle(15, 102.4, 95.8, 100),
]);
const timeout = StagedExitSimulator.simulate(signal, [
  candle(15, 101, 99, 100.5),
], { timedOut: true });
const snapshot = StagedExitSimulator.simulate(signal, [
  candle(15, 102.4, 100.2, 102),
], {
  currentPrice: 106,
  currentTimestamp: start + 30 * 60 * 1000,
});
const shortBreakeven = StagedExitSimulator.simulate({
  ...signal,
  direction: 'SHORT',
  stop_loss: 104,
  take_profit: 94,
}, [
  candle(15, 99.8, 97.5, 98),
  candle(30, 100.2, 98.5, 100),
]);

const checks = [
  {
    name: 'TP1 +2% closes half and the next candle can close the rest at breakeven',
    pass: breakeven.profiles.TP1_2_BE.status === 'BE_HIT' &&
      breakeven.profiles.TP1_2_BE.legs[0].fraction === 0.5 &&
      breakeven.profiles.TP1_2_BE.legs[0].price === 102 &&
      breakeven.profiles.TP1_2_BE.legs[1].price === 100,
  },
  {
    name: 'Final target keeps the TP1 partial and closes the remainder',
    pass: finalTarget.profiles.TP1_2_BE.status === 'TARGET_HIT' &&
      finalTarget.profiles.TP1_2_BE.legs[1].price === 106,
  },
  {
    name: 'A candle crossing the initial stop and TP1 is conservatively a full stop',
    pass: ambiguous.profiles.TP1_2_BE.status === 'SL_HIT' &&
      ambiguous.profiles.TP1_2_BE.ambiguous === true &&
      ambiguous.profiles.TP1_2_BE.tp1Hit === false,
  },
  {
    name: 'Timeout closes the whole unscaled position at the final candle close',
    pass: timeout.profiles.TP1_2_BE.status === 'TIMEOUT' &&
      timeout.profiles.TP1_2_BE.legs[0].price === 100.5 &&
      timeout.profiles.TP1_2_BE.legs[0].fraction === 1,
  },
  {
    name: 'Snapshot can complete a profile after the ordered candle path',
    pass: snapshot.pathMethod === 'CANDLE_PATH_WITH_SNAPSHOT' &&
      snapshot.profiles.TP1_2_BE.status === 'TARGET_HIT',
  },
  {
    name: 'The same staged logic supports SHORT direction',
    pass: shortBreakeven.profiles.TP1_2_BE.status === 'BE_HIT' &&
      shortBreakeven.profiles.TP1_2_BE.legs[0].price === 98 &&
      shortBreakeven.profiles.TP1_2_BE.legs[1].price === 100,
  },
  {
    name: 'TP1 +3% remains a separate comparison profile',
    pass: breakeven.profiles.TP1_3_BE.status === 'WATCHING' &&
      breakeven.profiles.TP1_3_BE.tp1Percent === 3,
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
