const TechnicalIndicators = require('./indicators');

const MIN_LIVE_CANDLES = 100;
const RANGE_LOOKBACK = 20;
const TRIGGER_LOOKBACK = 12;
const MIN_POST_BREAKOUT_CANDLES = 2;
const MIN_SCORE = 75;
const MIN_VOLUME_RATIO = 1.5;
const MAX_VOLUME_RATIO = 3;
const MIN_BODY_RATIO = 0.75;
const MAX_ENTRY_DISTANCE_ATR = 0.4;
const TARGET_RISK_REWARD = 1.8;

class CandidateBreakoutV3 {
  static scanAll(provider) {
    return provider.getPairs()
      .map((pair) => this.analyzePair(pair, provider.getCandles(pair, 120)))
      .sort((a, b) => (
        Number(b.candidate?.score || b.diagnostic?.score || 0) -
        Number(a.candidate?.score || a.diagnostic?.score || 0) ||
        String(a.pair).localeCompare(String(b.pair))
      ));
  }

  static analyzePair(pair, rawCandles = []) {
    const candles = this._normalizeCandles(rawCandles);
    if (candles.length < MIN_LIVE_CANDLES) {
      return this._noTrade(pair, 'NOT_ENOUGH_LIVE_CANDLES', {
        liveCandles: candles.length,
        required: MIN_LIVE_CANDLES,
      });
    }

    const current = candles[candles.length - 1];
    const atr = TechnicalIndicators.calculateATR(candles, 14);
    const atrPercent = current.close > 0 ? atr / current.close * 100 : 0;
    const rsi = TechnicalIndicators.calculateRSI(candles.map((candle) => candle.close), 14);
    const trend = this._analyzeFiveMinuteTrend(candles);
    if (!trend.ready) return this._noTrade(pair, 'NOT_ENOUGH_5M_CONTEXT', trend);

    const lastTriggerIndex = candles.length - 1 - MIN_POST_BREAKOUT_CANDLES;
    const firstTriggerIndex = Math.max(
      RANGE_LOOKBACK,
      lastTriggerIndex - TRIGGER_LOOKBACK + 1
    );
    const accepted = [];
    const rejected = [];

    for (let triggerIndex = firstTriggerIndex; triggerIndex <= lastTriggerIndex; triggerIndex += 1) {
      const setup = this._evaluateTrigger({
        pair,
        candles,
        triggerIndex,
        current,
        atr,
        atrPercent,
        rsi,
        trend,
      });
      if (!setup) continue;
      if (setup.rejected) rejected.push(setup);
      else accepted.push(setup);
    }

    if (!accepted.length) {
      const latest = rejected.sort((a, b) => b.triggerTimestamp - a.triggerTimestamp)[0];
      return this._noTrade(pair, latest?.reason || 'NO_BREAKOUT_RETEST_RECLAIM', latest || {
        atrPercent: this._round(atrPercent, 3),
        trend5m: trend.direction,
      });
    }

    const diagnostic = accepted.sort((a, b) => (
      b.score - a.score || b.triggerTimestamp - a.triggerTimestamp
    ))[0];
    const qualified = diagnostic.score >= MIN_SCORE;
    return {
      pair,
      action: qualified ? 'SHADOW_TRADE' : 'NO_TRADE',
      reason: qualified ? 'QUALIFIED' : 'SCORE_BELOW_MINIMUM',
      candidate: qualified ? diagnostic : null,
      diagnostic,
    };
  }

  static getActionableCandidates(reports = [], limit = 1) {
    return reports
      .filter((report) => report.action === 'SHADOW_TRADE' && report.candidate)
      .map((report) => report.candidate)
      .sort((a, b) => b.score - a.score || String(a.pair).localeCompare(String(b.pair)))
      .slice(0, limit);
  }

