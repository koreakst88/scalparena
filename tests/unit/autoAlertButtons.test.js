process.env.PAPER_SIGNAL_TRACKING_ENABLED = 'true';

const Scheduler = require('../../src/engine/scheduler');

console.log('Auto Alert Buttons Test\n');

const keyboards = [];
const bot = {
  _trackPaperSignal: async () => ({ id: 'paper-1' }),
  _sendPlain: async (_userId, _text, options = {}) => {
    if (options.reply_markup) keyboards.push(options.reply_markup.inline_keyboard.flat());
  },
};
const db = {
  getActivePaperSignals: async () => [],
};
const scheduler = new Scheduler(bot, db, {});

const candidate = {
  pair: 'AVAXUSDT',
  direction: 'LONG',
  strategy: 'BREAKOUT',
  score: 90,
  riskReward: 1.5,
  entryPrice: 10,
  takeProfit: 10.3,
  stopLoss: 9.8,
  summary: 'test candidate',
  context: {
    marketRegime: 'TREND_UP',
    rsi: 60,
    volume: 150,
    macdBias: 'BULLISH',
  },
};
const pump = {
  pair: 'PUMPUSDT',
  direction: 'LONG',
  strategy: 'PUMP_HUNTER',
  action: 'TRADE',
  score: 90,
  riskReward: 1,
  exitProfile: 'quick',
  entryPrice: 1,
  takeProfit: 1.03,
  stopLoss: 0.96,
  tp1: 1.02,
  tp2: 1.03,
  stretchTakeProfit: 1.08,
  moonTakeProfit: 1.2,
  tpPercent: 3,
  slPercent: 4,
  freshFromLow: 20,
  priceChange24h: 10,
  volumeBoost: 2,
  turnover24h: 10000000,
  distanceFromHigh: 1,
  marketSource: 'OKX_SWAP_FALLBACK',
  summary: 'test pump',
};

Promise.resolve()
  .then(() => scheduler._sendCandidateAlertsToUser({ telegram_id: '42' }, [candidate]))
  .then(() => scheduler._sendPumpAlertsToUser({ telegram_id: '42' }, [pump]))
  .then(() => {
    const candidateButtons = keyboards[0] || [];
    const pumpButtons = keyboards[1] || [];
    const checks = [
      {
        name: 'Candidate auto alert keeps only explicit V1 statistics',
        pass: candidateButtons.length === 1 &&
          candidateButtons[0].text === '📊 Candidate V1 · 7д' &&
          candidateButtons[0].callback_data === 'candidates_stats',
      },
      {
        name: 'Pump auto alert keeps only explicit V1 statistics',
        pass: pumpButtons.length === 1 &&
          pumpButtons[0].text === '📊 Pump V1 · 7д' &&
          pumpButtons[0].callback_data === 'pump_stats',
      },
      {
        name: 'Auto alerts no longer hide a fresh scan behind navigation labels',
        pass: ![...candidateButtons, ...pumpButtons]
          .some((button) => ['candidates_refresh', 'pump_refresh'].includes(button.callback_data)),
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
