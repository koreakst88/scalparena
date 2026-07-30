const ScalpArenaBot = require('../../src/bot/bot');

console.log('Bot Menu Test\n');

const bot = Object.create(ScalpArenaBot.prototype);
bot.candidateAutoOverrides = new Map([['42', true]]);
bot.pumpAutoOverrides = new Map([['42', false]]);

const keyboard = bot._getMainMenuKeyboard('42').inline_keyboard;
const callbacks = keyboard.flat().map((button) => button.callback_data);
const commands = ScalpArenaBot.BOT_COMMANDS.map((item) => item.command);

const checks = [
  {
    name: 'Visible Telegram menu contains only primary commands',
    pass: commands.join(',') === 'menu,pump,extreme,signals,research,status,help',
  },
  {
    name: 'Legacy commands stay out of the visible Telegram menu',
    pass: !commands.some((command) => ['scan', 'stats', 'patterns', 'rm', 'exit', 'deposit'].includes(command)),
  },
  {
    name: 'Main menu exposes Pump and Extreme but not retired Candidate',
    pass: callbacks.includes('menu_pump') &&
      callbacks.includes('menu_extreme') &&
      !callbacks.includes('menu_candidates'),
  },
  {
    name: 'Main menu exposes current results, archive and active signals',
    pass: ['menu_signals_current', 'menu_signals_legacy', 'menu_signals_open']
      .every((callback) => callbacks.includes(callback)),
  },
  {
    name: 'Main menu exposes research readiness without hiding system status',
    pass: callbacks.includes('menu_research') && callbacks.includes('menu_status'),
  },
  {
    name: 'Runtime auto states are reflected in button labels',
    pass: keyboard.flat().some((button) => button.text === 'Pump auto: OFF') &&
      !keyboard.flat().some((button) => button.text.includes('Candidate')),
  },
];

checks.forEach((check) => console.log(`   ${check.pass ? 'PASS' : 'FAIL'} ${check.name}`));

const allPassed = checks.every((check) => check.pass);
console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n`);
process.exit(allPassed ? 0 : 1);
