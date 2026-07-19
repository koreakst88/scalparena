const TechnicalIndicators = require('./indicators');

const MIN_LIVE_CANDLES = 35;
const RANGE_LOOKBACK = 20;
const TRIGGER_LOOKBACK = 10;
const MIN_SCORE = 75;
const MIN_VOLUME_RATIO = 1.5;
const MAX_VOLUME_RATIO = 10;
const MIN_BODY_RATIO = 0.45;
const MAX_ENTRY_DISTANCE_ATR = 0.8;
const MIN_ATR_PERCENT = 0.03;
const MAX_ATR_PERCENT = 1.5;
const TARGET_RISK_REWARD = 1.8;

class CandidateBreakoutV2 {
  static scanAll(provider) {
    return provider.getPairs()
      .map((pair) => this.analyzePair(pair, provider.getCandles(pair, 100)))
      .sort((a, b) => {
        const scoreDiff = Number(b.candidate?.score || 0) - Number(a.candidate?.score || 0);
        return scoreDiff || String(a.pair).localeCompare(String(b.pair));
      });
  }

  static analyzePair(pair, candles = []) {
    const liveCandles = this._normalizeLiveCandles(candles);
    if (liveCandles.length < MIN_LIVE_CANDLES) {
      return this._noTrade(pair, 'NOT_ENOUGH_LIVE_CANDLES', {
        liveCandles: liveCandles.length,
        required: MIN_LIVE_CANDLES,
      });
    }

    const current = liveCandles[liveCandles.length - 1];
    const prices = liveCandles.map((candle) => candle.close);
    const rsi = TechnicalIndicators.calculateRSI(prices, 14);
    const atr = TechnicalIndicators.calculateATR(liveCandles, 14);
    const atrPercent = current.close > 0 ? (atr / current.close) * 100 : 0;
    const ema9 = TechnicalIndicators.calculateEMA(prices, 9);
    const ema20 = TechnicalIndicators.calculateEMA(prices, 20);

    if (atrPercent < MIN_ATR_PERCENT || atrPercent > MAX_ATR_PERCENT) {
      return this._noTrade(pair, 'ATR_OUT_OF_RANGE', { atrPercent: this._round(atrPercent, 3) });
    }

    const startIndex = Math.max(RANGE_LOOKBACK, liveCandles.length - TRIGGER_LOOKBACK);
    const setups = [];
    const rejectedSetups = [];

    for (let index = startIndex; index < liveCandles.length; index += 1) {
      const setup = this._evaluateTrigger({
        pair,
        candles: liveCandles,
        triggerIndex: index,
        current,
        rsi,
        atr,
        atrPercent,
        ema9,
        ema20,
      });
      if (setup?.rejected) rejectedSetups.push(setup);
      else if (setup) setups.push(setup);
    }

    if (!setups.length) {
      const latestRejection = rejectedSetups.sort((a, b) => b.triggerTimestamp - a.triggerTimestamp)[0];
      if (latestRejection) {
        return this._noTrade(pair, latestRejection.reason, latestRejection);
      }

      return this._noTrade(pair, 'NO_CONFIRMED_BREAKOUT', {
        liveCandles: liveCandles.length,
        atrPercent: this._round(atrPercent, 3),
        rsi: this._round(rsi, 2),
      });
    }

    const candidate = setups.sort((a, b) => (
      b.score - a.score || b.triggerTimestamp - a.triggerTimestamp
    ))[0];

    return {
      pair,
      action: candidate.score >= MIN_SCORE ? 'SHADOW_TRADE' : 'NO_TRADE',
      reason: candidate.score >= MIN_SCORE ? 'QUALIFIED' : 'SCORE_BELOW_MINIMUM',
      candidate: candidate.score >= MIN_SCORE ? candidate : null,
      diagnostic: candidate,
    };
  }

  static getActionableCandidates(reports = [], limit = 3) {
    return reports
      .filter((report) => report.action === 'SHADOW_TRADE' && report.candidate)
      .map((report) => report.candidate)
      .sort((a, b) => b.score - a.score || String(a.pair).localeCompare(String(b.pair)))
      .slice(0, limit);
  }

