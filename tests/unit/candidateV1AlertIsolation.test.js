process.env.PAPER_SIGNAL_TRACKING_ENABLED = 'true';
process.env.CANDIDATE_V1_ALERTS_ENABLED = 'false';
process.env.CANDIDATE_V3_ENABLED = 'true';
process.env.MARKET_CONTEXT_V1_ENABLED = 'false';

const CandidateEngine = require('../../src/engine/candidateEngine');
const CandidateBreakoutV3 = require('../../src/engine/candidateBreakoutV3');
const Scheduler = require('../../src/engine/scheduler');

console.log('Candidate V1 Alert Isolation Test\n');

let v1Scans = 0;
let sentAlerts = 0;
let diagnosticPayload = null;

CandidateEngine.scanAll = () => {
  v1Scans += 1;
  return [];
};
CandidateBreakoutV3.scanAll = () => [];
CandidateBreakoutV3.getActionableCandidates = () => [];

const bot = {
  _isCandidateAutoEnabled: () => true,
  _sendPlain: async () => {
    sentAlerts += 1;
  },
  _trackPaperSignal: async () => {
    sentAlerts += 1;
    return { id: 'unexpected-v1-record' };
  },
};
const db = {
  client: {
    from: () => ({
      select: () => ({
        eq: async () => ({
          data: [{ telegram_id: '42', auto_scan_enabled: true }],
          error: null,
        }),
      }),
    }),
  },
  createResearchScanDiagnostic: async (payload) => {
    diagnosticPayload = payload;
    return { id: 'diagnostic-1', ...payload };
  },
};
const provider = {
  getCandles: () => [],
};
const scheduler = new Scheduler(bot, db, provider);

scheduler._candidateAutoScan()
  .then(() => {
    const checks = [
      {
        name: 'V1 detector does not run when V1 alerts are disabled',
        pass: v1Scans === 0,
      },
      {
        name: 'No V1 Telegram alert or paper record is created',
        pass: sentAlerts === 0,
      },
      {
        name: 'V3 diagnostic still runs in the same research cycle',
        pass: diagnosticPayload?.project === 'CANDIDATE_V3',
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
