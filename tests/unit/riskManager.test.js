const RiskManager = require('../../src/engine/riskManager');

console.log('🧪 Risk Manager Test\n');

// ─────────────────────────────────────────
// TEST 1: Position Calculator
// ─────────────────────────────────────────
console.log('1️⃣  Position Calculator\n');

const scenarios = [
  { balance: 200, entry: 83.5, atr: 1.5, label: 'SOL  | $200 баланс | ATR 1.5%' },
  { balance: 200, entry: 0.09172, atr: 2.1, label: 'DOGE | $200 баланс | ATR 2.1%' },
  { balance: 200, entry: 45200, atr: 1.2, label: 'BTC  | $200 баланс | ATR 1.2%' },
  { balance: 500, entry: 83.5, atr: 3.5, label: 'SOL  | $500 баланс | ATR 3.5%' },
  { balance: 1000, entry: 83.5, atr: 6.0, label: 'SOL  | $1000 баланс| ATR 6.0%' },
];

scenarios.forEach((scenario) => {
  const position = RiskManager.calculatePosition(
    scenario.balance,
    scenario.entry,
    scenario.atr
  );
  console.log(`   ${scenario.label}`);
  console.log(
    `     Margin: $${position.margin} | Notional: $${position.notional} | Leverage: ${position.leverage}x`
  );
  console.log(
    `     SL: $${position.stopLoss} (+${position.slPercent}%) | TP: $${position.takeProfit} (-${position.tpPercent}%)`
  );
  console.log(
    `     Max Loss: $${position.maxLoss} | Expected Profit: $${position.expectedProfit} | RR: ${position.riskReward}`
  );
  console.log();
});

// ─────────────────────────────────────────
// TEST 2: Entry Validation
// ─────────────────────────────────────────
console.log('2️⃣  Entry Validation\n');

const validationCases = [
  {
    label: '✅ Нормальный вход (всё OK)',
    stats: { starting_balance: 200, daily_risk_used: 2 },
    newRisk: 4,
    openPositions: 1,
    expectAllowed: true,
  },
  {
    label: '❌ Максимум позиций достигнут',
    stats: { starting_balance: 200, daily_risk_used: 4 },
    newRisk: 4,
    openPositions: 2,
    expectAllowed: false,
  },
  {
    label: '❌ Дневной лимит исчерпан',
    stats: { starting_balance: 200, daily_risk_used: 10 },
    newRisk: 4,
    openPositions: 0,
    expectAllowed: false,
  },
  {
    label: '⚠️  Риск превышает остаток (можно override)',
    stats: { starting_balance: 200, daily_risk_used: 8 },
    newRisk: 4,
    openPositions: 0,
    expectAllowed: false,
  },
];

validationCases.forEach((validationCase) => {
  const result = RiskManager.validateEntry(
    validationCase.stats,
    validationCase.newRisk,
    validationCase.openPositions
  );
  const icon = result.allowed === validationCase.expectAllowed ? '✅' : '❌';
  console.log(`   ${icon} ${validationCase.label}`);
  if (result.allowed) {
    console.log(`      Remaining: $${result.remainingRisk} | Used: ${result.usedPercent}%`);
  } else {
    console.log(`      Reason: ${result.reason}`);
    if (result.canOverride) console.log('      ⚠️  Можно override');
  }
  console.log();
});

// ─────────────────────────────────────────
// TEST 3: Cool-off System
// ─────────────────────────────────────────
console.log('3️⃣  Cool-off System\n');

