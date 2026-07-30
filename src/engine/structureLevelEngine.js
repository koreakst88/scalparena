const TechnicalIndicators = require('./indicators');
const StructureDataAudit = require('./structureDataAudit');
const {
  STRUCTURE_PROJECT,
  STRUCTURE_LEVEL_EXPERIMENT_ID,
} = require('../config/structure');

const PIVOT_SPAN = 2;
const REACTION_LOOKAHEAD = 4;
const ZONE_LIMIT = 3;

class StructureLevelEngine {
  static async analyze(provider, pair) {
    const audit = await StructureDataAudit.run(provider, pair, {
      includeCandles: true,
    });
    const primary = audit.primaryVenue
      ? audit.venues[audit.primaryVenue]
      : null;

    if (!audit.readyForLevelResearch || !primary?.candleSets) {
      return {
        project: STRUCTURE_PROJECT,
        experimentId: STRUCTURE_LEVEL_EXPERIMENT_ID,
        pair: audit.pair,
        source: audit.primaryVenue,
        status: 'DATA_NOT_READY',
        reason: 'No single venue has usable 4H/1H/15m candle history',
        audit,
        signalsGenerated: 0,
      };
    }

    return this.analyzeCandleSets(audit.pair, primary.candleSets, {
      source: audit.primaryVenue,
      audit,
    });
  }

  static analyzeCandleSets(pair, candleSets, options = {}) {
    const candles4h = this._confirmed(candleSets['4H']);
    const candles1h = this._confirmed(candleSets['1H']);
    const candles15m = this._confirmed(candleSets['15m']);

    if (candles4h.length < 50 || candles1h.length < 50 || candles15m.length < 20) {
      return {
        project: STRUCTURE_PROJECT,
        experimentId: STRUCTURE_LEVEL_EXPERIMENT_ID,
        pair,
        source: options.source || 'UNKNOWN',
        status: 'DATA_NOT_READY',
        reason: 'Not enough confirmed candles for level analysis',
        signalsGenerated: 0,
      };
    }

    const currentPrice = Number(candles15m[candles15m.length - 1].close);
    const atr4h = TechnicalIndicators.calculateATR(candles4h, 14);
    const atr1h = TechnicalIndicators.calculateATR(candles1h, 14);
    const pivots4h = this._findPivots(candles4h, '4H', atr4h);
    const pivots1h = this._findPivots(candles1h, '1H', atr1h);
    const zones = this._buildZones([...pivots4h, ...pivots1h], currentPrice);
    const support = zones
      .filter((zone) => zone.upper < currentPrice)
      .sort((a, b) => b.center - a.center)
      .slice(0, ZONE_LIMIT);
    const resistance = zones
      .filter((zone) => zone.lower > currentPrice)
      .sort((a, b) => a.center - b.center)
      .slice(0, ZONE_LIMIT);
    const activeZones = zones
      .filter((zone) => zone.lower <= currentPrice && zone.upper >= currentPrice)
      .sort((a, b) => b.score - a.score);
    const structure = this._classifyMarketStructure(pivots4h);
    const compression = this._analyzeCompression(candles1h);

    return {
      project: STRUCTURE_PROJECT,
      experimentId: STRUCTURE_LEVEL_EXPERIMENT_ID,
      pair,
      source: options.source || 'UNKNOWN',
      status: zones.length ? 'LEVELS_FOUND' : 'NO_LEVELS',
      currentPrice: this._round(currentPrice, 8),
      atr4h: this._round(atr4h, 8),
      atr1h: this._round(atr1h, 8),
      structure,
      compression,
      pivotCount: {
        '4H': pivots4h.length,
        '1H': pivots1h.length,
      },
      zoneCount: zones.length,
      activeZones,
      resistance,
      support,
      audit: options.audit || null,
      signalsGenerated: 0,
      eventsCreated: 0,
      paperSignalsCreated: 0,
    };
  }

