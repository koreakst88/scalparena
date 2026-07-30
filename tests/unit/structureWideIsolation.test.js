const fs = require('fs');
const path = require('path');
const ScalpArenaBot = require('../../src/bot/bot');
const StructureWideRadar = require('../../src/engine/structureWideRadar');

console.log('Structure Wide Isolation Test\n');

const schedulerSource = fs.readFileSync(
  path.join(__dirname, '../../src/engine/scheduler.js'),
  'utf8'
);
const originalScan = StructureWideRadar.scan;
const savedDiagnostics = [];
const messages = [];
let forbiddenCalls = 0;

StructureWideRadar.scan = async () => ({
  project: 'STRUCTURE',
  experimentId: 'STRUCTURE_V1_WIDE_DIAGNOSTIC_20260731',
  strategy: 'STRUCTURE_WIDE_RADAR_V1',
  marketSource: 'GATE',
  marketScope: 'GATE_FUTURES_SPOT_INTERSECTION',
  spotVerificationEnabled: true,
  spotPairs: 2000,
  scannedPairs: 800,
  liquidPairs: 40,
  deepScanSelected: 24,
  analyzedPairs: 24,
  candidateCount: 1,
  settings: {
    candidateScore: 65,
    maxZoneDistancePercent: 3,
    minTurnoverUsd: 5000000,
  },
  rejectionCounts: {},
  reports: [],
  candidates: [],
  durationMs: 1000,
  signalsGenerated: 0,
  eventsCreated: 0,
  paperSignalsCreated: 0,
  alertsSent: 0,
});

const bot = Object.create(ScalpArenaBot.prototype);
bot.provider = {};
bot.db = {
  createResearchScanDiagnostic: async (payload) => {
    savedDiagnostics.push(payload);
    return payload;
  },
  createExtremeEvent: async () => { forbiddenCalls += 1; },
  createPaperSignal: async () => { forbiddenCalls += 1; },
};
bot._sendPlain = async (_userId, message) => {
  messages.push(message);
  return message;
};
bot._getCommandParts = ScalpArenaBot.prototype._getCommandParts;

bot._onStructure({
  chat: { id: 42 },
  text: '/structure scan',
})
  .then(() => {
    StructureWideRadar.scan = originalScan;
    const checks = [
      {
        name: 'Manual command saves exactly one research diagnostic',
        pass: savedDiagnostics.length === 1 &&
          savedDiagnostics[0].project === 'STRUCTURE' &&
          savedDiagnostics[0].strategy === 'STRUCTURE_WIDE_RADAR_V1',
      },
      {
        name: 'Manual command never writes events or paper signals',
        pass: forbiddenCalls === 0 &&
          savedDiagnostics[0].market_context.eventsCreated === 0 &&
          savedDiagnostics[0].market_context.paperSignalsCreated === 0,
      },
      {
        name: 'Telegram output remains explicitly diagnostic-only',
        pass: messages.some((message) => (
          message.includes('Events: 0 | Paper: 0 | Alerts: OFF | Live: OFF')
        )),
      },
      {
        name: 'Structure Radar has no automatic scheduler hook in stage 3',
        pass: !schedulerSource.includes('structureWideRadar') &&
          !schedulerSource.includes('StructureWideRadar'),
      },
    ];

    checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
    const allPassed = checks.every((check) => check.pass);
    console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error) => {
    StructureWideRadar.scan = originalScan;
    console.error(error);
    process.exit(1);
  });
