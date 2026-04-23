// src/bot/bot.js

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const { BybitDataProvider } = require('../data/bybitProvider');
const SupabaseClient = require('../data/supabaseClient');
const SignalDetector = require('../engine/signalDetector');
const RiskManager = require('../engine/riskManager');
const PositionMonitor = require('../engine/positionMonitor');
const Scheduler = require('../engine/scheduler');
const GptAnalyzer = require('../analytics/gptAnalyzer');
const StatsCalculator = require('../analytics/stats');

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
    this.ready = false;

    console.log('✅ ScalpArenaBot initialized');
  }

  async start() {
    console.log('🚀 Starting ScalpArena Bot...');

    // Инициализировать провайдер данных
    await this.provider.validatePairs();
    await this.provider.backfillAll('60');
    this.provider.connect();
    this.ready = true;

    // Регистрировать команды
    this._registerCommands();

    this.monitor = new PositionMonitor(this, this.db, this.provider);
    this.monitor.start();

    this.scheduler = new Scheduler(this, this.db, this.provider);
    this.scheduler.start();

    console.log('✅ Bot ready!');
  }

  _registerCommands() {
    this.bot.onText(/\/start/, this._safe((msg) => this._onStart(msg)));
    this.bot.onText(/\/scan/, this._safe((msg) => this._onScan(msg)));
    this.bot.onText(/\/status/, this._safe((msg) => this._onStatus(msg)));
    this.bot.onText(/\/rm (.+)/, this._safe((msg, match) => this._onRm(msg, match)));
    this.bot.onText(/\/exit (.+)/, this._safe((msg, match) => this._onExit(msg, match)));
    this.bot.onText(/\/stats/, this._safe((msg) => this._onStats(msg)));
    this.bot.onText(/\/deposit (.+)/, this._safe((msg, match) => this._onDeposit(msg, match)));
    this.bot.onText(/\/help/, this._safe((msg) => this._onHelp(msg)));

    // Callback кнопки (inline keyboards)
    this.bot.on('callback_query', this._safe((query) => this._onCallback(query)));
    this.bot.on('polling_error', (error) => {
      console.error('❌ Telegram polling error:', error?.message || error);
    });

    console.log('✅ Commands registered');
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

      await this._send(
        userId,
        `
👋 Привет, ${username}!

Добро пожаловать в *ScalpArena* 🎯

Я помогу тебе торговать дисциплинированно:
- Нахожу импульсные сигналы на 15 парах
- Считаю риск автоматически
- Анализирую твои сделки через ИИ

━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 Твой баланс: *$200* (по умолчанию)

Если хочешь изменить баланс, напиши:
/deposit 300 _(добавить $300)_

Готов торговать? Начни со скана:
/scan
      `
      );
    } else {
      await this._send(
        userId,
        `
👋 С возвращением, ${username}!

💰 Баланс: *$${user.account_balance}*
📊 Команды: /scan /status /stats /help
      `
      );
    }
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

    if (signals.length === 0) {
      const pairs = this.provider.getPairs().slice(0, 5);
      const TechnicalIndicators = require('../engine/indicators');
      let diagnostics = '';

      for (const pair of pairs) {
        const candles = this.provider.getCandles(pair, 50);
        if (candles.length < 5) {
          diagnostics += `  ${pair}: нет данных\n`;
          continue;
        }

        const prices = candles.map((candle) => candle.close);
        const current = candles[candles.length - 1];
        const impulse = (((current.close - current.open) / current.open) * 100).toFixed(1);
        const rsi = TechnicalIndicators.calculateRSI(prices, 14).toFixed(0);
        const volume = TechnicalIndicators.calculateVolumeProfile(candles, 20).toFixed(0);
        const direction = impulse > 0 ? '📈' : '📉';
        diagnostics += `  ${direction} ${pair}: ${impulse}% | RSI ${rsi} | Vol ${volume}%\n`;
      }

      return this._send(
        userId,
        `
📭 *Сигналов не найдено*

Рынок сейчас не даёт чётких импульсов.
Система ищет движения 1.5-20% с подтверждением RSI и объёма.

📊 *Топ 5 пар сейчас:*
${diagnostics}
⏰ Авто-скан каждые 15 мин — пришлю алерт когда будет сигнал.
      `
      );
    }

    // Показать топ 3 сигнала
    const top = signals.slice(0, 3);
    for (let i = 0; i < top.length; i++) {
      const signal = top[i];
      const position = RiskManager.calculatePosition(
        accountBalance,
        signal.entryPrice,
        signal.atrPercent
      );

      await this._send(
        userId,
        `
🎯 *СИГНАЛ #${i + 1}*
━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *${signal.pair}* ${signal.type === 'SHORT' ? '🔴 SHORT' : '🟢 LONG'}

💰 Цена входа: \`$${signal.entryPrice}\`
📈 Импульс: *${signal.impulse}%*
📊 Откат: *${signal.retrace}%*
🔊 Volume: *${signal.volume}%*
RSI: *${signal.rsi}*

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
      `,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🟢 Я открыл позицию',
                  callback_data: `open_${signal.type}_${signal.pair}_${signal.entryPrice}_${signal.stopLoss}_${signal.takeProfit}`,
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
    const positions = await this.db.getOpenPositions(userId);

    if (positions.length === 0) {
      return this._send(
        userId,
        `
📭 *Нет открытых позиций*

Запусти /scan для поиска сигналов
      `
      );
    }

    for (const position of positions) {
      const current = this.provider.getCurrentCandle(position.pair);
      const currentPrice = current?.close || position.entry_price;
      const directionMultiplier = position.trade_type === 'LONG' ? 1 : -1;
      const pnl = (
        ((currentPrice - position.entry_price) / position.entry_price) *
        position.entry_size *
        position.leverage *
        directionMultiplier
      ).toFixed(2);
      const pnlIcon = pnl >= 0 ? '✅' : '❌';

      await this._send(
        userId,
        `
🔥 *АКТИВНАЯ ПОЗИЦИЯ*
════════════════════════════════

*${position.pair}* ${position.trade_type || 'SHORT'}
Entry: \`$${position.entry_price}\`
Current: \`$${currentPrice}\`

💰 P&L: *${pnl >= 0 ? '+' : ''}$${pnl}* ${pnlIcon}

🛑 SL: \`$${position.stop_loss}\`
🟢 TP: \`$${position.take_profit}\`

Закрыть: /exit ${currentPrice}
      `
      );
    }
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
    const directionMultiplier = position.trade_type === 'LONG' ? 1 : -1;
    const pnl = parseFloat(
      (
        ((exitPrice - position.entry_price) / position.entry_price) *
        position.entry_size *
        position.leverage *
        directionMultiplier
      ).toFixed(4)
    );
    const netPnl = parseFloat((pnl - position.entry_size * 0.002).toFixed(4));

    // Закрыть в базе
    await this.db.closePosition(position.id, {
      exit_price: exitPrice,
      exit_time: new Date(),
      exit_reason: 'MANUAL',
      profit_loss: netPnl,
      status: 'CLOSED',
    });

    // Обновить баланс
    const newBalance = await this.db.updateBalance(userId, netPnl);

    const icon = netPnl >= 0 ? '✅' : '❌';

    await this._send(
      userId,
      `
${icon} *СДЕЛКА ЗАКРЫТА*
════════════════════════════════

*${position.pair}* ${position.trade_type || 'SHORT'}
Entry: \`$${position.entry_price}\`
Exit:  \`$${exitPrice}\`

💰 P&L: *${netPnl >= 0 ? '+' : ''}$${netPnl}* (после комиссий)
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

    // Сделки с 08:00 Seoul Time
    const now = new Date();
    const seoulNow = new Date(
      now.toLocaleString('en-US', { timeZone: process.env.TIMEZONE || 'Asia/Seoul' })
    );
    const today8am = new Date(seoulNow);
    if (seoulNow.getHours() < 8) {
      today8am.setDate(today8am.getDate() - 1);
    }
    today8am.setHours(8, 0, 0, 0);

    const trades = await this.db.getTradesSince(userId, today8am.toISOString());
    const stats = StatsCalculator.calculate(trades, user.balance_at_8am || user.account_balance);

    // Сообщение 1: Статистика
    await this._send(userId, StatsCalculator.formatMessage(stats));

    if (trades.filter((trade) => trade.status === 'CLOSED').length === 0) {
      return this._send(userId, '📭 Закрытых сделок сегодня нет — GPT анализ пропущен.');
    }

    // Сообщение 2: GPT insights (через 2 сек)
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await this._send(userId, '🤖 Генерирую AI анализ...');

    const closedTrades = trades.filter((trade) => trade.status === 'CLOSED');
    const insights = await this.analyzer.generateDailyInsights(closedTrades, stats);

    await this._send(
      userId,
      `
🤖 *AI INSIGHTS*
════════════════════════════════

${insights}

════════════════════════════════
✅ До встречи завтра в 08:00!
  `
    );
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
    await this._send(
      userId,
      `
📚 *СПРАВКА SCALPARENA*
════════════════════════════════

/scan — найти сигналы (15 пар)
/rm 10 — RM калькулятор
/status — открытые позиции
/exit 91.57 — закрыть позицию
/stats — статистика дня
/deposit 300 — пополнить баланс
/help — эта справка

════════════════════════════════
💡 *Типичный день:*
1️⃣ /scan → выбрать сигнал
2️⃣ Открыть LONG/SHORT на Bybit вручную
3️⃣ Нажать \`Я открыл позицию\`
4️⃣ /exit цена → когда закроешь
5️⃣ /stats → анализ дня
    `
    );
  }

  // ─────────────────────────────────────────
  // CALLBACK КНОПКИ
  // ─────────────────────────────────────────

  async _onCallback(query) {
    const userId = String(query.message.chat.id);
    const data = query.data;

    await this.bot.answerCallbackQuery(query.id);

    if (data.startsWith('open_')) {
      const parts = data.split('_');
      const hasDirection = parts[1] === 'LONG' || parts[1] === 'SHORT';
      const direction = hasDirection ? parts[1] : 'SHORT';
      const pair = hasDirection ? parts[2] : parts[1];
      const entryPrice = parseFloat(hasDirection ? parts[3] : parts[2]);
      const stopLoss = parseFloat(hasDirection ? parts[4] : parts[3]);
      const takeProfit = parseFloat(hasDirection ? parts[5] : parts[4]);

      const user = await this.db.getUser(userId);

      // Залогировать сделку
      await this.db.logTrade(userId, {
        pair,
        trade_type: direction,
        entry_price: entryPrice,
        entry_time: new Date(),
        entry_size: user ? RiskManager.getMargin(user.account_balance) : 10,
        leverage: user ? RiskManager.getLeverage(user.account_balance) : 10,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        max_risk: user ? RiskManager.calculatePosition(user.account_balance, entryPrice, 1.5).maxLoss : 4,
        status: 'OPEN',
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
        const directionMultiplier = trade.trade_type === 'LONG' ? 1 : -1;
        const pnl = parseFloat(
          (
            ((price - trade.entry_price) / trade.entry_price) *
            trade.entry_size *
            trade.leverage *
            directionMultiplier
          ).toFixed(4)
        );
        const netPnl = parseFloat((pnl - trade.entry_size * 0.002).toFixed(4));

        await this.db.closePosition(tradeId, {
          exit_price: price,
          exit_time: new Date(),
          exit_reason: 'MANUAL',
          profit_loss: netPnl,
          status: 'CLOSED',
        });

        await this.db.updateBalance(userId, netPnl);

        const icon = netPnl >= 0 ? '✅' : '❌';
        await this._send(
          userId,
          `${icon} Позиция закрыта. P&L: *${netPnl >= 0 ? '+' : ''}$${netPnl}*`
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
      await this.bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...options,
      });
    } catch (e) {
      console.error(`❌ Send error to ${chatId}:`, e.message);
    }
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

module.exports = ScalpArenaBot;