  static toPaperSignal(candidate) {
    if (!candidate || candidate.action !== 'SHADOW_TRADE') return null;

    return {
      pair: candidate.pair,
      type: candidate.direction,
      entryPrice: candidate.entryPrice,
      stopLoss: candidate.stopLoss,
      takeProfit: candidate.takeProfit,
      tpPercent: candidate.tpPercent,
      slPercent: candidate.slPercent,
      riskReward: candidate.riskReward,
      rsi: candidate.rsi,
      volume: candidate.volumeRatio * 100,
      atrPercent: candidate.atrPercent,
      confidence: candidate.score,
      strategy: 'BREAKOUT_V2_SHADOW',
      entryMode: 'CONFIRMED_RANGE_BREAKOUT_V2',
      marketRegime: candidate.direction === 'LONG' ? 'TREND_UP' : 'TREND_DOWN',
      setupReason: candidate.summary,
      invalidationRule: `Уровень отмены: $${candidate.stopLoss}`,
      marketSource: 'BYBIT_WEBSOCKET',
      timeframe: String(process.env.BYBIT_WS_INTERVAL || '1'),
      signalMetadata: {
        breakoutLevel: candidate.breakoutLevel,
        triggerTimestamp: candidate.triggerTimestamp,
        triggerAgeCandles: candidate.triggerAgeCandles,
        volumeRatio: candidate.volumeRatio,
        bodyRatio: candidate.bodyRatio,
        closeLocation: candidate.closeLocation,
        entryDistanceAtr: candidate.entryDistanceAtr,
        atrPercent: candidate.atrPercent,
        rsi: candidate.rsi,
        ema9: candidate.ema9,
        ema20: candidate.ema20,
        liveCandleCount: candidate.liveCandleCount,
      },
    };
  }

  static _evaluateTrigger({ pair, candles, triggerIndex, current, rsi, atr, atrPercent, ema9, ema20 }) {
    const trigger = candles[triggerIndex];
    const baseline = candles.slice(triggerIndex - RANGE_LOOKBACK, triggerIndex);
    if (baseline.length < RANGE_LOOKBACK) return null;

    const rangeHigh = Math.max(...baseline.map((candle) => candle.high));
    const rangeLow = Math.min(...baseline.map((candle) => candle.low));
    const direction = trigger.close > rangeHigh
      ? 'LONG'
      : trigger.close < rangeLow
        ? 'SHORT'
        : null;
    if (!direction) return null;

    const breakoutLevel = direction === 'LONG' ? rangeHigh : rangeLow;
    const averageVolume = baseline.reduce((sum, candle) => sum + candle.volume, 0) / baseline.length;
    const volumeRatio = averageVolume > 0 ? trigger.volume / averageVolume : 0;
    const candleRange = trigger.high - trigger.low;
    const bodyRatio = candleRange > 0 ? Math.abs(trigger.close - trigger.open) / candleRange : 0;
    const closeLocation = candleRange > 0 ? (trigger.close - trigger.low) / candleRange : 0.5;
    const postBreakout = candles.slice(triggerIndex + 1);
    const levelHeld = direction === 'LONG'
      ? current.close > breakoutLevel && postBreakout.every((candle) => candle.low >= breakoutLevel - atr * 0.25)
      : current.close < breakoutLevel && postBreakout.every((candle) => candle.high <= breakoutLevel + atr * 0.25);
    const entryDistanceAtr = atr > 0 ? Math.abs(current.close - breakoutLevel) / atr : Infinity;
    const trendAligned = direction === 'LONG' ? ema9 > ema20 : ema9 < ema20;
    const rsiAllowed = direction === 'LONG'
      ? rsi >= 52 && rsi <= 76
      : rsi >= 24 && rsi <= 48;
    const closeConfirmed = direction === 'LONG' ? closeLocation >= 0.65 : closeLocation <= 0.35;

    const rejectionReasons = [];
    if (volumeRatio < MIN_VOLUME_RATIO || volumeRatio > MAX_VOLUME_RATIO) {
      rejectionReasons.push('REJECT_VOLUME');
    }
    if (bodyRatio < MIN_BODY_RATIO) rejectionReasons.push('REJECT_WEAK_BODY');
    if (!closeConfirmed) rejectionReasons.push('REJECT_WEAK_CLOSE');
    if (!levelHeld) rejectionReasons.push('REJECT_LEVEL_NOT_HELD');
    if (!trendAligned) rejectionReasons.push('REJECT_TREND');
    if (!rsiAllowed) rejectionReasons.push('REJECT_RSI');
    if (entryDistanceAtr > MAX_ENTRY_DISTANCE_ATR) rejectionReasons.push('REJECT_ENTRY_TOO_FAR');

    if (rejectionReasons.length) {
      return {
        rejected: true,
        reason: rejectionReasons[0],
        rejectionReasons,
        triggerTimestamp: trigger.timestamp,
        direction,
        volumeRatio: this._round(volumeRatio, 2),
        bodyRatio: this._round(bodyRatio, 2),
        closeLocation: this._round(closeLocation, 2),
        entryDistanceAtr: this._round(entryDistanceAtr, 2),
        atrPercent: this._round(atrPercent, 3),
        rsi: this._round(rsi, 2),
      };
    }

    const score = this._score({ volumeRatio, bodyRatio, closeLocation, direction, entryDistanceAtr, rsi });
    const slPercent = this._clamp(atrPercent * 1.25, 0.45, 0.9);
    const tpPercent = slPercent * TARGET_RISK_REWARD;
    const stopLoss = direction === 'LONG'
      ? current.close * (1 - slPercent / 100)
      : current.close * (1 + slPercent / 100);
    const takeProfit = direction === 'LONG'
      ? current.close * (1 + tpPercent / 100)
      : current.close * (1 - tpPercent / 100);

    return {
      pair,
      action: 'SHADOW_TRADE',
      strategy: 'BREAKOUT_V2_SHADOW',
      direction,
      score,
      entryPrice: this._round(current.close, 8),
      stopLoss: this._round(stopLoss, 8),
      takeProfit: this._round(takeProfit, 8),
      slPercent: this._round(slPercent, 3),
      tpPercent: this._round(tpPercent, 3),
      riskReward: TARGET_RISK_REWARD,
      breakoutLevel: this._round(breakoutLevel, 8),
      triggerTimestamp: trigger.timestamp,
      triggerAgeCandles: candles.length - 1 - triggerIndex,
      volumeRatio: this._round(volumeRatio, 2),
      bodyRatio: this._round(bodyRatio, 2),
      closeLocation: this._round(closeLocation, 2),
      entryDistanceAtr: this._round(entryDistanceAtr, 2),
      atrPercent: this._round(atrPercent, 3),
      rsi: this._round(rsi, 2),
      ema9: this._round(ema9, 8),
      ema20: this._round(ema20, 8),
      liveCandleCount: candles.length,
      summary: `confirmed ${direction} breakout, volume x${this._round(volumeRatio, 1)}, ` +
        `hold ${this._round(entryDistanceAtr, 2)} ATR, RR ${TARGET_RISK_REWARD}`,
    };
  }

