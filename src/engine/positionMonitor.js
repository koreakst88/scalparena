// src/engine/positionMonitor.js

const TechnicalIndicators = require('./indicators');
const RiskManager = require('./riskManager');
const FeeCalculator = require('./feeCalculator');
const { TIMEOUT_SOFT, TIMEOUT_HARD } = require('../config/riskManagement');

const CHECK_INTERVAL_MS = 60 * 1000;

class PositionMonitor {
  constructor(bot, db, provider) {
    this.bot = bot;
    this.db = db;
    this.provider = provider;
    this.timer = null;
    this.alerted = new Map();
  }

  async start() {
    if (this.timer) return;
    console.log('🔍 Position monitor started');
    console.log('✅ Position monitor: ACTIVE, checking every 60s');

    // Run once immediately so startup logs prove the monitor is alive.
    await this._checkAll();
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

      if (error) {
        console.error('❌ Monitor query error:', error.message);
        return;
      }

      console.log(`🔍 Position monitor heartbeat: ${positions?.length || 0} open position(s)`);

      if (!positions?.length) return;

      for (const position of positions) {
        await this._checkPosition(position);
      }
    } catch (error) {
      console.error('❌ Monitor error:', error.message);
    }
  }

  async _checkPosition(position) {
    const pair = position.pair.includes('USDT')
      ? position.pair
      : `${position.pair}USDT`;

    const liveCandle = this.provider.getCurrentCandle(pair);
    if (!liveCandle) return;

    const current = liveCandle.close;
    const minutesHeld = Math.round(
      (Date.now() - new Date(position.entry_time)) / 60000
    );
    const direction = position.trade_type || 'SHORT';
    const pnlResult = this._calculatePositionPnl(position, current);
    const pnl = pnlResult.netPnl;

    if (await this._checkTPHit(position, current, pnl, direction, pnlResult)) return;
    if (await this._checkSLHit(position, current, pnl, direction, pnlResult)) return;

    if (await this._checkRSIExit(position, pair, current, pnl, pnlResult)) return;
    await this._checkTimeout(position, minutesHeld, pnl, current, pnlResult);
  }

  async _checkTPHit(position, current, pnl, direction = 'SHORT', pnlResult = null) {
    const tpHit = direction === 'SHORT'
      ? current <= position.take_profit
      : current >= position.take_profit;

    if (!tpHit) return false;
    if (this._alreadyAlerted(position.id, 'TP')) return true;

    const finalPnl = pnlResult || this._calculatePositionPnl(position, current);
    await this._closeTrade(position, current, 'TP_HIT', finalPnl);
    this._markAlerted(position.id, 'TP');

    await this._sendAlert(
      position.user_id,
      `
🟢 *TP ДОСТИГНУТА!*
━━━━━━━━━━━━━━━━━━━━━━━━━━

*${position.pair}* ${direction}
Entry: \`$${position.entry_price}\`
TP: \`$${position.take_profit}\`
Current: \`$${current}\`

💰 P&L: *+$${Math.abs(pnl)}*
💸 Fees: *$${finalPnl.totalFees}*
⏱️ Время: *${Math.round((Date.now() - new Date(position.entry_time)) / 60000)} мин*

━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Позиция закрыта в журнале автоматически
Баланс обновлён
    `
    );

    return true;
  }

  async _checkSLHit(position, current, pnl, direction = 'SHORT', pnlResult = null) {
    const slHit = direction === 'SHORT'
      ? current >= position.stop_loss
      : current <= position.stop_loss;

    if (!slHit) return false;
    if (this._alreadyAlerted(position.id, 'SL')) return true;

    const finalPnl = pnlResult || this._calculatePositionPnl(position, current);
    await this._closeTrade(position, current, 'STOP_HIT', finalPnl);
    this._markAlerted(position.id, 'SL');

    await this._sendAlert(
      position.user_id,
      `
🔴 *STOP LOSS ХИТ!*
━━━━━━━━━━━━━━━━━━━━━━━━━━

*${position.pair}* ${direction}
Entry: \`$${position.entry_price}\`
SL: \`$${position.stop_loss}\`
Current: \`$${current}\`

💰 P&L: *$${pnl}*
💸 Fees: *$${finalPnl.totalFees}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ Позиция закрыта в журнале автоматически
Баланс обновлён
    `
    );

    return true;
  }

  async _checkRSIExit(position, pair, current, pnl, pnlResult = null) {
    if (this._alreadyAlerted(position.id, 'RSI')) return false;
    if (pnl <= 0) return false;

    const candles = this.provider.getCandles(pair, 20);
    if (candles.length < 15) return false;

    const prices = candles.map((candle) => candle.close);
    const rsi = TechnicalIndicators.calculateRSI(prices, 14);
    const direction = position.trade_type || 'SHORT';
    const shouldExit = direction === 'LONG'
      ? rsi >= 65
      : rsi <= 35;

    if (!shouldExit) return false;

    const finalPnl = pnlResult || this._calculatePositionPnl(position, current);
    await this._closeTrade(position, current, 'RSI_EXIT', finalPnl);
    this._markAlerted(position.id, 'RSI');

    await this._sendAlert(
      position.user_id,
      `
⚡ *RSI СИГНАЛ ВЫХОДА*
━━━━━━━━━━━━━━━━━━━━━━━━━━

*${position.pair}* ${direction}
RSI: *${rsi.toFixed(1)}* ${direction === 'LONG' ? '(> 65)' : '(< 35)'}

Current: \`$${current}\`
💰 P&L: *+$${pnl}*
💸 Fees: *$${finalPnl.totalFees}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ Быстрый RSI-отскок зафиксирован автоматически
Баланс обновлён
    `
    );

    return true;
  }

  async _checkTimeout(position, minutesHeld, pnl, current = null, pnlResult = null) {
    if (
      TIMEOUT_SOFT < TIMEOUT_HARD &&
      minutesHeld >= TIMEOUT_SOFT &&
      !this._alreadyAlerted(position.id, `TIMEOUT_${TIMEOUT_SOFT}`)
    ) {
      this._markAlerted(position.id, `TIMEOUT_${TIMEOUT_SOFT}`);

      await this._sendAlert(
        position.user_id,
        `
⏰ *TIMEOUT: ${TIMEOUT_SOFT} МИН*
━━━━━━━━━━━━━━━━━━━━━━━━━━

*${position.pair}* открыта уже *${TIMEOUT_SOFT} мин*
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

    if (minutesHeld >= TIMEOUT_HARD && !this._alreadyAlerted(position.id, `TIMEOUT_HARD_${TIMEOUT_HARD}`)) {
      this._markAlerted(position.id, `TIMEOUT_HARD_${TIMEOUT_HARD}`);

      await this._sendAlert(
        position.user_id,
        `
🚨 *HARD TIMEOUT: ${TIMEOUT_HARD} МИН*
━━━━━━━━━━━━━━━━━━━━━━━━━━

*${position.pair}* открыта *${TIMEOUT_HARD} мин* — принудительное закрытие!
💰 P&L: *${pnl >= 0 ? '+' : ''}$${pnl}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
❗ Закрой позицию на Bybit СЕЙЧАС
Затем: /exit ${current}
      `
      );

      if (current) {
        const finalPnl = pnlResult || this._calculatePositionPnl(position, current);

        await this._closeTrade(position, current, 'TIMEOUT_HARD', finalPnl);
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

  _calculatePositionPnl(position, exitPrice) {
    return FeeCalculator.calculatePnL({
      entryPrice: Number(position.entry_price),
      exitPrice: Number(exitPrice),
      margin: Number(position.entry_size),
      leverage: Number(position.leverage),
      direction: position.trade_type || 'SHORT',
    });
  }

  async _closeTrade(position, exitPrice, exitReason, pnlResult = null) {
    const finalPnl = pnlResult || this._calculatePositionPnl(position, exitPrice);

    await this.db.closePosition(position.id, {
      exit_price: exitPrice,
      exit_time: new Date(),
      exit_reason: exitReason,
      profit_loss: finalPnl.netPnl,
      status: 'CLOSED',
      gross_pnl: finalPnl.grossPnl,
      entry_fee: finalPnl.entryFee,
      exit_fee: finalPnl.exitFee,
    });

    await this.db.updateBalance(position.user_id, finalPnl.netPnl);

    console.log(
      `✅ Auto-closed ${position.pair} ${position.trade_type || 'SHORT'} ` +
      `reason=${exitReason} net=${finalPnl.netPnl}`
    );

    return finalPnl;
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
