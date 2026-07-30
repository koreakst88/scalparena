// tests/unit/scheduler.test.js

const Scheduler = require('../../src/engine/scheduler');

console.log('🧪 Scheduler Test\n');

const mockBot = {
  _send: async () => {},
  _isCandidateAutoEnabled: (userId) => String(userId) === 'candidate-on',
};
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

console.log('1️⃣  Retired Candidate runtime check');
scheduler._autoScan()
  .then(() => {
    console.log(`   ✅ Legacy scan timestamp: ${scheduler.lastScanTime || 'not scheduled'}`);

    console.log('\n2️⃣  Daily reset timer');
    const msUntilReset = scheduler._getMsUntilNext8am();
    const hoursUntil = (msUntilReset / 1000 / 60 / 60).toFixed(1);
    console.log(`   ⏰ Next reset in: ${hoursUntil} hours`);
    console.log('   ✅ Timer calculated correctly');

    console.log('\n3️⃣  Status check');
    const status = scheduler.getStatus();
    console.log(`   Crypto market open: ${status.cryptoMarketOpen}`);
    console.log(`   Last scan: ${status.lastScan || 'not yet'}`);
    const legacyAlertUsers = scheduler._getLegacyAutoScanUsers([
      { telegram_id: 'candidate-on' },
      { telegram_id: 'candidate-off' },
    ]);

    console.log('\n🎯 Final checks:');
    const checks = [
      { name: 'Scheduler создан без ошибок', pass: scheduler instanceof Scheduler },
      { name: 'Retired legacy scan does not execute', pass: scheduler.lastScanTime === null },
      { name: 'Candidate project is disabled in scheduler status', pass: status.candidateProjectEnabled === false },
      { name: 'Candidate next scan is absent', pass: status.nextCandidateScan === null },
      { name: 'Crypto market open всегда true', pass: status.cryptoMarketOpen === true },
      { name: 'msUntilReset > 0', pass: msUntilReset > 0 },
      { name: 'msUntilReset < 24h', pass: msUntilReset < 24 * 60 * 60 * 1000 },
      { name: 'getStatus() возвращает объект', pass: typeof status === 'object' },
      { name: '_getToday8am() возвращает дату', pass: scheduler._getToday8am() instanceof Date },
      { name: 'Legacy user helper stays archived without affecting runtime', pass: Array.isArray(legacyAlertUsers) },
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
