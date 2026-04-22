require('dotenv').config();
const { BybitDataProvider } = require('../../src/data/bybitProvider');
const TechnicalIndicators = require('../../src/engine/indicators');

console.log('🧪 Bybit Provider Test (with REST backfill + 1m WS)\n');

async function runTest() {
  const provider = new BybitDataProvider();

  // STEP 1: Validate pairs
  await provider.validatePairs();

  // STEP 2: Backfill 50 candles via REST (1H)
  await provider.backfillAll('60');

  // STEP 3: Check buffer after backfill
  console.log('📊 Buffer status after backfill:');
  provider.getPairs().forEach((pair) => {
    const count = provider.getCandles(pair, 100).length;
    const icon = count >= 30 ? '✅' : '⚠️ ';
    console.log(`   ${icon} ${pair}: ${count} candles`);
  });

  // STEP 4: Run indicators on buffered data
  console.log('\n📈 Indicator check on buffered data:');
  const testPairs = ['SOLUSDT', 'DOGEUSDT', 'BTCUSDT'];
  testPairs.forEach((pair) => {
    const candles = provider.getCandles(pair, 50);
    if (candles.length >= 20) {
      const indicators = TechnicalIndicators.calculateAll(candles);
      console.log(`\n   ${pair}:`);
      console.log(`     Price:   ${candles[candles.length - 1].close}`);
      console.log(`     ATR:     ${indicators.atr.toFixed(4)}`);
      console.log(`     RSI:     ${indicators.rsi.toFixed(2)}`);
      console.log(`     Volume:  ${indicators.volume.toFixed(1)}%`);
      console.log(`     Momentum:${indicators.momentum.toFixed(2)}%`);
    } else {
      console.log(`   ⚠️  ${pair}: not enough data (${candles.length} candles)`);
    }
  });

  // STEP 5: Connect WS (1m candles for smoke test)
  console.log('\n🔌 Connecting WebSocket (1m candles, 30 sec smoke test)...\n');

  let updatesReceived = 0;

  provider.onCandleUpdate((pair, candle) => {
    updatesReceived++;
    if (updatesReceived <= 5) {
      console.log(`   📡 [WS] ${pair}: close=${candle.close} | confirm=${candle.confirm}`);
    }
    if (updatesReceived === 5) {
      console.log('   ... (дальнейшие обновления скрыты)');
    }
  });

  process.env.NODE_ENV = 'development';
  provider.connect();

  await new Promise((resolve) => setTimeout(resolve, 30000));

  // Финальный статус
  console.log('\n📊 Final status:');
  const finalStatus = provider.getStatus();
  console.log(`   Connected:       ${finalStatus.connected}`);
  console.log(`   Valid pairs:     ${finalStatus.pairs_valid}`);
  console.log(`   Pairs with data: ${finalStatus.pairs_with_data}`);
  console.log(`   WS updates got:  ${updatesReceived}`);

  // Критерии успеха
  console.log('\n🎯 Success criteria:');
  const checks = [
    { name: 'Valid pairs >= 10', pass: finalStatus.pairs_valid >= 10 },
    { name: 'Pairs with data >= 10', pass: finalStatus.pairs_with_data >= 10 },
    { name: 'WS updates received > 0', pass: updatesReceived > 0 },
    { name: 'SOL has 30+ candles', pass: provider.getCandles('SOLUSDT').length >= 30 },
  ];

  checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

  const allPassed = checks.every((check) => check.pass);
  console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);

  provider.disconnect();
  process.exit(allPassed ? 0 : 1);
}

runTest().catch((err) => {
  console.error('❌ Test error:', err);
  process.exit(1);
});
