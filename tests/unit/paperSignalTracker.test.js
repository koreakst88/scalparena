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

const pathStart = Date.now() - 5 * 60 * 1000;
const pathSignal = {
  ...longSignal,
  created_at: new Date(pathStart).toISOString(),
  timeframe: '1',
};
const tpCandle = {
  timestamp: pathStart + 60 * 1000,
  high: 101.2,
  low: 99.4,
  close: 100.8,
};
const ambiguousCandle = {
  timestamp: pathStart + 2 * 60 * 1000,
  high: 101.2,
  low: 98.8,
  close: 100,
};

let pathSourceUsed = null;
let persistedOutcome = null;
const sourceTracker = new PaperSignalTracker(
  { _sendPlain: async () => {} },
  {},
  {
    getCurrentCandle: () => null,
    getCandles: () => [],
    getOkxSwapKlines: async () => {
      pathSourceUsed = 'OKX';
      return [tpCandle];
    },
  }
);
const persistenceTracker = new PaperSignalTracker(
  { _sendPlain: async () => {} },
  {
    updatePaperSignal: async (_id, updates) => {
      persistedOutcome = updates;
    },
  },
  {
    getCurrentCandle: () => ({ close: 105 }),
    getCandles: () => [tpCandle],
  }
);
let shadowAlerts = 0;
const shadowTracker = new PaperSignalTracker(
  { _sendPlain: async () => { shadowAlerts += 1; } },
  {
    updatePaperSignal: async () => {},
  },
  {
    getCurrentCandle: () => ({ close: 105 }),
    getCandles: () => [tpCandle],
  }
);

Promise.resolve()
  .then(async () => {
    const pumpPrice = await pumpTracker._getCurrentPrice('MEUSDT', pumpSignal);
    const tpPath = tracker._resolveCandlePath(pathSignal, [tpCandle, ambiguousCandle], 'LONG');
    const ambiguousPath = tracker._resolveCandlePath(pathSignal, [ambiguousCandle], 'LONG');
    const okxPath = await sourceTracker._getPricePath('TESTUSDT', {
      ...pathSignal,
      strategy: 'PUMP_HUNTER',
      source: 'PUMP_AUTO',
      market_source: 'OKX_SWAP_FALLBACK',
      timeframe: '15',
    });
    await persistenceTracker._checkSignal({
      ...pathSignal,
      id: 'signal-1',
      user_id: '42',
      pair: 'TESTUSDT',
      strategy: 'BREAKOUT',
    });
    await shadowTracker._checkSignal({
      ...pathSignal,
      id: 'shadow-1',
      user_id: '42',
      pair: 'TESTUSDT',
      project: 'CANDIDATE_V2_SHADOW',
      strategy: 'BREAKOUT_V2_SHADOW',
      source: 'CANDIDATE_V2_SHADOW',
    });

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
  {
    name: 'Candle high resolves LONG TP at the configured TP price',
    pass: tpPath.outcome?.status === 'TP_HIT' && tpPath.outcome.hitPrice === 101,
  },
  {
    name: 'Candle path stops at the first resolved candle',
    pass: tpPath.outcome?.candle?.timestamp === tpCandle.timestamp,
  },
  {
    name: 'One candle crossing TP and SL is conservatively ambiguous SL',
    pass: ambiguousPath.outcome?.status === 'SL_HIT' &&
      ambiguousPath.outcome.ambiguous === true &&
      ambiguousPath.outcome.hitPrice === 99,
  },
  {
    name: 'Candle extremes use high and low instead of close only',
    pass: tpPath.extremes.max_favorable_price === 101.2 &&
      tpPath.extremes.max_adverse_price === 99.4,
  },
  {
    name: 'Hourly timeframe is converted to minutes',
    pass: tracker._intervalMinutes('1H') === 60,
  },
  {
    name: 'Pump candle path follows the recorded market source',
    pass: pathSourceUsed === 'OKX' && okxPath.length === 1,
  },
  {
    name: 'Tracker persists candle-path method and exact TP hit price',
    pass: persistedOutcome?.status === 'TP_HIT' &&
      persistedOutcome?.hit_price === 101 &&
      persistedOutcome?.resolution_method === 'CANDLE_PATH' &&
      persistedOutcome?.resolved_candle_high === 101.2 &&
      persistedOutcome?.max_favorable_price === 101.2,
  },
  {
    name: 'Shadow outcomes are tracked without Telegram alerts',
    pass: shadowAlerts === 0,
  },
  {
    name: 'Pump V2 is recognized as source-aware and silent',
    pass: tracker._isPumpHunterSignal({ project: 'PUMP_V2_SHADOW' }) &&
      tracker._isSilentShadowSignal({ source: 'PUMP_V2_SHADOW' }),
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
