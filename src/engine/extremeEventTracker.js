const {
  EXTREME_EVENT_TRACKING_ENABLED,
  EXTREME_EVENT_ARM_SCORE,
  EXTREME_EVENT_ARM_OBSERVATIONS,
  EXTREME_EVENT_TRIGGER_MOVE_PERCENT,
  EXTREME_EVENT_STALE_MINUTES,
  EXTREME_EVENT_MAX_HOURS,
  EXTREME_EVENT_HISTORY_LIMIT,
  EXTREME_EXPERIMENT_ID,
  EXTREME_EVENT_STATES,
  EXTREME_SCENARIOS,
} = require('../config/extremeRadar');

class ExtremeEventTracker {
  constructor(db, options = {}) {
    this.db = db;
    this.enabled = options.enabled ?? EXTREME_EVENT_TRACKING_ENABLED;
    this.armScore = options.armScore || EXTREME_EVENT_ARM_SCORE;
    this.armObservations = options.armObservations || EXTREME_EVENT_ARM_OBSERVATIONS;
    this.triggerMovePercent =
      options.triggerMovePercent || EXTREME_EVENT_TRIGGER_MOVE_PERCENT;
    this.staleMinutes = options.staleMinutes || EXTREME_EVENT_STALE_MINUTES;
    this.maxHours = options.maxHours || EXTREME_EVENT_MAX_HOURS;
    this.historyLimit = options.historyLimit || EXTREME_EVENT_HISTORY_LIMIT;
  }

  async processScan(scan, now = new Date()) {
    const summary = {
      enabled: this.enabled,
      directionalCandidates: 0,
      created: 0,
      updated: 0,
      armed: 0,
      triggered: 0,
      expired: 0,
    };
    if (!this.enabled) return summary;

    const activeEvents = await this.db.getActiveExtremeEvents({
      experimentId: EXTREME_EXPERIMENT_ID,
    });
    const activeByKey = new Map();

    for (const event of activeEvents) {
      if (this._isPastMaxLifetime(event, now)) {
        await this._expireEvent(event, now, 'MAX_LIFETIME_REACHED');
        summary.expired += 1;
        continue;
      }
      activeByKey.set(this._eventKey(event.pair, event.scenario), event);
    }

    const candidates = (scan.anomalies || [])
      .map((report) => ({
        report,
        scenario: this._scenarioFor(report),
      }))
      .filter(({ scenario }) => Boolean(scenario));
    summary.directionalCandidates = candidates.length;
    const seenKeys = new Set();

    for (const { report, scenario } of candidates) {
      const key = this._eventKey(report.pair, scenario);
      seenKeys.add(key);
      const event = activeByKey.get(key);

      if (!event) {
        const created = await this._createWatchEvent(report, scenario, scan, now);
        if (created) {
          activeByKey.set(key, created);
          summary.created += 1;
        }
        continue;
      }

      const result = await this._observeEvent(event, report, scan, now);
      if (result.updated) summary.updated += 1;
      if (result.state === EXTREME_EVENT_STATES.ARMED) summary.armed += 1;
      if (result.state === EXTREME_EVENT_STATES.TRIGGERED) summary.triggered += 1;
      if (result.event) activeByKey.set(key, result.event);
    }

    for (const [key, event] of activeByKey.entries()) {
      if (seenKeys.has(key)) continue;
      if (!this._isStale(event, now)) continue;
      await this._expireEvent(event, now, 'ANOMALY_NO_LONGER_PRESENT');
      summary.expired += 1;
    }

    return summary;
  }

  _scenarioFor(report = {}) {
    const move = Number(report.priceChange24hPercent);
    const funding = Number(report.fundingPercent);

    if (report.anomalyType === 'SHORT_SQUEEZE_PRESSURE') {
      return EXTREME_SCENARIOS.SQUEEZE_LONG;
    }
    if (report.anomalyType === 'LONG_LIQUIDATION_RISK') {
      return EXTREME_SCENARIOS.CASCADE_SHORT;
    }
    if (Number.isFinite(funding) && funding <= -0.1) {
      return EXTREME_SCENARIOS.SQUEEZE_LONG;
    }
    if (Number.isFinite(funding) && funding >= 0.1) {
      return EXTREME_SCENARIOS.CASCADE_SHORT;
    }
    if (Number.isFinite(move) && move >= 15) {
      return EXTREME_SCENARIOS.SQUEEZE_LONG;
    }
    if (Number.isFinite(move) && move <= -15) {
      return EXTREME_SCENARIOS.CASCADE_SHORT;
    }
    return null;
  }