const cooloffCases = [
  {
    label: 'Нет убытков',
    trades: [{ profit_loss: 1.5 }, { profit_loss: 0.8 }],
    expectNeeded: false,
  },
  {
    label: '1 убыток подряд (нет cool-off)',
    trades: [{ profit_loss: -2.0 }, { profit_loss: 1.5 }],
    expectNeeded: false,
  },
  {
    label: '2 убытка подряд → 30 мин пауза',
    trades: [{ profit_loss: -2.0 }, { profit_loss: -3.0 }, { profit_loss: 1.5 }],
    expectNeeded: true,
    expectMinutes: 30,
  },
  {
    label: '3 убытка подряд → 60 мин пауза',
    trades: [{ profit_loss: -1.0 }, { profit_loss: -2.0 }, { profit_loss: -4.0 }],
    expectNeeded: true,
    expectMinutes: 60,
  },
];

cooloffCases.forEach((cooloffCase) => {
  const result = RiskManager.checkCooloff(cooloffCase.trades);
  const icon = result.needed === cooloffCase.expectNeeded ? '✅' : '❌';
  console.log(`   ${icon} ${cooloffCase.label}`);
  if (result.needed) {
    console.log(`      Пауза: ${result.minutes} мин | ${result.reason}`);
  } else {
    console.log('      Cool-off не нужен');
  }
  console.log();
});

console.log('3️⃣.b Pair Cooldown System\n');

const now = new Date('2026-04-27T10:00:00.000Z');
const pairCooldownActive = RiskManager.checkPairCooldown(
  [
    {
      pair: 'RENDERUSDT',
      status: 'CLOSED',
      profit_loss: -0.42,
      exit_time: '2026-04-27T09:10:00.000Z',
    },
  ],
  'RENDERUSDT',
  now
);
const pairCooldownExpired = RiskManager.checkPairCooldown(
  [
    {
      pair: 'RENDERUSDT',
      status: 'CLOSED',
      profit_loss: -0.42,
      exit_time: '2026-04-27T07:30:00.000Z',
    },
  ],
  'RENDERUSDT',
  now
);
const pairCooldownWin = RiskManager.checkPairCooldown(
  [
    {
      pair: 'RENDERUSDT',
      status: 'CLOSED',
      profit_loss: 0.25,
      exit_time: '2026-04-27T09:10:00.000Z',
    },
  ],
  'RENDERUSDT',
  now
);

console.log(
  `   ${pairCooldownActive.active ? '✅' : '❌'} Убыток 50 мин назад → cooldown ${pairCooldownActive.remainingMinutes} мин`
);
console.log(`   ${!pairCooldownExpired.active ? '✅' : '❌'} Убыток 150 мин назад → cooldown истёк`);
console.log(`   ${!pairCooldownWin.active ? '✅' : '❌'} Прибыльная сделка → cooldown не нужен`);
console.log();

// ─────────────────────────────────────────
// TEST 4: Daily Stats
// ─────────────────────────────────────────
console.log('4️⃣  Daily Stats Calculator\n');

const mockTrades = [
  { status: 'CLOSED', profit_loss: 0.93, max_risk: 4 },
  { status: 'CLOSED', profit_loss: -4.0, max_risk: 4 },
  { status: 'CLOSED', profit_loss: 1.1, max_risk: 4 },
  { status: 'CLOSED', profit_loss: 0.88, max_risk: 4 },
  { status: 'CLOSED', profit_loss: -2.5, max_risk: 4 },
  { status: 'OPEN', profit_loss: null, max_risk: 4 },
];

const stats = RiskManager.calcDailyStats(mockTrades, 200);
console.log(
  `   Trades: ${stats.total_trades} (${stats.winning_trades}W / ${stats.losing_trades}L)`
);
console.log(`   Win Rate: ${stats.win_rate}%`);
console.log(`   Total P&L: $${stats.total_pnl}`);
console.log(`   Avg Win: $${stats.avg_win} | Avg Loss: $${stats.avg_loss}`);
console.log(`   Profit Factor: ${stats.profit_factor}`);
console.log(`   Daily Risk: $${stats.daily_risk_used}/$${stats.daily_risk_limit}`);

// ─────────────────────────────────────────
// TEST 5: Dynamic Balance
// ─────────────────────────────────────────
console.log('\n5️⃣  Dynamic Balance Test\n');

