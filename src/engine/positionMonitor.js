// src/engine/positionMonitor.js

const TechnicalIndicators = require('./indicators');
const RiskManager = require('./riskManager');

const CHECK_INTERVAL_MS = 60 * 1000;

class PositionMonitor {
  constructor(bot, db, provider) {
    this.bot = bot;
    this.db = db;
    this.provider = provider;
    this.timer = null;
    this.alerted = new Map();
  }

  start() {
    if (this.timer) return;
    console.log('🔍 Position monitor started');
    this.timer = setInterval(() => this._checkAll(), CHECK_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('🔍 Position monitor stopped');
  }

  async _checkAll() {
    try {
      const { data: positions, error } = await this.db.client
        .from('trades')
        .select('*')
        .eq('status', 'OPEN');

      if (error || !positions?.length) return;

      for (const position of positions) {
        await this._checkPosition(position);
      }
    } catch (error) {
      console.error('❌ Monitor error:', error.message);
    }
  }

  async _checkPosition(position) {
    const pair = position.pair.includes('USDT') ? position.pair : `${position.pair}USDT`;
    const candle = this.provider.getCurrentCandle(pair);
    if (!candle) return;

    const current = candle.close;
    const entryPrice = position.entry_price;
    const entryTime = new Date(position.entry_time);
    const minutesHeld = Math.round((Date.now() - entryTime) / 60000);
    const directionMultiplier = position.trade_type === 'LONG' ? 1 : -1;
    const pnl = parseFloat(
      (
        ((current - entryPrice) / entryPrice) *
        position.entry_size *
        position.leverage *
        directionMultiplier
      ).toFixed(4)
    );

    await this._checkTPHit(position, current, pnl);
    await this._checkSLHit(position, current, pnl);
    await this._checkRSIExit(position, pair, current, pnl);
    await this._checkTimeout(position, minutesHeld, pnl);
  }

  async _checkTPHit(position, current, pnl) {
    const isLong = position.trade_type === 'LONG';
    const tpHit = isLong ? current >= position.take_profit : current <= position.take_profit;
    if (!tpHit) return;
    if (this._alreadyAlerted(position.id, 'TP')) return;

    this._markAlerted(position.id, 'TP');

    await this._sendAlert(
      position.user_id,
      `
🟢 *TP ДОСТИГНУТА!*
━━━━━━━━━━━━━━━━━━━━━━━━━━

*${position.pair}* ${position.trade_type || 'SHORT'}
Entry: \`$${position.entry_price}\`
TP: \`$${position.take_profit}\`
Current: \`$${current}\`

💰 P&L: *+$${pnl}*
⏱️ Время: *${Math.round((Date.now() - new Date(position.entry_time)) / 60000)} мин*

━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Закрой позицию на Bybit
Затем напиши: /exit ${current}
    `
    );
  }

  async _checkSLHit(position, current, pnl) {
    const isLong = position.trade_type === 'LONG';
    const slHit = isLong ? current <= position.stop_loss : current >= position.stop_loss;
    if (!slHit) return;
    if (this._alreadyAlerted(position.id, 'SL')) return;

    this._markAlerted(position.id, 'SL');

    await this._sendAlert(
      position.user_id,
      `
🔴 *STOP LOSS ХИТ!*
━━━━━━━━━━━━━━━━━━━━━━━━━━

*${position.pair}* ${position.trade_type || 'SHORT'}
Entry: \`$${position.entry_price}\`
SL: \`$${position.stop_loss}\`
Current: \`$${current}\`

💰 P&L: *$${pnl}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ Позиция закрыта по стопу
Подтверди: /exit ${current}
    `
    );
  }

  async _checkRSIExit(position, pair, current, pnl) {
    if (this._alreadyAlerted(position.id, 'RSI')) return;
    if (pnl <= 0.2) return;

    const candles = this.provider.getCandles(pair, 20);
    if (candles.length < 15) return;

    const prices = candles.map((candle) => candle.close);
    const rsi = TechnicalIndicators.calculateRSI(prices, 14);

    if (rsi < 75) return;

    this._markAlerted(position.id, 'RSI');

    await this._sendAlert(
      position.user_id,
      `
⚡ *RSI СИГНАЛ ВЫХОДА*
━━━━━━━━━━━━━━━━━━━━━━━━━━

*${position.pair}* ${position.trade_type || 'SHORT'}
RSI: *${rsi.toFixed(1)}* (> 75 — перекупленность)

Current: \`$${current}\`
💰 Текущий P&L: *+$${pnl}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ Рекомендуем зафиксировать прибыль
/exit ${current}
    `,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Закрыть сейчас', callback_data: `exit_${position.id}_${current}` },
              { text: '⏳ Подождать ещё', callback_data: `hold_${position.id}` },
            ],
          ],
        },
      }
    );
  }

  async _checkTimeout(position, minutesHeld, pnl) {
    const pair = position.pair.includes('USDT') ? position.pair : `${position.pair}USDT`;
    const current = this.provider.getCurrentCandle(pair)?.close;

    if (minutesHeld >= 60 && !this._alreadyAlerted(position.id, 'TIMEOUT_60')) {
      this._markAlerted(position.id, 'TIMEOUT_60');

      await this._sendAlert(
        position.user_id,
        `
⏰ *TIMEOUT: 1 ЧАС*
━━━━━━━━━━━━━━━━━━━━━━━━━━

*${position.pair}* открыта уже *60 мин*
💰 Текущий P&L: *${pnl >= 0 ? '+' : ''}$${pnl}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
Хочешь закрыть позицию?
      `,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Да, закрыть', callback_data: `exit_${position.id}_${current}` },
                { text: '⏳ Нет, подождать', callback_data: `hold_${position.id}` },
              ],
            ],
          },
        }
      );
    }

    if (minutesHeld >= 90 && !this._alreadyAlerted(position.id, 'TIMEOUT_90')) {
      this._markAlerted(position.id, 'TIMEOUT_90');

      await this._sendAlert(
        position.user_id,
        `
🚨 *HARD TIMEOUT: 1.5 ЧАСА*
━━━━━━━━━━━━━━━━━━━━━━━━━━

*${position.pair}* открыта *90 мин* — принудительное закрытие!
💰 P&L: *${pnl >= 0 ? '+' : ''}$${pnl}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
❗ Закрой позицию на Bybit СЕЙЧАС
Затем: /exit ${current}
      `
      );

      if (current) {
        const netPnl = parseFloat((pnl - position.entry_size * 0.002).toFixed(4));

        await this.db.closePosition(position.id, {
          exit_price: current,
          exit_time: new Date(),
          exit_reason: 'TIMEOUT_HARD',
          profit_loss: netPnl,
          status: 'CLOSED',
        });

        await this.db.updateBalance(position.user_id, netPnl);
      }
    }
  }

  async checkCooloff(userId, recentTrades) {
    const cooloff = RiskManager.checkCooloff(recentTrades);
    if (!cooloff.needed) return;

    await this._sendAlert(
      userId,
      `
⚠️ *COOL-OFF АКТИВИРОВАН*
━━━━━━━━━━━━━━━━━━━━━━━━━━

${cooloff.losses} убытка подряд — дисциплина!
⏸️ Пауза: *${cooloff.minutes} минут*

Следующий вход доступен в:
*${cooloff.endsAt.toLocaleTimeString('ru-RU')}*

Используй время для анализа 📊
    `
    );
  }

  _alreadyAlerted(tradeId, type) {
    if (!this.alerted.has(tradeId)) return false;
    return this.alerted.get(tradeId).has(type);
  }

  _markAlerted(tradeId, type) {
    if (!this.alerted.has(tradeId)) {
      this.alerted.set(tradeId, new Set());
    }
    this.alerted.get(tradeId).add(type);
  }

  async _sendAlert(userId, text, options = {}) {
    try {
      await this.bot.bot.sendMessage(userId, text, {
        parse_mode: 'Markdown',
        ...options,
      });
    } catch (error) {
      console.error('❌ Alert send error:', error.message);
    }
  }
}

module.exports = PositionMonitor;
