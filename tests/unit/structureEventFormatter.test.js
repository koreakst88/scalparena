const StructureEventFormatter = require('../../src/analytics/structureEventFormatter');

console.log('Structure Event Formatter Test\n');

const message = StructureEventFormatter.format([{
  pair: 'BTCUSDT',
  state: 'TRIGGERED',
  scenario: 'ZONE_COMPRESSION',
  zone_lower: 64000,
  zone_upper: 65000,
  zone_score: 90,
  reference_price: 64500,
  metrics: {
    last_price: 65150,
    observation_count: 3,
    trigger_outcome: 'ZONE_EXIT_UP_CONFIRMED',
  },
}]);

const checks = [
  {
    name: 'Event report exposes state, original zone and observations',
    pass: message.includes('BTCUSDT | TRIGGERED') &&
      message.includes('$64000.00–$65000.00') &&
      message.includes('наблюдений 3'),
  },
  {
    name: 'Triggered direction is translated for the user',
    pass: message.includes('выход из зоны вверх подтверждён'),
  },
  {
    name: 'Event report explicitly remains outside paper and live trading',
    pass: message.includes('не сигналы на вход') &&
      message.includes('Paper: OFF | Alerts: OFF | Live: OFF'),
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
