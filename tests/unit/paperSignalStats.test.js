// tests/unit/paperSignalStats.test.js

const PaperSignalStats = require('../../src/analytics/paperSignalStats');

console.log('🧪 Paper Signal Stats Test\n');

const signals = [
  {
    pair: 'SOLUSDT',
    strategy: 'TREND_PULLBACK',
    status: 'TP_HIT',
    time_to_result_minutes: 24,
    direction: 'LONG',
    entry_price: 100,
    take_profit: 102,
    stop_loss: 99,
    max_favorable_price: 102,
    max_adverse_price: 99.5,
  },
  {
    pair: 'SOLUSDT',
    strategy: 'TREND_PULLBACK',
    status: 'SL_HIT',
    time_to_result_minutes: 18,
    direction: 'LONG',
    entry_price: 100,
    take_profit: 102,
    stop_loss: 99,
    max_favorable_price: 100.8,
    max_adverse_price: 99,
  },
  {
    pair: 'BTCUSDT',
    strategy: 'MEAN_REVERSION',
    status: 'WATCHING',
  },
  {
    pair: 'ETHUSDT',
    strategy: 'MEAN_REVERSION',
    status: 'TIMEOUT',
    time_to_result_minutes: 90,
  },
  {
    pair: 'HUSDT',
    strategy: 'PUMP_HUNTER',
    source: 'PUMP_AUTO',
    direction: 'LONG',
    status: 'WATCHING',
    entry_price: 0.07,
    take_profit: 0.084,
    stop_loss: 0.0595,
    max_favorable_price: 0.075,
    max_adverse_price: 0.068,
    created_at: '2026-06-30T10:00:00Z',
  },
  {
    pair: 'KGENUSDT',
    strategy: 'BREAKOUT',
    source: 'CANDIDATE_ENGINE',
    direction: 'LONG',
    status: 'WATCHING',
    entry_price: 0.22,
    take_profit: 0.24,
    stop_loss: 0.21,
    created_at: '2026-06-30T09:00:00Z',
  },
];

const stats = PaperSignalStats.calculate(signals);
const message = PaperSignalStats.format(stats, 'последние 7 дн.');
const pumpSignals = PaperSignalStats.filterByProject(signals, 'pump');
const candidateSignals = PaperSignalStats.filterByProject(signals, 'candidates');
const watchingMessage = PaperSignalStats.formatWatching(pumpSignals, 'последние 7 дн. | PumpHunter');
const detailMessage = PaperSignalStats.formatDetail(candidateSignals, 'последние 7 дн. | Candidate Engine');
const edgeMessage = PaperSignalStats.formatEdge(pumpSignals, 'последние 7 дн. | PumpHunter', { balance: 200 });
const experimentSignals = [
  { pair: 'CURRENT', experiment_id: 'SCALPARENA_V2_20260719', is_legacy: false },
  { pair: 'OLD', experiment_id: 'LEGACY_PRE_20260719', is_legacy: true },
];
const currentSignals = PaperSignalStats.filterByExperiment(
  experimentSignals,
  'current',
  'SCALPARENA_V2_20260719'
);
const legacySignals = PaperSignalStats.filterByExperiment(experimentSignals, 'legacy');
const historySignals = PaperSignalStats.filterByExperiment(experimentSignals, 'history');

console.log(message);

const checks = [
  { name: 'total = 6', pass: stats.total === 6 },
  { name: 'watching = 3', pass: stats.watching === 3 },
  { name: 'tp = 1', pass: stats.tp === 1 },
  { name: 'sl = 1', pass: stats.sl === 1 },
  { name: 'timeout = 1', pass: stats.timeout === 1 },
  { name: 'winRate = 50%', pass: stats.winRate === 50 },
  { name: 'avgTimeToResult = 44', pass: stats.avgTimeToResult === 44 },
  { name: 'message includes PAPER SIGNALS', pass: message.includes('PAPER SIGNALS') },
  { name: 'message shows watching count per row', pass: message.includes('W:1') },
  { name: 'message hints open signal commands', pass: message.includes('/signals open pump') },
  { name: 'strategy grouping exists', pass: stats.byStrategy[0].total === 2 },
  { name: 'pump filter keeps only PumpHunter', pass: pumpSignals.length === 1 && pumpSignals[0].pair === 'HUSDT' },
  { name: 'candidate filter keeps Candidate Engine source', pass: candidateSignals.length === 1 && candidateSignals[0].pair === 'KGENUSDT' },
  { name: 'watching message lists active pump signal', pass: watchingMessage.includes('HUSDT') && watchingMessage.includes('PUMP_AUTO') },
  { name: 'detail message includes MFE/MAE diagnostics', pass: detailMessage.includes('PAPER DETAIL') && detailMessage.includes('Avg MFE') },
  { name: 'edge message includes MFE thresholds', pass: edgeMessage.includes('PAPER EDGE') && edgeMessage.includes('>=5% MFE') && edgeMessage.includes('MFE пороги') },
  { name: 'edge message includes money model', pass: edgeMessage.includes('margin $10') && edgeMessage.includes('leverage 10x') && edgeMessage.includes('net $') },
  { name: 'current experiment excludes legacy rows', pass: currentSignals.length === 1 && currentSignals[0].pair === 'CURRENT' },
  { name: 'legacy scope excludes current rows', pass: legacySignals.length === 1 && legacySignals[0].pair === 'OLD' },
  { name: 'history scope keeps both cohorts', pass: historySignals.length === 2 },
];

console.log('\n🎯 Final checks:');
checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
