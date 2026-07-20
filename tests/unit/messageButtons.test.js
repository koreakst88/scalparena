const ScalpArenaBot = require('../../src/bot/bot');

console.log('Message Buttons Test\n');

const bot = Object.create(ScalpArenaBot.prototype);
bot.candidateSnapshots = new Map();
bot.pumpSnapshots = new Map();

const candidateEmptyKeyboard = bot._getCandidateKeyboard(0).inline_keyboard.flat();
const candidateReadyKeyboard = bot._getCandidateKeyboard(2).inline_keyboard.flat();
const pumpEmptyKeyboard = bot._getPumpHunterKeyboard(0).inline_keyboard.flat();
const pumpReadyKeyboard = bot._getPumpHunterKeyboard(1).inline_keyboard.flat();
const candidateFullKeyboard = bot._getCandidateKeyboard(1, { includeDetails: false }).inline_keyboard.flat();
const pumpFullKeyboard = bot._getPumpHunterKeyboard(1, { includeDetails: false }).inline_keyboard.flat();

const candidateReport = {
  pair: 'TESTUSDT',
  best: {
    pair: 'TESTUSDT',
    action: 'NO_TRADE',
    strategy: 'BREAKOUT',
    summary: 'NO_TRADE: test snapshot',
    reasons: [],
    risks: [],
  },
  candidates: [],
};
bot.candidateSnapshots.set('42:100', {
  reports: [candidateReport],
  actionable: [],
  createdAt: Date.now(),
});

let detailsMessage = null;
let keyboardUpdate = null;
bot._sendPlainChunks = async (_userId, message) => {
  detailsMessage = message;
};
bot._sendPlain = async () => null;
bot.bot = {
  editMessageReplyMarkup: async (keyboard, options) => {
    keyboardUpdate = { keyboard, options };
  },
};

const paperCandidate = {
  pair: 'READYUSDT',
  direction: 'LONG',
  strategy: 'BREAKOUT',
  score: 80,
};
bot.candidateSnapshots.set('42:101', {
  reports: [candidateReport],
  actionable: [paperCandidate],
  createdAt: Date.now(),
});
bot._trackCandidateActionables = async () => [paperCandidate];

Promise.resolve()
  .then(() => bot._sendCandidateSnapshotDetails('42', 100))
  .then(() => bot._writeCandidateSnapshotToPaper('42', 101))
  .then(() => {
    const updatedCallbacks = keyboardUpdate.keyboard.inline_keyboard
      .flat()
      .map((button) => button.callback_data);
    const checks = [
      {
        name: 'Candidate report hides paper action when there are no entries',
        pass: !candidateEmptyKeyboard.some((button) => button.callback_data === 'candidates_paper'),
      },
      {
        name: 'Pump report hides paper action when there are no entries',
        pass: !pumpEmptyKeyboard.some((button) => button.callback_data === 'pump_paper'),
      },
      {
        name: 'Paper action remains available when entries exist',
        pass: candidateReadyKeyboard.some((button) => button.text === '🧪 Записать в paper (2)') &&
          pumpReadyKeyboard.some((button) => button.text === '🧪 Записать в paper (1)'),
      },
      {
        name: 'Buttons distinguish snapshot details, new scan and V1 statistics',
        pass: candidateEmptyKeyboard.some((button) => button.text === '📋 Подробнее') &&
          candidateEmptyKeyboard.some((button) => button.text === '🔄 Новый скан') &&
          candidateEmptyKeyboard.some((button) => button.text === '📊 Candidate V1 · 7д'),
      },
      {
        name: 'Full reports do not offer redundant snapshot details',
        pass: !candidateFullKeyboard.some((button) => button.callback_data === 'candidates_full') &&
          !pumpFullKeyboard.some((button) => button.callback_data === 'pump_full'),
      },
      {
        name: 'Snapshot details render the saved report without running a new scan',
        pass: detailsMessage?.includes('TESTUSDT') && detailsMessage?.includes('test snapshot'),
      },
      {
        name: 'Successful paper recording removes the repeat paper button',
        pass: !updatedCallbacks.includes('candidates_paper') &&
          keyboardUpdate.options.chat_id === '42' && keyboardUpdate.options.message_id === 101,
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
