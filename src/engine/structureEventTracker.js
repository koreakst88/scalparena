const {
  STRUCTURE_EVENT_TRACKING_ENABLED,
  STRUCTURE_EVENT_ARM_SCORE,
  STRUCTURE_EVENT_ARM_OBSERVATIONS,
  STRUCTURE_EVENT_TRIGGER_BUFFER_PERCENT,
  STRUCTURE_EVENT_INVALIDATION_PERCENT,
  STRUCTURE_EVENT_RETEST_TOLERANCE_PERCENT,
  STRUCTURE_EVENT_STALE_MINUTES,
  STRUCTURE_EVENT_MAX_HOURS,
  STRUCTURE_EVENT_HISTORY_LIMIT,
  STRUCTURE_EVENT_EXPERIMENT_ID,
  STRUCTURE_EVENT_STATES,
  STRUCTURE_SCENARIOS,
} = require('../config/structure');

class StructureEventTracker {
  constructor(db, options = {}) {
    this.db = db;
    this.enabled = options.enabled ?? STRUCTURE_EVENT_TRACKING_ENABLED;
    this.armScore = options.armScore || STRUCTURE_EVENT_ARM_SCORE;
    this.armObservations = options.armObservations ||
      STRUCTURE_EVENT_ARM_OBSERVATIONS;
    this.triggerBufferPercent = options.triggerBufferPercent ||
      STRUCTURE_EVENT_TRIGGER_BUFFER_PERCENT;
    this.invalidationPercent = options.invalidationPercent ||
      STRUCTURE_EVENT_INVALIDATION_PERCENT;
    this.retestTolerancePercent = options.retestTolerancePercent ||
      STRUCTURE_EVENT_RETEST_TOLERANCE_PERCENT;
    this.staleMinutes = options.staleMinutes ||
      STRUCTURE_EVENT_STALE_MINUTES;
    this.maxHours = options.maxHours || STRUCTURE_EVENT_MAX_HOURS;
    this.historyLimit = options.historyLimit ||
      STRUCTURE_EVENT_HISTORY_LIMIT;
  }

  async processScan(scan, now = new Date()) {
    const summary = {
      enabled: this.enabled,
      candidates: (scan.candidates || []).length,
      created: 0,
      updated: 0,
      armed: 0,
      triggered: 0,
      invalidated: 0,
      expired: 0,
      paperReady: 0,
      readyEvents: [],
    };
    if (!this.enabled) return summary;

    const activeEvents = await this.db.getActiveStructureEvents({
      experimentId: STRUCTURE_EVENT_EXPERIMENT_ID,
    });
    const reportsByPair = new Map(
      (scan.reports || []).map((report) => [report.pair, report])
    );
    const activePairs = new Set();

    for (const event of activeEvents) {
      if (this._isPastMaxLifetime(event, now)) {
        await this._closeEvent(
          event,
          STRUCTURE_EVENT_STATES.EXPIRED,
          now,
          'MAX_LIFETIME_REACHED'
        );
        summary.expired += 1;
        continue;
      }

      const report = reportsByPair.get(event.pair);
      if (!report) {
        if (this._isStale(event, now)) {
          await this._closeEvent(
            event,
            STRUCTURE_EVENT_STATES.EXPIRED,
            now,
            'PAIR_NO_LONGER_IN_DEEP_SCAN'
          );
          summary.expired += 1;
        } else {
          activePairs.add(event.pair);
        }
        continue;
      }

      const result = await this._observeEvent(event, report, now);
      summary.updated += 1;
      if (result.state === STRUCTURE_EVENT_STATES.ARMED) summary.armed += 1;
      if (result.state === STRUCTURE_EVENT_STATES.TRIGGERED) summary.triggered += 1;
      if (result.state === STRUCTURE_EVENT_STATES.INVALIDATED) {
        summary.invalidated += 1;
      } else {
        activePairs.add(event.pair);
      }
      if (result.paperReady) {
        summary.paperReady += 1;
        summary.readyEvents.push(result.event);
      }
    }

    for (const report of scan.candidates || []) {
      if (activePairs.has(report.pair)) continue;
      const scenario = this._scenarioFor(report);
      if (!scenario || !this._validZone(report.zone)) continue;
      const created = await this._createWatchEvent(
        report,
        scenario,
        scan,
        now
      );
      if (created) {
        activePairs.add(report.pair);
        summary.created += 1;
      }
    }

    return summary;
  }

