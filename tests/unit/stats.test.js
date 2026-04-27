// tests/unit/stats.test.js

const StatsCalculator = require('../../src/analytics/stats');

console.log('🧪 Stats Calculator Test\n');

const mockTrades = [
  {
    status: 'CLOSED',
    pair: 'SOL',
    profit_loss: 0.93,
    max_risk: 4,
    exit_reason: 'TP_HIT',
    strategy: 'MEAN_REVERSION',
    market_regime: 'LOW_VOL_RANGE',
    macd_bias: 'BEARISH',
    rsi_at_entry: 28,
    bb_position: 12,
    bb_width: 2.4,
    atr_percent: 0.9,
    volume_spike_percentage: 105,
    entry_time: new Date(Date.now() - 15 * 60000),
    exit_time: new Date(),
  },
  {
    status: 'CLOSED',
    pair: 'BTC',
    profit_loss: -0.52,
    max_risk: 4,
    exit_reason: 'STOP_HIT',
    strategy: 'MEAN_REVERSION',
    market_regime: 'LOW_VOL_RANGE',
    macd_bias: 'BEARISH',
    rsi_at_entry: 31,
    bb_position: 18,
    bb_width: 2.1,
    atr_percent: 0.8,
    volume_spike_percentage: 94,
    entry_time: new Date(Date.now() - 45 * 60000),
    exit_time: new Date(),
  },
  {
    status: 'CLOSED',
    pair: 'DOGE',
    profit_loss: 1.1,
    max_risk: 4,
    exit_reason: 'TP_HIT',
    strategy: 'MEAN_REVERSION',
    market_regime: 'ACTIVE_RANGE',
    macd_bias: 'BULLISH',
    rsi_at_entry: 72,
    bb_position: 91,
    bb_width: 4.2,
    atr_percent: 1.7,
    volume_spike_percentage: 122,
    entry_time: new Date(Date.now() - 20 * 60000),
    exit_time: new Date(),
  },
  {
    status: 'CLOSED',
    pair: 'SOL',
    profit_loss: 0.88,
    max_risk: 4,
    exit_reason: 'TP_HIT',
    strategy: 'MEAN_REVERSION',
    market_regime: 'LOW_VOL_RANGE',
    macd_bias: 'BEARISH',
    rsi_at_entry: 26,
    bb_position: 9,
    bb_width: 2.7,
    atr_percent: 0.9,
    volume_spike_percentage: 118,
    entry_time: new Date(Date.now() - 10 * 60000),
    exit_time: new Date(),
  },
  {
    status: 'CLOSED',
    pair: 'XRP',
    profit_loss: -0.52,
    max_risk: 4,
    exit_reason: 'STOP_HIT',
    strategy: 'MEAN_REVERSION',
    market_regime: 'ACTIVE_RANGE',
    macd_bias: 'BULLISH',
    rsi_at_entry: 69,
    bb_position: 84,
    bb_width: 3.8,
    atr_percent: 1.5,
    volume_spike_percentage: 97,
    entry_time: new Date(Date.now() - 60 * 60000),
    exit_time: new Date(),
  },
  { status: 'OPEN', pair: 'ETH', profit_loss: null, max_risk: 4 },
];

const stats = StatsCalculator.calculate(mockTrades, 200);

console.log('📊 Stats result:');
console.log(`   Trades: ${stats.total_trades} (${stats.winning_trades}W/${stats.losing_trades}L)`);
console.log(`   Win Rate: ${stats.win_rate}%`);
console.log(`   Total P&L: $${stats.total_pnl}`);
console.log(`   Avg Hold: ${stats.avg_hold_time} мин`);
console.log(`   Best: ${stats.best_trade?.pair} +$${stats.best_trade?.pnl}`);
console.log(`   Worst: ${stats.worst_trade?.pair} $${stats.worst_trade?.pnl}`);
console.log('   Exit reasons:', stats.exit_reasons);
console.log(`   Best setup: ${stats.best_setup?.label} | P&L $${stats.best_setup?.pnl}`);
console.log(`   Worst setup: ${stats.worst_setup?.label} | P&L $${stats.worst_setup?.pnl}`);
console.log();

console.log('📨 Formatted message:');
console.log(StatsCalculator.formatMessage(stats));
console.log();

console.log('🧪 Pattern message:');
console.log(StatsCalculator.formatPatternMessage(stats, 7));

console.log('\n🎯 Checks:');
const checks = [
  { name: 'OPEN сделки не считаются', pass: stats.total_trades === 5 },
  { name: 'Win rate корректный (60%)', pass: stats.win_rate === 60 },
  { name: 'Best trade = DOGE (+1.10)', pass: stats.best_trade?.pnl === 1.1 },
  { name: 'Worst trade = BTC или XRP', pass: stats.worst_trade?.pnl === -0.52 },
  {
    name: 'Exit reasons TP=3 SL=2',
    pass: stats.exit_reasons?.TP_HIT === 3 && stats.exit_reasons?.STOP_HIT === 2,
  },
  { name: 'Avg hold time > 0', pass: stats.avg_hold_time > 0 },
  { name: 'Context coverage = 5/5', pass: stats.context_coverage?.trades_with_context === 5 },
  { name: 'Setup stats рассчитаны', pass: stats.setup_stats?.length === 2 },
  { name: 'Best regime определён', pass: stats.best_regime?.label === 'LOW_VOL_RANGE' },
  { name: 'MACD stats рассчитаны', pass: stats.macd_bias_stats?.length === 2 },
  {
    name: 'Pattern message содержит TOP сетапы',
    pass: StatsCalculator.formatPatternMessage(stats, 7).includes('ТОП СЕТАПЫ'),
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