const balanceScenarios = [
  { balance: 200, entry: 83.5, atr: 1.5, label: 'Старт $200' },
  { balance: 450, entry: 83.5, atr: 1.5, label: 'Вырос до $450' },
  { balance: 600, entry: 83.5, atr: 3.5, label: 'Вырос до $600' },
  { balance: 1200, entry: 83.5, atr: 6.0, label: 'Вырос до $1200' },
];

balanceScenarios.forEach((scenario) => {
  const position = RiskManager.calculatePosition(scenario.balance, scenario.entry, scenario.atr);
  const limit = RiskManager.getDailyLimit(scenario.balance);
  console.log(`   ${scenario.label}:`);
  console.log(
    `     Margin: $${position.margin} | Notional: $${position.notional} | Leverage: ${position.leverage}x`
  );
  console.log(
    `     Max Loss: $${position.maxLoss} | Daily: $${limit}`
  );
  console.log(`     Expected Profit: $${position.expectedProfit} | Risk/Reward: ${position.riskReward}`);
  console.log();
});

// Тест updateBalance
console.log('   Balance update flow:');
let balance = 200;
console.log(`   Start: $${balance}`);
const trades = [0.93, -4.0, 1.1];
trades.forEach((pnl) => {
  balance = RiskManager.updateBalance(balance, pnl);
  const icon = pnl > 0 ? '✅' : '❌';
  console.log(`   ${icon} After ${pnl > 0 ? '+' : ''}$${pnl}: $${balance}`);
});
console.log();

// ─────────────────────────────────────────
// ФИНАЛЬНЫЕ ПРОВЕРКИ
// ─────────────────────────────────────────
console.log('\n🎯 Final checks:\n');

const pos200 = RiskManager.calculatePosition(200, 83.5, 1.5);
const pos500 = RiskManager.calculatePosition(500, 83.5, 3.5);
const pos1k = RiskManager.calculatePosition(1000, 83.5, 6.0);
const posLowAtr = RiskManager.calculatePosition(200, 83.5, 1.5);
const posMidAtr = RiskManager.calculatePosition(200, 83.5, 3.5);

const checks = [
  { name: 'Leverage 10x при $200', pass: pos200.leverage === 10 },
  { name: 'Margin $10 при $200', pass: pos200.margin === 10 },
  { name: 'SL выше entry (SHORT)', pass: pos200.stopLoss > 83.5 },
  { name: 'TP ниже entry (SHORT)', pass: pos200.takeProfit < 83.5 },
  {
    name: 'TP = ровно -1%',
    pass: Math.abs((83.5 - pos200.takeProfit) / 83.5 - 0.01) < 0.0001,
  },
  { name: 'RR > 1.5 при низком ATR (1.5%)', pass: posLowAtr.riskReward >= 1.5 },
  { name: 'RR > 1.0 при среднем ATR (3.5%)', pass: posMidAtr.riskReward >= 1.0 },
  {
    name: 'Cool-off 2 убытка → 30 мин',
    pass: RiskManager.checkCooloff([{ profit_loss: -1 }, { profit_loss: -2 }]).minutes === 30,
  },
  {
    name: 'Cool-off 3 убытка → 60 мин',
    pass: RiskManager.checkCooloff([
      { profit_loss: -1 },
      { profit_loss: -2 },
      { profit_loss: -3 },
    ]).minutes === 60,
  },
  { name: 'Pair cooldown после убытка активен', pass: pairCooldownActive.active },
  { name: 'Pair cooldown длится 90 мин', pass: RiskManager.getPairCooldownMinutes() === 90 },
  { name: 'Pair cooldown истекает', pass: !pairCooldownExpired.active },
  { name: 'Win rate корректный', pass: stats.win_rate === 60 },
];

checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);

process.exit(allPassed ? 0 : 1);
