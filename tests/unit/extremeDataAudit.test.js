const ExtremeDataAudit = require('../../src/engine/extremeDataAudit');
const ExtremeAuditFormatter = require('../../src/analytics/extremeAuditFormatter');

function probe(capability, available, source, records = 1, error = null) {
  return {
    capability,
    available,
    source,
    records,
    latencyMs: 25,
    error,
  };
}

const provider = {
  auditBybitExtremeData: async () => ({
    ticker: probe('ticker', true, 'BYBIT_PROXY'),
    candles: probe('candles', true, 'BYBIT_PROXY', 3),
    funding: probe('funding', false, null, 0, '403'),
    openInterest: probe('openInterest', false, null, 0, '403'),
    orderbook: probe('orderbook', true, 'BYBIT_PROXY', 50),
    liquidations: probe('liquidations', true, 'BYBIT_WS', 0),
  }),
  auditOkxExtremeData: async () => ({
    ticker: probe('ticker', true, 'OKX'),
    candles: probe('candles', true, 'OKX', 3),
    funding: probe('funding', true, 'OKX', 3),
    openInterest: probe('openInterest', true, 'OKX'),
    orderbook: probe('orderbook', true, 'OKX', 50),
    liquidations: probe('liquidations', true, 'OKX', 0),
  }),
  auditGateExtremeData: async () => ({
    ticker: probe('ticker', true, 'GATE'),
    candles: probe('candles', true, 'GATE', 3),
    funding: probe('funding', true, 'GATE'),
    openInterest: probe('openInterest', true, 'GATE'),
    orderbook: probe('orderbook', true, 'GATE', 50),
    liquidations: probe('liquidations', true, 'GATE', 20),
  }),
};

Promise.resolve()
  .then(() => ExtremeDataAudit.run(provider, 'dexe/usdt'))
  .then((report) => {
    const formatted = ExtremeAuditFormatter.format(report);
    const checks = [
      {
        name: 'Pair is normalized',
        pass: report.pair === 'DEXEUSDT',
      },
      {
        name: 'A complete venue is preferred over mixing partial Bybit data',
        pass: report.primaryVenue === 'OKX' &&
          report.effective.ticker.source === 'OKX' &&
          report.effective.orderbook.source === 'OKX',
      },
      {
        name: 'Funding and OI stay on the selected primary venue',
        pass: report.effective.funding.source === 'OKX' &&
          report.effective.openInterest.source === 'OKX',
      },
      {
        name: 'A complete primary venue reports source integrity',
        pass: report.singleVenueComplete && report.mixedVenues === false,
      },
      {
        name: 'Empty liquidation event list does not mean unavailable feed',
        pass: report.effective.liquidations.available &&
          report.effective.liquidations.records === 0,
      },
      {
        name: 'Research readiness does not enable signals',
        pass: report.readyForResearch && report.signalsEnabled === false,
      },
      {
        name: 'Telegram report explicitly keeps all trading actions off',
        pass: formatted.includes('Сигналы: OFF') &&
          formatted.includes('Автосканирование: OFF') &&
          formatted.includes('Paper-записи: OFF') &&
          formatted.includes('Gate fallback: 6/6'),
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
