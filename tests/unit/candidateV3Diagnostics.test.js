const fs = require('fs');
const path = require('path');
const Scheduler = require('../../src/engine/scheduler');

console.log('Candidate V3 Diagnostics Test\n');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '../../supabase/migrations/20260725000000_add_research_scan_diagnostics.sql'
  ),
  'utf8'
);
const saved = [];
const scheduler = new Scheduler(
  {},
  {
    createResearchScanDiagnostic: async (payload) => {
      saved.push(payload);
      return payload;
    },
  },
  {}
);

const reports = [
  {
    pair: 'AUSDT',
    action: 'NO_TRADE',
    reason: 'REJECT_VOLUME',
    diagnostic: {
      rejectionReasons: ['REJECT_VOLUME', 'REJECT_NO_RETEST'],
      direction: 'LONG',
      volumeRatio: 4.2,
      bodyRatio: 0.8,
      entryDistanceAtr: 0.2,
      trend5m: 'LONG',
    },
  },
  {
    pair: 'BUSDT',
    action: 'NO_TRADE',
    reason: 'NOT_ENOUGH_LIVE_CANDLES',
    diagnostic: { liveCandles: 72, required: 100 },
  },
];
const qualified = [{
  pair: 'CUSDT',
  direction: 'LONG',
  marketContext: { state: 'NEUTRAL', decision: 'CAUTION' },
}];

scheduler._recordCandidateV3Diagnostics({
  reports,
  rawCandidates: qualified,
  contextualCandidates: qualified,
  candidates: [],
  marketContext: { state: 'NEUTRAL' },
})
  .then(async () => {
    let missingTableAttempts = 0;
    const unavailableScheduler = new Scheduler(
      {},
      {
        createResearchScanDiagnostic: async () => {
          missingTableAttempts += 1;
          const error = new Error('research_scan_diagnostics was not found');
          error.code = 'PGRST205';
          throw error;
        },
      },
      {}
    );
    await unavailableScheduler._recordCandidateV3Diagnostics({ reports });
    await unavailableScheduler._recordCandidateV3Diagnostics({ reports });

    const payload = saved[0];
    const checks = [
      {
        name: 'Migration creates a dedicated research-only diagnostics table',
        pass: migration.includes('create table if not exists research_scan_diagnostics') &&
          migration.includes('rejection_counts jsonb') &&
          migration.includes('context_rejection_counts jsonb'),
      },
      {
        name: 'One cycle persists aggregate rejection reasons',
        pass: saved.length === 1 &&
          payload.rejection_counts.REJECT_VOLUME === 1 &&
          payload.rejection_counts.REJECT_NO_RETEST === 1 &&
          payload.rejection_counts.NOT_ENOUGH_LIVE_CANDLES === 1,
      },
      {
        name: 'BTC context rejections remain separate from strategy filters',
        pass: payload.context_rejection_counts.CAUTION === 1 &&
          payload.qualified_before_context === 1 &&
          payload.qualified_after_context === 0,
      },
      {
        name: 'Diagnostic examples are bounded and contain no paper trades',
        pass: payload.examples.length === 2 &&
          payload.project === 'CANDIDATE_V3' &&
          payload.strategy === 'BREAKOUT_V3_SHADOW',
      },
      {
        name: 'Missing migration disables writes after one safe warning',
        pass: missingTableAttempts === 1 &&
          unavailableScheduler.candidateDiagnosticsUnavailable === true,
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
