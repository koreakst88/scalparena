// src/bot/bot.js

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const { BybitDataProvider } = require('../data/bybitProvider');
const SupabaseClient = require('../data/supabaseClient');
const SignalDetector = require('../engine/signalDetector');
const CandidateEngine = require('../engine/candidateEngine');
const PumpHunterEngine = require('../engine/pumpHunterEngine');
const ExtremeDataAudit = require('../engine/extremeDataAudit');
const ExtremeWideRadar = require('../engine/extremeWideRadar');
const StructureDataAudit = require('../engine/structureDataAudit');
const StructureLevelEngine = require('../engine/structureLevelEngine');
const StructureWideRadar = require('../engine/structureWideRadar');
const StructureEventTracker = require('../engine/structureEventTracker');
const RiskManager = require('../engine/riskManager');
const FeeCalculator = require('../engine/feeCalculator');
const PositionMonitor = require('../engine/positionMonitor');
const Scheduler = require('../engine/scheduler');
const PaperSignalTracker = require('../engine/paperSignalTracker');
const GptAnalyzer = require('../analytics/gptAnalyzer');
const StatsCalculator = require('../analytics/stats');
const PaperSignalStats = require('../analytics/paperSignalStats');
const ResearchReadiness = require('../analytics/researchReadiness');
const CandidateFormatter = require('../analytics/candidateFormatter');
const PumpHunterFormatter = require('../analytics/pumpHunterFormatter');
const ExtremeAuditFormatter = require('../analytics/extremeAuditFormatter');
const ExtremeWideFormatter = require('../analytics/extremeWideFormatter');
const StructureAuditFormatter = require('../analytics/structureAuditFormatter');
const StructureLevelFormatter = require('../analytics/structureLevelFormatter');
const StructureWideFormatter = require('../analytics/structureWideFormatter');
const StructureEventFormatter = require('../analytics/structureEventFormatter');
const { formatDetailedAnalytics } = require('../analytics/formatters');
const { CURRENT_STRATEGY_VERSION, LEGACY_STRATEGY_VERSION } = require('../config/strategy');
const { MARKET_CONTEXT_V1_ENABLED } = require('../config/marketContext');
const {
  CURRENT_PAPER_EXPERIMENT_ID,
  CANDIDATE_V3_EXPERIMENT_ID,
  PUMP_V2_EXPERIMENT_ID,
  STRUCTURE_PAPER_EXPERIMENT_ID,
  getPaperProject,
  getPaperStrategyVersion,
} = require('../config/paperExperiment');
const {
  PUMP_HUNTER_SCAN_LIMIT,
  PUMP_HUNTER_KLINE_INTERVAL,
  PUMP_HUNTER_KLINE_LIMIT,
  PUMP_HUNTER_ACTIONABLE_LIMIT,
  PUMP_HUNTER_FALLBACK_MARKET,
  PUMP_HUNTER_SIGNAL_TTL_MINUTES,
  PUMP_AUTO_SCAN_ENABLED,
  PUMP_AUTO_SCAN_INTERVAL_MS,
  PUMP_AUTO_MIN_SCORE,
  PUMP_AUTO_COOLDOWN_MINUTES,
  PUMP_AUTO_MAX_ALERTS,
  PUMP_V2_SHADOW_ENABLED,
  PUMP_V2_SHADOW_MAX_PER_CYCLE,
} = require('../config/pumpHunter');
const {
  EXTREME_RADAR_ENABLED,
  EXTREME_AUTO_SCAN_ENABLED,
  EXTREME_PAPER_SIGNALS_ENABLED,
  EXTREME_PROJECT,
  EXTREME_EXPERIMENT_ID,
  EXTREME_WIDE_SCAN_ENABLED,
  EXTREME_WIDE_SCAN_INTERVAL_MS,
  EXTREME_EVENT_TRACKING_ENABLED,
  EXTREME_AUDIT_SYMBOL,
  EXTREME_AUDIT_TIMEOUT_MS,
} = require('../config/extremeRadar');
const {
  STRUCTURE_PROJECT,
  STRUCTURE_EXPERIMENT_ID,
  STRUCTURE_LEVEL_EXPERIMENT_ID,
  STRUCTURE_WIDE_EXPERIMENT_ID,
  STRUCTURE_EVENT_EXPERIMENT_ID,
  STRUCTURE_LEVEL_ENGINE_ENABLED,
  STRUCTURE_WIDE_SCAN_ENABLED,
  STRUCTURE_WIDE_SCAN_LIMIT,
  STRUCTURE_WIDE_MIN_TURNOVER_USD,
  STRUCTURE_AUTO_RESEARCH_ENABLED,
  STRUCTURE_AUTO_SCAN_INTERVAL_MS,
  STRUCTURE_EVENT_TRACKING_ENABLED,
  STRUCTURE_PAPER_SIGNALS_ENABLED,
  STRUCTURE_PAPER_TTL_MINUTES,
  STRUCTURE_PAPER_MIN_RR,
  STRUCTURE_PAPER_MAX_RISK_PERCENT,
  STRUCTURE_ALERTS_ENABLED,
} = require('../config/structure');
const {
  PAPER_SIGNAL_TRACKING_ENABLED,
  PAPER_SIGNAL_TTL_MINUTES,
  CANDIDATE_PROJECT_ENABLED,
  CANDIDATE_AUTO_SCAN_ENABLED,
  CANDIDATE_V1_ALERTS_ENABLED,
  CANDIDATE_AUTO_SCAN_INTERVAL_MS,
  CANDIDATE_AUTO_MIN_SCORE,
  CANDIDATE_AUTO_MIN_RR,
  CANDIDATE_AUTO_COOLDOWN_MINUTES,
  CANDIDATE_AUTO_MAX_ALERTS,
  CANDIDATE_V3_ENABLED,
  CANDIDATE_V3_MAX_PER_CYCLE,
} = require('../config/paperSignals');

const BOT_COMMANDS = [
  { command: 'menu', description: 'Главная панель' },
  { command: 'pump', description: 'PumpHunter Lab' },
  { command: 'extreme', description: 'Extreme Radar · аудит данных' },
  { command: 'structure', description: 'Structure · уровни и широкий радар' },
  { command: 'signals', description: 'Paper результаты' },
  { command: 'research', description: 'Готовность исследования' },
  { command: 'status', description: 'Состояние системы' },
  { command: 'help', description: 'Короткая справка' },
];