  static _score({ volumeRatio, bodyRatio, closeLocation, direction, entryDistanceAtr, rsi }) {
    let score = 55;
    score += Math.min(15, (volumeRatio - MIN_VOLUME_RATIO) * 7.5);
    score += Math.min(10, (bodyRatio - MIN_BODY_RATIO) * 25);
    const closeStrength = direction === 'LONG' ? closeLocation : 1 - closeLocation;
    score += Math.min(8, Math.max(0, (closeStrength - 0.65) * 25));
    score += Math.max(0, 7 * (1 - entryDistanceAtr / MAX_ENTRY_DISTANCE_ATR));
    if (direction === 'LONG' && rsi >= 58 && rsi <= 70) score += 5;
    if (direction === 'SHORT' && rsi >= 30 && rsi <= 42) score += 5;
    return Math.round(this._clamp(score, 0, 100));
  }

  static _normalizeLiveCandles(candles = []) {
    const byTimestamp = new Map();

    candles.forEach((raw) => {
      const candle = {
        timestamp: Number(raw.timestamp),
        open: Number(raw.open),
        high: Number(raw.high),
        low: Number(raw.low),
        close: Number(raw.close),
        volume: Number(raw.volume),
        confirm: raw.confirm,
      };
      const valid = (
        Number.isFinite(candle.timestamp) &&
        Number.isFinite(candle.open) && candle.open > 0 &&
        Number.isFinite(candle.high) && candle.high > 0 &&
        Number.isFinite(candle.low) && candle.low > 0 &&
        Number.isFinite(candle.close) && candle.close > 0 &&
        Number.isFinite(candle.volume) && candle.volume > 0 &&
        candle.confirm !== false
      );
      if (valid) byTimestamp.set(candle.timestamp, candle);
    });

    return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  static _noTrade(pair, reason, diagnostic = {}) {
    return { pair, action: 'NO_TRADE', reason, candidate: null, diagnostic };
  }

  static _clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  static _round(value, digits) {
    const multiplier = 10 ** digits;
    return Math.round(Number(value) * multiplier) / multiplier;
  }
}

module.exports = CandidateBreakoutV2;
