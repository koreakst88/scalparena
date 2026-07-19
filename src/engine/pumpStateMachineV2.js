const TechnicalIndicators = require('./indicators');

const MIN_CANDLES = 50;
const BASE_LOOKBACK = 24;
const IGNITION_LOOKBACK = 24;
const MIN_TURNOVER_24H = 5000000;
const MIN_IGNITION_MOVE_PERCENT = 1.5;
const MIN_IGNITION_VOLUME_RATIO = 2;
const MAX_FRESH_FROM_LOW = 35;
const MAX_ENTRY_DISTANCE_ATR = 2;
const TARGET_RISK_REWARD = 1.8;
const MIN_SCORE = 75;

class PumpStateMachineV2 {
  static analyzeSymbol(pair, ticker = {}, rawCandles = [], options = {}) {
    const candles = this._normalizeCandles(rawCandles);
    const marketSource = options.marketSource || 'BYBIT';
    const timeframe = String(options.timeframe || '15');

    if (candles.length < MIN_CANDLES) {
      return this._state(pair, 'SCANNING', 'NOT_ENOUGH_CONFIRMED_CANDLES', {
        candleCount: candles.length,
        required: MIN_CANDLES,
        marketSource,
        timeframe,
      });
    }

    const turnover24h = Number(ticker.turnover24h || 0);
    if (!Number.isFinite(turnover24h) || turnover24h < MIN_TURNOVER_24H) {
      return this._state(pair, 'SCANNING', 'LOW_LIQUIDITY', {
        turnover24h,
        marketSource,
        timeframe,
      });
    }

    const latest = candles[candles.length - 1];
    const prices = candles.map((candle) => candle.close);
    const atr = TechnicalIndicators.calculateATR(candles, 14);
    const atrPercent = latest.close > 0 ? atr / latest.close * 100 : 0;
    const rsi = TechnicalIndicators.calculateRSI(prices, 14);
    const ema9 = TechnicalIndicators.calculateEMA(prices, 9);
    const ema20 = TechnicalIndicators.calculateEMA(prices, 20);
    const localLow = Math.min(...candles.slice(-48).map((candle) => candle.low));
    const freshFromLow = this._percent(latest.close, localLow);
    const priceChange24h = Number(ticker.price24hPcnt || 0) * 100;
    const searchStart = Math.max(BASE_LOOKBACK, candles.length - IGNITION_LOOKBACK);
    const ignitions = [];

    for (let index = searchStart; index < candles.length; index += 1) {
      const baseline = candles.slice(index - BASE_LOOKBACK, index);
      const ignition = candles[index];
      const averageVolume = this._average(baseline.map((candle) => candle.volume));
      const volumeRatio = averageVolume > 0 ? ignition.volume / averageVolume : 0;
      const movePercent = this._percent(ignition.close, ignition.open);
      const candleRange = ignition.high - ignition.low;
      const closeLocation = candleRange > 0
        ? (ignition.close - ignition.low) / candleRange
        : 0.5;

      if (
        movePercent >= MIN_IGNITION_MOVE_PERCENT &&
        volumeRatio >= MIN_IGNITION_VOLUME_RATIO &&
        closeLocation >= 0.7
      ) {
        ignitions.push({
          index,
          candle: ignition,
          baselineHigh: Math.max(...baseline.map((candle) => candle.high)),
          volumeRatio,
          movePercent,
          closeLocation,
        });
      }
    }

    if (!ignitions.length) {
      return this._state(pair, 'SCANNING', 'NO_IGNITION', {
        freshFromLow: this._round(freshFromLow, 2),
        atrPercent: this._round(atrPercent, 2),
        marketSource,
        timeframe,
      });
    }

    // A reclaim candle can itself look like a new ignition. Prefer the latest
    // ignition that has enough following candles to prove retest + reclaim.
    const completedIgnition = [...ignitions]
      .reverse()
      .find((item) => item.index <= candles.length - 3);
    const ignition = completedIgnition || ignitions[ignitions.length - 1];
    const common = {
      ignitionTimestamp: ignition.candle.timestamp,
      ignitionMovePercent: this._round(ignition.movePercent, 2),
      ignitionVolumeRatio: this._round(ignition.volumeRatio, 2),
      breakoutLevel: this._round(ignition.baselineHigh, 8),
      freshFromLow: this._round(freshFromLow, 2),
      priceChange24h: this._round(priceChange24h, 2),
      turnover24h: this._round(turnover24h, 2),
      atrPercent: this._round(atrPercent, 2),
      rsi: this._round(rsi, 2),
      marketSource,
      timeframe,
    };

    if (ignition.candle.close <= ignition.baselineHigh) {
      return this._state(pair, 'IGNITION', 'WAITING_FOR_BREAKOUT_CLOSE', common);
    }

    const afterBreakout = candles.slice(ignition.index + 1);
    if (!afterBreakout.length) {
      return this._state(pair, 'BREAKOUT_CONFIRMED', 'WAITING_FOR_RETEST', common);
    }

    const invalidated = afterBreakout.some((candle) => (
      candle.close < ignition.baselineHigh - atr * 0.5
    ));
    if (invalidated) {
      return this._state(pair, 'INVALIDATED', 'BREAKOUT_LEVEL_LOST', common);
    }

    const retestOffset = afterBreakout.findIndex((candle) => (
      candle.low <= ignition.baselineHigh + atr * 0.5 &&
      candle.close >= ignition.baselineHigh - atr * 0.25 &&
      candle.volume <= ignition.candle.volume * 0.8
    ));
    if (retestOffset < 0) {
      return this._state(pair, 'BREAKOUT_CONFIRMED', 'WAITING_FOR_LOW_VOLUME_RETEST', common);
    }

    const retestIndex = ignition.index + 1 + retestOffset;
    const retest = candles[retestIndex];
    const afterRetest = candles.slice(retestIndex + 1);
    const retestContext = {
      ...common,
      retestTimestamp: retest.timestamp,
      retestLow: this._round(retest.low, 8),
      retestVolumeContraction: this._round(retest.volume / ignition.candle.volume, 2),
    };

    if (!afterRetest.length) {
      return this._state(pair, 'RETEST_HELD', 'WAITING_FOR_RECLAIM', retestContext);
    }

    const reclaim = afterRetest[afterRetest.length - 1];
    const reclaimRange = reclaim.high - reclaim.low;
    const reclaimCloseLocation = reclaimRange > 0
      ? (reclaim.close - reclaim.low) / reclaimRange
      : 0.5;
    const reclaimVolumeRatio = retest.volume > 0 ? reclaim.volume / retest.volume : 0;
    const entryDistanceAtr = atr > 0
      ? (reclaim.close - ignition.baselineHigh) / atr
      : Infinity;
    const reclaimReady = (
      reclaim.close > Math.max(ignition.baselineHigh, retest.high) &&
      reclaim.close > reclaim.open &&
      reclaimCloseLocation >= 0.65 &&
      reclaimVolumeRatio >= 1.1
    );

    if (!reclaimReady) {
      return this._state(pair, 'RETEST_HELD', 'WAITING_FOR_RECLAIM', {
        ...retestContext,
        reclaimVolumeRatio: this._round(reclaimVolumeRatio, 2),
      });
    }

    const rejectionReasons = [];
    if (entryDistanceAtr > MAX_ENTRY_DISTANCE_ATR) rejectionReasons.push('ENTRY_TOO_FAR_FROM_LEVEL');
    if (freshFromLow > MAX_FRESH_FROM_LOW) rejectionReasons.push('MOVE_TOO_EXTENDED');
    if (rsi < 52 || rsi > 82) rejectionReasons.push('RSI_OUT_OF_RANGE');
    if (ema9 <= ema20) rejectionReasons.push('TREND_NOT_ALIGNED');
    if (priceChange24h <= 0 || priceChange24h > 80) rejectionReasons.push('24H_MOVE_OUT_OF_RANGE');

    if (rejectionReasons.length) {
      return this._state(pair, 'REJECTED', rejectionReasons[0], {
        ...retestContext,
        rejectionReasons,
        entryDistanceAtr: this._round(entryDistanceAtr, 2),
        reclaimVolumeRatio: this._round(reclaimVolumeRatio, 2),
      });
    }

    const score = this._score({
      ignitionVolumeRatio: ignition.volumeRatio,
      ignitionMovePercent: ignition.movePercent,
      retestVolumeContraction: retest.volume / ignition.candle.volume,
      reclaimVolumeRatio,
      entryDistanceAtr,
      rsi,
    });
    if (score < MIN_SCORE) {
      return this._state(pair, 'REJECTED', 'SCORE_BELOW_MINIMUM', {
        ...retestContext,
        score,
      });
    }

    const structuralStop = Math.min(retest.low, ignition.baselineHigh - atr * 0.25);
    const rawSlPercent = Math.max(0, (reclaim.close - structuralStop) / reclaim.close * 100);
    const slPercent = this._clamp(rawSlPercent, 2, 6);
    const tpPercent = slPercent * TARGET_RISK_REWARD;
    const entryPrice = reclaim.close;
    const stopLoss = entryPrice * (1 - slPercent / 100);
    const takeProfit = entryPrice * (1 + tpPercent / 100);

    return {
      pair,
      action: 'SHADOW_TRADE',
      state: 'ENTRY_READY',
      reason: 'RETEST_RECLAIM_CONFIRMED',
      direction: 'LONG',
      strategy: 'PUMP_STATE_V2_SHADOW',
      entryMode: 'IGNITION_BREAKOUT_RETEST_RECLAIM',
      score,
      entryPrice: this._round(entryPrice, 8),
      stopLoss: this._round(stopLoss, 8),
      takeProfit: this._round(takeProfit, 8),
      slPercent: this._round(slPercent, 2),
      tpPercent: this._round(tpPercent, 2),
      riskReward: TARGET_RISK_REWARD,
      entryDistanceAtr: this._round(entryDistanceAtr, 2),
      reclaimVolumeRatio: this._round(reclaimVolumeRatio, 2),
      reclaimTimestamp: reclaim.timestamp,
      ...retestContext,
      summary: `ignition x${this._round(ignition.volumeRatio, 1)} → breakout → ` +
        `low-volume retest → reclaim x${this._round(reclaimVolumeRatio, 1)}`,
    };
  }