class ScalpArenaBot {
  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      this.bot = new TelegramBot(this.token, { webHook: false });
    } else {
      this.bot = new TelegramBot(this.token, { polling: true });
    }

    this.db = new SupabaseClient();
    this.provider = new BybitDataProvider();
    this.analyzer = new GptAnalyzer();
    this.monitor = null;
    this.scheduler = null;
    this.paperSignalTracker = null;
    this.structureEventTracker = new StructureEventTracker(this.db);
    this.ready = false;
    this.commandsRegistered = false;
    this.pendingSignals = new Map();
    this.candidateSnapshots = new Map();
    this.pumpSnapshots = new Map();
    this.candidateAutoOverrides = new Map();
    this.pumpAutoOverrides = new Map();

    console.log('✅ ScalpArenaBot initialized');
    this._registerCommands();
  }

  async start() {
    console.log('🚀 Starting ScalpArena Bot...');

    this._registerCommands();
    await this._setCommandMenu();

    // Инициализировать минимальный provider state синхронно, но не блокировать bot startup backfill'ом.
    await this.provider.validatePairs();
    this.provider.connect();
    this.ready = true;

    console.log('🔄 About to start position monitor...');
    this.monitor = new PositionMonitor(this, this.db, this.provider);
    await this.monitor.start();
    console.log('✅ Position monitor started successfully');
    console.log('✅ Bot startup: PositionMonitor initialized and started');

    this.scheduler = new Scheduler(this, this.db, this.provider);
    this.scheduler.start();

    this.paperSignalTracker = new PaperSignalTracker(this, this.db, this.provider);
    this.paperSignalTracker.start();

    console.log('✅ Bot ready!');
    this._startBackfillInBackground();
  }

  _startBackfillInBackground() {
    console.log('📥 Starting market backfill in background...');

    this.provider
      .backfillAll('60')
      .then(() => {
        console.log('✅ Background backfill completed');
      })
      .catch((error) => {
        console.error('❌ Background backfill failed:', error?.message || error);
      });
  }

  _registerCommands() {
    if (this.commandsRegistered) return;

    this.bot.onText(/\/start/, this._safe((msg) => this._onStart(msg)));
    this.bot.onText(/\/menu/, this._safe((msg) => this._onMenu(msg)));
    this.bot.onText(/\/scan/, this._safe((msg) => this._onScan(msg)));
    this.bot.onText(/\/status/, this._safe((msg) => this._onStatus(msg)));
    this.bot.onText(/\/rm (.+)/, this._safe((msg, match) => this._onRm(msg, match)));
    this.bot.onText(/\/exit (.+)/, this._safe((msg, match) => this._onExit(msg, match)));
    this.bot.onText(/\/stats/, this._safe((msg) => this._onStats(msg)));
    this.bot.onText(/\/pump_?auto(?:\s+(\S+))?/, this._safe((msg, match) => this._onPumpAuto(msg, match)));
    this.bot.onText(/\/pump(?:\s+(\S+))?$/, this._safe((msg) => this._onPump(msg)));
    this.bot.onText(/\/extreme(?:@\w+)?(?:\s+.*)?$/, this._safe((msg) => this._onExtreme(msg)));
    this.bot.onText(/\/structure(?:@\w+)?(?:\s+.*)?$/, this._safe((msg) => this._onStructure(msg)));
    this.bot.onText(/\/signals/, this._safe((msg) => this._onSignals(msg)));
    this.bot.onText(/\/research(?:@\w+)?$/, this._safe((msg) => this._onResearch(msg)));
    this.bot.onText(/\/signal_stats/, this._safe((msg) => this._onSignals(msg)));
    this.bot.onText(/\/patterns/, this._safe((msg) => this._onPatterns(msg)));
    this.bot.onText(/\/deposit (.+)/, this._safe((msg, match) => this._onDeposit(msg, match)));
    this.bot.onText(/\/help/, this._safe((msg) => this._onHelp(msg)));

    // Callback кнопки (inline keyboards)
    this.bot.on('callback_query', this._safe((query) => this._onCallback(query)));
    this.bot.on('polling_error', (error) => {
      console.error('❌ Telegram polling error:', error?.message || error);
    });

    this.commandsRegistered = true;
    console.log('✅ Commands registered');
  }

  async _setCommandMenu() {
    try {
      await this.bot.setMyCommands(BOT_COMMANDS);
      await this.bot.setChatMenuButton({
        menu_button: {
          type: 'commands',
        },
      });

      const menuButton = await this.bot.getChatMenuButton();
      console.log(`✅ Telegram command menu updated (${menuButton?.type || 'unknown'})`);
    } catch (error) {
      console.error('❌ Telegram command menu update failed:', error?.message || error);
    }
  }

  // ─────────────────────────────────────────
  // КОМАНДЫ
  // ─────────────────────────────────────────

  async _onStart(msg) {
    const userId = String(msg.chat.id);
    const username = msg.from?.username || 'trader';

    // Проверить есть ли пользователь в базе
    let user = await this.db.getUser(userId);

    if (!user) {
      // Новый пользователь
      await this.db.upsertUser(userId, {
        username,
        account_balance: 200,
        balance_at_8am: 200,
      });

      await this._sendPlain(
        userId,
        `👋 Привет, ${username}!\n\nScalpArena готова собирать и проверять paper-сигналы. Стартовый расчётный баланс: $200.`
      );
    } else {
      await this._sendPlain(
        userId,
        `👋 С возвращением, ${username}!\nРасчётный баланс: $${user.account_balance}`
      );
    }

    await this._sendMainMenu(userId);
  }

  async _onMenu(msg) {
    const userId = String(msg.chat.id);
    await this._sendMainMenu(userId);
  }

  async _sendMainMenu(userId, notice = '') {
    const pumpEnabled = this._isPumpAutoEnabled(userId);
    const text = [
      notice,
      '📋 SCALPARENA',
      '━━━━━━━━━━━━━━━━━━━━',
      'Активные исследовательские направления:',
      '🚀 PumpHunter — импульсные монеты',
      '⚡ Extreme Radar — рыночные аномалии',
      '🏗 Structure — уровни, сжатие и пробои',
      '',
      `Автопоиск PumpHunter: ${pumpEnabled ? 'ON' : 'OFF'}`,
      `Extreme Radar: ${EXTREME_WIDE_SCAN_ENABLED ? 'ON (research)' : 'OFF'}`,
      `Structure research: ${STRUCTURE_AUTO_RESEARCH_ENABLED ? 'ON' : 'OFF'}`,
      'Live-сделки на Bybit: OFF',
    ].filter(Boolean).join('\n');

    await this._sendPlain(userId, text, {
      reply_markup: this._getMainMenuKeyboard(userId),
    });
  }

  _getMainMenuKeyboard(userId) {
    const pumpEnabled = this._isPumpAutoEnabled(userId);

    return {
      inline_keyboard: [
        [
          { text: '🚀 PumpHunter', callback_data: 'menu_pump' },
          { text: '⚡ Extreme', callback_data: 'menu_extreme' },
        ],
        [
          { text: '🏗 Structure', callback_data: 'menu_structure' },
        ],
        [
          {
            text: `Pump auto: ${pumpEnabled ? 'ON' : 'OFF'}`,
            callback_data: 'menu_pump_auto_toggle',
          },
        ],
        [
          { text: '📊 Результаты', callback_data: 'menu_signals_current' },
          { text: '🗄 Архив', callback_data: 'menu_signals_legacy' },
        ],
        [
          { text: '👀 Активные', callback_data: 'menu_signals_open' },
          { text: '🔬 Исследование', callback_data: 'menu_research' },
        ],
        [
          { text: '⚙️ Статус', callback_data: 'menu_status' },
        ],
      ],
    };
  }

  async _onScan(msg) {
    const userId = String(msg.chat.id);

    if (!this.ready) {
      return this._send(userId, '⏳ Провайдер данных загружается... Попробуй через 30 сек');
    }

    await this._send(userId, '🔍 Сканирую 15 пар...');

    const signals = SignalDetector.scanAll(this.provider);
    const user = await this.db.getUser(userId);
    const accountBalance = user?.account_balance || 200;
    const openPositions = await this.db.getOpenPositions(userId);
    const maxPositions = RiskManager.getMaxPositions();
    const slotsAvailable = maxPositions - openPositions.length;

    if (signals.length === 0) {
      const pairs = this.provider.getPairs().slice(0, 5);
      const TechnicalIndicators = require('../engine/indicators');
      const MarketRegimeDetector = require('../engine/marketRegimeDetector');
      let diagnostics = '';

      for (const pair of pairs) {
        const candles = this.provider.getCandles(pair, 50);
        if (candles.length < 5) {
          diagnostics += `  ${pair}: нет данных\n`;
          continue;
        }

        const prices = candles.map((candle) => candle.close);
        const currentPrice = candles[candles.length - 1].close;
        const rsi = TechnicalIndicators.calculateRSI(prices, 14).toFixed(0);
        const volume = TechnicalIndicators.calculateVolumeProfile(candles, 20).toFixed(0);
        const bb = TechnicalIndicators.calculateBollingerBands(prices, 20, 2);
        const bbRange = bb.upper - bb.lower;
        const bbPosition = bbRange > 0 ? (((currentPrice - bb.lower) / bbRange) * 100).toFixed(0) : 'n/a';
        const bbWidth = bb.middle ? (((bb.upper - bb.lower) / bb.middle) * 100).toFixed(1) : 'n/a';
        const regime = MarketRegimeDetector.detect(candles);
        const regimeLabel = this._formatSignalLabel(regime.regime);
        diagnostics += `  📊 ${pair}: ${regimeLabel} | RSI ${rsi} | BB ${bbPosition}% | Width ${bbWidth}% | Vol ${volume}%\n`;
      }

      return this._send(
        userId,
        `
📭 *Сигналов не найдено*

Рынок сейчас не даёт качественных Hybrid сетапов.
Range → Mean Reversion. Trend → Momentum. Noise → пропуск.

📊 *Топ 5 пар сейчас:*
${diagnostics}
⏰ Авто-скан каждые 15 мин — пришлю алерт когда будет сигнал.
      `
      );
    }

    if (slotsAvailable <= 0) {
      return this._send(
        userId,
        `⛔ Максимум *${maxPositions}* позиции уже открыто.\nЗакрой одну через /status, потом снова /scan.`
      );
    }

    const openPairs = new Set(openPositions.map((position) => this._normalizePair(position.pair)));
    const pairCooldownTrades = await this.db.getClosedTradesExitedSince(
      userId,
      new Date(Date.now() - RiskManager.getPairCooldownMinutes() * 60 * 1000)
    );
    const tradableSignals = signals.filter((signal) => {
      if (openPairs.has(this._normalizePair(signal.pair))) return false;

      const pairCooldown = RiskManager.checkPairCooldown(pairCooldownTrades, signal.pair);
      return !pairCooldown.active;
    });

    if (tradableSignals.length === 0) {
      return this._send(
        userId,
        `
📭 *Сигналы есть, но все отфильтрованы защитой*

Причины: уже открыта позиция по паре, достигнут лимит позиций или активен cooldown после убытка.

Cooldown по паре: *${RiskManager.getPairCooldownMinutes()} мин* после убыточной сделки.
      `
      );
    }

    // Показать топ 3 сигнала
    const top = tradableSignals.slice(0, Math.min(3, slotsAvailable));
    for (let i = 0; i < top.length; i++) {
      const signal = top[i];
      const paperSignal = await this._trackPaperSignal(userId, signal, 'MANUAL_SCAN');
      const signalId = this._storePendingSignal(signal);
      const strategyLabel = this._formatSignalLabel(signal.strategy);
      const regimeLabel = this._formatSignalLabel(signal.marketRegime);
      const entryModeLabel = this._formatSignalLabel(signal.entryMode);
      const position = RiskManager.calculatePosition(
        accountBalance,
        signal.entryPrice,
        signal.atrPercent,
        {
          slPercent: signal.slPercent / 100,
          tpPercent: signal.tpPercent / 100,
        }
      );

      await this._send(
        userId,
        `
🎯 *СИГНАЛ #${i + 1}*
━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *${signal.pair}* ${signal.type === 'SHORT' ? '🔴 SHORT' : '🟢 LONG'}

🧠 Strategy: *${strategyLabel}* (${entryModeLabel})
🌡️ Regime: *${regimeLabel}*
💰 Цена входа: \`$${signal.entryPrice}\`
🧾 Причина: ${signal.setupReason}
🎯 RSI: *${signal.rsi}* ${signal.rsi < 30 ? '(перепродано)' : signal.rsi > 70 ? '(перекуплено)' : ''}
📉 MACD: *${signal.macdBias}* (hist ${signal.macdHistogram})
📊 BB Position: *${signal.bbPosition}%* (0=низ, 100=верх)
🔊 Volume: *${signal.volume}%*
📏 BB Width: *${signal.bbWidth}%*
🚫 Invalidation: ${signal.invalidationRule}

━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ *ПАРАМЕТРЫ СДЕЛКИ:*

🛑 STOP LOSS: \`$${signal.stopLoss}\`
🟢 TAKE PROFIT: \`$${signal.takeProfit}\`
💼 Margin: *$${position.margin}* (Notional: $${position.notional})
📉 Max Loss: *$${position.maxLoss}*
📈 Expected: *+$${position.expectedProfit}*
⚖️ RR: *${position.riskReward}*

🎯 Уверенность: *${signal.confidence}%*
⏰ Действует: 30 мин
${paperSignal ? '\n🧪 Paper signal записан для отслеживания' : ''}
      `,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🟢 Я открыл позицию',
                  callback_data: `open_${signalId}`,
                },
                {
                  text: '⏭️ Пропустить',
                  callback_data: `skip_${signal.pair}`,
                },
              ],
            ],
          },
        }
      );
    }
  }

  async _onRm(msg, match) {
    const userId = String(msg.chat.id);
    const size = parseFloat(match[1]);

    if (isNaN(size) || size <= 0) {
      return this._send(userId, '❌ Укажи размер позиции. Пример: /rm 10');
    }

    const user = await this.db.getUser(userId);
    if (!user) return this._send(userId, '❌ Сначала /start');

    const currentCandle = this.provider.getCurrentCandle('SOLUSDT'); // пример
    const entryPrice = currentCandle?.close || 0;

    // Получить ATR для текущей пары (упрощённо берём среднее)
    const atrPercent = 1.5; // TODO: передавать пару как параметр

    const position = RiskManager.calculatePosition(user.account_balance, entryPrice, atrPercent);

    await this._send(
      userId,
      `
💼 *RM КАЛЬКУЛЯТОР*
════════════════════════════════

Баланс: *$${user.account_balance}*
Плечо: *${position.leverage}x*

💰 Margin: *$${position.margin}*
📊 Notional: *$${position.notional}*

🛑 Stop Loss: +${position.slPercent}% от high
🟢 Take Profit: -${position.tpPercent}% (фиксированный)

📉 Max Loss: *$${position.maxLoss}*
📈 Expected: *+$${position.expectedProfit}*
⚖️ RR: *${position.riskReward}*

✅ RM Check: Всё в порядке!
    `
    );
  }

  async _onStatus(msg) {
    const userId = String(msg.chat.id);
    await this._sendSystemStatus(userId);
  }

  async _sendSystemStatus(userId) {
    const [positions, activeSignals] = await Promise.all([
      this.db.getOpenPositions(userId),
      PAPER_SIGNAL_TRACKING_ENABLED ? this.db.getActivePaperSignals(userId) : Promise.resolve([]),
    ]);
    const currentSignals = PaperSignalStats.filterByExperiment(
      activeSignals,
      'current',
      CURRENT_PAPER_EXPERIMENT_ID
    );
    const pumpCount = PaperSignalStats.filterByProject(currentSignals, 'pump').length;
    const pumpV2Signals = PaperSignalStats.filterByExperiment(
      activeSignals,
      'current',
      PUMP_V2_EXPERIMENT_ID
    );
    const pumpV2Count = PaperSignalStats.filterByProject(pumpV2Signals, 'pump_v2').length;
    const hybridCount = PaperSignalStats.filterByProject(currentSignals, 'hybrid').length;
    const schedulerStatus = this.scheduler?.getStatus?.() || {};

    const text = [
      '⚙️ SCALPARENA STATUS',
      '━━━━━━━━━━━━━━━━━━━━',
      `Pump auto: ${this._isPumpAutoEnabled(userId) ? 'ON' : 'OFF'}`,
      `Последний цикл: ${this._formatStatusTime(schedulerStatus.lastPumpScan)}`,
      '',
      `Extreme Radar: ${schedulerStatus.extremeWideEnabled ? 'ON (research)' : 'OFF'}`,
      `Последний цикл: ${this._formatStatusTime(schedulerStatus.lastExtremeWideScan)}`,
      `Extreme events: ${schedulerStatus.extremeEventTrackingEnabled ? 'ON (research)' : 'OFF'}`,
      '',
      `Structure research: ${schedulerStatus.structureAutoResearchEnabled ? 'ON' : 'OFF'}`,
      `Последний цикл: ${this._formatStatusTime(schedulerStatus.lastStructureWideScan)}`,
      `Structure events: ${schedulerStatus.structureEventTrackingEnabled ? 'ON (research)' : 'OFF'}`,
      '',
      `Paper tracking: ${PAPER_SIGNAL_TRACKING_ENABLED ? 'ON' : 'OFF'}`,
      `Текущий эксперимент: ${CURRENT_PAPER_EXPERIMENT_ID}`,
      `Активные: Pump ${pumpCount} | Hybrid ${hybridCount}`,
      `Pump State V2.1: ${PUMP_V2_SHADOW_ENABLED ? 'ON' : 'OFF'} | активных ${pumpV2Count} | alerts OFF`,
      `Market Context V1: ${MARKET_CONTEXT_V1_ENABLED ? 'ON (research only)' : 'OFF'}`,
      `Ручные позиции: ${positions?.length || 0}`,
      'Live-сделки на Bybit: OFF',
    ].join('\n');

    await this._sendPlain(userId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `Pump auto: ${this._isPumpAutoEnabled(userId) ? 'ON' : 'OFF'}`,
              callback_data: 'menu_pump_auto_toggle',
            },
          ],
          [
            { text: '📊 Результаты', callback_data: 'menu_signals_current' },
            { text: '📋 Главное меню', callback_data: 'menu_home' },
          ],
        ],
      },
    });

    if (!positions || positions.length === 0) {
      return;
    }

    for (const pos of positions) {
      const pair = pos.pair.includes('USDT') ? pos.pair : `${pos.pair}USDT`;
      const candle = this.provider.getCurrentCandle(pair);
      const current = candle?.close || pos.entry_price;
      const direction = pos.trade_type || 'SHORT';
      const pnlResult = this._calculateTradePnl(pos, current);
      const pnl = pnlResult.netPnl;
      const pnlIcon = pnl >= 0 ? '✅' : '❌';
      const heldMin = Math.round((Date.now() - new Date(pos.entry_time)) / 60000);

      await this._send(
        userId,
        `
🔥 *АКТИВНАЯ ПОЗИЦИЯ*
════════════════════════════════

*${pos.pair}* ${direction === 'SHORT' ? '🔴 SHORT' : '🟢 LONG'}
Entry: \`$${pos.entry_price}\`
Current: \`$${current}\`
⏱️ Держим: *${heldMin} мин*

💰 P&L: *${pnl >= 0 ? '+' : ''}$${pnl}* ${pnlIcon} _(после fees)_
💸 Fees est: *$${pnlResult.totalFees}*

🛑 SL: \`$${pos.stop_loss}\`
🟢 TP: \`$${pos.take_profit}\`
      `,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: `💰 Закрыть ${pos.pair} по $${current}`,
                  callback_data: `close_${pos.id}_${current}`,
                },
              ],
            ],
          },
        }
      );
    }
  }

  _formatStatusTime(value) {
    if (!value) return 'ещё не запускался';

    return new Date(value).toLocaleString('ru-RU', {
      timeZone: 'Asia/Seoul',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async _onExit(msg, match) {
    const userId = String(msg.chat.id);
    const exitPrice = parseFloat(match[1]);

    if (isNaN(exitPrice) || exitPrice <= 0) {
      return this._send(userId, '❌ Укажи цену выхода. Пример: /exit 91.57');
    }

    const positions = await this.db.getOpenPositions(userId);

    if (positions.length === 0) {
      return this._send(userId, '❌ Нет открытых позиций');
    }

    // Закрыть первую открытую позицию
    const position = positions[0];
    const pnlResult = this._calculateTradePnl(position, exitPrice);

    // Закрыть в базе
    await this.db.closePosition(position.id, {
      exit_price: exitPrice,
      exit_time: new Date(),
      exit_reason: 'MANUAL',
      profit_loss: pnlResult.netPnl,
      status: 'CLOSED',
      ...this._buildFeeFields(pnlResult),
    });

    // Обновить баланс
    const newBalance = await this.db.updateBalance(userId, pnlResult.netPnl);

    const icon = pnlResult.netPnl >= 0 ? '✅' : '❌';

    await this._send(
      userId,
      `
${icon} *СДЕЛКА ЗАКРЫТА*
════════════════════════════════

*${position.pair}* ${position.trade_type || 'SHORT'}
Entry: \`$${position.entry_price}\`
Exit:  \`$${exitPrice}\`

💰 P&L: *${pnlResult.netPnl >= 0 ? '+' : ''}$${pnlResult.netPnl}* (после комиссий)
💸 Fees: *$${pnlResult.totalFees}*
💼 Новый баланс: *$${newBalance}*

📊 /stats — посмотреть статистику дня
    `
    );

    if (this.monitor) {
      const recent = await this.db.getTradesSince(
        userId,
        new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
      );
      await this.monitor.checkCooloff(
        userId,
        recent.filter((trade) => trade.status === 'CLOSED').reverse()
      );
    }
  }

  async _onStats(msg) {
    const userId = String(msg.chat.id);
    const user = await this.db.getUser(userId);
    if (!user) return this._send(userId, '❌ Сначала /start');

    const parts = this._getCommandParts(msg.text);
    const versionFilter = this._parseStrategyVersion(parts);
    const period = this._parseStatsPeriod(parts.find((part) => !this._isStrategyVersionArg(part) && part !== '/stats'));
    const trades = await this.db.getTradesSince(userId, period.since, {
      strategyVersion: versionFilter,
    });
    const stats = StatsCalculator.calculate(trades, user.balance_at_8am || user.account_balance);

    // Сообщение 1: Статистика
    await this._send(userId, `${period.title}${this._formatVersionTitle(versionFilter)}\n\n${StatsCalculator.formatMessage(stats)}`);

    if (trades.filter((trade) => trade.status === 'CLOSED').length === 0) {
      return this._send(userId, '📭 Закрытых сделок за период нет — GPT анализ пропущен.');
    }

    // Сообщение 2: GPT insights (через 2 сек)
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await this._send(userId, '🤖 Генерирую AI анализ...');

    const closedTrades = trades.filter((trade) => trade.status === 'CLOSED');
    const insights = await this.analyzer.generateDailyInsights(closedTrades, stats);

    await this._sendPlain(
      userId,
      `🤖 AI INSIGHTS
──────────────────────────────

${insights}

──────────────────────────────
✅ До встречи завтра в 08:00!
  `.trim()
    );
  }

  async _onCandidates(msg) {
    const userId = String(msg.chat.id);
    const parts = this._getCommandParts(msg.text);
    const mode = parts[1] || 'top';

    return this._sendCandidates(userId, mode);
  }

  async _onCandidateAuto(msg, match) {
    const userId = String(msg.chat.id);
    const action = String(match?.[1] || 'status').toLowerCase();

    if (action === 'on') {
      this.candidateAutoOverrides.set(userId, true);
      return this._sendPlain(userId, this._formatCandidateAutoStatus(userId, '✅ Candidate research включен для текущего runtime.'));
    }

    if (action === 'off') {
      this.candidateAutoOverrides.set(userId, false);
      return this._sendPlain(userId, this._formatCandidateAutoStatus(userId, '⏸️ Candidate research выключен для текущего runtime.'));
    }

    if (action !== 'status') {
      return this._sendPlain(userId, 'Используй: /candidate_auto on, /candidate_auto off или /candidate_auto status. Также работает /candidateauto.');
    }

    return this._sendPlain(userId, this._formatCandidateAutoStatus(userId));
  }

  async _onPumpAuto(msg, match) {
    const userId = String(msg.chat.id);
    const action = String(match?.[1] || 'status').toLowerCase();

    if (action === 'on') {
      this.pumpAutoOverrides.set(userId, true);
      return this._sendPlain(userId, this._formatPumpAutoStatus(userId, '✅ Pump auto включен для текущего runtime.'));
    }

    if (action === 'off') {
      this.pumpAutoOverrides.set(userId, false);
      return this._sendPlain(userId, this._formatPumpAutoStatus(userId, '⏸️ Pump auto выключен для текущего runtime.'));
    }

    if (action !== 'status') {
      return this._sendPlain(userId, 'Используй: /pump_auto on, /pump_auto off или /pump_auto status. Также работает /pumpauto.');
    }

    return this._sendPlain(userId, this._formatPumpAutoStatus(userId));
  }

  async _onPump(msg) {
    const userId = String(msg.chat.id);
    const parts = this._getCommandParts(msg.text);
    const mode = parts[1] || 'top';

    if (mode === 'debug') {
      return this._sendPumpHunterDebug(userId);
    }

    return this._sendPumpHunter(userId, mode);
  }

  async _onExtreme(msg) {
    const userId = String(msg.chat.id);
    const parts = this._getCommandParts(msg.text);
    const mode = String(parts[1] || 'status').toLowerCase();

    if (mode === 'status') {
      let storageStatus = 'NOT READY';
      let activeEvents = 'n/a';
      let eventStates = 'n/a';

      try {
        const events = await this.db.getActiveExtremeEvents();
        storageStatus = 'READY';
        activeEvents = events.length;
        const stateCounts = events.reduce((counts, event) => {
          counts[event.state] = (counts[event.state] || 0) + 1;
          return counts;
        }, {});
        eventStates = [
          `WATCH ${stateCounts.WATCH || 0}`,
          `ARMED ${stateCounts.ARMED || 0}`,
          `TRIGGERED ${stateCounts.TRIGGERED || 0}`,
        ].join(' | ');
      } catch (error) {
        const message = String(error?.message || '');
        storageStatus = (
          error?.code === '42P01' ||
          error?.code === 'PGRST205' ||
          message.includes('extreme_events')
        ) ? 'MIGRATION REQUIRED' : 'UNAVAILABLE';
      }

      return this._sendPlain(
        userId,
        [
          '⚡ Extreme Radar',
          '━━━━━━━━━━━━━━━━━━━━',
          `Проект: ${EXTREME_PROJECT}`,
          `Эксперимент: ${EXTREME_EXPERIMENT_ID}`,
          `Хранилище extreme_events: ${storageStatus}`,
          `Активных research-событий: ${activeEvents}`,
          `Состояния: ${eventStates}`,
          '',
          `Radar engine: ${EXTREME_RADAR_ENABLED ? 'ON' : 'OFF'}`,
          `Торговое автосканирование: ${EXTREME_AUTO_SCAN_ENABLED ? 'ON' : 'OFF'}`,
          `Wide diagnostics auto: ${EXTREME_WIDE_SCAN_ENABLED ? 'ON' : 'OFF'}` +
            ` | ${Math.round(EXTREME_WIDE_SCAN_INTERVAL_MS / 60000)} мин`,
          `Event lifecycle: ${EXTREME_EVENT_TRACKING_ENABLED ? 'ON (research only)' : 'OFF'}`,
          `Paper-сигналы: ${EXTREME_PAPER_SIGNALS_ENABLED ? 'ON' : 'OFF'}`,
          'Live-сделки: OFF',
          '',
          'Запустить широкий диагностический срез: /extreme scan',
          `Проверить базовую пару: /extreme debug`,
          'Проверить монету: /extreme debug DEXEUSDT',
        ].join('\n')
      );
    }

    if (mode === 'scan') {
      await this._sendPlain(
        userId,
        '⚡ Extreme Radar проверяет широкий рынок. Сигналы и события не создаются...'
      );

      const scan = await ExtremeWideRadar.scan(this.provider);
      scan.diagnosticSaved = false;

      try {
        await this.db.createResearchScanDiagnostic(
          ExtremeWideRadar.toDiagnostic(scan)
        );
        scan.diagnosticSaved = true;
      } catch (error) {
        console.error(
          '❌ Extreme manual diagnostic write failed:',
          error?.message || error
        );
      }

      return this._sendPlain(
        userId,
        ExtremeWideFormatter.format(scan)
      );
    }

    if (mode !== 'debug') {
      return this._sendPlain(
        userId,
        '❌ Используй /extreme, /extreme scan или /extreme debug DEXEUSDT'
      );
    }

    const pair = parts[2] || EXTREME_AUDIT_SYMBOL;
    let normalizedPair;

    try {
      normalizedPair = ExtremeDataAudit.normalizePair(pair);
    } catch (error) {
      return this._sendPlain(
        userId,
        '❌ Неверная пара. Используй формат /extreme debug BTCUSDT'
      );
    }

    await this._sendPlain(
      userId,
      `⚡ Extreme Radar проверяет данные ${normalizedPair}. Сигналы не запускаются...`
    );

    const report = await ExtremeDataAudit.run(this.provider, normalizedPair, {
      timeoutMs: EXTREME_AUDIT_TIMEOUT_MS,
    });
    return this._sendPlain(userId, ExtremeAuditFormatter.format(report));
  }

  async _onStructure(msg) {
    const userId = String(msg.chat.id);
    const parts = this._getCommandParts(msg.text);
    const mode = String(parts[1] || 'status').toLowerCase();

    if (mode === 'status') {
      let storageStatus = 'NOT READY';
      let activeEvents = 'n/a';
      let eventStates = 'n/a';

      try {
        const events = await this.db.getActiveStructureEvents();
        storageStatus = 'READY';
        activeEvents = events.length;
        const stateCounts = events.reduce((counts, event) => {
          counts[event.state] = (counts[event.state] || 0) + 1;
          return counts;
        }, {});
        eventStates = [
          `WATCH ${stateCounts.WATCH || 0}`,
          `ARMED ${stateCounts.ARMED || 0}`,
          `TRIGGERED ${stateCounts.TRIGGERED || 0}`,
        ].join(' | ');
      } catch (error) {
        const message = String(error?.message || '');
        storageStatus = (
          error?.code === '42P01' ||
          error?.code === 'PGRST205' ||
          message.includes('structure_events')
        ) ? 'MIGRATION REQUIRED' : 'UNAVAILABLE';
      }

      return this._sendPlain(
        userId,
        [
          '🏗 Structure Breakout',
          '━━━━━━━━━━━━━━━━━━━━',
          `Проект: ${STRUCTURE_PROJECT}`,
          `Аудит данных: ${STRUCTURE_EXPERIMENT_ID}`,
          `Исследование уровней: ${STRUCTURE_LEVEL_EXPERIMENT_ID}`,
          `Wide Radar: ${STRUCTURE_WIDE_EXPERIMENT_ID}`,
          `Event lifecycle: ${STRUCTURE_EVENT_EXPERIMENT_ID}`,
          `Paper experiment: ${STRUCTURE_PAPER_EXPERIMENT_ID}`,
          `Хранилище structure_events: ${storageStatus}`,
          `Активных research-событий: ${activeEvents}`,
          `Состояния: ${eventStates}`,
          '',
          'Data Audit: ON (ручная проверка)',
          `Level Engine: ${STRUCTURE_LEVEL_ENGINE_ENABLED ? 'ON (ручная диагностика)' : 'OFF'}`,
          `Wide Radar: ${STRUCTURE_WIDE_SCAN_ENABLED ? 'ON (ручная диагностика)' : 'OFF'}`,
          `Глубокий анализ за scan: до ${STRUCTURE_WIDE_SCAN_LIMIT} пар`,
          `Минимальный оборот: $${Math.round(STRUCTURE_WIDE_MIN_TURNOVER_USD / 1000000)}M`,
          `Авто research scan: ${STRUCTURE_AUTO_RESEARCH_ENABLED ? 'ON' : 'OFF'}` +
            ` | ${Math.round(STRUCTURE_AUTO_SCAN_INTERVAL_MS / 60000)} мин`,
          `Events: ${STRUCTURE_EVENT_TRACKING_ENABLED ? 'ON (research only)' : 'OFF'}`,
          `Paper-сигналы: ${STRUCTURE_PAPER_SIGNALS_ENABLED ? 'ON' : 'OFF'}`,
          `Paper gate: retest + RR ≥ ${STRUCTURE_PAPER_MIN_RR}` +
            ` | риск ≤ ${STRUCTURE_PAPER_MAX_RISK_PERCENT}%` +
            ` | TTL ${STRUCTURE_PAPER_TTL_MINUTES} мин`,
          `Telegram-алерты: ${STRUCTURE_ALERTS_ENABLED ? 'ON' : 'OFF'}`,
          'Live-сделки: OFF',
          '',
          'Проверить данные: /structure debug BTCUSDT',
          'Построить зоны: /structure levels BTCUSDT',
          'Проверить широкий рынок: /structure scan',
          'Активные события: /structure events',
          'Проверить широкую монету: /structure debug DEXEUSDT',
        ].join('\n')
      );
    }

    if (mode === 'scan') {
      await this._sendPlain(
        userId,
        '🏗 Structure Radar проверяет рынок. Paper и Telegram-алерты не создаются...'
      );
      let priorityPairs = [];
      if (STRUCTURE_EVENT_TRACKING_ENABLED) {
        try {
          const activeEvents = await this.db.getActiveStructureEvents();
          priorityPairs = activeEvents.map((event) => event.pair);
        } catch (_error) {
          priorityPairs = [];
        }
      }
      const scan = await StructureWideRadar.scan(this.provider, {
        priorityPairs,
      });
      scan.diagnosticSaved = false;

      if (STRUCTURE_EVENT_TRACKING_ENABLED) {
        try {
          const tracker = this.structureEventTracker ||
            new StructureEventTracker(this.db);
          scan.eventTracking = await tracker.processScan(scan);
          scan.eventsCreated = scan.eventTracking.created;
        } catch (error) {
          console.error(
            '❌ Structure manual event tracking failed:',
            error?.message || error
          );
        }
      }

      try {
        await this.db.createResearchScanDiagnostic(
          StructureWideRadar.toDiagnostic(scan)
        );
        scan.diagnosticSaved = true;
      } catch (error) {
        console.error(
          '❌ Structure manual diagnostic write failed:',
          error?.message || error
        );
      }

      return this._sendPlain(userId, StructureWideFormatter.format(scan));
    }

    if (mode === 'events') {
      try {
        const events = await this.db.getActiveStructureEvents();
        return this._sendPlain(
          userId,
          StructureEventFormatter.format(events)
        );
      } catch (error) {
        return this._sendPlain(
          userId,
          '❌ Structure events недоступны. Проверь миграцию structure_events.'
        );
      }
    }

    if (mode !== 'debug' && mode !== 'levels') {
      return this._sendPlain(
        userId,
        '❌ Используй /structure, /structure scan, /structure events, /structure debug DEXEUSDT или /structure levels BTCUSDT'
      );
    }

    let pair;
    try {
      pair = StructureDataAudit.normalizePair(parts[2] || 'BTCUSDT');
    } catch (_error) {
      return this._sendPlain(
        userId,
        `❌ Неверная пара. Используй формат /structure ${mode} BTCUSDT`
      );
    }

    if (mode === 'levels') {
      await this._sendPlain(
        userId,
        `🏗 Structure строит 4H/1H зоны ${pair}. Торговые сигналы не запускаются...`
      );
      const report = await StructureLevelEngine.analyze(this.provider, pair);
      return this._sendPlain(userId, StructureLevelFormatter.format(report));
    }

    await this._sendPlain(
      userId,
      `🏗 Structure проверяет 4H/1H/15m данные ${pair}. Сигналы не запускаются...`
    );
    const report = await StructureDataAudit.run(this.provider, pair);
    return this._sendPlain(userId, StructureAuditFormatter.format(report));
  }

  async _sendPumpHunterDebug(userId) {
    await this._sendPlain(userId, '🧪 PumpHunter debug: проверяю Bybit public REST...');

    const bybitTickers = await this.provider.getLinearTickers();
    const marketError = this._formatPublicMarketError(this.provider.lastPublicMarketError);
    const proxyError = this._formatPublicMarketError(this.provider.lastSupabaseProxyError);
    const fallbackMarkets = this._parseFallbackMarkets(PUMP_HUNTER_FALLBACK_MARKET);
    let fallbackSource = 'none';
    let fallbackTickers = [];

    if (!bybitTickers.length && fallbackMarkets.includes('binance')) {
      fallbackTickers = await this.provider.getBinanceFuturesTickers();
      fallbackSource = fallbackTickers.length ? 'binance' : 'none';
    }

    if (!bybitTickers.length && !fallbackTickers.length && fallbackMarkets.includes('okx')) {
      fallbackTickers = await this.provider.getOkxSwapTickers();
      fallbackSource = fallbackTickers.length ? 'okx' : 'none';
    }

    const tickers = bybitTickers.length ? bybitTickers : fallbackTickers;
    const universe = PumpHunterEngine.selectTickerUniverse(tickers, PUMP_HUNTER_SCAN_LIMIT);
    const first = universe.slice(0, 5).map((ticker) => ticker.symbol).join(', ') || 'none';
    const binanceError = this._formatPublicMarketError(this.provider.lastBinanceMarketError);
    const okxError = this._formatPublicMarketError(this.provider.lastOkxMarketError);

    return this._sendPlain(
      userId,
      [
        '🧪 PumpHunter debug',
        '━━━━━━━━━━━━━━━━━━━━',
        `Bybit tickers received: ${bybitTickers.length}`,
        `Fallback market: ${fallbackMarkets.length ? fallbackMarkets.join(',') : 'off'}`,
        `Fallback source used: ${fallbackSource}`,
        `Fallback tickers received: ${fallbackTickers.length}`,
        `Tickers used: ${tickers.length}`,
        `Universe after filters: ${universe.length}`,
        `Scan limit: ${PUMP_HUNTER_SCAN_LIMIT}`,
        `REST hosts: ${(this.provider.publicMarketRestBases || []).join(', ')}`,
        `Last host used: ${this.provider.lastPublicMarketHost || 'n/a'}`,
        `Proxy configured: ${this.provider.supabaseProxyUrl ? 'yes' : 'no'}`,
        `Proxy auth configured: ${this.provider.supabaseProxyKey ? 'yes' : 'no'}`,
        `Proxy version: ${this.provider.lastSupabaseProxyVersion || 'n/a'}`,
        `Last REST error: ${marketError}`,
        `Last proxy error: ${proxyError}`,
        `Last Binance error: ${binanceError}`,
        `Last OKX error: ${okxError}`,
        `First symbols: ${first}`,
      ].join('\n')
    );
  }

  _parseFallbackMarkets(value) {
    return String(value || '')
      .split(',')
      .map((market) => market.trim().toLowerCase())
      .filter((market) => market && market !== 'none' && market !== 'off');
  }

  _formatPublicMarketError(error) {
    if (!error) return 'none';

    const head = [error.status, error.message].filter(Boolean).join(' ');
    const attempts = (error.attempts || [])
      .map((attempt) => `${attempt.base || 'unknown'}:${attempt.status || attempt.error || 'failed'}`)
      .join(', ');

    return attempts ? `${head}; attempts ${attempts}` : head;
  }

  async _sendPumpHunter(userId, mode = 'top') {
    await this._sendPlain(
      userId,
      `🚀 PumpHunter сканирует Bybit futures: top ${PUMP_HUNTER_SCAN_LIMIT} по импульсу...`
    );

    const reports = await PumpHunterEngine.scan(this.provider, {
      scanLimit: PUMP_HUNTER_SCAN_LIMIT,
      interval: PUMP_HUNTER_KLINE_INTERVAL,
      klineLimit: PUMP_HUNTER_KLINE_LIMIT,
      fallbackMarket: PUMP_HUNTER_FALLBACK_MARKET,
    });
    const actionable = PumpHunterEngine.getActionable(reports, PUMP_HUNTER_ACTIONABLE_LIMIT);
    const keyboard = this._getPumpHunterKeyboard(actionable.length, {
      includeDetails: mode !== 'full',
    });

    if (mode === 'full') {
      await this._sendPlainChunks(userId, PumpHunterFormatter.formatFull(reports));
      const message = await this._sendPlain(userId, '👇 Действия с текущим PumpHunter отчетом:', {
        reply_markup: keyboard,
      });
      this._storePumpSnapshot(userId, message, reports, actionable, mode);
      return message;
    }

    if (mode === 'paper') {
      const tracked = await this._trackPumpHunterActionables(userId, actionable);
      await this._sendPlain(userId, PumpHunterFormatter.formatPaperResult(tracked));
      const message = await this._sendPlain(userId, PumpHunterFormatter.formatTop(reports, actionable), {
        reply_markup: keyboard,
      });
      this._storePumpSnapshot(userId, message, reports, actionable, mode);
      return message;
    }

    const message = await this._sendPlain(userId, PumpHunterFormatter.formatTop(reports, actionable), {
      reply_markup: keyboard,
    });
    this._storePumpSnapshot(userId, message, reports, actionable, mode);
    return message;
  }

  async _sendCandidates(userId, mode = 'top') {

    if (!this.ready) {
      return this._send(userId, '⏳ Провайдер данных загружается... Попробуй через 30 сек');
    }

    await this._sendPlain(userId, '🧠 Анализирую market candidates по 15 парам...');

    const reports = CandidateEngine.scanAll(this.provider);
    const actionable = CandidateEngine.getActionableCandidates(reports, 3);
    const keyboard = this._getCandidateKeyboard(actionable.length, {
      includeDetails: mode !== 'full',
    });

    if (mode === 'full') {
      await this._sendPlainChunks(userId, CandidateFormatter.formatFull(reports));
      const message = await this._sendPlain(userId, '👇 Действия с текущими candidates:', {
        reply_markup: keyboard,
      });
      this._storeCandidateSnapshot(userId, message, reports, actionable, mode);
      return message;
    }

    if (mode === 'paper') {
      if (!PAPER_SIGNAL_TRACKING_ENABLED) {
        await this._sendPlain(
          userId,
          '🧪 Paper tracking выключен. Включи PAPER_SIGNAL_TRACKING_ENABLED=true в Railway Variables и redeploy, чтобы записывать candidates.'
        );
        const message = await this._sendPlain(userId, CandidateFormatter.formatTop(reports, actionable), {
          reply_markup: keyboard,
        });
        this._storeCandidateSnapshot(userId, message, reports, actionable, mode);
        return message;
      }

      const tracked = await this._trackCandidateActionables(userId, actionable);

      await this._sendPlain(userId, CandidateFormatter.formatPaperResult(tracked));
      const message = await this._sendPlain(userId, CandidateFormatter.formatTop(reports, actionable), {
        reply_markup: keyboard,
      });
      this._storeCandidateSnapshot(userId, message, reports, actionable, mode);
      return message;
    }

    const message = await this._sendPlain(userId, CandidateFormatter.formatTop(reports, actionable), {
      reply_markup: keyboard,
    });
    this._storeCandidateSnapshot(userId, message, reports, actionable, mode);
    return message;
  }

  async _onPatterns(msg) {
    const userId = String(msg.chat.id);
    const user = await this.db.getUser(userId);
    if (!user) return this._send(userId, '❌ Сначала /start');

    const parts = this._getCommandParts(msg.text);
    const isFull = parts[1] === 'full';
    const versionFilter = this._parseStrategyVersion(parts);
    const daysArg = parts.find((part, index) => {
      return index > 1 && !this._isStrategyVersionArg(part);
    });
    const period = this._parseDaysPeriod(daysArg, 7);
    const days = period.days;

    if (isFull) {
      await this._sendPlain(userId, '🔄 Собираю детальную аналитику...');

      const analytics = await StatsCalculator.getDetailedAnalytics(this.db, userId, days, {
        strategyVersion: versionFilter,
      });
      const message = formatDetailedAnalytics(analytics, period.isAll ? 'all' : days);

      await this._sendPlainChunks(userId, `${message}${this._formatPlainVersionTitle(versionFilter)}`);

      try {
        await this._sendPlain(userId, '🤖 GPT анализирует паттерны...');
        const insights = await this.analyzer.analyzeDetailedPatterns(analytics);

        await this._sendPlain(
          userId,
          `💡 GPT ИНСАЙТЫ
════════════════════════════════

${insights}`
        );
      } catch (error) {
        console.error('❌ GPT pattern insights error:', error.message);
      }

      return;
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const trades = await this.db.getTradesSince(userId, since, {
      strategyVersion: versionFilter,
    });
    const stats = StatsCalculator.calculate(trades, user.balance_at_8am || user.account_balance);

    await this._send(
      userId,
      `${StatsCalculator.formatPatternMessage(stats, days)}\n\n💡 Детали: /patterns full`
    );
  }

  async _onSignals(msg) {
    const userId = String(msg.chat.id);
    const user = await this.db.getUser(userId);
    if (!user) return this._send(userId, '❌ Сначала /start');

    const parts = this._getCommandParts(msg.text);
    await this._sendPaperSignalStats(userId, parts.slice(1), user);
  }

  async _onResearch(msg) {
    const userId = String(msg.chat.id);
    const user = await this.db.getUser(userId);
    if (!user) return this._send(userId, '❌ Сначала /start');

    return this._sendResearchReadiness(userId);
  }

  async _sendResearchReadiness(userId) {
    const signals = await this.db.getPaperSignalsSince(userId, new Date(0));
    const researchSignals = signals.filter((signal) => (
      signal.experiment_id === PUMP_V2_EXPERIMENT_ID
    ));
    const readiness = ResearchReadiness.calculate(researchSignals, {
      experimentId: PUMP_V2_EXPERIMENT_ID,
    });

    await this._sendPlain(userId, ResearchReadiness.format(readiness));
  }

  async _sendPaperSignalStats(userId, args = [], user = null) {
    const options = this._parsePaperSignalStatsArgs(args);
    const period = this._parseStatsPeriod(options.period);
    const statsUser = user || await this.db.getUser(userId);
    const signals = await this.db.getPaperSignalsSince(userId, period.since);
    const currentExperimentId = ['candidate_v3', 'candidates'].includes(options.project)
      ? CANDIDATE_V3_EXPERIMENT_ID
      : options.project === 'pump_v2'
        ? PUMP_V2_EXPERIMENT_ID
        : CURRENT_PAPER_EXPERIMENT_ID;
    const experimentSignals = options.scope === 'current' && options.project === 'all'
      ? signals.filter((signal) => (
        signal.is_legacy === false && [
          CURRENT_PAPER_EXPERIMENT_ID,
          CANDIDATE_V3_EXPERIMENT_ID,
          PUMP_V2_EXPERIMENT_ID,
        ].includes(signal.experiment_id)
      ))
      : PaperSignalStats.filterByExperiment(signals, options.scope, currentExperimentId);
    const activeExperimentSignals = options.scope === 'current' && options.project === 'all'
      ? this._excludeRetiredCandidateSignals(experimentSignals)
      : experimentSignals;
    const projectSignals = PaperSignalStats.filterByProject(
      activeExperimentSignals,
      options.project
    );
    const title = this._formatPaperSignalStatsTitle(
      period.title.replace(/[*📊]/g, '').replace('Период:', '').trim(),
      options.project,
      options.scope
    );

    if (options.mode === 'watching') {
      await this._sendPlain(userId, PaperSignalStats.formatWatching(projectSignals, title));
      return;
    }

    if (options.mode === 'detail') {
      await this._sendPlainChunks(userId, PaperSignalStats.formatDetail(projectSignals, title));
      return;
    }

    if (options.mode === 'edge') {
      await this._sendPlainChunks(userId, PaperSignalStats.formatEdge(projectSignals, title, {
        balance: statsUser?.account_balance || 200,
      }));
      return;
    }

    if (options.mode === 'staged_exit') {
      await this._sendPlainChunks(
        userId,
        PaperSignalStats.formatStagedExitStudy(projectSignals, title, {
          balance: statsUser?.account_balance || 200,
        })
      );
      return;
    }

    const stats = PaperSignalStats.calculate(projectSignals, {
      balance: statsUser?.account_balance || 200,
    });

    await this._sendPlain(
      userId,
      PaperSignalStats.format(stats, title)
    );
  }

  _parsePaperSignalStatsArgs(args = []) {
    let mode = 'stats';
    let project = 'all';
    let scope = 'current';
    let period = undefined;

    args.forEach((raw) => {
      const value = String(raw || '').toLowerCase();
      if (!value) return;

      if (['open', 'watching', 'active'].includes(value)) {
        mode = 'watching';
      } else if (['detail', 'details', 'full'].includes(value)) {
        mode = 'detail';
      } else if (['edge', 'mfe', 'profit'].includes(value)) {
        mode = 'edge';
      } else if (['exit', 'exits', 'staged', 'tp1'].includes(value)) {
        mode = 'staged_exit';
      } else if (['pump', 'pumphunter'].includes(value)) {
        project = 'pump';
      } else if (['candidate', 'candidates'].includes(value)) {
        project = 'candidate_v3';
      } else if (['candidate_v3', 'candidates_v3'].includes(value)) {
        project = 'candidate_v3';
      } else if (['candidate_v1', 'candidates_v1'].includes(value)) {
        project = 'candidate_v1';
      } else if (['candidate_v2', 'candidates_v2', 'shadow'].includes(value)) {
        project = 'candidate_v2';
      } else if (['pump_v2', 'pump_shadow', 'pump_state'].includes(value)) {
        project = 'pump_v2';
      } else if (['pump_v2_baseline', 'pump_baseline'].includes(value)) {
        project = 'pump_v2_baseline';
      } else if (['hybrid', 'scan'].includes(value)) {
        project = 'hybrid';
      } else if (['current', 'new'].includes(value)) {
        scope = 'current';
      } else if (['legacy', 'archive', 'old'].includes(value)) {
        scope = 'legacy';
      } else if (['history', 'combined'].includes(value)) {
        scope = 'history';
      } else {
        period = value;
      }
    });

    if (scope === 'legacy' && project === 'candidate_v3') project = 'candidate_v1';
    return { mode, project, scope, period };
  }

  _excludeRetiredCandidateSignals(signals = []) {
    const retiredProjects = new Set([
      'CANDIDATE',
      'CANDIDATE_V2_SHADOW',
      'CANDIDATE_V3',
    ]);
    const retiredSources = new Set([
      'CANDIDATE_ENGINE',
      'CANDIDATE_AUTO',
      'CANDIDATE_V2_SHADOW',
      'CANDIDATE_V3',
    ]);

    return signals.filter((signal) => (
      !retiredProjects.has(signal.project) &&
      !retiredSources.has(signal.source)
    ));
  }

  _formatPaperSignalStatsTitle(periodTitle, project = 'all', scope = 'current') {
    const projectTitle = {
      all: 'все проекты',
      pump: 'PumpHunter',
      candidate_v3: 'Candidate V3',
      candidate_v1: 'Candidate V1 alerts',
      candidate_v2: 'Candidate Breakout V2 shadow',
      pump_v2: 'Pump State V2.1 · ATR ≤ 1.3',
      pump_v2_baseline: 'Pump State V2 baseline',
      hybrid: 'Hybrid scan',
    }[project] || project;
    const scopeTitle = {
      current: project === 'all' ? 'текущие эксперименты' : 'текущий эксперимент',
      legacy: 'архив LEGACY',
      history: 'вся история',
    }[scope] || scope;

    return `${periodTitle} | ${projectTitle} | ${scopeTitle}`;
  }

  _getCandidateKeyboard(actionableCount = 0, options = {}) {
    const rows = [];
    const includeDetails = options.includeDetails !== false;

    if (actionableCount > 0) {
      rows.push([{
        text: `🧪 Записать в paper (${actionableCount})`,
        callback_data: 'candidates_paper',
      }]);
    }

    const navigationRow = [];
    if (includeDetails) {
      navigationRow.push({ text: '📋 Подробнее', callback_data: 'candidates_full' });
    }
    navigationRow.push({ text: '🔄 Новый скан', callback_data: 'candidates_refresh' });

    rows.push(
      navigationRow,
      [
        { text: '📊 Candidate V1 · 7д', callback_data: 'candidates_stats' },
      ]
    );

    return {
      inline_keyboard: rows,
    };
  }

  _getPumpHunterKeyboard(actionableCount = 0, options = {}) {
    const rows = [];
    const includeDetails = options.includeDetails !== false;

    if (actionableCount > 0) {
      rows.push([{
        text: `🧪 Записать в paper (${actionableCount})`,
        callback_data: 'pump_paper',
      }]);
    }

    const navigationRow = [];
    if (includeDetails) {
      navigationRow.push({ text: '📋 Подробнее', callback_data: 'pump_full' });
    }
    navigationRow.push({ text: '🔄 Новый скан', callback_data: 'pump_refresh' });

    rows.push(
      navigationRow,
      [
        { text: '📊 Pump V1 · 7д', callback_data: 'pump_stats' },
      ]
    );

    return {
      inline_keyboard: rows,
    };
  }

  async _sendCandidateSnapshotDetails(userId, messageId) {
    const snapshot = this._getCandidateSnapshot(userId, messageId);
    if (!snapshot) {
      return this._sendPlain(userId, '⏰ Этот отчёт устарел. Нажми «Новый скан», чтобы получить актуальные данные.');
    }

    return this._sendPlainChunks(userId, CandidateFormatter.formatFull(snapshot.reports));
  }

  async _sendPumpSnapshotDetails(userId, messageId) {
    const snapshot = this._getPumpSnapshot(userId, messageId);
    if (!snapshot) {
      return this._sendPlain(userId, '⏰ Этот отчёт устарел. Нажми «Новый скан», чтобы получить актуальные данные.');
    }

    return this._sendPlainChunks(userId, PumpHunterFormatter.formatFull(snapshot.reports));
  }

  async _writeCandidateSnapshotToPaper(userId, messageId) {
    const snapshot = this._getCandidateSnapshot(userId, messageId);

    if (!snapshot) {
      return this._sendPlain(
        userId,
        '⏰ Этот отчет candidates уже устарел. Нажми «Обновить» и запиши входы из нового отчета.'
      );
    }

    if (!PAPER_SIGNAL_TRACKING_ENABLED) {
      return this._sendPlain(
        userId,
        '🧪 Paper tracking выключен. Включи PAPER_SIGNAL_TRACKING_ENABLED=true в Railway Variables и redeploy, чтобы записывать candidates.'
      );
    }

    if (snapshot.trackedAt) {
      return this._sendPlain(userId, '✅ Эти входы уже были записаны в paper из этого отчета.');
    }

    const tracked = await this._trackCandidateActionables(userId, snapshot.actionable);
    snapshot.trackedAt = Date.now();
    await this._replaceReportKeyboard(userId, messageId, this._getCandidateKeyboard(0, {
      includeDetails: snapshot.mode !== 'full',
    }));
    return this._sendPlain(userId, CandidateFormatter.formatPaperResult(tracked));
  }

  async _writePumpSnapshotToPaper(userId, messageId) {
    const snapshot = this._getPumpSnapshot(userId, messageId);

    if (!snapshot) {
      return this._sendPlain(
        userId,
        '⏰ Этот PumpHunter отчет уже устарел. Нажми «Обновить» и запиши входы из нового отчета.'
      );
    }

    if (snapshot.trackedAt) {
      return this._sendPlain(userId, '✅ Эти pump-входы уже были записаны в paper из этого отчета.');
    }

    const tracked = await this._trackPumpHunterActionables(userId, snapshot.actionable);
    snapshot.trackedAt = Date.now();
    await this._replaceReportKeyboard(userId, messageId, this._getPumpHunterKeyboard(0, {
      includeDetails: snapshot.mode !== 'full',
    }));
    return this._sendPlain(userId, PumpHunterFormatter.formatPaperResult(tracked));
  }

  async _replaceReportKeyboard(userId, messageId, keyboard) {
    if (!this.bot?.editMessageReplyMarkup) return;

    try {
      await this.bot.editMessageReplyMarkup(keyboard, {
        chat_id: userId,
        message_id: messageId,
      });
    } catch (error) {
      console.error('❌ Telegram report keyboard update failed:', error?.message || error);
    }
  }

  async _trackCandidateActionables(userId, actionable = []) {
    const tracked = [];

    for (const candidate of actionable) {
      const paperSignal = CandidateEngine.toPaperSignal(candidate);
      const saved = await this._trackPaperSignal(userId, paperSignal, 'CANDIDATE_ENGINE');
      if (saved) tracked.push(candidate);
    }

    return tracked;
  }

  async _trackPumpHunterActionables(userId, actionable = []) {
    const tracked = [];

    for (const candidate of actionable) {
      const paperSignal = PumpHunterEngine.toPaperSignal(candidate);
      const saved = await this._trackPaperSignal(userId, paperSignal, 'PUMP_HUNTER');
      if (saved) tracked.push(candidate);
    }

    return tracked;
  }

  _storeCandidateSnapshot(userId, message, reports, actionable, mode = 'top') {
    if (!message?.message_id) return;

    const key = this._candidateSnapshotKey(userId, message.message_id);
    this.candidateSnapshots.set(key, {
      reports,
      actionable,
      mode,
      createdAt: Date.now(),
    });
    this._cleanupCandidateSnapshots();
  }

  _getCandidateSnapshot(userId, messageId) {
    const key = this._candidateSnapshotKey(userId, messageId);
    const snapshot = this.candidateSnapshots.get(key);
    const maxAgeMs = 10 * 60 * 1000;

    if (!snapshot) return null;
    if (Date.now() - snapshot.createdAt > maxAgeMs) {
      this.candidateSnapshots.delete(key);
      return null;
    }

    return snapshot;
  }

  _storePumpSnapshot(userId, message, reports, actionable, mode = 'top') {
    if (!message?.message_id) return;

    const key = this._pumpSnapshotKey(userId, message.message_id);
    this.pumpSnapshots.set(key, {
      reports,
      actionable,
      mode,
      createdAt: Date.now(),
    });
    this._cleanupPumpSnapshots();
  }

  _getPumpSnapshot(userId, messageId) {
    const key = this._pumpSnapshotKey(userId, messageId);
    const snapshot = this.pumpSnapshots.get(key);
    const maxAgeMs = 10 * 60 * 1000;

    if (!snapshot) return null;
    if (Date.now() - snapshot.createdAt > maxAgeMs) {
      this.pumpSnapshots.delete(key);
      return null;
    }

    return snapshot;
  }

  _pumpSnapshotKey(userId, messageId) {
    return `${userId}:${messageId}`;
  }

  _cleanupPumpSnapshots() {
    const maxAgeMs = 10 * 60 * 1000;
    const now = Date.now();

    for (const [key, snapshot] of this.pumpSnapshots.entries()) {
      if (now - snapshot.createdAt > maxAgeMs) {
        this.pumpSnapshots.delete(key);
      }
    }
  }

  _candidateSnapshotKey(userId, messageId) {
    return `${userId}:${messageId}`;
  }

  _cleanupCandidateSnapshots() {
    const maxAgeMs = 10 * 60 * 1000;
    const now = Date.now();

    for (const [key, snapshot] of this.candidateSnapshots.entries()) {
      if (now - snapshot.createdAt > maxAgeMs) {
        this.candidateSnapshots.delete(key);
      }
    }
  }

  _getCommandParts(text = '') {
    return String(text).trim().split(/\s+/).filter(Boolean);
  }

  _isCandidateAutoEnabled(userId) {
    if (!CANDIDATE_PROJECT_ENABLED) return false;

    const key = String(userId);
    if (this.candidateAutoOverrides.has(key)) {
      return this.candidateAutoOverrides.get(key);
    }

    return CANDIDATE_AUTO_SCAN_ENABLED;
  }

  _formatCandidateAutoStatus(userId, prefix = '') {
    const enabled = this._isCandidateAutoEnabled(userId);
    const override = this.candidateAutoOverrides.has(String(userId))
      ? 'runtime override'
      : 'Railway env default';

    return [
      prefix,
      '🧠 Candidate research status',
      '━━━━━━━━━━━━━━━━━━━━',
      `Статус: ${enabled ? 'ON' : 'OFF'} (${override})`,
      `Интервал: ${Math.round(CANDIDATE_AUTO_SCAN_INTERVAL_MS / 60000)} мин`,
      `Candidate V1 alerts: ${CANDIDATE_V1_ALERTS_ENABLED ? 'ON' : 'OFF'}`,
      `V1 фильтр: score >= ${CANDIDATE_AUTO_MIN_SCORE}, RR >= ${CANDIDATE_AUTO_MIN_RR}`,
      `V1 cooldown по паре: ${CANDIDATE_AUTO_COOLDOWN_MINUTES} мин`,
      `V1 макс алертов за цикл: ${CANDIDATE_AUTO_MAX_ALERTS}`,
      `Candidate V3: ${CANDIDATE_V3_ENABLED ? 'ON' : 'OFF'} | max ${CANDIDATE_V3_MAX_PER_CYCLE} запись | alerts OFF`,
      'Candidate V2: ARCHIVE, новые записи отключены',
      `Старый Auto-scan: ${enabled ? 'PAUSED, чтобы не дублировать Candidate research' : 'ON'}`,
      'Live Bybit orders: OFF',
      '',
      'Постоянно включить после redeploy: CANDIDATE_AUTO_SCAN_ENABLED=true в Railway Variables.',
    ].filter(Boolean).join('\n');
  }

  _isPumpAutoEnabled(userId) {
    const key = String(userId);
    if (this.pumpAutoOverrides.has(key)) {
      return this.pumpAutoOverrides.get(key);
    }

    return PUMP_AUTO_SCAN_ENABLED;
  }

  _formatPumpAutoStatus(userId, prefix = '') {
    const enabled = this._isPumpAutoEnabled(userId);
    const override = this.pumpAutoOverrides.has(String(userId))
      ? 'runtime override'
      : 'Railway env default';

    return [
      prefix,
      '🚀 Pump auto status',
      '━━━━━━━━━━━━━━━━━━━━',
      `Статус: ${enabled ? 'ON' : 'OFF'} (${override})`,
      `Интервал: ${Math.round(PUMP_AUTO_SCAN_INTERVAL_MS / 60000)} мин`,
      `Фильтр: score >= ${PUMP_AUTO_MIN_SCORE}`,
      `Cooldown по паре: ${PUMP_AUTO_COOLDOWN_MINUTES} мин`,
      `Макс алертов за цикл: ${PUMP_AUTO_MAX_ALERTS}`,
      `State V2.1: ${PUMP_V2_SHADOW_ENABLED ? 'ON' : 'OFF'} | entry ≤ 1.3 ATR | max ${PUMP_V2_SHADOW_MAX_PER_CYCLE} записей | alerts OFF`,
      `Fallback market data: ${PUMP_HUNTER_FALLBACK_MARKET}`,
      'Live Bybit orders: OFF',
      '',
      'Постоянно включить после redeploy: PUMP_AUTO_SCAN_ENABLED=true в Railway Variables.',
    ].filter(Boolean).join('\n');
  }

  _parseDaysPeriod(value, defaultDays = 7) {
    if (value === 'all') {
      return { days: 9999, isAll: true };
    }

    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return { days: parsed, isAll: false };
    }

    return { days: defaultDays, isAll: false };
  }

  _parseStatsPeriod(value) {
    if (value === 'all') {
      return {
        since: new Date(0),
        title: '📊 *Период:* всё время',
      };
    }

    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return {
        since: new Date(Date.now() - parsed * 24 * 60 * 60 * 1000),
        title: `📊 *Период:* последние ${parsed} дн.`,
      };
    }

    return {
      since: StatsCalculator.getSeoulDayRange().start,
      title: '📊 *Период:* сегодня (Seoul)',
    };
  }

  _parseStrategyVersion(parts = []) {
    const versionArg = parts.find((part) => this._isStrategyVersionArg(part));
    if (!versionArg) return null;
    if (versionArg === 'v1') return LEGACY_STRATEGY_VERSION;
    if (versionArg === 'v2') return CURRENT_STRATEGY_VERSION;
    return versionArg;
  }

  _isStrategyVersionArg(value) {
    return value === 'v1' || value === 'v2' || /^v\d+_[a-z0-9_]+$/i.test(String(value || ''));
  }

  _formatVersionTitle(strategyVersion) {
    return strategyVersion ? `\n🧬 *Версия:* ${strategyVersion}` : '';
  }

  _formatPlainVersionTitle(strategyVersion) {
    return strategyVersion ? `\n\n🧬 Версия стратегии: ${strategyVersion}` : '';
  }

  async _onDeposit(msg, match) {
    const userId = String(msg.chat.id);
    const amount = parseFloat(match[1]);

    if (isNaN(amount) || amount <= 0) {
      return this._send(userId, '❌ Укажи сумму. Пример: /deposit 300');
    }

    const newBalance = await this.db.depositBalance(userId, amount);

    await this._send(
      userId,
      `
✅ *Депозит зачислен!*

Добавлено: *+$${amount}*
Новый баланс: *$${newBalance}*

Параметры торговли обновлены автоматически 🎯
    `
    );
  }

  async _onHelp(msg) {
    const userId = String(msg.chat.id);
    await this._sendPlain(
      userId,
      `📚 SCALPARENA
━━━━━━━━━━━━━━━━━━━━

/menu — главная панель и автопоиск
/pump — PumpHunter сейчас
/extreme — статус Extreme Radar
/extreme scan — широкий диагностический срез без сигналов
/extreme debug DEXEUSDT — аудит рыночных данных
/structure — статус Structure Breakout
/structure debug DEXEUSDT — аудит 4H/1H/15m свечей
/structure levels BTCUSDT — структура рынка и зоны 4H/1H
/structure scan — широкий диагностический поиск Structure
/structure events — активные WATCH/ARMED/TRIGGERED
/signals 7 — результаты текущего эксперимента
/research — готовность новых выборок
/status — автопоиск, наблюдения и режимы

Раздельные отчёты:
/signals pump 7
/signals pump edge 7
/signals pump_v2 detail 30
/signals pump_v2 exits 30
/signals pump_v2_baseline detail 30
/signals open pump

Архив до перезапуска эксперимента:
/signals legacy pump 30

Диагностика при необходимости:
/pump full
/pump debug
/extreme debug
/structure debug DEXEUSDT
/structure levels BTCUSDT
/structure scan
/structure events

Live-сделки на Bybit отключены. Бот собирает и проверяет paper-сигналы.`
    );
  }

  // ─────────────────────────────────────────
  // CALLBACK КНОПКИ
  // ─────────────────────────────────────────

  async _onCallback(query) {
    const userId = String(query.message.chat.id);
    const data = query.data;

    await this.bot.answerCallbackQuery(query.id);

    if (data === 'menu_home') {
      return this._sendMainMenu(userId);
    }

    if (data === 'menu_candidates') {
      return this._sendMainMenu(
        userId,
        '🗄 Candidate выведен из активного проекта. Исторические данные сохранены в Supabase.'
      );
    }

    if (data === 'menu_pump') {
      return this._sendPumpHunter(userId, 'top');
    }

    if (data === 'menu_extreme') {
      return this._onExtreme({ chat: { id: userId }, text: '/extreme' });
    }

    if (data === 'menu_structure') {
      return this._onStructure({ chat: { id: userId }, text: '/structure' });
    }

    if (data === 'menu_candidate_auto_toggle') {
      return this._sendMainMenu(
        userId,
        '🗄 Candidate выведен из активного проекта и не может быть включён старой кнопкой.'
      );
    }

    if (data.startsWith('candidates_')) {
      return this._sendMainMenu(
        userId,
        '🗄 Эта кнопка относится к закрытому Candidate. Новый скан и paper-запись не запускаются.'
      );
    }

    if (data === 'menu_pump_auto_toggle') {
      const enabled = !this._isPumpAutoEnabled(userId);
      this.pumpAutoOverrides.set(userId, enabled);
      return this._sendMainMenu(
        userId,
        `${enabled ? '✅' : '⏸️'} Pump auto ${enabled ? 'включен' : 'выключен'} до следующего redeploy.`
      );
    }

    if (data === 'menu_signals_current') {
      return this._sendPaperSignalStats(userId, ['7']);
    }

    if (data === 'menu_signals_legacy') {
      return this._sendPaperSignalStats(userId, ['legacy', '30']);
    }

    if (data === 'menu_signals_open') {
      return this._sendPaperSignalStats(userId, ['open', '7']);
    }

    if (data === 'menu_research') {
      return this._sendResearchReadiness(userId);
    }

    if (data === 'menu_status') {
      return this._sendSystemStatus(userId);
    }

    if (data === 'pump_stats') {
      return this._sendPaperSignalStats(userId, ['pump', '7']);
    }

    if (data === 'pump_refresh') {
      return this._sendPumpHunter(userId, 'top');
    }

    if (data === 'pump_full') {
      return this._sendPumpSnapshotDetails(userId, query.message.message_id);
    }

    if (data === 'pump_paper') {
      return this._writePumpSnapshotToPaper(userId, query.message.message_id);
    }

    if (data.startsWith('open_')) {
      const parts = data.split('_');
      const pendingSignal = this._getPendingSignal(parts[1]);
      const hasDirection = parts[1] === 'LONG' || parts[1] === 'SHORT';
      const isPendingSignalFormat = !hasDirection && parts.length === 2;

      if (!pendingSignal && isPendingSignalFormat) {
        return this._send(userId, '⏰ Сигнал устарел. Запусти /scan ещё раз.');
      }

      const direction = pendingSignal?.type || (hasDirection ? parts[1] : 'SHORT');
      const pair = pendingSignal?.pair || (hasDirection ? parts[2] : parts[1]);
      const entryPrice = pendingSignal?.entryPrice || parseFloat(hasDirection ? parts[3] : parts[2]);
      const stopLoss = pendingSignal?.stopLoss || parseFloat(hasDirection ? parts[4] : parts[3]);
      const takeProfit = pendingSignal?.takeProfit || parseFloat(hasDirection ? parts[5] : parts[4]);

      const openPositions = await this.db.getOpenPositions(userId);
      const normalizedPair = this._normalizePair(pair);
      const existingOnPair = openPositions.find(
        (position) => this._normalizePair(position.pair) === normalizedPair
      );

      if (existingOnPair) {
        return this._send(
          userId,
          `⛔ Уже есть открытая позиция на *${pair}*\nЗакрой её сначала через /status`
        );
      }

      const pairCooldown = await this._getPairCooldown(userId, pair);
      if (pairCooldown.active) {
        return this._send(
          userId,
          `⏸️ *${pairCooldown.pair}* на cooldown после убытка.\n` +
            `Осталось: *${pairCooldown.remainingMinutes} мин*\n` +
            'Это защита от повторного входа в тот же нож.'
        );
      }

      const maxPositions = RiskManager.getMaxPositions();
      if (openPositions.length >= maxPositions) {
        return this._send(
          userId,
          `⛔ Максимум *${maxPositions}* позиции одновременно!\n` +
            `Сейчас открыто: *${openPositions.length}*\n` +
            'Закрой одну через /status прежде чем открывать новую.'
        );
      }

      const user = await this.db.getUser(userId);
      const accountBalance = user?.account_balance || 200;
      const slPercent = Math.abs(stopLoss - entryPrice) / entryPrice;
      const tpPercent = Math.abs(takeProfit - entryPrice) / entryPrice;
      const position = RiskManager.calculatePosition(accountBalance, entryPrice, 1.5, {
        slPercent,
        tpPercent,
      });

      // Залогировать сделку
      await this.db.logTrade(userId, {
        pair,
        trade_type: direction,
        entry_price: entryPrice,
        entry_time: new Date(),
        entry_size: position.margin,
        leverage: position.leverage,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        max_risk: position.maxLoss,
        status: 'OPEN',
        ...this._buildTradeContext(pendingSignal),
      });

      await this._send(
        userId,
        `
✅ *ПОЗИЦИЯ ЗАЛОГИРОВАНА*
════════════════════════════════

*${pair}* ${direction}
Entry: \`$${entryPrice}\`
🛑 SL: \`$${stopLoss}\`
🟢 TP: \`$${takeProfit}\`

Открой позицию на Bybit с этими параметрами.
Когда закроешь — напиши /exit [цена]
      `
      );
    } else if (data.startsWith('skip_')) {
      const pair = data.split('_')[1];
      await this._send(userId, `⏭️ Сигнал ${pair} пропущен`);
    } else if (data.startsWith('close_')) {
      const parts = data.split('_');
      const tradeId = parts[1];
      const price = parseFloat(parts[2]);

      const { data: trade } = await this.db.client
        .from('trades')
        .select('*')
        .eq('id', tradeId)
        .eq('user_id', userId)
        .single();

      if (!trade || trade.status !== 'OPEN') {
        return this._send(userId, '❌ Позиция уже закрыта или не найдена');
      }

      const direction = trade.trade_type || 'SHORT';
      const pnlResult = this._calculateTradePnl(trade, price);

      await this.db.closePosition(tradeId, {
        exit_price: price,
        exit_time: new Date(),
        exit_reason: 'MANUAL',
        profit_loss: pnlResult.netPnl,
        status: 'CLOSED',
        ...this._buildFeeFields(pnlResult),
      });

      await this.db.updateBalance(userId, pnlResult.netPnl);
      const updatedUser = await this.db.getUser(userId);

      const icon = pnlResult.netPnl >= 0 ? '✅' : '❌';
      await this._send(
        userId,
        `
${icon} *СДЕЛКА ЗАКРЫТА*
════════════════════════════════

*${trade.pair}* ${direction}
Entry: \`$${trade.entry_price}\`
Exit:  \`$${price}\`

💰 P&L: *${pnlResult.netPnl >= 0 ? '+' : ''}$${pnlResult.netPnl}*
💸 Fees: *$${pnlResult.totalFees}*
💼 Новый баланс: *$${updatedUser?.account_balance || '—'}*

/stats — посмотреть статистику дня
  `
      );

      if (this.monitor) {
        const recent = await this.db.getTradesSince(
          userId,
          new Date(Date.now() - 3 * 60 * 60 * 1000)
        );
        await this.monitor.checkCooloff(
          userId,
          recent.filter((entry) => entry.status === 'CLOSED').reverse()
        );
      }
    } else if (data.startsWith('exit_')) {
      const parts = data.split('_');
      const tradeId = parts[1];
      const price = parseFloat(parts[2]);

      const { data: trade } = await this.db.client
        .from('trades')
        .select('*')
        .eq('id', tradeId)
        .single();

      if (trade && trade.status === 'OPEN') {
        const pnlResult = this._calculateTradePnl(trade, price);

        await this.db.closePosition(tradeId, {
          exit_price: price,
          exit_time: new Date(),
          exit_reason: 'MANUAL',
          profit_loss: pnlResult.netPnl,
          status: 'CLOSED',
          ...this._buildFeeFields(pnlResult),
        });

        await this.db.updateBalance(userId, pnlResult.netPnl);

        const icon = pnlResult.netPnl >= 0 ? '✅' : '❌';
        await this._send(
          userId,
          `${icon} Позиция закрыта. P&L: *${pnlResult.netPnl >= 0 ? '+' : ''}$${pnlResult.netPnl}* | Fees: *$${pnlResult.totalFees}*`
        );

        if (this.monitor) {
          const recent = await this.db.getTradesSince(
            userId,
            new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
          );
          await this.monitor.checkCooloff(
            userId,
            recent.filter((entry) => entry.status === 'CLOSED').reverse()
          );
        }
      }
    } else if (data.startsWith('hold_')) {
      await this._send(userId, '⏳ Окей, продолжаем держать позицию');
    }
  }

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  async _send(chatId, text, options = {}) {
    try {
      return this.bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...options,
      });
    } catch (e) {
      console.error(`❌ Send error to ${chatId}:`, e.message);
      return null;
    }
  }

  async _sendPlain(chatId, text, options = {}) {
    try {
      return this.bot.sendMessage(chatId, text, options);
    } catch (e) {
      console.error(`❌ Send plain error to ${chatId}:`, e.message);
      return null;
    }
  }

  async _sendPlainChunks(chatId, text, options = {}) {
    const maxLength = 3900;
    const chunks = this._splitMessage(text, maxLength);

    for (const chunk of chunks) {
      await this._sendPlain(chatId, chunk, options);
    }
  }

  _splitMessage(text, maxLength) {
    if (text.length <= maxLength) return [text];

    const chunks = [];
    const lines = text.split('\n');
    let current = '';

    for (const line of lines) {
      if (`${current}\n${line}`.trim().length > maxLength) {
        if (current) chunks.push(current);
        current = line;
      } else {
        current = current ? `${current}\n${line}` : line;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  _normalizePair(pair) {
    return pair?.includes('USDT') ? pair : `${pair}USDT`;
  }

  _formatSignalLabel(value) {
    return String(value || 'UNKNOWN').replace(/_/g, ' ');
  }

  async _getPairCooldown(userId, pair) {
    const trades = await this.db.getClosedTradesExitedSince(
      userId,
      new Date(Date.now() - RiskManager.getPairCooldownMinutes() * 60 * 1000)
    );

    return RiskManager.checkPairCooldown(trades, pair);
  }

  _storePendingSignal(signal) {
    const id = `sig${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    this.pendingSignals.set(id, {
      signal,
      createdAt: Date.now(),
    });

    this._cleanupPendingSignals();
    return id;
  }

  _getPendingSignal(id) {
    const entry = this.pendingSignals.get(id);
    return entry?.signal || null;
  }

  _cleanupPendingSignals() {
    const maxAgeMs = 60 * 60 * 1000;
    const now = Date.now();

    for (const [id, entry] of this.pendingSignals.entries()) {
      if (now - entry.createdAt > maxAgeMs) {
        this.pendingSignals.delete(id);
      }
    }
  }

  _buildTradeContext(signal) {
    if (!signal) return {};

    return {
      strategy_version: CURRENT_STRATEGY_VERSION,
      strategy: signal.strategy,
      entry_mode: signal.entryMode,
      market_regime: signal.marketRegime,
      signal_confidence: signal.confidence,
      signal_reason: signal.setupReason,
      invalidation_rule: signal.invalidationRule,
      rsi_at_entry: signal.rsi,
      macd_at_entry: signal.macd,
      macd_signal_at_entry: signal.macdSignal,
      macd_histogram_at_entry: signal.macdHistogram,
      macd_bias: signal.macdBias,
      bb_position: signal.bbPosition,
      bb_width: signal.bbWidth,
      atr_percent: signal.atrPercent,
      volume_spike_percentage: signal.volume,
    };
  }

  async _trackPaperSignal(userId, signal, source = 'MANUAL_SCAN') {
    if (!PAPER_SIGNAL_TRACKING_ENABLED || !signal) return null;

    const now = new Date();
    const project = getPaperProject(signal, source);
    const ttlMinutes = ['PUMP', 'PUMP_V2_SHADOW'].includes(project)
      ? PUMP_HUNTER_SIGNAL_TTL_MINUTES
      : project === 'STRUCTURE'
        ? STRUCTURE_PAPER_TTL_MINUTES
        : PAPER_SIGNAL_TTL_MINUTES;
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
    const timeframe = signal.timeframe || (
      ['PUMP', 'PUMP_V2_SHADOW'].includes(project)
        ? PUMP_HUNTER_KLINE_INTERVAL
        : process.env.BYBIT_WS_INTERVAL || '1'
    );

    return this.db.createPaperSignal(userId, {
      pair: signal.pair,
      direction: signal.type,
      strategy: signal.strategy,
      entry_mode: signal.entryMode,
      market_regime: signal.marketRegime,
      strategy_version: getPaperStrategyVersion(signal),
      project,
      experiment_id: signal.experimentId || CURRENT_PAPER_EXPERIMENT_ID,
      is_legacy: false,
      market_source: signal.marketSource || (project === 'PUMP' ? 'UNKNOWN_PUBLIC_FALLBACK' : 'BYBIT_WEBSOCKET'),
      timeframe: String(timeframe),
      exit_profile: signal.exitProfile || null,
      entry_price: signal.entryPrice,
      stop_loss: signal.stopLoss,
      take_profit: signal.takeProfit,
      tp1: signal.tp1 || null,
      tp2: signal.tp2 || null,
      stretch_take_profit: signal.stretchTakeProfit || null,
      moon_take_profit: signal.moonTakeProfit || null,
      confidence: signal.confidence,
      rsi: signal.rsi,
      volume: signal.volume,
      atr_percent: signal.atrPercent,
      bb_position: signal.bbPosition,
      bb_width: signal.bbWidth,
      macd_bias: signal.macdBias,
      signal_reason: signal.setupReason,
      invalidation_rule: signal.invalidationRule,
      signal_metadata: {
        ...(signal.signalMetadata || {}),
        riskReward: signal.riskReward ?? null,
        tpPercent: signal.tpPercent ?? null,
        slPercent: signal.slPercent ?? null,
        tp1Percent: signal.tp1Percent ?? null,
        tp2Percent: signal.tp2Percent ?? null,
        stretchTpPercent: signal.stretchTpPercent ?? null,
        moonTpPercent: signal.moonTpPercent ?? null,
      },
      max_favorable_price: signal.entryPrice,
      max_adverse_price: signal.entryPrice,
      source,
      expires_at: expiresAt.toISOString(),
    });
  }

  _calculateTradePnl(trade, exitPrice) {
    return FeeCalculator.calculatePnL({
      entryPrice: Number(trade.entry_price),
      exitPrice: Number(exitPrice),
      margin: Number(trade.entry_size),
      leverage: Number(trade.leverage),
      direction: trade.trade_type || 'SHORT',
    });
  }

  _buildFeeFields(pnlResult) {
    return {
      gross_pnl: pnlResult.grossPnl,
      entry_fee: pnlResult.entryFee,
      exit_fee: pnlResult.exitFee,
    };
  }

  _safe(handler) {
    return async (...args) => {
      try {
        await handler(...args);
      } catch (error) {
        const target = args[0];
        const chatId =
          target?.chat?.id ||
          target?.message?.chat?.id ||
          null;

        console.error('❌ Bot handler error:', error?.message || error);

        if (chatId) {
          await this._send(
            String(chatId),
            '❌ Внутренняя ошибка бота. Проверь настройки базы/ключей и попробуй снова.'
          );
        }
      }
    };
  }
}

ScalpArenaBot.BOT_COMMANDS = BOT_COMMANDS;

module.exports = ScalpArenaBot;
