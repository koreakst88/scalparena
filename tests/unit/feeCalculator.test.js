// tests/unit/feeCalculator.test.js

const FeeCalculator = require('../../src/engine/feeCalculator');

console.log('🧪 Fee Calculator Test\n');

const longResult = FeeCalculator.calculatePnL({
  entryPrice: 100,
  exitPrice: 101,
  margin: 10,
  leverage: 10,
  direction: 'LONG',
});

const shortResult = FeeCalculator.calculatePnL({
  entryPrice: 100,
  exitPrice: 99,
  margin: 10,
  leverage: 10,
  direction: 'SHORT',
});

console.log('1️⃣  LONG example');
console.log(`   Gross: $${longResult.grossPnl}`);
console.log(`   Fees:  $${longResult.totalFees}`);
console.log(`   Net:   $${longResult.netPnl}`);

console.log('\n2️⃣  SHORT example');
console.log(`   Gross: $${shortResult.grossPnl}`);
console.log(`   Fees:  $${shortResult.totalFees}`);
console.log(`   Net:   $${shortResult.netPnl}`);

console.log('\n🎯 Checks:');

const checks = [
  { name: 'Fee rate = 0.055%', pass: FeeCalculator.getFeeRate() === 0.00055 },
  { name: 'Round-trip fee = 0.11%', pass: FeeCalculator.getRoundTripFee() === 0.0011 },
  { name: 'LONG notional = $100', pass: longResult.entryNotional === 100 },
  { name: 'LONG qty = 1', pass: Math.abs(longResult.qty - 1) < 0.000001 },
  { name: 'LONG gross P&L = $1', pass: Math.abs(longResult.grossPnl - 1) < 0.000001 },
  { name: 'LONG entry fee = $0.055', pass: Math.abs(longResult.entryFee - 0.055) < 0.000001 },
  { name: 'LONG exit fee = $0.05555', pass: Math.abs(longResult.exitFee - 0.05555) < 0.000001 },
  { name: 'LONG net P&L = $0.88945', pass: Math.abs(longResult.netPnl - 0.88945) < 0.000001 },
  { name: 'SHORT gross P&L = $1', pass: Math.abs(shortResult.grossPnl - 1) < 0.000001 },
  { name: 'SHORT net P&L = $0.89055', pass: Math.abs(shortResult.netPnl - 0.89055) < 0.000001 },
  { name: 'Max loss includes round-trip fees', pass: FeeCalculator.calculateMaxLoss(100, 0.008) === 0.91 },
  { name: 'Expected profit includes round-trip fees', pass: FeeCalculator.calculateExpectedProfit(100, 0.008) === 0.69 },
];

checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
