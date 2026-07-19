const ScalpArenaBot = require('../../src/bot/bot');

console.log('Paper Signal Scope Test\n');

const bot = Object.create(ScalpArenaBot.prototype);
const current = bot._parsePaperSignalStatsArgs(['pump', 'edge', '7']);
const legacy = bot._parsePaperSignalStatsArgs(['legacy', 'candidates', '30']);
const history = bot._parsePaperSignalStatsArgs(['history', 'pump', 'all']);
const shadow = bot._parsePaperSignalStatsArgs(['candidate_v2', 'detail', '7']);
const pumpShadow = bot._parsePaperSignalStatsArgs(['pump_v2', 'edge', '30']);

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
    name: 'Shadow report has an isolated project selector',
    pass: shadow.project === 'candidate_v2' && shadow.mode === 'detail' && shadow.period === '7',
  },
  {
    name: 'Pump shadow report has an isolated project selector',
    pass: pumpShadow.project === 'pump_v2' && pumpShadow.mode === 'edge' && pumpShadow.period === '30',
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
