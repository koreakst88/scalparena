process.env.PAPER_SIGNAL_TRACKING_ENABLED = 'true';
process.env.CANDIDATE_V3_ENABLED = 'true';
process.env.CANDIDATE_V3_MAX_PER_CYCLE = '1';

const CandidateBreakoutV3 = require('../../src/engine/candidateBreakoutV3');
const Scheduler = require('../../src/engine/scheduler');

console.log('Candidate V3 Scheduler Test\n');

const candidates = ['AUSDT', 'BUSDT'].map((pair, index) => ({
  pair,
  action: 'SHADOW_TRADE',
  strategy: 'BREAKOUT_V3_SHADOW',
  direction: 'SHORT',
  score: 90 - index,
  entryPrice: 100,
  stopLoss: 100.5,
  takeProfit: 99.1,
  slPercent: 0.5,
  tpPercent: 0.9,
  riskReward: 1.8,
  rsi: 40,
  volumeRatio: 2,
  atrPercent: 0.4,
  summary: 'test V3 retest',
}));

CandidateBreakoutV3.scanAll = () => candidates.map((candidate) => ({
  pair: candidate.pair,
  action: 'SHADOW_TRADE',
  reason: 'QUALIFIED',
  candidate,
}));

const tracked = [];
let activeFilter = null;
const bot = {
  _trackPaperSignal: async (userId, signal, source) => {
    tracked.push({ userId, signal, source });
    return { id: `${userId}-${signal.pair}` };
  },
};
const db = {
  getActivePaperSignals: async (_userId, filters) => {
    activeFilter = filters;
    return [];
  },
  getPaperSignalsSince: async () => [],
};
const provider = {
  getPairs: () => [],
  getCandles: (pair) => pair === 'BTCUSDT'
    ? Array.from({ length: 60 }, (_, index) => ({
      timestamp: Date.UTC(2026, 6, 20) + index * 60000,
      open: 60000,
      high: 60010,
      low: 59990,
      close: 60000,
      volume: 100,
      confirm: true,
    }))
    : [],
};
const scheduler = new Scheduler(bot, db, provider);

scheduler._recordCandidateV3([{ telegram_id: '42' }])
  .then(() => {
    const cooldownNow = new Date().toISOString();
    const checks = [
      {
        name: 'Cycle records at most one Candidate V3 setup',
        pass: tracked.length === 1,
      },
      {
        name: 'Record uses the isolated V3 source and experiment',
        pass: tracked[0]?.source === 'CANDIDATE_V3' &&
          tracked[0]?.signal?.experimentId === 'CANDIDATE_V3_20260720',
      },
      {
        name: 'Active lookup cannot mix V2 and V3 cohorts',
        pass: activeFilter?.project === 'CANDIDATE_V3' &&
          activeFilter?.experimentId === 'CANDIDATE_V3_20260720',
      },
      {
        name: 'A recent V3 signal starts a six-hour pair cooldown',
        pass: scheduler._isCandidateV3PairCoolingDown('AUSDT', [{
          pair: 'AUSDT',
          project: 'CANDIDATE_V3',
          experiment_id: 'CANDIDATE_V3_20260720',
          status: 'TIMEOUT',
          created_at: cooldownNow,
        }]),
      },
      {
        name: 'Old V2 rows do not affect the V3 cooldown',
        pass: !scheduler._isCandidateV3PairCoolingDown('AUSDT', [{
          pair: 'AUSDT',
          project: 'CANDIDATE_V2_SHADOW',
          experiment_id: 'SCALPARENA_V2_20260719',
          status: 'SL_HIT',
          created_at: cooldownNow,
        }]),
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