  static isAllowedByMarketContext(candidate) {
    const decision = candidate?.marketContext?.decision;
    if (candidate?.direction === 'LONG') return decision === 'ALLOW';
    return decision === 'ALLOW' || decision === 'CAUTION';
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
      strategy: 'BREAKOUT_V3_SHADOW',
      entryMode: 'BREAKOUT_RETEST_RECLAIM_V3',
      marketRegime: candidate.direction === 'LONG' ? 'TREND_UP' : 'TREND_DOWN',
      setupReason: candidate.summary,
      invalidationRule: `Retest structure invalid below/above $${candidate.stopLoss}`,
      marketSource: 'BYBIT_WEBSOCKET',
      timeframe: String(process.env.BYBIT_WS_INTERVAL || '1'),
      signalMetadata: {
        marketContext: candidate.marketContext || null,
        breakoutLevel: candidate.breakoutLevel,
        triggerTimestamp: candidate.triggerTimestamp,
        triggerAgeCandles: candidate.triggerAgeCandles,
        retestTimestamp: candidate.retestTimestamp,
        reclaimTimestamp: candidate.reclaimTimestamp,
        volumeRatio: candidate.volumeRatio,
        retestVolumeRatio: candidate.retestVolumeRatio,
        bodyRatio: candidate.bodyRatio,
        entryDistanceAtr: candidate.entryDistanceAtr,
        atrPercent: candidate.atrPercent,
        rsi: candidate.rsi,
        trend5m: candidate.trend5m,
        ema9_5m: candidate.ema9_5m,
        ema20_5m: candidate.ema20_5m,
        stopBasis: candidate.stopBasis,
      },
    };
  }

  static _evaluateTrigger({ pair, candles, triggerIndex, current, atr, atrPercent, rsi, trend }) {
    const trigger = candles[triggerIndex];
    const baseline = candles.slice(triggerIndex - RANGE_LOOKBACK, triggerIndex);
    if (baseline.length < RANGE_LOOKBACK) return null;

    const rangeHigh = Math.max(...baseline.map((candle) => candle.high));
    const rangeLow = Math.min(...baseline.map((candle) => candle.low));
    const direction = trigger.close > rangeHigh ? 'LONG' : trigger.close < rangeLow ? 'SHORT' : null;
    if (!direction) return null;

    const breakoutLevel = direction === 'LONG' ? rangeHigh : rangeLow;
    const averageVolume = baseline.reduce((sum, candle) => sum + candle.volume, 0) / baseline.length;
    const volumeRatio = averageVolume > 0 ? trigger.volume / averageVolume : 0;
    const triggerRange = trigger.high - trigger.low;
    const bodyRatio = triggerRange > 0 ? Math.abs(trigger.close - trigger.open) / triggerRange : 0;
    const closeLocation = triggerRange > 0 ? (trigger.close - trigger.low) / triggerRange : 0.5;
    const closeConfirmed = direction === 'LONG' ? closeLocation >= 0.75 : closeLocation <= 0.25;
    const trendAligned = direction === trend.direction;
    const postBreakout = candles.slice(triggerIndex + 1);
    const retestCandles = postBreakout.slice(0, -1);
    const retest = retestCandles.find((candle) => {
      const touched = direction === 'LONG'
        ? candle.low <= breakoutLevel + atr * 0.2
        : candle.high >= breakoutLevel - atr * 0.2;
      const held = direction === 'LONG'
        ? candle.close >= breakoutLevel - atr * 0.1
        : candle.close <= breakoutLevel + atr * 0.1;
      return touched && held;
    });
    const retestVolumeRatio = retest && trigger.volume > 0 ? retest.volume / trigger.volume : Infinity;
    const reclaimConfirmed = Boolean(retest) && (
      direction === 'LONG'
        ? current.close > breakoutLevel && current.close > current.open
        : current.close < breakoutLevel && current.close < current.open
    );
    const entryDistanceAtr = atr > 0 ? Math.abs(current.close - breakoutLevel) / atr : Infinity;

    const rejectionReasons = [];
    if (volumeRatio < MIN_VOLUME_RATIO || volumeRatio > MAX_VOLUME_RATIO) rejectionReasons.push('REJECT_VOLUME');
    if (bodyRatio < MIN_BODY_RATIO) rejectionReasons.push('REJECT_WEAK_BODY');
    if (!closeConfirmed) rejectionReasons.push('REJECT_WEAK_CLOSE');
    if (!trendAligned) rejectionReasons.push('REJECT_5M_TREND');
    if (!retest) rejectionReasons.push('REJECT_NO_RETEST');
    if (retestVolumeRatio > 0.85) rejectionReasons.push('REJECT_RETEST_VOLUME');
    if (!reclaimConfirmed) rejectionReasons.push('REJECT_NO_RECLAIM');
    if (entryDistanceAtr > MAX_ENTRY_DISTANCE_ATR) rejectionReasons.push('REJECT_ENTRY_TOO_FAR');

    const shared = {
      triggerTimestamp: trigger.timestamp,
      direction,
      volumeRatio: this._round(volumeRatio, 2),
      retestVolumeRatio: this._round(retestVolumeRatio, 2),
      bodyRatio: this._round(bodyRatio, 2),
      closeLocation: this._round(closeLocation, 2),
      entryDistanceAtr: this._round(entryDistanceAtr, 2),
      atrPercent: this._round(atrPercent, 3),
      trend5m: trend.direction,
    };
    if (rejectionReasons.length) {
      return { rejected: true, reason: rejectionReasons[0], rejectionReasons, ...shared };
    }

    const retestExtreme = direction === 'LONG' ? retest.low : retest.high;
    const structuralStop = direction === 'LONG'
      ? retestExtreme - atr * 0.2
      : retestExtreme + atr * 0.2;
    const rawSlPercent = Math.abs(current.close - structuralStop) / current.close * 100;
    if (rawSlPercent < 0.35 || rawSlPercent > 1.1) {
      return {
        rejected: true,
        reason: 'REJECT_STRUCTURAL_STOP',
        rejectionReasons: ['REJECT_STRUCTURAL_STOP'],
        structuralStop: this._round(structuralStop, 8),
        rawSlPercent: this._round(rawSlPercent, 3),
        ...shared,
      };
    }

    const tpPercent = rawSlPercent * TARGET_RISK_REWARD;
    const takeProfit = direction === 'LONG'
      ? current.close * (1 + tpPercent / 100)
      : current.close * (1 - tpPercent / 100);
    const score = this._score({ volumeRatio, bodyRatio, entryDistanceAtr, retestVolumeRatio });

    return {
      pair,
      action: 'SHADOW_TRADE',
      strategy: 'BREAKOUT_V3_SHADOW',
      direction,
      score,
      entryPrice: this._round(current.close, 8),
      stopLoss: this._round(structuralStop, 8),
      takeProfit: this._round(takeProfit, 8),
      slPercent: this._round(rawSlPercent, 3),
      tpPercent: this._round(tpPercent, 3),
      riskReward: TARGET_RISK_REWARD,
      breakoutLevel: this._round(breakoutLevel, 8),
      triggerTimestamp: trigger.timestamp,
      triggerAgeCandles: candles.length - 1 - triggerIndex,
      retestTimestamp: retest.timestamp,
      reclaimTimestamp: current.timestamp,
      rsi: this._round(rsi, 2),
      ema9_5m: trend.ema9,
      ema20_5m: trend.ema20,
      stopBasis: this._round(retestExtreme, 8),
      summary: `${direction} breakout-retest-reclaim, volume x${this._round(volumeRatio, 1)}, ` +
        `retest volume x${this._round(retestVolumeRatio, 2)}, RR ${TARGET_RISK_REWARD}`,
      ...shared,
    };
  }

  static _score({ volumeRatio, bodyRatio, entryDistanceAtr, retestVolumeRatio }) {
    let score = 68;
    score += Math.max(0, 10 - Math.abs(volumeRatio - 2) * 10);
    score += Math.min(8, (bodyRatio - MIN_BODY_RATIO) * 32);
    score += Math.max(0, 8 * (1 - entryDistanceAtr / MAX_ENTRY_DISTANCE_ATR));
    score += Math.max(0, 6 * (1 - retestVolumeRatio / 0.85));
    return Math.round(this._clamp(score, 0, 100));
  }

  static _analyzeFiveMinuteTrend(candles) {
    const aggregated = this._aggregateCandles(candles, 5);
    if (aggregated.length < 20) return { ready: false, candleCount: aggregated.length };
    const prices = aggregated.map((candle) => candle.close);
    const ema9 = TechnicalIndicators.calculateEMA(prices, 9);
    const ema20 = TechnicalIndicators.calculateEMA(prices, 20);
    const current = prices[prices.length - 1];
    const direction = ema9 > ema20 && current > ema20
      ? 'LONG'
      : ema9 < ema20 && current < ema20
        ? 'SHORT'
        : 'MIXED';
    return {
      ready: true,
      direction,
      ema9: this._round(ema9, 8),
      ema20: this._round(ema20, 8),
      candleCount: aggregated.length,
    };
  }

  static _aggregateCandles(candles, size) {
    const result = [];
    for (let index = 0; index + size <= candles.length; index += size) {
      const group = candles.slice(index, index + size);
      result.push({
        timestamp: group[0].timestamp,
        open: group[0].open,
        high: Math.max(...group.map((candle) => candle.high)),
        low: Math.min(...group.map((candle) => candle.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((sum, candle) => sum + candle.volume, 0),
      });
    }
    return result;
  }

  static _normalizeCandles(candles = []) {
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
      if (
        Number.isFinite(candle.timestamp) && candle.open > 0 && candle.high > 0 &&
        candle.low > 0 && candle.close > 0 && candle.volume > 0 && candle.confirm !== false
      ) byTimestamp.set(candle.timestamp, candle);
    });
    return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  static _noTrade(pair, reason, diagnostic = {}) {
    return { pair, action: 'NO_TRADE', reason, candidate: null, diagnostic };
  }

  static _clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  static _round(value, digits) {
    if (!Number.isFinite(Number(value))) return null;
    const multiplier = 10 ** digits;
    return Math.round(Number(value) * multiplier) / multiplier;
  }
}

module.exports = CandidateBreakoutV3;
