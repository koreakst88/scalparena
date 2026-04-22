require('dotenv').config();
const { BybitDataProvider } = require('../../src/data/bybitProvider');
const SignalDetector = require('../../src/engine/signalDetector');

console.log('🧪 Signal Detection Test\n');

async function runTest() {
  const provider = new BybitDataProvider();

  // Загрузить реальные данные
  console.log('📥 Loading data...');
  await provider.validatePairs();
  await provider.backfillAll('60');

  console.log('\n🔍 Scanning all pairs for signals...\n');

  // Сканировать все пары
  const signals = SignalDetector.scanAll(provider);

  if (signals.length === 0) {
    console.log('📭 No signals found (спокойный рынок — это нормально)');
    console.log('\n📊 Individual pair analysis:');

    // Показать почему каждая пара не дала сигнал
    provider.getPairs().forEach((pair) => {
      const candles = provider.getCandles(pair, 50);
      if (candles.length < 30) {
        console.log(`   ⚠️  ${pair}: недостаточно данных (${candles.length})`);
        return;
      }

      const TechnicalIndicators = require('../../src/engine/indicators');
      const prices = candles.map((candle) => candle.close);
      const current = candles[candles.length - 1];
      const impulse = ((current.close - current.open) / current.open) * 100;
      const rsi = TechnicalIndicators.calculateRSI(prices, 14);
      const volume = TechnicalIndicators.calculateVolumeProfile(candles, 20);
      const retrace = ((current.high - current.close) / current.high) * 100;

      console.log(
        `   📊 ${pair}: impulse=${impulse.toFixed(1)}% | RSI=${rsi.toFixed(0)} | vol=${volume.toFixed(0)}% | retrace=${retrace.toFixed(1)}%`
      );
    });
  } else {
    console.log(`🎯 Found ${signals.length} signal(s)!\n`);

    signals.forEach((signal, index) => {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`SIGNAL #${index + 1}: ${signal.pair} ${signal.type}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  Entry:      $${signal.entryPrice}`);
      console.log(`  Stop Loss:  $${signal.stopLoss}`);
      console.log(`  Take Profit:$${signal.takeProfit}`);
      console.log(`  Impulse:    ${signal.impulse}%`);
      console.log(`  Retrace:    ${signal.retrace}%`);
      console.log(`  RSI:        ${signal.rsi}`);
      console.log(`  Volume:     ${signal.volume}%`);
      console.log(`  Confidence: ${signal.confidence}%`);
      console.log(`  Expires:    ${signal.expiresAt.toLocaleTimeString()}`);
      console.log();
    });
  }

  // Финальные проверки
  console.log('\n🎯 Test checks:');
  const checks = [
    {
      name: 'SignalDetector.scanAll() не упал с ошибкой',
      pass: Array.isArray(signals),
    },
    {
      name: 'Все сигналы содержат обязательные поля',
      pass: signals.every(
        (signal) =>
          signal.pair &&
          signal.entryPrice &&
          signal.stopLoss &&
          signal.takeProfit &&
          signal.confidence !== undefined
      ),
    },
    {
      name: 'SL всегда выше entry (для SHORT)',
      pass: signals.every((signal) => signal.stopLoss > signal.entryPrice),
    },
    {
      name: 'TP всегда ниже entry (для SHORT)',
      pass: signals.every((signal) => signal.takeProfit < signal.entryPrice),
    },
    {
      name: 'Confidence в диапазоне 0-100',
      pass: signals.every((signal) => signal.confidence >= 0 && signal.confidence <= 100),
    },
  ];

  checks.forEach((check) => {
    console.log(`  ${check.pass ? '✅' : '❌'} ${check.name}`);
  });

  const allPassed = checks.every((check) => check.pass);
  console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);

  process.exit(allPassed ? 0 : 1);
}

runTest().catch((err) => {
  console.error('❌ Test error:', err);
  process.exit(1);
});
