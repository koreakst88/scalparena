const { BybitDataProvider } = require('../../src/data/bybitProvider');

function probe(provider, capability, available, source, records = 1, error = null) {
  return provider._buildAuditProbe({
    capability,
    available,
    source,
    records,
    latencyMs: 10,
    error,
  });
}

const provider = Object.create(BybitDataProvider.prototype);
const capabilities = [
  'ticker',
  'candles',
  'funding',
  'openInterest',
  'orderbook',
  'liquidations',
];

provider._probeBybitRest = async (capability) => (
  probe(provider, capability, false, null, 0, 'simulated Railway 403')
);
provider._probeBybitExtremeStream = async () => Object.fromEntries(
  capabilities.map((capability) => [
    capability,
    probe(provider, capability, true, 'BYBIT_WS', capability === 'orderbook' ? 50 : 1),
  ])
);

provider.auditBybitExtremeData('DEXEUSDT', { timeoutMs: 100 })
  .then((result) => {
    const checks = [
      {
        name: 'WebSocket fills every capability when Bybit REST is blocked',
        pass: capabilities.every(
          (capability) => result[capability].available &&
            result[capability].source === 'BYBIT_WS'
        ),
      },
      {
        name: 'Transport diagnostics preserve REST and WebSocket readiness',
        pass: result._meta.restAvailable === 0 && result._meta.websocketAvailable === 6,
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
