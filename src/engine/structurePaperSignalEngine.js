const {
  STRUCTURE_PAPER_MIN_RR,
  STRUCTURE_PAPER_MAX_RISK_PERCENT,
  STRUCTURE_PAPER_STOP_ATR_BUFFER,
} = require('../config/structure');
const {
  STRUCTURE_PAPER_EXPERIMENT_ID,
} = require('../config/paperExperiment');

class StructurePaperSignalEngine {
  static build(event, options = {}) {
    const direction = event.metrics?.paper_direction;
    const entryPrice = Number(
      event.metrics?.paper_entry_price || event.metrics?.last_price
    );
    const lower = Number(event.zone_lower);
    const upper = Number(event.zone_upper);
    const latest = event.metrics?.latest || {};
    const atr1h = Number(latest.atr_1h || 0);
    const minRiskReward = Number(options.minRiskReward || STRUCTURE_PAPER_MIN_RR);
    const maxRiskPercent = Number(
      options.maxRiskPercent || STRUCTURE_PAPER_MAX_RISK_PERCENT
    );
    const stopAtrBuffer = Number(
      options.stopAtrBuffer || STRUCTURE_PAPER_STOP_ATR_BUFFER
    );

    if (
      !['LONG', 'SHORT'].includes(direction) ||
      ![entryPrice, lower, upper].every(Number.isFinite) ||
      entryPrice <= 0 ||
      lower <= 0 ||
      upper <= lower
    ) {
      return this._skip(event, 'INVALID_EVENT_LEVELS');
    }

    const stopBuffer = atr1h > 0
      ? atr1h * stopAtrBuffer
      : entryPrice * 0.001;
    const stopLoss = direction === 'LONG'
      ? lower - stopBuffer
      : upper + stopBuffer;
    const risk = direction === 'LONG'
      ? entryPrice - stopLoss
      : stopLoss - entryPrice;
    const riskPercent = risk / entryPrice * 100;

    if (
      !Number.isFinite(risk) ||
      risk <= 0 ||
      riskPercent > maxRiskPercent
    ) {
      return this._skip(event, 'RISK_TOO_WIDE', { riskPercent });
    }

    const target = this._selectTarget(
      latest.structural_zones,
      direction,
      entryPrice
    );
    if (!target) {
      return this._skip(event, 'NO_NEXT_STRUCTURAL_ZONE');
    }

    const takeProfit = direction === 'LONG'
      ? Number(target.lower)
      : Number(target.upper);
    const reward = direction === 'LONG'
      ? takeProfit - entryPrice
      : entryPrice - takeProfit;
    const riskReward = reward / risk;

    if (
      !Number.isFinite(reward) ||
      reward <= 0 ||
      !Number.isFinite(riskReward) ||
      riskReward < minRiskReward
    ) {
      return this._skip(event, 'RR_BELOW_MINIMUM', {
        riskReward,
        minRiskReward,
      });
    }

    const entry = this._round(entryPrice);
    const stop = this._round(stopLoss);
    const tp = this._round(takeProfit);

    return {
      eligible: true,
      reason: 'RETEST_RECONFIRMED_WITH_STRUCTURAL_TARGET',
      signal: {
        pair: event.pair,
        type: direction,
        strategy: 'STRUCTURE_BREAKOUT_RETEST_V1_SHADOW',
        entryMode: 'LEVEL_BREAK_RETEST_CONFIRM',
        marketRegime: latest.structure_4h || 'STRUCTURE_LEVEL',
        entryPrice: entry,
        stopLoss: stop,
        takeProfit: tp,
        confidence: Number(event.score || event.zone_score || 0),
        atrPercent: atr1h > 0 ? atr1h / entryPrice * 100 : null,
        volume: null,
        rsi: null,
        bbPosition: null,
        bbWidth: null,
        macdBias: 'STRUCTURE',
        riskReward: this._round(riskReward, 2),
        tpPercent: this._round(reward / entryPrice * 100, 2),
        slPercent: this._round(riskPercent, 2),
        timeframe: '15',
        marketSource: event.primary_venue || 'GATE',
        experimentId: STRUCTURE_PAPER_EXPERIMENT_ID,
        setupReason:
          `${event.scenario}: breakout, retest and direction reconfirmed`,
        invalidationRule:
          `Original zone failed beyond ${this._round(stopLoss)}`,
        signalMetadata: {
          structureEventId: event.id,
          structureEventExperimentId: event.experiment_id,
          scenario: event.scenario,
          triggerOutcome: event.metrics?.trigger_outcome,
          triggerPrice: event.metrics?.trigger_price,
          retestPrice: event.metrics?.retest_price,
          retestSeenAt: event.metrics?.retest_seen_at,
          paperReadyAt: event.metrics?.paper_ready_at,
          originalZone: {
            lower,
            upper,
            score: Number(event.zone_score || 0),
          },
          targetZone: target,
          atr1h: atr1h || null,
          riskPercent: this._round(riskPercent, 2),
          riskReward: this._round(riskReward, 2),
        },
      },
    };
  }

  static _selectTarget(zones = {}, direction, entryPrice) {
    if (direction === 'LONG') {
      return (zones?.resistance || [])
        .filter((zone) => Number(zone.lower) > entryPrice)
        .sort((a, b) => Number(a.lower) - Number(b.lower))[0] || null;
    }
    return (zones?.support || [])
      .filter((zone) => Number(zone.upper) < entryPrice)
      .sort((a, b) => Number(b.upper) - Number(a.upper))[0] || null;
  }

  static _skip(event, reason, details = {}) {
    return {
      eligible: false,
      pair: event?.pair,
      reason,
      details,
      signal: null,
    };
  }

  static _round(value, decimals = 8) {
    const factor = 10 ** decimals;
    return Math.round(Number(value) * factor) / factor;
  }
}

module.exports = StructurePaperSignalEngine;
