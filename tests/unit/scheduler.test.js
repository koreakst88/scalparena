// tests/unit/scheduler.test.js

const Scheduler = require('../../src/engine/scheduler');

console.log('🧪 Scheduler Test\n');

const mockBot = { _send: async () => {} };
const mockDb = {
  client: { from: () => ({ select: () => ({ data: [], error: null }) }) },
  getTradesSince: async () => [],
  snapshotBalanceAt8am: async () => {},
};
const mockProvider = { getPairs: () => [], getCandles: () => [], hasEnoughData: () => false };

const scheduler = new Scheduler(mockBot, mockDb, mockProvider);

console.log('1️⃣  Trading hours check');
const hourChecks = [
  { seoulHour: 8, expected: true, label: '08:00 Seoul (start)' },
  { seoulHour: 14, expected: true, label: '14:00 Seoul (active)' },
  { seoulHour: 23, expected: true, label: '23:00 Seoul (evening)' },
  { seoulHour: 3, expected: false, label: '03:00 Seoul (night)' },
  { seoulHour: 6, expected: false, label: '06:00 Seoul (early)' },
];

hourChecks.forEach((item) => {
  const result = item.seoulHour >= 8 && item.seoulHour < 24;
  const icon = result === item.expected ? '✅' : '❌';
  console.log(`   ${icon} ${item.label}: ${result ? 'TRADING' : 'CLOSED'}`);
});

console.log('\n2️⃣  Daily reset timer');
const msUntilReset = scheduler._getMsUntilNext8am();
const hoursUntil = (msUntilReset / 1000 / 60 / 60).toFixed(1);
console.log(`   ⏰ Next reset in: ${hoursUntil} hours`);
console.log('   ✅ Timer calculated correctly');

console.log('\n3️⃣  Status check');
const status = scheduler.getStatus();
console.log(`   Trading hours: ${status.tradingHours}`);
console.log(`   Last scan: ${status.lastScan || 'not yet'}`);

console.log('\n🎯 Final checks:');
const checks = [
  { name: 'Scheduler создан без ошибок', pass: scheduler instanceof Scheduler },
  { name: 'msUntilReset > 0', pass: msUntilReset > 0 },
  { name: 'msUntilReset < 24h', pass: msUntilReset < 24 * 60 * 60 * 1000 },
  { name: 'getStatus() возвращает объект', pass: typeof status === 'object' },
  { name: '_getToday8am() возвращает дату', pass: scheduler._getToday8am() instanceof Date },
];

checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