  static _findPivots(candles, timeframe, atr) {
    const pivots = [];

    for (let index = PIVOT_SPAN; index < candles.length - PIVOT_SPAN; index += 1) {
      const candle = candles[index];
      const window = candles.slice(index - PIVOT_SPAN, index + PIVOT_SPAN + 1);
      const other = window.filter((_, offset) => offset !== PIVOT_SPAN);
      const pivotHigh = other.every((item) => candle.high >= item.high) &&
        other.some((item) => candle.high > item.high);
      const pivotLow = other.every((item) => candle.low <= item.low) &&
        other.some((item) => candle.low < item.low);

      if (pivotHigh) {
        pivots.push(this._buildPivot(candles, index, timeframe, 'HIGH', atr));
      }
      if (pivotLow) {
        pivots.push(this._buildPivot(candles, index, timeframe, 'LOW', atr));
      }
    }

    return pivots;
  }

  static _buildPivot(candles, index, timeframe, kind, atr) {
    const candle = candles[index];
    const following = candles.slice(index + 1, index + 1 + REACTION_LOOKAHEAD);
    const price = kind === 'HIGH' ? Number(candle.high) : Number(candle.low);
    const reactionDistance = following.length
      ? kind === 'HIGH'
        ? price - Math.min(...following.map((item) => Number(item.low)))
        : Math.max(...following.map((item) => Number(item.high))) - price
      : 0;

    return {
      kind,
      timeframe,
      price,
      atr,
      timestamp: Number(candle.timestamp),
      reactionAtr: atr > 0 ? Math.max(0, reactionDistance / atr) : 0,
    };
  }

  static _buildZones(pivots, currentPrice) {
    const clusters = [];
    const sorted = [...pivots].sort((a, b) => a.price - b.price);

    sorted.forEach((pivot) => {
      const cluster = clusters.find((candidate) => {
        const tolerance = Math.min(
          Math.max(pivot.atr, candidate.averageAtr) * 0.3,
          pivot.price * 0.01
        );
        return Math.abs(pivot.price - candidate.center) <= tolerance;
      });

      if (cluster) {
        cluster.pivots.push(pivot);
        cluster.center = this._weightedCenter(cluster.pivots);
        cluster.averageAtr = this._average(cluster.pivots.map((item) => item.atr));
      } else {
        clusters.push({
          center: pivot.price,
          averageAtr: pivot.atr,
          pivots: [pivot],
        });
      }
    });

    const finalized = clusters
      .filter((cluster) => (
        cluster.pivots.length >= 2 ||
        new Set(cluster.pivots.map((pivot) => pivot.timeframe)).size >= 2
      ))
      .map((cluster) => this._finalizeZone(cluster, currentPrice))
      .sort((a, b) => b.score - a.score);

    return finalized.filter((zone, index) => (
      !finalized.slice(0, index).some((stronger) => this._zonesOverlap(zone, stronger))
    ));
  }

  static _zonesOverlap(first, second) {
    return first.lower <= second.upper && first.upper >= second.lower;
  }

  static _finalizeZone(cluster, currentPrice) {
    const prices = cluster.pivots.map((pivot) => pivot.price);
    const halfWidth = Math.max(cluster.averageAtr * 0.12, cluster.center * 0.001);
    const lower = Math.min(...prices) - halfWidth;
    const upper = Math.max(...prices) + halfWidth;
    const timeframes = [...new Set(cluster.pivots.map((pivot) => pivot.timeframe))];
    const latestTimestamp = Math.max(...cluster.pivots.map((pivot) => pivot.timestamp));
    const ageHours = Math.max(0, (Date.now() - latestTimestamp) / 3600000);
    const averageReactionAtr = this._average(
      cluster.pivots.map((pivot) => pivot.reactionAtr)
    );
    const score = this._scoreZone({
      touches: cluster.pivots.length,
      fourHourTouches: cluster.pivots.filter((pivot) => pivot.timeframe === '4H').length,
      averageReactionAtr,
      ageHours,
      confluence: timeframes.length >= 2,
    });

    return {
      lower: this._round(lower, 8),
      upper: this._round(upper, 8),
      center: this._round(cluster.center, 8),
      score,
      touches: cluster.pivots.length,
      fourHourTouches: cluster.pivots.filter((pivot) => pivot.timeframe === '4H').length,
      highTouches: cluster.pivots.filter((pivot) => pivot.kind === 'HIGH').length,
      lowTouches: cluster.pivots.filter((pivot) => pivot.kind === 'LOW').length,
      timeframes,
      averageReactionAtr: this._round(averageReactionAtr, 2),
      lastTouchAt: new Date(latestTimestamp).toISOString(),
      distancePercent: this._round(
        Math.abs(cluster.center - currentPrice) / currentPrice * 100,
        2
      ),
    };
  }

