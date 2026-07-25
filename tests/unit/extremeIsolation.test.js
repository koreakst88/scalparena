const fs = require('fs');
const path = require('path');
const SupabaseClient = require('../../src/data/supabaseClient');
const ScalpArenaBot = require('../../src/bot/bot');
const {
  EXTREME_PROJECT,
  EXTREME_EXPERIMENT_ID,
  EXTREME_EVENT_STATES,
  EXTREME_SCENARIOS,
} = require('../../src/config/extremeRadar');
const { getPaperProject } = require('../../src/config/paperExperiment');

const migrationPath = path.join(
  __dirname,
  '../../supabase/migrations/20260725010000_add_extreme_events.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');

function createClientRecorder() {
  const calls = [];
  let insertedPayload = null;
  const query = {
    insert(payload) { insertedPayload = payload; calls.push(['insert', payload]); return this; },
    update(payload) { calls.push(['update', payload]); return this; },
    select() { calls.push(['select']); return this; },
    single() {
      return Promise.resolve({
        data: insertedPayload?.[0] || { id: 'event-1' },
        error: null,
      });
    },
    eq(field, value) { calls.push(['eq', field, value]); return this; },
    in(field, value) { calls.push(['in', field, value]); return this; },
    gte(field, value) { calls.push(['gte', field, value]); return this; },
    order(field) {
      calls.push(['order', field]);
      return this;
    },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
  };

  return {
    calls,
    get insertedPayload() { return insertedPayload; },
    client: {
      from(table) {
        calls.push(['from', table]);
        return query;
      },
    },
  };
}

(async () => {
  const recorder = createClientRecorder();
  const db = Object.create(SupabaseClient.prototype);
  db.client = recorder.client;

  await db.createExtremeEvent({
    pair: 'DEXEUSDT',
    scenario: EXTREME_SCENARIOS.SQUEEZE_LONG,
    state: EXTREME_EVENT_STATES.WATCH,
  });
  await db.getActiveExtremeEvents({ pair: 'DEXEUSDT' });

  const bot = Object.create(ScalpArenaBot.prototype);
  bot.db = {
    getActiveExtremeEvents: async () => [],
  };
  let statusMessage = '';
  bot._sendPlain = async (_userId, message) => {
    statusMessage = message;
  };
  await bot._onExtreme({
    chat: { id: 42 },
    text: '/extreme',
  });

  const payload = recorder.insertedPayload?.[0] || {};
  const checks = [
    {
      name: 'Extreme events have a separate table',
      pass: migration.includes('create table if not exists extreme_events'),
    },
    {
      name: 'Only one active scenario can exist per experiment and pair',
      pass: migration.includes('experiment_id, pair, scenario') &&
        migration.includes("where state in ('WATCH', 'ARMED', 'TRIGGERED')"),
    },
    {
      name: 'Research lifecycle has explicit terminal states',
      pass: ['EXPIRED', 'INVALIDATED', 'RESOLVED']
        .every((state) => migration.includes(`'${state}'`)),
    },
    {
      name: 'Extreme project and experiment are isolated',
      pass: EXTREME_PROJECT === 'EXTREME' &&
        EXTREME_EXPERIMENT_ID === 'EXTREME_V1_RESEARCH_20260725',
    },
    {
      name: 'Future Extreme paper rows map only to EXTREME',
      pass: getPaperProject(
        { strategy: 'EXTREME_SQUEEZE_LONG' },
        'EXTREME_RADAR'
      ) === 'EXTREME',
    },
    {
      name: 'Database writes force the Extreme project and experiment',
      pass: payload.project === EXTREME_PROJECT &&
        payload.experiment_id === EXTREME_EXPERIMENT_ID,
    },
    {
      name: 'Active event lookup never touches paper_signals',
      pass: recorder.calls.some(([method, table]) => (
        method === 'from' && table === 'extreme_events'
      )) && !recorder.calls.some(([method, table]) => (
        method === 'from' && table === 'paper_signals'
      )),
    },
    {
      name: 'Extreme status confirms storage while all engines stay off',
      pass: statusMessage.includes('Хранилище extreme_events: READY') &&
        statusMessage.includes('Radar engine: OFF') &&
        statusMessage.includes('Paper-сигналы: OFF'),
    },
  ];

  checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));
  const allPassed = checks.every((check) => check.pass);
  console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
  process.exit(allPassed ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
