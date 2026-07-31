const StructureWideRadar = require('../../src/engine/structureWideRadar');
const StructureWideFormatter = require('../../src/analytics/structureWideFormatter');

function buildCandles(intervalMinutes, count = 200) {
  const intervalMs = intervalMinutes * 60 * 1000;
  const start = Date.now() - count * intervalMs;

  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index * Math.PI / 6) * 5;
    return {
      timestamp: start + index * intervalMs,
      open: close - 0.1,
      high: close + 0.7,
      low: close - 0.7,
      close: index === count - 1 ? 105.2 : close,
      volume: 1000,
      confirm: true,
    };
  });
}

const candleCalls = [];
const provider = {
  getGateSpotSymbols: async () => [
    'TESTUSDT',
    'LIMITUSDT',
    'THINUSDT',
  ],
  getGateFuturesTickers: async () => [
    {
      symbol: 'TESTUSDT',
      lastPrice: 105.2,
      turnover24h: 50000000,
      bidPrice: 105.19,
      askPrice: 105.2,
      priceChange24hPercent: 1,
    },
    {
      symbol: 'LIMITUSDT',
      lastPrice: 10,
      turnover24h: 10000000,
      bidPrice: 9.99,
      askPrice: 10,
      priceChange24hPercent: 0,
    },
    {
      symbol: 'THINUSDT',
      lastPrice: 1,
      turnover24h: 100000,
      bidPrice: 0.99,
      askPrice: 1,
      priceChange24hPercent: 2,
    },
  ],
  getGateFuturesKlines: async (pair, interval) => {
    candleCalls.push([pair, interval]);
    return buildCandles(Number(interval));
  },
};

console.log('Structure Wide Radar Test\n');

StructureWideRadar.scan(provider, {
  scanLimit: 1,
  concurrency: 1,
  minTurnoverUsd: 5000000,
  maxSpreadPercent: 0.3,
  maxZoneDistancePercent: 3,
  candidateScore: 65,
})
  .then((scan) => {
    scan.diagnosticSaved = true;
    const diagnostic = StructureWideRadar.toDiagnostic(scan);
    const message = StructureWideFormatter.format(scan);
    const candidate = scan.candidates[0];
    const checks = [
      {
        name: 'Radar sees the full universe before liquidity filtering',
        pass: scan.scannedPairs === 3 &&
          scan.marketScope === 'GATE_FUTURES_SPOT_INTERSECTION' &&
          scan.liquidPairs === 2 &&
          scan.rejectionCounts.LOW_TURNOVER === 1,
      },
      {
        name: 'Deep analysis respects its bounded scan limit',
        pass: scan.deepScanSelected === 1 &&
          candleCalls.length === 3 &&
          candleCalls.every(([pair]) => pair === 'TESTUSDT') &&
          scan.rejectionCounts.DEEP_SCAN_LIMIT === 1,
      },
      {
        name: 'Level Engine candidate is ranked near a confirmed zone',
        pass: scan.analyzedPairs === 1 &&
          scan.candidateCount === 1 &&
          candidate.pair === 'TESTUSDT' &&
          candidate.location === 'RESISTANCE' &&
          candidate.zoneDistancePercent <= 1 &&
          candidate.score >= 65,
      },
      {
        name: 'Radar requires compression or very close zone-edge proximity',
        pass: candidate.compression.state === 'COMPRESSED' ||
          (
            candidate.location !== 'INSIDE_ZONE' &&
            candidate.zoneDistancePercent <= 0.5
          ),
      },
      {
        name: 'Diagnostic payload is isolated from trading projects',
        pass: diagnostic.project === 'STRUCTURE' &&
          diagnostic.strategy === 'STRUCTURE_WIDE_RADAR_V1' &&
          diagnostic.market_context.signalsGenerated === 0 &&
          diagnostic.market_context.eventsCreated === 0 &&
          diagnostic.market_context.paperSignalsCreated === 0 &&
          diagnostic.market_context.alertsSent === 0,
      },
      {
        name: 'Telegram report clearly remains diagnostic-only',
        pass: message.includes('STRUCTURE WIDE RADAR · DIAGNOSTIC') &&
          message.includes('Диагностический снимок сохранён: YES') &&
          message.includes('Research lifecycle: OFF') &&
          message.includes('Paper: 0 | Alerts: OFF | Live: OFF'),
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
