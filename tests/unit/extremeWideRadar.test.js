const ExtremeWideRadar = require('../../src/engine/extremeWideRadar');
const ExtremeWideFormatter = require('../../src/analytics/extremeWideFormatter');

const tickers = [
  {
    symbol: 'DEXEUSDT',
    lastPrice: 4.4,
    high24h: 6.44,
    low24h: 2.5,
    priceChange24hPercent: 73.6,
    turnover24h: 143000000,
    fundingRate: -0.00467,
    openInterestUsd: 3100000,
    bidPrice: 4.39,
    askPrice: 4.40,
    marketSource: 'GATE',
  },
  {
    symbol: 'BTCUSDT',
    lastPrice: 64000,
    high24h: 64500,
    low24h: 63700,
    priceChange24hPercent: 0.4,
    turnover24h: 900000000,
    fundingRate: 0.0001,
    openInterestUsd: 100000000,
    bidPrice: 63999,
    askPrice: 64000,
    marketSource: 'GATE',
  },
  {
    symbol: 'THINUSDT',
    lastPrice: 1,
    high24h: 1.2,
    low24h: 0.8,
    priceChange24hPercent: 10,
    turnover24h: 100000,
    fundingRate: -0.001,
    openInterestUsd: 50000,
    bidPrice: 0.99,
    askPrice: 1.01,
    marketSource: 'GATE',
  },
];

const provider = {
  getGateFuturesTickers: async () => tickers,
  getOkxSwapTickers: async () => {
    throw new Error('OKX fallback should not run when Gate is available');
  },
};

ExtremeWideRadar.scan(provider, {
  minTurnoverUsd: 5000000,
  anomalyScore: 45,
})
  .then((scan) => {
    scan.diagnosticSaved = true;
    const diagnostic = ExtremeWideRadar.toDiagnostic(scan);
    const formatted = ExtremeWideFormatter.format(scan);
    const dexe = scan.reports.find((report) => report.pair === 'DEXEUSDT');
    const checks = [
      {
        name: 'Wide scan covers all provider contracts before liquidity filtering',
        pass: scan.scannedPairs === 3 && scan.eligiblePairs === 2,
      },
      {
        name: 'Low turnover contracts are rejected without becoming events',
        pass: scan.rejectionCounts.LOW_TURNOVER === 1 &&
          scan.eventsCreated === 0 &&
          scan.signalsGenerated === 0,
      },
      {
        name: 'DEXE-like dislocation ranks as short squeeze pressure',
        pass: dexe.score >= 80 &&
          dexe.anomalyType === 'SHORT_SQUEEZE_PRESSURE' &&
          scan.anomalies[0].pair === 'DEXEUSDT',
      },
      {
        name: 'Diagnostic payload is isolated from paper and event tables',
        pass: diagnostic.project === 'EXTREME' &&
          diagnostic.strategy === 'EXTREME_WIDE_RADAR_V1' &&
          diagnostic.market_context.eventsCreated === 0 &&
          diagnostic.market_context.signalsGenerated === 0,
      },
      {
        name: 'Diagnostic examples preserve the observed market price',
        pass: diagnostic.examples.find((example) => example.pair === 'DEXEUSDT')
          ?.lastPrice === 4.4,
      },
      {
        name: 'Telegram output states that manual scan creates no states, signals or alerts',
        pass: formatted.includes('Ручной scan не создаёт WATCH/ARMED события') &&
          formatted.includes('Extreme events: 0') &&
          formatted.includes('Paper-сигналы: 0') &&
          formatted.includes('Telegram-алерты: OFF'),
      },
    ];

    checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
    const allPassed = checks.every((check) => check.pass);
    console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