  static getEntryReady(reports = [], limit = 2) {
    return reports
      .map((report) => report.shadowV2 || report)
      .filter((candidate) => candidate?.action === 'SHADOW_TRADE' && candidate.state === 'ENTRY_READY')
      .sort((a, b) => b.score - a.score || String(a.pair).localeCompare(String(b.pair)))
      .slice(0, limit);
  }

  static toPaperSignal(candidate) {
    if (!candidate || candidate.action !== 'SHADOW_TRADE' || candidate.state !== 'ENTRY_READY') {
      return null;
    }

    return {
      pair: candidate.pair,
      type: 'LONG',
      entryPrice: candidate.entryPrice,
      stopLoss: candidate.stopLoss,
      takeProfit: candidate.takeProfit,
      tpPercent: candidate.tpPercent,
      slPercent: candidate.slPercent,
      riskReward: candidate.riskReward,
      rsi: candidate.rsi,
      volume: candidate.ignitionVolumeRatio * 100,
      atrPercent: candidate.atrPercent,
      confidence: candidate.score,
      strategy: 'PUMP_STATE_V2_SHADOW',
      entryMode: candidate.entryMode,
      marketRegime: 'PUMP_RETEST_CONTINUATION',
      setupReason: candidate.summary,
      invalidationRule: `Retest invalidation ниже $${candidate.stopLoss}`,
      marketSource: candidate.marketSource,
      timeframe: candidate.timeframe,
      exitProfile: 'state_v2_rr_1_8',
      signalMetadata: {
        state: candidate.state,
        ignitionTimestamp: candidate.ignitionTimestamp,
        ignitionMovePercent: candidate.ignitionMovePercent,
        ignitionVolumeRatio: candidate.ignitionVolumeRatio,
        breakoutLevel: candidate.breakoutLevel,
        retestTimestamp: candidate.retestTimestamp,
        retestLow: candidate.retestLow,
        retestVolumeContraction: candidate.retestVolumeContraction,
        reclaimTimestamp: candidate.reclaimTimestamp,
        reclaimVolumeRatio: candidate.reclaimVolumeRatio,
        entryDistanceAtr: candidate.entryDistanceAtr,
        freshFromLow: candidate.freshFromLow,
      },
    };
  }

