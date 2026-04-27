// src/engine/scheduler.js

const SignalDetector = require('./signalDetector');
const RiskManager = require('./riskManager');

const SCAN_INTERVAL_MS = 15 * 60 * 1000;
const TRADING_START_HOUR = 8;
const TRADING_END_HOUR = 24;
const SEOUL_TIMEZONE = process.env.TIMEZONE || 'Asia/Seoul';

class Scheduler {
  constructor(bot, db, provider) {
    this.bot = bot;
    this.db = db;
    this.provider = provider;
    this.scanTimer = null;
    this.resetTimer = null;
    this.lastScanTime = null;
  }

  start() {
    if (this.scanTimer || this.resetTimer) return;

    console.log('⏰ Scheduler started');

    this.scanTimer = setInterval(() => this._autoScan(), SCAN_INTERVAL_MS);
    this._scheduleDailyReset();

    setTimeout(() => this._autoScan(), 5 * 60 * 1000);

    console.log('✅ Auto-scan every 15 min | Daily reset at 08:00 Seoul');
    console.log('⏳ First auto-scan in 5 minutes (WS data accumulation)');
  }

  stop() {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    console.log('⏰ Scheduler stopped');
  }

  async _autoScan() {
    if (!this._isTradingHours()) {
      console.log('💤 Outside trading hours, scan skipped');
      return;
    }

    console.log('🔍 Auto-scan triggered...');
    this.lastScanTime = new Date();

    try {
      const signals = SignalDetector.scanAll(this.provider);

      if (signals.length === 0) {
        console.log('📭 Auto-scan: no signals found');
        return;
      }

      console.log(`🎯 Auto-scan: ${signals.length} signal(s) found`);

      const { data: users, error } = await this.db.client
        .from('users')
        .select('*')
        .eq('auto_scan_enabled', true);

      if (error || !users?.length) return;

      for (const user of users) {
        await this._sendSignalsToUser(user, signals);
      }
    } catch (error) {
      console.error('❌ Auto-scan error:', error.message);
    }
  }

