const ScalpArenaBot = require('../../src/bot/bot');

console.log('Candidate V3 Report Scope Test\n');

const bot = Object.create(ScalpArenaBot.prototype);
const rows = [
  {
    pair: 'OLDUSDT',
    project: 'CANDIDATE_V2_SHADOW',
    strategy: 'BREAKOUT_V2_SHADOW',
    source: 'CANDIDATE_V2_SHADOW',
    experiment_id: 'SCALPARENA_V2_20260719',
    is_legacy: false,
    status: 'SL_HIT',
    created_at: '2026-07-19T12:00:00Z',
  },
  {
    pair: 'NEWUSDT',
    project: 'CANDIDATE_V3',
    strategy: 'BREAKOUT_V3_SHADOW',
    source: 'CANDIDATE_V3',
    experiment_id: 'CANDIDATE_V3_20260720',
    is_legacy: false,
    status: 'WATCHING',
    created_at: '2026-07-20T12:00:00Z',
  },
];
const messages = [];
bot.db = {
  getPaperSignalsSince: async () => rows,
  getUser: async () => ({ account_balance: 200 }),
};
bot._sendPlain = async (_userId, message) => { messages.push(message); };
bot._sendPlainChunks = bot._sendPlain;

Promise.resolve()
  .then(() => bot._sendPaperSignalStats('42', ['candidate', '30'], { account_balance: 200 }))
  .then(() => bot._sendPaperSignalStats('42', ['candidate_v2', '30'], { account_balance: 200 }))
  .then(() => {
    const checks = [
      {
        name: 'Simple Candidate command shows only the clean V3 cohort',
        pass: messages[0].includes('Candidate V3') &&
          messages[0].includes('NEWUSDT') && !messages[0].includes('OLDUSDT'),
      },
      {
        name: 'Explicit Candidate V2 command keeps the frozen old cohort available',
        pass: messages[1].includes('Candidate Breakout V2 shadow') &&
          messages[1].includes('OLDUSDT') && !messages[1].includes('NEWUSDT'),
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