  async _createWatchEvent(report, scenario, scan, now) {
    const observation = this._observation(report, now);
    const expiresAt = new Date(now.getTime() + this.maxHours * 60 * 60 * 1000);
    const transition = this._transition(
      null,
      EXTREME_EVENT_STATES.WATCH,
      now,
      'DIRECTIONAL_ANOMALY_DETECTED'
    );

    return this.db.createExtremeEvent({
      pair: report.pair,
      scenario,
      state: EXTREME_EVENT_STATES.WATCH,
      primary_venue: report.marketSource || scan.marketSource,
      source_integrity: Boolean(report.marketSource || scan.marketSource),
      score: report.score,
      reference_price: report.lastPrice,
      timeframe: '24H_TICKER_3M_SCAN',
      metrics: {
        version: 'extreme_event_metrics_v1',
        observation_count: 1,
        first: observation,
        latest: observation,
        first_price: report.lastPrice,
        last_price: report.lastPrice,
        max_price: report.lastPrice,
        min_price: report.lastPrice,
        max_score: report.score,
        last_seen_at: now.toISOString(),
        observations: [observation],
      },
      reasons: report.reasons || [],
      risk_flags: report.riskFlags || [],
      transition_history: [transition],
      first_seen_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
  }

  async _observeEvent(event, report, scan, now) {
    const previousState = event.state;
    const observation = this._observation(report, now);
    const metrics = this._nextMetrics(event.metrics, observation, event.scenario);
    const updates = {
      primary_venue: event.primary_venue || report.marketSource || scan.marketSource,
      source_integrity: Boolean(
        event.source_integrity &&
        (!event.primary_venue || event.primary_venue === (report.marketSource || scan.marketSource))
      ),
      score: Number(report.score || 0),
      metrics,
      reasons: this._mergeUnique(event.reasons, report.reasons),
      risk_flags: this._mergeUnique(event.risk_flags, report.riskFlags),
    };

    let nextState = previousState;
    let transitionReason = null;

    if (
      previousState === EXTREME_EVENT_STATES.WATCH &&
      this._shouldArm(event, report, metrics, now, updates.source_integrity)
    ) {
      nextState = EXTREME_EVENT_STATES.ARMED;
      transitionReason = 'PERSISTENT_DIRECTIONAL_ANOMALY';
      updates.armed_at = now.toISOString();
      metrics.armed_price = report.lastPrice;
      metrics.armed_at = now.toISOString();
    } else if (
      previousState === EXTREME_EVENT_STATES.ARMED &&
      this._shouldTrigger(event, report, metrics)
    ) {
      nextState = EXTREME_EVENT_STATES.TRIGGERED;
      transitionReason = 'POST_ARM_PRICE_CONFIRMATION';
      updates.triggered_at = now.toISOString();
      metrics.trigger_price = report.lastPrice;
      metrics.triggered_at = now.toISOString();
    }

    if (nextState !== previousState) {
      updates.state = nextState;
      updates.transition_history = [
        ...(event.transition_history || []),
        this._transition(previousState, nextState, now, transitionReason),
      ];
    }

    const updated = await this.db.updateExtremeEvent(event.id, updates);
    return {
      updated: true,
      state: nextState !== previousState ? nextState : null,
      event: updated || { ...event, ...updates },
    };
  }

  _nextMetrics(current = {}, observation, scenario) {
    const price = Number(observation.price);
    const firstPrice = Number(current.first_price);
    const maxPrice = Number(current.max_price);
    const minPrice = Number(current.min_price);
    const history = [...(current.observations || []), observation]
      .slice(-this.historyLimit);
    const metrics = {
      ...current,
      observation_count: Number(current.observation_count || 0) + 1,
      latest: observation,
      last_price: Number.isFinite(price) ? price : current.last_price,
      max_price: Number.isFinite(price)
        ? Math.max(Number.isFinite(maxPrice) ? maxPrice : price, price)
        : current.max_price,
      min_price: Number.isFinite(price)
        ? Math.min(Number.isFinite(minPrice) ? minPrice : price, price)
        : current.min_price,
      max_score: Math.max(Number(current.max_score || 0), observation.score),
      last_seen_at: observation.at,
      observations: history,
    };

    if (Number.isFinite(firstPrice) && firstPrice > 0 && Number.isFinite(price)) {
      const rawMove = ((price - firstPrice) / firstPrice) * 100;
      metrics.move_from_first_percent = this._round(rawMove, 4);
      metrics.favorable_move_percent = this._round(
        scenario === EXTREME_SCENARIOS.SQUEEZE_LONG ? rawMove : -rawMove,
        4
      );
    }
    return metrics;
  }

  _shouldArm(event, report, metrics, now, sourceIntegrity) {
    const firstSeen = new Date(event.first_seen_at || event.created_at).getTime();
    const persistenceMinutes = (now.getTime() - firstSeen) / 60000;
    const spread = Number(report.spreadPercent);
    return (
      metrics.observation_count >= this.armObservations &&
      Number(report.score || 0) >= this.armScore &&
      persistenceMinutes >= Math.max(1, (this.armObservations - 1) * 2) &&
      (!Number.isFinite(spread) || spread <= 0.5) &&
      sourceIntegrity !== false
    );
  }

  _shouldTrigger(event, report, metrics) {
    const armedPrice = Number(event.metrics?.armed_price || metrics.armed_price);
    const price = Number(report.lastPrice);
    if (!Number.isFinite(armedPrice) || armedPrice <= 0 || !Number.isFinite(price)) {
      return false;
    }
    const rawMove = ((price - armedPrice) / armedPrice) * 100;
    const favorableMove = event.scenario === EXTREME_SCENARIOS.SQUEEZE_LONG
      ? rawMove
      : -rawMove;
    metrics.move_from_armed_percent = this._round(rawMove, 4);
    metrics.favorable_from_armed_percent = this._round(favorableMove, 4);
    return favorableMove >= this.triggerMovePercent;
  }

  async _expireEvent(event, now, reason) {
    const history = [
      ...(event.transition_history || []),
      this._transition(event.state, EXTREME_EVENT_STATES.EXPIRED, now, reason),
    ];
    return this.db.updateExtremeEvent(event.id, {
      state: EXTREME_EVENT_STATES.EXPIRED,
      resolved_at: now.toISOString(),
      transition_history: history,
    });
  }

  _isPastMaxLifetime(event, now) {
    const expiresAt = new Date(event.expires_at || 0).getTime();
    return Number.isFinite(expiresAt) && expiresAt > 0 && now.getTime() >= expiresAt;
  }

  _isStale(event, now) {
    const lastSeenAt = new Date(
      event.metrics?.last_seen_at || event.updated_at || event.created_at
    ).getTime();
    return Number.isFinite(lastSeenAt) &&
      now.getTime() - lastSeenAt >= this.staleMinutes * 60 * 1000;
  }

  _observation(report, now) {
    return {
      at: now.toISOString(),
      price: report.lastPrice,
      score: Number(report.score || 0),
      anomaly_type: report.anomalyType,
      price_change_24h_percent: report.priceChange24hPercent,
      range_24h_percent: report.range24hPercent,
      funding_percent: report.fundingPercent,
      open_interest_usd: report.openInterestUsd,
      turnover_24h: report.turnover24h,
      spread_percent: report.spreadPercent,
    };
  }

  _transition(from, to, now, reason) {
    return {
      from,
      to,
      at: now.toISOString(),
      reason,
    };
  }

  _eventKey(pair, scenario) {
    return `${String(pair || '').toUpperCase()}:${scenario}`;
  }

  _mergeUnique(left = [], right = []) {
    return [...new Set([...(left || []), ...(right || [])])];
  }

  _round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }
}

module.exports = ExtremeEventTracker;
