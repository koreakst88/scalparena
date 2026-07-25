const VERSION = 'staged_exit_v1';
const PARTIAL_FRACTION = 0.5;
const PROFILES = [
  { key: 'TP1_2_BE', tp1Percent: 2 },
  { key: 'TP1_3_BE', tp1Percent: 3 },
];

class StagedExitSimulator {
  static simulate(signal, candles = [], options = {}) {
    const entryPrice = Number(signal.entry_price);
    const stopLoss = Number(signal.stop_loss);
    const finalTarget = Number(signal.take_profit);
    const direction = String(signal.direction || 'LONG').toUpperCase();

    if (![entryPrice, stopLoss, finalTarget].every(Number.isFinite) || entryPrice <= 0) {
      return null;
    }

    const orderedCandles = candles
      .filter((candle) => (
        Number.isFinite(Number(candle.timestamp)) &&
        Number.isFinite(Number(candle.high)) &&
        Number.isFinite(Number(candle.low))
      ))
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

    const snapshotPrice = Number(options.currentPrice);
    if (Number.isFinite(snapshotPrice) && snapshotPrice > 0 && options.timedOut !== true) {
      const lastTimestamp = Number(orderedCandles[orderedCandles.length - 1]?.timestamp || 0);
      orderedCandles.push({
        timestamp: Math.max(lastTimestamp + 1, Number(options.currentTimestamp) || Date.now()),
        high: snapshotPrice,
        low: snapshotPrice,
        close: snapshotPrice,
      });
    }

    if (!orderedCandles.length) return null;

    const profiles = {};
    PROFILES.forEach((profile) => {
      profiles[profile.key] = this._simulateProfile({
        profile,
        entryPrice,
        stopLoss,
        finalTarget,
        direction,
        candles: orderedCandles,
        timedOut: options.timedOut === true,
      });
    });

    return {
      version: VERSION,
      partialFraction: PARTIAL_FRACTION,
      breakevenActivatesNextCandle: true,
      timeframe: String(signal.timeframe || 'unknown'),
      pathMethod: Number.isFinite(snapshotPrice) && snapshotPrice > 0
        ? 'CANDLE_PATH_WITH_SNAPSHOT'
        : 'CANDLE_PATH',
      profiles,
    };
  }

  static _simulateProfile({
    profile,
    entryPrice,
    stopLoss,
    finalTarget,
    direction,
    candles,
    timedOut,
  }) {
    const tp1Price = this._targetPrice(entryPrice, profile.tp1Percent, direction);
    const state = {
      profile: profile.key,
      tp1Percent: profile.tp1Percent,
      tp1Price: this._round(tp1Price),
      partialFraction: PARTIAL_FRACTION,
      finalTarget: this._round(finalTarget),
      status: 'WATCHING',
      tp1Hit: false,
      tp1HitAt: null,
      resolvedAt: null,
      ambiguous: false,
      legs: [],
    };

    for (const candle of candles) {
      const timestamp = new Date(Number(candle.timestamp)).toISOString();
      const stopHit = this._levelHit(candle, stopLoss, direction, 'STOP');
      const tp1Hit = this._levelHit(candle, tp1Price, direction, 'TARGET');
      const finalHit = this._levelHit(candle, finalTarget, direction, 'TARGET');

      if (!state.tp1Hit) {
        if (stopHit && (tp1Hit || finalHit)) {
          return this._resolveFull(state, 'SL_HIT', stopLoss, timestamp, true);
        }
        if (stopHit) {
          return this._resolveFull(state, 'SL_HIT', stopLoss, timestamp, false);
        }
        if (finalHit) {
          this._addLeg(state, PARTIAL_FRACTION, tp1Price, 'TP1', timestamp);
          this._addLeg(state, 1 - PARTIAL_FRACTION, finalTarget, 'FINAL_TARGET', timestamp);
          state.tp1Hit = true;
          state.tp1HitAt = timestamp;
          state.status = 'TARGET_HIT';
          state.resolvedAt = timestamp;
          return state;
        }
        if (tp1Hit) {
          this._addLeg(state, PARTIAL_FRACTION, tp1Price, 'TP1', timestamp);
          state.tp1Hit = true;
          state.tp1HitAt = timestamp;
          continue;
        }
      } else {
        const breakevenHit = this._levelHit(candle, entryPrice, direction, 'STOP');
        if (finalHit && breakevenHit) {
          return this._resolveRemainder(state, 'BE_HIT', entryPrice, timestamp, true);
        }
        if (finalHit) {
          return this._resolveRemainder(
            state,
            'TARGET_HIT',
            finalTarget,
            timestamp,
            false,
            'FINAL_TARGET'
          );
        }
        if (breakevenHit) {
          return this._resolveRemainder(state, 'BE_HIT', entryPrice, timestamp, false);
        }
      }
    }

    if (timedOut) {
      const last = candles[candles.length - 1];
      const exitPrice = Number(last.close);
      if (Number.isFinite(exitPrice) && exitPrice > 0) {
        const timestamp = new Date(Number(last.timestamp)).toISOString();
        if (state.tp1Hit) {
          return this._resolveRemainder(
            state,
            'TIMEOUT',
            exitPrice,
            timestamp,
            false,
            'TIMEOUT'
          );
        }
        return this._resolveFull(state, 'TIMEOUT', exitPrice, timestamp, false);
      }
    }

    return state;
  }

  static _resolveFull(state, status, price, timestamp, ambiguous) {
    this._addLeg(state, 1, price, status, timestamp);
    state.status = status;
    state.resolvedAt = timestamp;
    state.ambiguous = ambiguous;
    return state;
  }

  static _resolveRemainder(
    state,
    status,
    price,
    timestamp,
    ambiguous,
    reason = status
  ) {
    this._addLeg(state, 1 - PARTIAL_FRACTION, price, reason, timestamp);
    state.status = status;
    state.resolvedAt = timestamp;
    state.ambiguous = ambiguous;
    return state;
  }

  static _addLeg(state, fraction, price, reason, timestamp) {
    state.legs.push({
      fraction,
      price: this._round(price),
      reason,
      timestamp,
    });
  }

  static _levelHit(candle, level, direction, type) {
    const high = Number(candle.high);
    const low = Number(candle.low);

    if (direction === 'SHORT') {
      return type === 'TARGET' ? low <= level : high >= level;
    }
    return type === 'TARGET' ? high >= level : low <= level;
  }

  static _targetPrice(entryPrice, percent, direction) {
    const multiplier = direction === 'SHORT'
      ? 1 - percent / 100
      : 1 + percent / 100;
    return entryPrice * multiplier;
  }

  static _round(value) {
    return Math.round(Number(value) * 1e8) / 1e8;
  }
}

StagedExitSimulator.VERSION = VERSION;
StagedExitSimulator.PROFILES = PROFILES;

module.exports = StagedExitSimulator;
