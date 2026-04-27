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
      const currentPrice = candles[candles.length - 1].close;
      const rsi = TechnicalIndicators.calculateRSI(prices, 14);
      const volume = TechnicalIndicators.calculateVolumeProfile(candles, 20);
      const bb = TechnicalIndicators.calculateBollingerBands(prices, 20, 2);
      const bbRange = bb.upper - bb.lower;
      const bbPosition = bbRange > 0 ? ((currentPrice - bb.lower) / bbRange) * 100 : 0;
      const bbWidth = bb.middle ? ((bb.upper - bb.lower) / bb.middle) * 100 : 0;

      console.log(
        `   📊 ${pair}: RSI=${rsi.toFixed(0)} | BB=${bbPosition.toFixed(0)}% | width=${bbWidth.toFixed(1)}% | vol=${volume.toFixed(0)}%`
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
      console.log(`  RSI:        ${signal.rsi}`);
      console.log(`  MACD:       ${signal.macdBias} (${signal.macdHistogram})`);
      console.log(`  BB Position:${signal.bbPosition}%`);
      console.log(`  BB Width:   ${signal.bbWidth}%`);
      console.log(`  Regime:     ${signal.marketRegime}`);
      console.log(`  Strategy:   ${signal.strategy}`);
      console.log(`  ROC12:      ${signal.roc12}%`);
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
      name: 'SignalDetector.scanAll() работает',
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
          signal.confidence !== undefined &&
          ['MEAN_REVERSION', 'MOMENTUM'].includes(signal.strategy)
      ),
    },
    {
      name: 'LONG: SL ниже entry, TP выше',
      pass: signals
        .filter((signal) => signal.type === 'LONG')
        .every(
          (signal) => signal.stopLoss < signal.entryPrice && signal.takeProfit > signal.entryPrice
        ),
    },
    {
      name: 'SHORT: SL выше entry, TP ниже',
      pass: signals
        .filter((signal) => signal.type === 'SHORT')
        .every(
          (signal) => signal.stopLoss > signal.entryPrice && signal.takeProfit < signal.entryPrice
        ),
    },
    {
      name: 'Hybrid strategy поля присутствуют',
      pass: signals.every(
        (signal) =>
          signal.bbPosition !== undefined &&
          signal.bbWidth !== undefined &&
          signal.slPercent !== undefined &&
          signal.macdBias !== undefined &&
          signal.marketRegime !== undefined &&
          signal.strategy !== undefined &&
          signal.setupReason !== undefined &&
          signal.invalidationRule !== undefined
      ),
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
