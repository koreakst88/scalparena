// tests/unit/monitor.test.js

const PositionMonitor = require('../../src/engine/positionMonitor');

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

checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