  async _sendSignalsToUser(user, signals) {
    const userId = user.telegram_id;
    const today8am = this._getToday8am();
    const trades = await this.db.getTradesSince(userId, today8am.toISOString());
    const stats = RiskManager.calcDailyStats(trades, user.balance_at_8am || user.account_balance);

    if (stats.daily_risk_used >= stats.daily_risk_limit) {
      console.log(`⛔ User ${userId}: daily limit reached, signals skipped`);
      return;
    }

    const recentTrades = trades
      .filter((trade) => trade.status === 'CLOSED')
      .sort((a, b) => new Date(b.exit_time) - new Date(a.exit_time));

    const cooloff = RiskManager.checkCooloff(recentTrades);
    if (cooloff.needed && new Date() < cooloff.endsAt) {
      console.log(`⏸️ User ${userId}: in cool-off, signals skipped`);
      return;
    }

    const openPositions = await this.db.getOpenPositions(userId);
    const openPairs = new Set(
      openPositions.map((position) => this._normalizePair(position.pair))
    );
    const maxPositions = RiskManager.getMaxPositions();
    const pairCooldownTrades = await this.db.getClosedTradesExitedSince(
      userId,
      new Date(Date.now() - RiskManager.getPairCooldownMinutes() * 60 * 1000)
    );

    if (openPositions.length >= maxPositions) {
      console.log(`📊 User ${userId}: max ${maxPositions} positions reached`);
      return;
    }

    const filteredSignals = signals.filter((signal) => {
      if (openPairs.has(this._normalizePair(signal.pair))) {
        console.log(`⏭️ Skip ${signal.pair}: already has open position`);
        return false;
      }

      const pairCooldown = RiskManager.checkPairCooldown(pairCooldownTrades, signal.pair);
      if (pairCooldown.active) {
        console.log(`⏸️ Skip ${signal.pair}: pair cooldown ${pairCooldown.remainingMinutes} min`);
        return false;
      }

      return true;
    });

    if (filteredSignals.length === 0) {
      console.log(`📭 User ${userId}: all signals filtered out (existing positions)`);
      return;
    }

    const slotsAvailable = maxPositions - openPositions.length;
    const top = filteredSignals.slice(0, Math.min(3, slotsAvailable));
    await this.bot._send(
      userId,
      `🔔 *Авто-скан: найдено ${filteredSignals.length} сигнал(ов)*`
    );

    for (let i = 0; i < top.length; i++) {
      const signal = top[i];
      const signalId = this.bot._storePendingSignal(signal);
      const strategyLabel = this.bot._formatSignalLabel(signal.strategy);
      const regimeLabel = this.bot._formatSignalLabel(signal.marketRegime);
      const entryModeLabel = this.bot._formatSignalLabel(signal.entryMode);
      const position = RiskManager.calculatePosition(
        user.account_balance,
        signal.entryPrice,
        signal.atrPercent,
        {
          slPercent: signal.slPercent / 100,
          tpPercent: signal.tpPercent / 100,
        }
      );

      await this.bot._send(
        userId,
        `
🎯 *СИГНАЛ #${i + 1}* (авто)
━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *${signal.pair}* ${signal.type === 'SHORT' ? '🔴 SHORT' : '🟢 LONG'}
🧠 Strategy: *${strategyLabel}* (${entryModeLabel})
🌡️ Regime: *${regimeLabel}*
💰 Цена: \`$${signal.entryPrice}\`
🧾 Причина: ${signal.setupReason}
🎯 RSI: *${signal.rsi}*
📉 MACD: *${signal.macdBias}* (hist ${signal.macdHistogram})
📊 BB Position: *${signal.bbPosition}%*
🔊 Volume: *${signal.volume}%*
📏 BB Width: *${signal.bbWidth}%*
🚫 Invalidation: ${signal.invalidationRule}

🛑 SL: \`$${signal.stopLoss}\`
🟢 TP: \`$${signal.takeProfit}\`
💼 Margin: *$${position.margin}* | RR: *${position.riskReward}*

🎯 Уверенность: *${signal.confidence}%*
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

  _scheduleDailyReset() {
    const msUntilReset = this._getMsUntilNext8am();
    console.log(`⏰ Next daily reset in ${Math.round(msUntilReset / 60000)} minutes`);

    this.resetTimer = setTimeout(async () => {
      await this._dailyReset();
      this._scheduleDailyReset();
    }, msUntilReset);
  }

  async _dailyReset() {
    console.log('🌅 Daily reset triggered (08:00 Seoul Time)');

    try {
      const { data: users, error } = await this.db.client.from('users').select('*');
      if (error || !users?.length) return;

      for (const user of users) {
        await this.db.snapshotBalanceAt8am(user.telegram_id);

        await this.bot._send(
          user.telegram_id,
          `
☀️ *Доброе утро! Новый торговый день.*
━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 Баланс: *$${user.account_balance}*
🛡️ Дневной лимит риска: *$${RiskManager.getDailyLimit(user.account_balance)}*
📊 Макс позиций: *${RiskManager.getMaxPositions()}*

🔍 Авто-скан запущен. Первый скан через 5 мин.
/scan — запустить вручную
        `
        );
      }

      console.log(`✅ Daily reset complete for ${users.length} users`);
    } catch (error) {
      console.error('❌ Daily reset error:', error.message);
    }
  }

  _getSeoulParts(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: SEOUL_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );

    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
    };
  }

  _isTradingHours() {
    const { hour } = this._getSeoulParts();
    return hour >= TRADING_START_HOUR && hour < TRADING_END_HOUR;
  }

  _getMsUntilNext8am() {
    const now = new Date();
    const parts = this._getSeoulParts(now);
    const nextSeoulDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 8 - 9, 0, 0, 0));

    if (parts.hour >= 8) {
      nextSeoulDate.setUTCDate(nextSeoulDate.getUTCDate() + 1);
    }

    return nextSeoulDate.getTime() - now.getTime();
  }

  _getToday8am() {
    const parts = this._getSeoulParts();
    const targetDay = parts.hour < 8 ? parts.day - 1 : parts.day;
    return new Date(Date.UTC(parts.year, parts.month - 1, targetDay, 8 - 9, 0, 0, 0));
  }

  _normalizePair(pair) {
    return pair?.includes('USDT') ? pair : `${pair}USDT`;
  }

  getStatus() {
    return {
      lastScan: this.lastScanTime,
      nextScan: new Date(Date.now() + SCAN_INTERVAL_MS),
      tradingHours: this._isTradingHours(),
      msUntilReset: this._getMsUntilNext8am(),
    };
  }
}

module.exports = Scheduler;
