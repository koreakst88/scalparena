// tests/unit/scheduler.test.js

const Scheduler = require('../../src/engine/scheduler');

console.log('🧪 Scheduler Test\n');

const mockBot = { _send: async () => {} };
const mockDb = {
  client: {
    from: () => ({
      select: () => ({
        eq: () => ({ data: [], error: null }),
      }),
    }),
  },
  getTradesSince: async () => [],
  getOpenPositions: async () => [],
  getClosedTradesExitedSince: async () => [],
  snapshotBalanceAt8am: async () => {},
};
const mockProvider = { getPairs: () => [], getCandles: () => [], hasEnoughData: () => false };

const scheduler = new Scheduler(mockBot, mockDb, mockProvider);

console.log('1️⃣  24/7 crypto auto-scan check');
scheduler._autoScan()
  .then(() => {
    console.log(`   ✅ Auto-scan executed at: ${scheduler.lastScanTime.toISOString()}`);

    console.log('\n2️⃣  Daily reset timer');
    const msUntilReset = scheduler._getMsUntilNext8am();
    const hoursUntil = (msUntilReset / 1000 / 60 / 60).toFixed(1);
    console.log(`   ⏰ Next reset in: ${hoursUntil} hours`);
    console.log('   ✅ Timer calculated correctly');

    console.log('\n3️⃣  Status check');
    const status = scheduler.getStatus();
    console.log(`   Crypto market open: ${status.cryptoMarketOpen}`);
    console.log(`   Last scan: ${status.lastScan || 'not yet'}`);

    console.log('\n🎯 Final checks:');
    const checks = [
      { name: 'Scheduler создан без ошибок', pass: scheduler instanceof Scheduler },
      { name: 'Auto-scan не блокируется временем', pass: scheduler.lastScanTime instanceof Date },
      { name: 'Crypto market open всегда true', pass: status.cryptoMarketOpen === true },
      { name: 'msUntilReset > 0', pass: msUntilReset > 0 },
      { name: 'msUntilReset < 24h', pass: msUntilReset < 24 * 60 * 60 * 1000 },
      { name: 'getStatus() возвращает объект', pass: typeof status === 'object' },
      { name: '_getToday8am() возвращает дату', pass: scheduler._getToday8am() instanceof Date },
    ];

    checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

    const allPassed = checks.every((check) => check.pass);
    console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Scheduler test error:', error);
    process.exit(1);
  });
