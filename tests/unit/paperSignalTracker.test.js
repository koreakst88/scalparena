// tests/unit/paperSignalTracker.test.js

const PaperSignalTracker = require('../../src/engine/paperSignalTracker');

console.log('🧪 Paper Signal Tracker Test\n');

const tracker = new PaperSignalTracker(
  { _sendPlain: async () => {} },
  {},
  {
    getCurrentCandle: () => ({ close: 99 }),
    getCandles: () => [],
  }
);

const pumpTracker = new PaperSignalTracker(
  { _sendPlain: async () => {} },
  {},
  {
    getCurrentCandle: () => null,
    getCandles: () => [],
    getOkxSwapPrice: async () => 125,
  }
);

const shortSignal = {
  direction: 'SHORT',
  entry_price: 100,
  take_profit: 99,
  stop_loss: 101,
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

const longSignal = {
  direction: 'LONG',
  entry_price: 100,
  take_profit: 101,
  stop_loss: 99,
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

const expiredSignal = {
  direction: 'LONG',
  entry_price: 100,
  take_profit: 120,
  stop_loss: 90,
  expires_at: new Date(Date.now() - 1000).toISOString(),
};

const pumpSignal = {
  strategy: 'PUMP_HUNTER',
  source: 'PUMP_AUTO',
  direction: 'LONG',
  entry_price: 100,
  take_profit: 120,
  stop_loss: 85,
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

Promise.resolve()
  .then(async () => {
    const pumpPrice = await pumpTracker._getCurrentPrice('MEUSDT', pumpSignal);

    const checks = [
  {
    name: 'SHORT resolves TP when price <= take_profit',
    pass: tracker._resolveOutcome(shortSignal, 99, 'SHORT', new Date())?.status === 'TP_HIT',
  },
  {
    name: 'LONG resolves SL when price <= stop_loss',
    pass: tracker._resolveOutcome(longSignal, 99, 'LONG', new Date())?.status === 'SL_HIT',
  },
  {
    name: 'Expired unresolved signal becomes TIMEOUT',
    pass: tracker._resolveOutcome(expiredSignal, 100, 'LONG', new Date())?.status === 'TIMEOUT',
  },
  {
    name: 'Expired signal can timeout without current price',
    pass: tracker._resolveTimeout(expiredSignal, new Date())?.status === 'TIMEOUT',
  },
  {
    name: 'PumpHunter can resolve price from OKX fallback',
    pass: pumpPrice === 125,
  },
  {
    name: 'SHORT favorable extreme moves downward',
    pass: tracker._calculateExtremes(shortSignal, 98, 'SHORT').max_favorable_price === 98,
  },
  {
    name: 'LONG favorable extreme moves upward',
    pass: tracker._calculateExtremes(longSignal, 102, 'LONG').max_favorable_price === 102,
  },
    ];

    console.log('🎯 Final checks:');
    checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

    const allPassed = checks.every((check) => check.pass);
    console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Paper Signal Tracker Test failed:', error);
    process.exit(1);
  });
