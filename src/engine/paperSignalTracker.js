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
    const direction = signal.direction || signal.signal_type;
    const now = new Date();
    const candles = await this._getPricePath(pair, signal, now);
    const pathResult = this._resolveCandlePath(signal, candles, direction);
    const expiresAt = new Date(signal.expires_at);
    const isExpired = !Number.isNaN(expiresAt.getTime()) && now >= expiresAt;
    const lastPathClose = Number(candles[candles.length - 1]?.close) || null;
    const currentPrice = pathResult.outcome
      ? null
      : isExpired
        ? lastPathClose
        : await this._getCurrentPrice(pair, signal, candles);
    const currentOutcome = !pathResult.outcome && !isExpired && currentPrice
      ? this._resolvePriceHit(signal, currentPrice, direction)
      : null;
    const timeoutOutcome = !pathResult.outcome && !currentOutcome
      ? this._resolveTimeout(signal, now)
      : null;
    const outcome = pathResult.outcome || currentOutcome || timeoutOutcome;
    const extremes = currentPrice
      ? this._calculateExtremes({ ...signal, ...pathResult.extremes }, currentPrice, direction)
      : pathResult.extremes;

    if (!currentPrice && !candles.length && !timeoutOutcome) return;

    if (!outcome) {
      await this.db.updatePaperSignal(signal.id, extremes);
      return;
    }

    const createdAt = new Date(signal.created_at || signal.generated_at);
    const resolvedAt = outcome.resolvedAt || now;
    const timeToResult = Math.max(0, Math.round((resolvedAt - createdAt) / 60000));
    const hitPrice = outcome.hitPrice ?? currentPrice ?? signal.max_favorable_price ?? signal.entry_price;

    await this.db.updatePaperSignal(signal.id, {
      ...extremes,
      status: outcome.status,
      result: outcome.status,
      hit_price: hitPrice,
      resolved_at: resolvedAt.toISOString(),
      time_to_result_minutes: timeToResult,
      resolution_method: outcome.method || 'PRICE_SNAPSHOT',
      resolution_timeframe: outcome.timeframe || String(signal.timeframe || 'snapshot'),
      first_hit_ambiguous: outcome.ambiguous === true,
      resolved_candle_at: outcome.candle?.timestamp
        ? new Date(Number(outcome.candle.timestamp)).toISOString()
        : null,
      resolved_candle_high: outcome.candle?.high ?? null,
      resolved_candle_low: outcome.candle?.low ?? null,
    });

    if (!this._isSilentShadowSignal(signal)) {
      await this._sendOutcome(signal, outcome.status, hitPrice, timeToResult, outcome.ambiguous);
    }
  }

  async _getPricePath(pair, signal, now = new Date()) {
    const createdAt = new Date(signal.created_at || signal.generated_at);
    if (Number.isNaN(createdAt.getTime())) return [];

    const timeframe = String(signal.timeframe || (this._isPumpHunterSignal(signal) ? '15' : '1'));
    const intervalMinutes = this._intervalMinutes(timeframe);
    const ageMinutes = Math.max(1, Math.ceil((now - createdAt) / 60000));
    const limit = Math.min(200, Math.max(10, Math.ceil(ageMinutes / intervalMinutes) + 3));
    let candles = [];

    if (this._isPumpHunterSignal(signal)) {
      const source = String(signal.market_source || '').toUpperCase();

      if (source.includes('OKX') && this.provider.getOkxSwapKlines) {
        candles = await this.provider.getOkxSwapKlines(pair, timeframe, limit) || [];
      } else if (source.includes('BINANCE') && this.provider.getBinanceFuturesKlines) {
        candles = await this.provider.getBinanceFuturesKlines(pair, timeframe, limit) || [];
      } else if (this.provider.getRestKlines) {
        candles = await this.provider.getRestKlines(pair, timeframe, limit) || [];
      }
    } else {
      candles = this.provider.getCandles(pair, limit) || [];
    }

    const expiresAt = new Date(signal.expires_at);
    const cutoff = !Number.isNaN(expiresAt.getTime()) && expiresAt < now ? expiresAt : now;

    return candles
      .filter((candle) => Number(candle.timestamp) > createdAt.getTime())
      .filter((candle) => Number(candle.timestamp) <= cutoff.getTime())
      .filter((candle) => (
        Number.isFinite(Number(candle.high)) &&
        Number.isFinite(Number(candle.low))
      ))
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  }

  _resolveCandlePath(signal, candles, direction) {
    let extremes = {};

    for (const candle of candles) {
      extremes = this._calculateCandleExtremes({ ...signal, ...extremes }, candle, direction);
      const outcome = this._resolveCandleHit(signal, candle, direction);

      if (outcome) {
        return {
          outcome: {
            ...outcome,
            method: 'CANDLE_PATH',
            timeframe: String(signal.timeframe || 'unknown'),
            candle,
            resolvedAt: new Date(Number(candle.timestamp)),
          },
          extremes,
        };
      }
    }

    return { outcome: null, extremes };
  }

  _resolveCandleHit(signal, candle, direction) {
    const takeProfit = Number(signal.take_profit);
    const stopLoss = Number(signal.stop_loss);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const tpHit = direction === 'LONG' ? high >= takeProfit : low <= takeProfit;
    const slHit = direction === 'LONG' ? low <= stopLoss : high >= stopLoss;

    if (tpHit && slHit) {
      return { status: 'SL_HIT', hitPrice: stopLoss, ambiguous: true };
    }
    if (tpHit) return { status: 'TP_HIT', hitPrice: takeProfit, ambiguous: false };
    if (slHit) return { status: 'SL_HIT', hitPrice: stopLoss, ambiguous: false };
    return null;
  }

  async _getCurrentPrice(pair, signal = {}, pathCandles = []) {
    const currentCandle = this.provider.getCurrentCandle(pair);
    if (currentCandle?.close) return Number(currentCandle.close);

    const candles = this.provider.getCandles(pair, 1);
    const last = candles[candles.length - 1];
    if (last?.close) return Number(last.close);

    const lastPathCandle = pathCandles[pathCandles.length - 1];
    if (lastPathCandle?.close) return Number(lastPathCandle.close);

    const source = String(signal.market_source || '').toUpperCase();
    if (
      this._isPumpHunterSignal(signal) &&
      (!source || source.includes('OKX')) &&
      this.provider.getOkxSwapPrice
    ) {
      return this.provider.getOkxSwapPrice(pair);
    }

    return null;
  }

  _resolveOutcome(signal, currentPrice, direction, now) {
    return this._resolvePriceHit(signal, currentPrice, direction) || this._resolveTimeout(signal, now);
  }

  _resolvePriceHit(signal, currentPrice, direction) {
    const takeProfit = Number(signal.take_profit);
    const stopLoss = Number(signal.stop_loss);

    if (direction === 'LONG') {
      if (currentPrice >= takeProfit) {
        return { status: 'TP_HIT', hitPrice: takeProfit, method: 'PRICE_SNAPSHOT' };
      }
      if (currentPrice <= stopLoss) {
        return { status: 'SL_HIT', hitPrice: stopLoss, method: 'PRICE_SNAPSHOT' };
      }
    } else {
      if (currentPrice <= takeProfit) {
        return { status: 'TP_HIT', hitPrice: takeProfit, method: 'PRICE_SNAPSHOT' };
      }
      if (currentPrice >= stopLoss) {
        return { status: 'SL_HIT', hitPrice: stopLoss, method: 'PRICE_SNAPSHOT' };
      }
    }

    return null;
  }

  _resolveTimeout(signal, now) {
    const expiresAt = new Date(signal.expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && now >= expiresAt) {
      return { status: 'TIMEOUT', method: 'TIMEOUT' };
    }

    return null;
  }

  _isPumpHunterSignal(signal) {
    return (
      ['PUMP_HUNTER', 'PUMP_STATE_V2_SHADOW'].includes(signal.strategy) ||
      ['PUMP_HUNTER', 'PUMP_AUTO', 'PUMP_V2_SHADOW'].includes(signal.source) ||
      ['PUMP', 'PUMP_V2_SHADOW'].includes(signal.project)
    );
  }

  _isSilentShadowSignal(signal) {
    return (
      signal.project === 'CANDIDATE_V2_SHADOW' ||
      signal.strategy === 'BREAKOUT_V2_SHADOW' ||
      signal.source === 'CANDIDATE_V2_SHADOW' ||
      signal.project === 'PUMP_V2_SHADOW' ||
      signal.strategy === 'PUMP_STATE_V2_SHADOW' ||
      signal.source === 'PUMP_V2_SHADOW'
    );
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

  _calculateCandleExtremes(signal, candle, direction) {
    const currentMaxFavorable = Number(signal.max_favorable_price || signal.entry_price);
    const currentMaxAdverse = Number(signal.max_adverse_price || signal.entry_price);
    const high = Number(candle.high);
    const low = Number(candle.low);

    if (direction === 'LONG') {
      return {
        max_favorable_price: Math.max(currentMaxFavorable, high),
        max_adverse_price: Math.min(currentMaxAdverse, low),
      };
    }

    return {
      max_favorable_price: Math.min(currentMaxFavorable, low),
      max_adverse_price: Math.max(currentMaxAdverse, high),
    };
  }

  _intervalMinutes(value) {
    const normalized = String(value || '1').toUpperCase();
    if (normalized === 'D' || normalized === '1D') return 24 * 60;
    if (normalized.endsWith('H')) {
      return Math.max(1, Number.parseInt(normalized, 10) || 1) * 60;
    }
    return Math.max(1, Number.parseInt(normalized, 10) || 1);
  }

  async _sendOutcome(signal, status, price, minutes, ambiguous = false) {
    const icon = status === 'TP_HIT' ? '✅' : status === 'SL_HIT' ? '❌' : '⏱️';
    const title = status === 'TP_HIT'
      ? 'PAPER TP HIT'
      : status === 'SL_HIT'
        ? 'PAPER SL HIT'
        : 'PAPER TIMEOUT';
    const priceLabel = price ? `$${price}` : 'n/a';

    await this.bot._sendPlain(
      signal.user_id,
      `${icon} ${title}
════════════════════════════════

${signal.pair} ${signal.direction}
Strategy: ${signal.strategy || 'UNKNOWN'}
Entry: $${signal.entry_price}
Current: ${priceLabel}
TP: $${signal.take_profit}
SL: $${signal.stop_loss}
Time: ${minutes} мин
${ambiguous ? '\n⚠️ Одна свеча коснулась TP и SL; консервативно засчитан SL.' : ''}

Live trading: OFF`
    );
  }
}

module.exports = PaperSignalTracker;
