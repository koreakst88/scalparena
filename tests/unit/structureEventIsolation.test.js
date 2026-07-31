process.env.STRUCTURE_EVENT_TRACKING_ENABLED = 'true';

const fs = require('fs');
const path = require('path');
const SupabaseClient = require('../../src/data/supabaseClient');
const ScalpArenaBot = require('../../src/bot/bot');
const {
  STRUCTURE_PROJECT,
  STRUCTURE_EVENT_EXPERIMENT_ID,
} = require('../../src/config/structure');

console.log('Structure Event Isolation Test\n');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '../../supabase/migrations/20260731000000_add_structure_events.sql'
  ),
  'utf8'
);

function recorder() {
  const calls = [];
  let inserted = null;
  const query = {
    insert(payload) { inserted = payload; calls.push(['insert', payload]); return this; },
    update(payload) { calls.push(['update', payload]); return this; },
    select() { calls.push(['select']); return this; },
    single() {
      return Promise.resolve({
        data: inserted?.[0] || { id: 'structure-event-1' },
        error: null,
      });
    },
    eq(field, value) { calls.push(['eq', field, value]); return this; },
    in(field, values) { calls.push(['in', field, values]); return this; },
    gte(field, value) { calls.push(['gte', field, value]); return this; },
    order(field) { calls.push(['order', field]); return this; },
    then(resolve) {
      return Promise.resolve({ data: [], error: null }).then(resolve);
    },
  };
  return {
    calls,
    get inserted() { return inserted; },
    client: {
      from(table) {
        calls.push(['from', table]);
        return query;
      },
    },
  };
}

(async () => {
  const recorded = recorder();
  const db = Object.create(SupabaseClient.prototype);
  db.client = recorded.client;
  await db.createStructureEvent({
    pair: 'BTCUSDT',
    scenario: 'ZONE_COMPRESSION',
    state: 'WATCH',
    zone_lower: 64000,
    zone_upper: 65000,
  });
  await db.getActiveStructureEvents({ pair: 'BTCUSDT' });

  const bot = Object.create(ScalpArenaBot.prototype);
  bot.db = {
    getActiveStructureEvents: async () => [{
      state: 'WATCH',
    }],
  };
  bot._getCommandParts = ScalpArenaBot.prototype._getCommandParts;
  let statusMessage = '';
  bot._sendPlain = async (_userId, message) => {
    statusMessage = message;
  };
  await bot._onStructure({
    chat: { id: 42 },
    text: '/structure',
  });

  const payload = recorded.inserted?.[0] || {};
  const checks = [
    {
      name: 'Migration creates a dedicated Structure research table',
      pass: migration.includes('create table if not exists structure_events') &&
        migration.includes('RESISTANCE_TEST') &&
        migration.includes('SUPPORT_TEST') &&
        migration.includes('ZONE_COMPRESSION'),
    },
    {
      name: 'Active uniqueness is isolated by experiment, pair and scenario',
      pass: migration.includes('experiment_id, pair, scenario') &&
        migration.includes("where state in ('WATCH', 'ARMED', 'TRIGGERED')"),
    },
    {
      name: 'Structure writes force their own project and experiment',
      pass: payload.project === STRUCTURE_PROJECT &&
        payload.experiment_id === STRUCTURE_EVENT_EXPERIMENT_ID,
    },
    {
      name: 'Structure DB methods never touch Extreme or paper tables',
      pass: recorded.calls.some(([method, table]) => (
        method === 'from' && table === 'structure_events'
      )) &&
        !recorded.calls.some(([method, table]) => (
          method === 'from' &&
          ['extreme_events', 'paper_signals'].includes(table)
        )),
    },
    {
      name: 'Status reports isolated storage and research-only states',
      pass: statusMessage.includes('Хранилище structure_events: READY') &&
        statusMessage.includes('Активных research-событий: 1') &&
        statusMessage.includes('WATCH 1 | ARMED 0 | TRIGGERED 0') &&
        statusMessage.includes('Events: ON (research only)') &&
        statusMessage.includes('Paper-сигналы: OFF'),
    },
    {
      name: 'Migration contains no paper signal link or trading exits',
      pass: !migration.includes('paper_signal_id') &&
        !migration.includes('take_profit') &&
        !migration.includes('stop_loss'),
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
