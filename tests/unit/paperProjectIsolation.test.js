const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '../../supabase/migrations/20260719010000_isolate_paper_signal_projects.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');

console.log('Paper Project Isolation Test\n');

function createQueryRecorder() {
  const filters = [];
  const query = {
    select() { return this; },
    eq(field, value) { filters.push([field, value]); return this; },
    order() { return this; },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
  };

  return {
    filters,
    client: { from: () => query },
  };
}

const SupabaseClient = require('../../src/data/supabaseClient');
const recorder = createQueryRecorder();
const db = Object.create(SupabaseClient.prototype);
db.client = recorder.client;

(async () => {
  await db.getActivePaperSignals('42', {
    project: 'PUMP',
    experimentId: 'SCALPARENA_V2_20260719',
  });

  const checks = [
    {
      name: 'Active signal query is scoped to project',
      pass: recorder.filters.some(([field, value]) => field === 'project' && value === 'PUMP'),
    },
    {
      name: 'Active signal query is scoped to experiment',
      pass: recorder.filters.some(([field, value]) => (
        field === 'experiment_id' && value === 'SCALPARENA_V2_20260719'
      )),
    },
    {
      name: 'Legacy cross-project unique index is removed',
      pass: migration.includes('drop index if exists idx_paper_signals_one_watching_per_pair_direction'),
    },
    {
      name: 'New unique index includes experiment and project',
      pass: migration.includes('user_id, experiment_id, project, pair, direction'),
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
