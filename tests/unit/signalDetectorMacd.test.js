// tests/unit/signalDetectorMacd.test.js

const SignalDetector = require('../../src/engine/signalDetector');

console.log('🧪 Signal Detector MACD Alignment Test\n');

const lowVol = (macdBias) => ({
  market: { regime: 'LOW_VOL_RANGE' },
  macdBias,
});

const activeRange = (macdBias) => ({
  market: { regime: 'ACTIVE_RANGE' },
  macdBias,
});

const shortAligned = SignalDetector._calculateMeanReversionConfidence(
  75,
  95,
  120,
  'SHORT',
  lowVol('BEARISH')
);
const shortAgainst = SignalDetector._calculateMeanReversionConfidence(
  75,
  95,
  120,
  'SHORT',
  lowVol('BULLISH')
);
const shortMixed = SignalDetector._calculateMeanReversionConfidence(
  75,
  95,
  120,
  'SHORT',
  lowVol('MIXED')
);
const longAligned = SignalDetector._calculateMeanReversionConfidence(
  25,
  5,
  120,
  'LONG',
  lowVol('BULLISH')
);
const longAgainst = SignalDetector._calculateMeanReversionConfidence(
  25,
  5,
  120,
  'LONG',
  lowVol('BEARISH')
);
const activeRangeShort = SignalDetector._calculateMeanReversionConfidence(
  75,
  95,
  120,
  'SHORT',
  activeRange('BEARISH')
);

console.log(`   SHORT aligned: ${shortAligned}`);
console.log(`   SHORT mixed:   ${shortMixed}`);
console.log(`   SHORT against: ${shortAgainst}`);
console.log(`   LONG aligned:  ${longAligned}`);
console.log(`   LONG against:  ${longAgainst}`);
console.log(`   Active range:  ${activeRangeShort}`);

console.log('\n🎯 Checks:');

const checks = [
  {
    name: 'LOW_VOL_RANGE SHORT получает бонус при BEARISH MACD',
    pass: shortAligned > shortMixed,
  },
  {
    name: 'LOW_VOL_RANGE SHORT получает штраф при BULLISH MACD',
    pass: shortAgainst < shortMixed,
  },
  {
    name: 'LOW_VOL_RANGE LONG получает бонус при BULLISH MACD',
    pass: longAligned > longAgainst,
  },
  {
    name: 'ACTIVE_RANGE не получает LOW_VOL MACD adjustment',
    pass: activeRangeShort === shortMixed,
  },
  {
    name: 'MACD alignment helper для SHORT корректный',
    pass: SignalDetector._isMacdAlignedWithDirection('SHORT', 'BEARISH') &&
      !SignalDetector._isMacdAlignedWithDirection('SHORT', 'BULLISH'),
  },
  {
    name: 'MACD alignment helper для LONG корректный',
    pass: SignalDetector._isMacdAlignedWithDirection('LONG', 'BULLISH') &&
      !SignalDetector._isMacdAlignedWithDirection('LONG', 'BEARISH'),
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
