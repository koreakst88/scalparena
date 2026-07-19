process.env.PAPER_SIGNAL_TRACKING_ENABLED = 'true';
process.env.CANDIDATE_V2_SHADOW_ENABLED = 'true';
process.env.CANDIDATE_V2_SHADOW_MAX_PER_CYCLE = '3';

const CandidateBreakoutV2 = require('../../src/engine/candidateBreakoutV2');
const Scheduler = require('../../src/engine/scheduler');

console.log('Candidate V2 Shadow Scheduler Test\n');

const candidates = ['AUSDT', 'BUSDT', 'CUSDT', 'DUSDT'].map((pair, index) => ({
  pair,
  action: 'SHADOW_TRADE',
  strategy: 'BREAKOUT_V2_SHADOW',
  direction: 'LONG',
  score: 90 - index,
  entryPrice: 100,
  stopLoss: 99.5,
  takeProfit: 100.9,
  slPercent: 0.5,
  tpPercent: 0.9,
  riskReward: 1.8,
  rsi: 62,
  volumeRatio: 2,
  atrPercent: 0.4,
  summary: 'test shadow breakout',
}));

CandidateBreakoutV2.scanAll = () => candidates.map((candidate) => ({
  pair: candidate.pair,
  action: 'SHADOW_TRADE',
  reason: 'QUALIFIED',
  candidate,
}));

const tracked = [];
let telegramMessages = 0;
let activeFilter = null;
const bot = {
  _trackPaperSignal: async (userId, signal, source) => {
    tracked.push({ userId, signal, source });
    return { id: `${userId}-${signal.pair}` };
  },
  _sendPlain: async () => { telegramMessages += 1; },
};
const db = {
  getActivePaperSignals: async (_userId, filters) => {
    activeFilter = filters;
    return [];
  },
};
const scheduler = new Scheduler(bot, db, { getPairs: () => [], getCandles: () => [] });

scheduler._recordCandidateV2Shadow([{ telegram_id: '42' }])
  .then(() => {
    const checks = [
      {
        name: 'Shadow cycle respects max three records',
        pass: tracked.length === 3,
      },
      {
        name: 'Every record uses the isolated shadow source',
        pass: tracked.every((item) => item.source === 'CANDIDATE_V2_SHADOW'),
      },
      {
        name: 'Active lookup is isolated by shadow project and experiment',
        pass: activeFilter?.project === 'CANDIDATE_V2_SHADOW' &&
          activeFilter?.experimentId === 'SCALPARENA_V2_20260719',
      },
      {
        name: 'Shadow recording sends no Telegram messages',
        pass: telegramMessages === 0,
      },
      {
        name: 'Insufficient BTC history is stored as UNKNOWN research context',
        pass: tracked.every((item) => (
          item.signal.signalMetadata?.marketContext?.state === 'UNKNOWN' &&
          item.signal.signalMetadata?.marketContext?.decision === 'UNKNOWN'
        )),
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
