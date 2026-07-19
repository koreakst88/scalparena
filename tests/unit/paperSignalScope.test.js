const ScalpArenaBot = require('../../src/bot/bot');

console.log('Paper Signal Scope Test\n');

const bot = Object.create(ScalpArenaBot.prototype);
const current = bot._parsePaperSignalStatsArgs(['pump', 'edge', '7']);
const legacy = bot._parsePaperSignalStatsArgs(['legacy', 'candidates', '30']);
const history = bot._parsePaperSignalStatsArgs(['history', 'pump', 'all']);

const checks = [
  {
    name: 'Default report uses current experiment',
    pass: current.scope === 'current' && current.project === 'pump' && current.mode === 'edge' && current.period === '7',
  },
  {
    name: 'Legacy report keeps project and period',
    pass: legacy.scope === 'legacy' && legacy.project === 'candidates' && legacy.period === '30',
  },
  {
    name: 'History scope preserves all-time period',
    pass: history.scope === 'history' && history.project === 'pump' && history.period === 'all',
  },
  {
    name: 'Current title is explicit',
    pass: bot._formatPaperSignalStatsTitle('7 дней', 'pump', 'current').includes('текущий эксперимент'),
  },
  {
    name: 'Legacy title is explicit',
    pass: bot._formatPaperSignalStatsTitle('30 дней', 'candidates', 'legacy').includes('архив LEGACY'),
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
