const ScalpArenaBot = require('../../src/bot/bot');
const Scheduler = require('../../src/engine/scheduler');

console.log('Candidate Retirement Test\n');

const bot = Object.create(ScalpArenaBot.prototype);
bot.candidateAutoOverrides = new Map([['42', true]]);
bot.bot = {
  answerCallbackQuery: async () => {},
};

let candidateScanCalled = false;
let retirementNotice = '';

bot._sendCandidates = async () => {
  candidateScanCalled = true;
};
bot._sendMainMenu = async (_userId, notice = '') => {
  retirementNotice = notice;
};

const scheduler = new Scheduler(
  bot,
  {
    client: {
      from: () => {
        throw new Error('Candidate scheduler must not query the database');
      },
    },
  },
  {}
);

Promise.resolve()
  .then(() => bot._onCallback({
    id: 'callback-1',
    data: 'candidates_refresh',
    message: { chat: { id: '42' }, message_id: 1 },
  }))
  .then(() => scheduler._candidateAutoScan())
  .then(() => {
    const checks = [
      {
        name: 'Runtime override cannot reactivate retired Candidate',
        pass: bot._isCandidateAutoEnabled('42') === false,
      },
      {
        name: 'Old Candidate button does not run a market scan',
        pass: candidateScanCalled === false,
      },
      {
        name: 'Old Candidate button explains that the project is closed',
        pass: retirementNotice.includes('закрытому Candidate'),
      },
      {
        name: 'Candidate scheduler exits before database access',
        pass: scheduler.lastCandidateScanTime === null,
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