  static _score(context) {
    let score = 55;
    score += Math.min(15, Math.max(0, (context.ignitionVolumeRatio - 2) * 7.5));
    score += Math.min(8, Math.max(0, (context.ignitionMovePercent - 1.5) * 4));
    score += Math.min(8, Math.max(0, (0.8 - context.retestVolumeContraction) * 20));
    score += Math.min(8, Math.max(0, (context.reclaimVolumeRatio - 1.1) * 8));
    score += Math.max(0, 6 * (1 - context.entryDistanceAtr / MAX_ENTRY_DISTANCE_ATR));
    if (context.rsi >= 58 && context.rsi <= 74) score += 5;
    return Math.round(this._clamp(score, 0, 100));
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

  static _state(pair, state, reason, diagnostic = {}) {
    return {
      pair,
      action: 'NO_TRADE',
      strategy: 'PUMP_STATE_V2_SHADOW',
      state,
      reason,
      diagnostic,
      ...diagnostic,
    };
  }

  static _percent(current, base) {
    if (!base) return 0;
    return (current - base) / base * 100;
  }

  static _average(values = []) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  static _clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  static _round(value, digits) {
    const multiplier = 10 ** digits;
    return Math.round(Number(value) * multiplier) / multiplier;
  }
}

module.exports = PumpStateMachineV2;