  static _scoreZone(context) {
    let score = 15;
    score += Math.min(30, context.touches * 5);
    score += Math.min(15, context.fourHourTouches * 5);
    score += Math.min(20, context.averageReactionAtr * 8);
    if (context.confluence) score += 12;
    if (context.ageHours <= 24) score += 8;
    else if (context.ageHours <= 72) score += 6;
    else if (context.ageHours <= 168) score += 3;

    return Math.min(100, Math.round(score));
  }

  static _classifyMarketStructure(pivots) {
    const highs = pivots.filter((pivot) => pivot.kind === 'HIGH').slice(-3);
    const lows = pivots.filter((pivot) => pivot.kind === 'LOW').slice(-3);

    if (highs.length < 2 || lows.length < 2) {
      return {
        state: 'UNDETERMINED',
        sequence: 'not enough 4H swings',
      };
    }

    const lastHigh = highs[highs.length - 1].price;
    const previousHigh = highs[highs.length - 2].price;
    const lastLow = lows[lows.length - 1].price;
    const previousLow = lows[lows.length - 2].price;
    const higherHigh = lastHigh > previousHigh;
    const higherLow = lastLow > previousLow;
    const lowerHigh = lastHigh < previousHigh;
    const lowerLow = lastLow < previousLow;

    if (higherHigh && higherLow) {
      return { state: 'UPTREND', sequence: 'HH + HL' };
    }
    if (lowerHigh && lowerLow) {
      return { state: 'DOWNTREND', sequence: 'LH + LL' };
    }

    return {
      state: 'RANGE_OR_TRANSITION',
      sequence: `${higherHigh ? 'HH' : lowerHigh ? 'LH' : 'EQH'} + ` +
        `${higherLow ? 'HL' : lowerLow ? 'LL' : 'EQL'}`,
    };
  }

  static _analyzeCompression(candles) {
    const trueRanges = this._trueRanges(candles);
    const recentAtr = this._average(trueRanges.slice(-12));
    const baselineAtr = this._average(trueRanges.slice(-60, -12));
    const recent = candles.slice(-12);
    const previous = candles.slice(-24, -12);
    const recentRange = this._range(recent);
    const previousRange = this._range(previous);
    const atrRatio = baselineAtr > 0 ? recentAtr / baselineAtr : 1;
    const rangeRatio = previousRange > 0 ? recentRange / previousRange : 1;
    let state = 'NORMAL';

    if (atrRatio <= 0.8 && rangeRatio <= 0.85) state = 'COMPRESSED';
    else if (atrRatio >= 1.25 || rangeRatio >= 1.35) state = 'EXPANDING';

    return {
      state,
      atrRatio: this._round(atrRatio, 2),
      rangeRatio: this._round(rangeRatio, 2),
    };
  }

  static _trueRanges(candles) {
    const values = [];
    for (let index = 1; index < candles.length; index += 1) {
      values.push(Math.max(
        candles[index].high - candles[index].low,
        Math.abs(candles[index].high - candles[index - 1].close),
        Math.abs(candles[index].low - candles[index - 1].close)
      ));
    }
    return values;
  }

  static _range(candles) {
    if (!candles.length) return 0;
    return Math.max(...candles.map((candle) => candle.high)) -
      Math.min(...candles.map((candle) => candle.low));
  }

  static _weightedCenter(pivots) {
    const weighted = pivots.reduce((result, pivot) => {
      const weight = pivot.timeframe === '4H' ? 2 : 1;
      result.total += pivot.price * weight;
      result.weight += weight;
      return result;
    }, { total: 0, weight: 0 });
    return weighted.weight ? weighted.total / weighted.weight : 0;
  }

  static _confirmed(candles = []) {
    return candles
      .filter((candle) => candle?.confirm !== false)
      .map((candle) => ({
        ...candle,
        timestamp: Number(candle.timestamp),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  static _average(values) {
    const finite = values.map(Number).filter(Number.isFinite);
    return finite.length
      ? finite.reduce((sum, value) => sum + value, 0) / finite.length
      : 0;
  }

  static _round(value, precision = 2) {
    const factor = 10 ** precision;
    return Math.round(Number(value || 0) * factor) / factor;
  }
}

module.exports = StructureLevelEngine;
