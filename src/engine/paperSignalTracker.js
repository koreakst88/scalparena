const {
  PAPER_SIGNAL_TRACKING_ENABLED,
  PAPER_SIGNAL_TRACK_INTERVAL_MS,
} = require('../config/paperSignals');

class PaperSignalTracker {
  constructor(bot, db, provider) {
    this.bot = bot;
    this.db = db;
    this.provider = provider;
    this.timer = null;
  }

  start() {
    if (!PAPER_SIGNAL_TRACKING_ENABLED) {
      console.log('🧪 Paper signal tracker disabled');
      return;
    }

    if (this.timer) return;

    console.log(`🧪 Paper signal tracker started, checking every ${PAPER_SIGNAL_TRACK_INTERVAL_MS / 1000}s`);
    this.timer = setInterval(() => this._checkAll(), PAPER_SIGNAL_TRACK_INTERVAL_MS);
    this._checkAll();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    console.log('🧪 Paper signal tracker stopped');
  }

  async _checkAll() {
    try {
      const signals = await this.db.getActivePaperSignals();
      if (!signals.length) return;

      for (const signal of signals) {
        await this._checkSignal(signal);
      }
    } catch (error) {
      console.error('❌ Paper signal tracker error:', error.message);
    }
  }

  async _checkSignal(signal) {
    const pair = signal.pair?.includes('USDT') ? signal.pair : `${signal.pair}USDT`;
    const currentPrice = this._getCurrentPrice(pair);
    if (!currentPrice) return;

    const direction = signal.direction || signal.signal_type;
    const now = new Date();
    const outcome = this._resolveOutcome(signal, currentPrice, direction, now);
    const extremes = this._calculateExtremes(signal, currentPrice, direction);

    if (!outcome) {
      await this.db.updatePaperSignal(signal.id, extremes);
      return;
    }

    const createdAt = new Date(signal.created_at || signal.generated_at);
    const timeToResult = Math.max(0, Math.round((now - createdAt) / 60000));

    await this.db.updatePaperSignal(signal.id, {
      ...extremes,
      status: outcome.status,
      result: outcome.status,
      hit_price: currentPrice,
      resolved_at: now.toISOString(),
      time_to_result_minutes: timeToResult,
    });

    await this._sendOutcome(signal, outcome.status, currentPrice, timeToResult);
  }

  _getCurrentPrice(pair) {
    const currentCandle = this.provider.getCurrentCandle(pair);
    if (currentCandle?.close) return Number(currentCandle.close);

    const candles = this.provider.getCandles(pair, 1);
    const last = candles[candles.length - 1];
    return last?.close ? Number(last.close) : null;
  }

  _resolveOutcome(signal, currentPrice, direction, now) {
    const takeProfit = Number(signal.take_profit);
    const stopLoss = Number(signal.stop_loss);
    const expiresAt = new Date(signal.expires_at);

    if (direction === 'LONG') {
      if (currentPrice >= takeProfit) return { status: 'TP_HIT' };
      if (currentPrice <= stopLoss) return { status: 'SL_HIT' };
    } else {
      if (currentPrice <= takeProfit) return { status: 'TP_HIT' };
      if (currentPrice >= stopLoss) return { status: 'SL_HIT' };
    }

    if (!Number.isNaN(expiresAt.getTime()) && now >= expiresAt) {
      return { status: 'TIMEOUT' };
    }

    return null;
  }

  _calculateExtremes(signal, currentPrice, direction) {
    const currentMaxFavorable = Number(signal.max_favorable_price || signal.entry_price);
    const currentMaxAdverse = Number(signal.max_adverse_price || signal.entry_price);

    if (direction === 'LONG') {
      return {
        max_favorable_price: Math.max(currentMaxFavorable, currentPrice),
        max_adverse_price: Math.min(currentMaxAdverse, currentPrice),
      };
    }

    return {
      max_favorable_price: Math.min(currentMaxFavorable, currentPrice),
      max_adverse_price: Math.max(currentMaxAdverse, currentPrice),
    };
  }

  async _sendOutcome(signal, status, price, minutes) {
    const icon = status === 'TP_HIT' ? '✅' : status === 'SL_HIT' ? '❌' : '⏱️';
    const title = status === 'TP_HIT'
      ? 'PAPER TP HIT'
      : status === 'SL_HIT'
        ? 'PAPER SL HIT'
        : 'PAPER TIMEOUT';

    await this.bot._sendPlain(
      signal.user_id,
      `${icon} ${title}
════════════════════════════════

${signal.pair} ${signal.direction}
Strategy: ${signal.strategy || 'UNKNOWN'}
Entry: $${signal.entry_price}
Current: $${price}
TP: $${signal.take_profit}
SL: $${signal.stop_loss}
Time: ${minutes} мин

Live trading: OFF`
    );
  }
}

module.exports = PaperSignalTracker;
