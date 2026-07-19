const ScalpArenaBot = require('../../src/bot/bot');

console.log('Research Command Test\n');

const bot = Object.create(ScalpArenaBot.prototype);
let requestedSince = null;
let sentMessage = null;

bot.db = {
  getPaperSignalsSince: async (_userId, since) => {
    requestedSince = since;
    return [
      {
        pair: 'CURRENTUSDT',
        project: 'CANDIDATE_V2_SHADOW',
        status: 'TP_HIT',
        experiment_id: 'SCALPARENA_V2_20260719',
        is_legacy: false,
        created_at: '2026-07-19T00:00:00Z',
        signal_metadata: { marketContext: { decision: 'ALLOW' } },
      },
      {
        pair: 'LEGACYUSDT',
        project: 'PUMP_V2_SHADOW',
        status: 'SL_HIT',
        experiment_id: 'LEGACY_PRE_20260719',
        is_legacy: true,
        created_at: '2026-07-01T00:00:00Z',
        signal_metadata: { marketContext: { decision: 'BLOCK' } },
      },
      {
        pair: 'V1USDT',
        project: 'CANDIDATE',
        status: 'TP_HIT',
        experiment_id: 'SCALPARENA_V2_20260719',
        is_legacy: false,
        created_at: '2026-07-19T01:00:00Z',
      },
    ];
  },
};
bot._sendPlain = async (_userId, message) => {
  sentMessage = message;
};

bot._sendResearchReadiness('42')
  .then(() => {
    const checks = [
      {
        name: 'Command requests all-time rows and lets experiment filtering isolate the cohort',
        pass: requestedSince instanceof Date && requestedSince.getTime() === 0,
      },
      {
        name: 'Current Candidate V2 row enters the report',
        pass: sentMessage.includes('Candidate V2: 1/30 resolved'),
      },
      {
        name: 'Legacy and V1 rows do not pollute Pump V2 readiness',
        pass: sentMessage.includes('Pump V2: 0/30 resolved') &&
          sentMessage.includes('BLOCK 0/10'),
      },
      {
        name: 'Report identifies the active experiment',
        pass: sentMessage.includes('SCALPARENA_V2_20260719'),
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