  _scenarioFor(report = {}) {
    if (report.location === 'RESISTANCE') {
      return STRUCTURE_SCENARIOS.RESISTANCE_TEST;
    }
    if (report.location === 'SUPPORT') {
      return STRUCTURE_SCENARIOS.SUPPORT_TEST;
    }
    if (report.location === 'INSIDE_ZONE') {
      return STRUCTURE_SCENARIOS.ZONE_COMPRESSION;
    }
    return null;
  }

  async _createWatchEvent(report, scenario, scan, now) {
    const observation = this._observation(report, now);
    const transition = this._transition(
      null,
      STRUCTURE_EVENT_STATES.WATCH,
      now,
      'STRUCTURE_CANDIDATE_DETECTED'
    );
    const expiresAt = new Date(
      now.getTime() + this.maxHours * 60 * 60 * 1000
    );

    return this.db.createStructureEvent({
      pair: report.pair,
      scenario,
      state: STRUCTURE_EVENT_STATES.WATCH,
      primary_venue: scan.marketSource || 'GATE',
      source_integrity: scan.marketScope ===
        'GATE_FUTURES_SPOT_INTERSECTION',
      score: report.score,
      reference_price: report.currentPrice,
      zone_lower: report.zone.lower,
      zone_upper: report.zone.upper,
      zone_score: report.zone.score,
      timeframe: '4H_1H_15M',
      metrics: {
        version: 'structure_event_metrics_v1',
        observation_count: 1,
        first: observation,
        latest: observation,
        first_price: report.currentPrice,
        last_price: report.currentPrice,
        max_price: report.currentPrice,
        min_price: report.currentPrice,
        max_score: report.score,
        last_seen_at: now.toISOString(),
        observations: [observation],
      },
      reasons: report.reasons || [],
      transition_history: [transition],
      first_seen_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
  }

  async _observeEvent(event, report, now) {
    const previousState = event.state;
    const observation = this._observation(report, now);
    const metrics = this._nextMetrics(event.metrics, observation);
    const updates = {
      score: Number(report.score || 0),
      metrics,
      reasons: this._mergeUnique(event.reasons, report.reasons),
    };
    let nextState = previousState;
    let transitionReason = null;
    let paperReady = false;

    if (
      [STRUCTURE_EVENT_STATES.WATCH, STRUCTURE_EVENT_STATES.ARMED]
        .includes(previousState)
    ) {
      const invalidation = this._invalidationFor(event, report.currentPrice);
      if (invalidation) {
        nextState = STRUCTURE_EVENT_STATES.INVALIDATED;
        transitionReason = invalidation;
        updates.resolved_at = now.toISOString();
      }
    }

    if (
      nextState === STRUCTURE_EVENT_STATES.WATCH &&
      this._shouldArm(event, report, metrics, now)
    ) {
      nextState = STRUCTURE_EVENT_STATES.ARMED;
      transitionReason = 'PERSISTENT_ZONE_TEST';
      updates.armed_at = now.toISOString();
      metrics.armed_price = report.currentPrice;
      metrics.armed_at = now.toISOString();
    } else if (nextState === STRUCTURE_EVENT_STATES.ARMED) {
      const outcome = this._triggerOutcome(event, report.currentPrice);
      if (outcome) {
        nextState = STRUCTURE_EVENT_STATES.TRIGGERED;
        transitionReason = outcome;
        updates.triggered_at = now.toISOString();
        metrics.trigger_price = report.currentPrice;
        metrics.triggered_at = now.toISOString();
        metrics.trigger_outcome = outcome;
      }
    } else if (nextState === STRUCTURE_EVENT_STATES.TRIGGERED) {
      const followUp = this._observeTriggered(event, report, metrics, now);
      nextState = followUp.state;
      transitionReason = followUp.transitionReason;
      paperReady = followUp.paperReady;
      if (followUp.resolvedAt) updates.resolved_at = followUp.resolvedAt;
    }

    if (nextState !== previousState) {
      updates.state = nextState;
      updates.transition_history = [
        ...(event.transition_history || []),
        this._transition(previousState, nextState, now, transitionReason),
      ];
    }

    const updated = await this.db.updateStructureEvent(event.id, updates);
    return {
      state: nextState !== previousState ? nextState : null,
      event: updated || { ...event, ...updates },
      paperReady,
    };
  }

  async markPaperRecorded(
    event,
    paperSignals = [],
    now = new Date(),
    decisionReason = null
  ) {
    const metrics = {
      ...(event.metrics || {}),
      paper_decided_at: now.toISOString(),
      ...(paperSignals.length
        ? { paper_recorded_at: now.toISOString() }
        : {}),
      paper_signal_ids: paperSignals.map((signal) => signal.id).filter(Boolean),
      paper_signal_count: paperSignals.length,
      paper_decision_reason: decisionReason,
    };
    return this.db.updateStructureEvent(event.id, {
      state: STRUCTURE_EVENT_STATES.RESOLVED,
      metrics,
      resolved_at: now.toISOString(),
      transition_history: [
        ...(event.transition_history || []),
        this._transition(
          event.state,
          STRUCTURE_EVENT_STATES.RESOLVED,
          now,
          decisionReason || (
            paperSignals.length
              ? 'RETEST_PAPER_RECORDED'
              : 'RETEST_PAPER_SKIPPED'
          )
        ),
      ],
    });
  }

  _observeTriggered(event, report, metrics, now) {
    const direction = this._triggerDirection(event);
    if (!direction) {
      return {
        state: STRUCTURE_EVENT_STATES.INVALIDATED,
        transitionReason: 'UNKNOWN_TRIGGER_DIRECTION',
        resolvedAt: now.toISOString(),
        paperReady: false,
      };
    }

    if (this._postTriggerInvalidated(event, report.currentPrice, direction)) {
      return {
        state: STRUCTURE_EVENT_STATES.INVALIDATED,
        transitionReason: 'RETEST_BROKE_ORIGINAL_ZONE',
        resolvedAt: now.toISOString(),
        paperReady: false,
      };
    }

    if (metrics.paper_ready_at) {
      return {
        state: STRUCTURE_EVENT_STATES.TRIGGERED,
        transitionReason: null,
        paperReady: true,
      };
    }

    if (!event.metrics?.retest_seen_at) {
      if (this._isRetest(event, report.currentPrice, direction)) {
        metrics.retest_seen_at = now.toISOString();
        metrics.retest_price = Number(report.currentPrice);
      }
      return {
        state: STRUCTURE_EVENT_STATES.TRIGGERED,
        transitionReason: null,
        paperReady: false,
      };
    }

    if (this._isReconfirmed(event, report.currentPrice, direction)) {
      metrics.paper_ready_at = now.toISOString();
      metrics.paper_entry_price = Number(report.currentPrice);
      metrics.paper_direction = direction;
      return {
        state: STRUCTURE_EVENT_STATES.TRIGGERED,
        transitionReason: null,
        paperReady: true,
      };
    }

    return {
      state: STRUCTURE_EVENT_STATES.TRIGGERED,
      transitionReason: null,
      paperReady: false,
    };
  }

  _triggerDirection(event) {
    const outcome = event.metrics?.trigger_outcome;
    if (['BREAKOUT_UP_CONFIRMED', 'ZONE_EXIT_UP_CONFIRMED'].includes(outcome)) {
      return 'LONG';
    }
    if (
      ['BREAKDOWN_DOWN_CONFIRMED', 'ZONE_EXIT_DOWN_CONFIRMED'].includes(outcome)
    ) {
      return 'SHORT';
    }
    return null;
  }

  _isRetest(event, priceValue, direction) {
    const price = Number(priceValue);
    const lower = Number(event.zone_lower);
    const upper = Number(event.zone_upper);
    if (![price, lower, upper].every(Number.isFinite)) return false;
    const tolerance = this.retestTolerancePercent / 100;

    if (direction === 'LONG') {
      return price <= upper * (1 + tolerance) && price >= lower;
    }
    return price >= lower * (1 - tolerance) && price <= upper;
  }

  _isReconfirmed(event, priceValue, direction) {
    const price = Number(priceValue);
    const lower = Number(event.zone_lower);
    const upper = Number(event.zone_upper);
    if (![price, lower, upper].every(Number.isFinite)) return false;
    const buffer = this.triggerBufferPercent / 100;
    return direction === 'LONG'
      ? price > upper * (1 + buffer)
      : price < lower * (1 - buffer);
  }

  _postTriggerInvalidated(event, priceValue, direction) {
    const price = Number(priceValue);
    const lower = Number(event.zone_lower);
    const upper = Number(event.zone_upper);
    if (![price, lower, upper].every(Number.isFinite)) return true;
    const invalidation = this.invalidationPercent / 100;
    return direction === 'LONG'
      ? price < lower * (1 - invalidation)
      : price > upper * (1 + invalidation);
  }

  _shouldArm(event, report, metrics, now) {
    const firstSeen = new Date(
      event.first_seen_at || event.created_at
    ).getTime();
    const persistenceMinutes = (now.getTime() - firstSeen) / 60000;
    return (
      metrics.observation_count >= this.armObservations &&
      Number(report.score || 0) >= this.armScore &&
      persistenceMinutes >= Math.max(1, this.armObservations - 1) &&
      event.source_integrity !== false
    );
  }

  _triggerOutcome(event, priceValue) {
    const price = Number(priceValue);
    const lower = Number(event.zone_lower);
    const upper = Number(event.zone_upper);
    if (![price, lower, upper].every(Number.isFinite)) return null;

    const upperTrigger = upper * (1 + this.triggerBufferPercent / 100);
    const lowerTrigger = lower * (1 - this.triggerBufferPercent / 100);
    if (
      event.scenario === STRUCTURE_SCENARIOS.RESISTANCE_TEST &&
      price > upperTrigger
    ) {
      return 'BREAKOUT_UP_CONFIRMED';
    }
    if (
      event.scenario === STRUCTURE_SCENARIOS.SUPPORT_TEST &&
      price < lowerTrigger
    ) {
      return 'BREAKDOWN_DOWN_CONFIRMED';
    }
    if (event.scenario === STRUCTURE_SCENARIOS.ZONE_COMPRESSION) {
      if (price > upperTrigger) return 'ZONE_EXIT_UP_CONFIRMED';
      if (price < lowerTrigger) return 'ZONE_EXIT_DOWN_CONFIRMED';
    }
    return null;
  }

  _invalidationFor(event, priceValue) {
    const price = Number(priceValue);
    const lower = Number(event.zone_lower);
    const upper = Number(event.zone_upper);
    if (![price, lower, upper].every(Number.isFinite)) return null;

    if (
      event.scenario === STRUCTURE_SCENARIOS.RESISTANCE_TEST &&
      price < lower * (1 - this.invalidationPercent / 100)
    ) {
      return 'MOVED_AWAY_BELOW_RESISTANCE_ZONE';
    }
    if (
      event.scenario === STRUCTURE_SCENARIOS.SUPPORT_TEST &&
      price > upper * (1 + this.invalidationPercent / 100)
    ) {
      return 'MOVED_AWAY_ABOVE_SUPPORT_ZONE';
    }
    return null;
  }

  _nextMetrics(current = {}, observation) {
    const price = Number(observation.price);
    const history = [...(current.observations || []), observation]
      .slice(-this.historyLimit);
    return {
      ...current,
      observation_count: Number(current.observation_count || 0) + 1,
      latest: observation,
      last_price: price,
      max_price: Math.max(Number(current.max_price || price), price),
      min_price: Math.min(Number(current.min_price || price), price),
      max_score: Math.max(
        Number(current.max_score || 0),
        Number(observation.score || 0)
      ),
      last_seen_at: observation.at,
      observations: history,
    };
  }

  _observation(report, now) {
    return {
      at: now.toISOString(),
      price: report.currentPrice,
      score: Number(report.score || 0),
      setup: report.setup,
      location: report.location,
      zone_distance_percent: report.zoneDistancePercent,
      observed_zone_lower: report.zone?.lower ?? null,
      observed_zone_upper: report.zone?.upper ?? null,
      observed_zone_score: report.zone?.score ?? null,
      structure_4h: report.structure?.state,
      compression_1h: report.compression?.state,
      atr_1h: report.atr1h ?? null,
      structural_zones: report.structuralZones || null,
      turnover_24h: report.turnover24h,
      spread_percent: report.spreadPercent,
    };
  }

  async _closeEvent(event, state, now, reason) {
    return this.db.updateStructureEvent(event.id, {
      state,
      resolved_at: now.toISOString(),
      transition_history: [
        ...(event.transition_history || []),
        this._transition(event.state, state, now, reason),
      ],
    });
  }

  _isPastMaxLifetime(event, now) {
    const expiresAt = new Date(event.expires_at || 0).getTime();
    return Number.isFinite(expiresAt) &&
      expiresAt > 0 &&
      now.getTime() >= expiresAt;
  }

  _isStale(event, now) {
    const lastSeenAt = new Date(
      event.metrics?.last_seen_at || event.updated_at || event.created_at
    ).getTime();
    return Number.isFinite(lastSeenAt) &&
      now.getTime() - lastSeenAt >= this.staleMinutes * 60 * 1000;
  }

  _validZone(zone = {}) {
    const lower = Number(zone.lower);
    const upper = Number(zone.upper);
    return Number.isFinite(lower) &&
      Number.isFinite(upper) &&
      lower > 0 &&
      upper > lower;
  }

  _transition(from, to, now, reason) {
    return {
      from,
      to,
      at: now.toISOString(),
      reason,
    };
  }

  _mergeUnique(left = [], right = []) {
    return [...new Set([...(left || []), ...(right || [])])];
  }
}

module.exports = StructureEventTracker;
