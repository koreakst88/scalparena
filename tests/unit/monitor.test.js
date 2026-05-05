// tests/unit/monitor.test.js

const PositionMonitor = require('../../src/engine/positionMonitor');
const { TIMEOUT_HARD } = require('../../src/config/riskManagement');

console.log('🧪 Position Monitor Test\n');

const mockBot = { bot: { sendMessage: async () => {} } };
const mockDb = {
  client: {
    from: () => ({
      select: () => ({
        eq: () => ({ data: [], error: null }),
      }),
    }),
  },
};
const mockProvider = {
  getCurrentCandle: () => ({ close: 83.5 }),
  getCandles: () => Array(20).fill({ close: 83.5 }),
};

const monitor = new PositionMonitor(mockBot, mockDb, mockProvider);

console.log('1️⃣  Alert deduplication test');
monitor._markAlerted('trade-1', 'TP');
monitor._markAlerted('trade-1', 'SL');

const checks = [
  { name: 'TP alert зарегистрирован', pass: monitor._alreadyAlerted('trade-1', 'TP') },
  { name: 'SL alert зарегистрирован', pass: monitor._alreadyAlerted('trade-1', 'SL') },
  { name: 'RSI alert НЕ зарегистрирован', pass: !monitor._alreadyAlerted('trade-1', 'RSI') },
  { name: 'Другая сделка не имеет алертов', pass: !monitor._alreadyAlerted('trade-2', 'TP') },
  { name: 'Monitor создан без ошибок', pass: monitor instanceof PositionMonitor },
];

console.log('\n2️⃣  Direction-aware TP/SL test');

async function runDirectionChecks() {
  const alerts = [];
  const closeUpdates = [];
  const balanceUpdates = [];
  const directionMonitor = new PositionMonitor(
    { bot: { sendMessage: async (_userId, text) => alerts.push(text) } },
    {
      closePosition: async (id, payload) => closeUpdates.push({ id, payload }),
      updateBalance: async (userId, pnl) => balanceUpdates.push({ userId, pnl }),
    },
    mockProvider
  );

  const basePosition = {
    id: 'base',
    user_id: 'user-1',
    pair: 'SOLUSDT',
    entry_price: 100,
    entry_size: 10,
    leverage: 10,
    entry_time: new Date(Date.now() - 5 * 60000).toISOString(),
  };

  await directionMonitor._checkTPHit(
    { ...basePosition, id: 'short-tp', trade_type: 'SHORT', take_profit: 99 },
    98.9,
    1.1,
    'SHORT'
  );
  await directionMonitor._checkSLHit(
    { ...basePosition, id: 'short-sl', trade_type: 'SHORT', stop_loss: 101 },
    101.1,
    -1.1,
    'SHORT'
  );
  await directionMonitor._checkTPHit(
    { ...basePosition, id: 'long-tp', trade_type: 'LONG', take_profit: 101 },
    101.1,
    1.1,
    'LONG'
  );
  await directionMonitor._checkSLHit(
    { ...basePosition, id: 'long-sl', trade_type: 'LONG', stop_loss: 99 },
    98.9,
    -1.1,
    'LONG'
  );

  const timeoutUpdates = [];
  const timeoutMonitor = new PositionMonitor(
    { bot: { sendMessage: async (_userId, text) => alerts.push(text) } },
    {
      closePosition: async (id, payload) => timeoutUpdates.push({ id, payload }),
      updateBalance: async () => {},
    },
    mockProvider
  );

  await timeoutMonitor._checkTimeout(
    {
      ...basePosition,
      id: 'hard-timeout',
      trade_type: 'LONG',
      entry_size: 10,
    },
    60,
    -0.5,
    99.5
  );

  return [
    { name: 'SHORT TP срабатывает ниже take_profit', pass: directionMonitor._alreadyAlerted('short-tp', 'TP') },
    { name: 'SHORT SL срабатывает выше stop_loss', pass: directionMonitor._alreadyAlerted('short-sl', 'SL') },
    { name: 'LONG TP срабатывает выше take_profit', pass: directionMonitor._alreadyAlerted('long-tp', 'TP') },
    { name: 'LONG SL срабатывает ниже stop_loss', pass: directionMonitor._alreadyAlerted('long-sl', 'SL') },
    {
      name: 'TP/SL автоматически закрывают сделки в БД',
      pass: closeUpdates.length === 4 &&
        closeUpdates.filter((entry) => entry.payload.exit_reason === 'TP_HIT').length === 2 &&
        closeUpdates.filter((entry) => entry.payload.exit_reason === 'STOP_HIT').length === 2,
    },
    { name: 'TP/SL обновляют баланс', pass: balanceUpdates.length === 4 },
    { name: 'Hard timeout = 60 минут', pass: TIMEOUT_HARD === 60 },
    {
      name: 'Hard timeout закрывает позицию на 60 минуте',
      pass: timeoutMonitor._alreadyAlerted('hard-timeout', 'TIMEOUT_HARD_60') &&
        timeoutUpdates[0]?.payload?.exit_reason === 'TIMEOUT_HARD',
    },
    { name: 'Отправлено 5 alert-сообщений', pass: alerts.length === 5 },
  ];
}

runDirectionChecks().then((directionChecks) => {
  const allChecks = [...checks, ...directionChecks];
  allChecks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

  const allPassed = allChecks.every((check) => check.pass);
  console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
  process.exit(allPassed ? 0 : 1);
});
