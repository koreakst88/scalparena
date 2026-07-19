// tests/unit/pumpHunterEngine.test.js

const PumpHunterEngine = require('../../src/engine/pumpHunterEngine');
const PumpHunterFormatter = require('../../src/analytics/pumpHunterFormatter');

function buildCandles({ start = 1, end = 1.32, low = 1, high = 1.33, recentVolume = 7000, baseVolume = 1000 } = {}) {
  const candles = [];

  for (let i = 0; i < 36; i += 1) {
    const progress = i / 35;
    const close = start + (end - start) * progress;
    const isRecent = i >= 32;
    candles.push({
      timestamp: i,
      open: close * 0.995,
      high: Math.max(close * 1.01, i === 35 ? high : close),
      low: Math.min(close * 0.99, i === 0 ? low : close),
      close,
      volume: isRecent ? recentVolume : baseVolume,
      turnover: close * (isRecent ? recentVolume : baseVolume),
    });
  }

  return candles;
}

function buildBtcCandles() {
  return Array.from({ length: 60 }, (_, index) => {
    const close = 60000 * (1 + (index ** 2) * 0.00005);
    return {
      timestamp: index * 15 * 60000,
      open: close * 0.9998,
      high: close * 1.001,
      low: close * 0.999,
      close,
      volume: 1000 + index,
      confirm: true,
    };
  });
}

console.log('🧪 Pump Hunter Engine Test\n');

const strongTicker = {
  symbol: 'RAVEUSDT',
  price24hPcnt: '0.34',
  turnover24h: '5000000',
};
const weakTicker = {
  symbol: 'SLOWUSDT',
  price24hPcnt: '0.02',
  turnover24h: '200000',
};
const extendedTicker = {
  symbol: 'LATEUSDT',
  price24hPcnt: '1.4',
  turnover24h: '8000000',
};
const btcTicker = {
  symbol: 'BTCUSDT',
  price24hPcnt: '0.03',
  turnover24h: '1000000000',
};

const strong = PumpHunterEngine.analyzeSymbol('RAVEUSDT', strongTicker, buildCandles());
const weak = PumpHunterEngine.analyzeSymbol('SLOWUSDT', weakTicker, buildCandles({
  end: 1.05,
  high: 1.06,
  recentVolume: 900,
  baseVolume: 1000,
}));
const extended = PumpHunterEngine.analyzeSymbol('LATEUSDT', extendedTicker, buildCandles({
  end: 1.9,
  high: 1.95,
  recentVolume: 8000,
  baseVolume: 1000,
}));
const paperSignal = PumpHunterEngine.toPaperSignal(strong);
const emptyMessage = PumpHunterFormatter.formatTop([], []);

const fallbackReportsPromise = PumpHunterEngine.scan({
  getLinearTickers: async () => [],
  getBinanceFuturesTickers: async () => [strongTicker, btcTicker],
  getBinanceFuturesKlines: async (symbol) => symbol === 'BTCUSDT' ? buildBtcCandles() : buildCandles(),
}, {
  scanLimit: 3,
  fallbackMarket: 'binance',
});
const okxFallbackReportsPromise = PumpHunterEngine.scan({
  getLinearTickers: async () => [],
  getBinanceFuturesTickers: async () => [],
  getOkxSwapTickers: async () => [strongTicker, btcTicker],
  getOkxSwapKlines: async (symbol) => symbol === 'BTCUSDT' ? buildBtcCandles() : buildCandles(),
}, {
  scanLimit: 3,
  fallbackMarket: 'binance,okx',
});

(async () => {
  const fallbackReports = await fallbackReportsPromise;
  const okxFallbackReports = await okxFallbackReportsPromise;

  const checks = [
    { name: 'Fresh pump becomes TRADE only at strict score', pass: strong.action === 'TRADE' && strong.score >= 80 },
    { name: 'Pump signal uses quick +8/-6 levels', pass: strong.tpPercent === 8 && strong.slPercent === 6 },
    { name: 'Pump signal keeps +20 moon target as analytics level', pass: strong.moonTpPercent === 20 && strong.moonTakeProfit > strong.takeProfit },
    { name: 'Weak move is not actionable', pass: weak.action !== 'TRADE' },
    { name: 'Too extended pump is not actionable', pass: extended.action !== 'TRADE' },
    { name: 'Paper signal shape is PUMP_HUNTER', pass: paperSignal.strategy === 'PUMP_HUNTER' && paperSignal.type === 'LONG' },
    { name: 'Paper signal keeps dynamic exit context', pass: paperSignal.tp1 > paperSignal.entryPrice && paperSignal.exitProfile },
    { name: 'Actionable filter keeps only strong pump', pass: PumpHunterEngine.getActionable([strong, weak, extended]).length === 1 },
    { name: 'Empty scan shows data unavailable', pass: emptyMessage.includes('Данные Bybit не получены') && !emptyMessage.includes('Проверено: 0') },
    { name: 'Binance fallback is used when Bybit tickers are unavailable', pass: fallbackReports[0]?.marketSource === 'BINANCE_FUTURES_FALLBACK' },
    { name: 'OKX fallback is used when Bybit and Binance are unavailable', pass: okxFallbackReports[0]?.marketSource === 'OKX_SWAP_FALLBACK' },
    { name: 'Legacy scan attaches V2 state without changing V1 action', pass: fallbackReports[0]?.shadowV2?.strategy === 'PUMP_STATE_V2_SHADOW' },
    {
      name: 'Pump V2 report carries BTC context without changing V1 action',
      pass: fallbackReports[0]?.shadowV2?.marketContext?.state === 'RISK_ON' &&
        fallbackReports[0]?.action === strong.action,
    },
  ];

  console.log('🎯 Final checks:');
  checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

  const allPassed = checks.every((check) => check.pass);
  console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
  process.exit(allPassed ? 0 : 1);
})();
