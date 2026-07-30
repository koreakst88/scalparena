const {
  STRUCTURE_PROJECT,
  STRUCTURE_EXPERIMENT_ID,
  STRUCTURE_TIMEFRAMES,
  STRUCTURE_AUDIT_CANDLE_LIMIT,
  STRUCTURE_AUDIT_MIN_CONFIRMED_CANDLES,
} = require('../config/structure');

const VENUES = Object.freeze([
  {
    name: 'GATE',
    method: 'getGateFuturesKlines',
  },
  {
    name: 'OKX',
    method: 'getOkxSwapKlines',
  },
]);

class StructureDataAudit {
  static async run(provider, pair, options = {}) {
    const normalizedPair = this.normalizePair(pair);
    const startedAt = Date.now();
    const limit = options.limit || STRUCTURE_AUDIT_CANDLE_LIMIT;
    const minConfirmed = options.minConfirmed || STRUCTURE_AUDIT_MIN_CONFIRMED_CANDLES;

    const venues = Object.fromEntries(await Promise.all(
      VENUES.map(async (venue) => [
        venue.name,
        await this._auditVenue(provider, venue, normalizedPair, {
          limit,
          minConfirmed,
          includeCandles: options.includeCandles === true,
        }),
      ])
    ));
    const primaryVenue = this._selectPrimaryVenue(venues);
    const primary = primaryVenue ? venues[primaryVenue] : null;

    return {
      project: STRUCTURE_PROJECT,
      experimentId: STRUCTURE_EXPERIMENT_ID,
      pair: normalizedPair,
      timeframes: STRUCTURE_TIMEFRAMES,
      candleLimit: limit,
      minConfirmed,
      venues,
      primaryVenue,
      readyForLevelResearch: Boolean(primary?.complete),
      durationMs: Date.now() - startedAt,
      levelEngineEnabled: false,
      wideScanEnabled: false,
      eventsEnabled: false,
      paperSignalsEnabled: false,
      alertsEnabled: false,
    };
  }

  static normalizePair(pair) {
    const normalized = String(pair || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    if (!normalized.endsWith('USDT') || normalized.length < 7) {
      throw new Error('Structure audit pair must look like BTCUSDT');
    }

    return normalized;
  }

  static async _auditVenue(provider, venue, pair, options) {
    if (typeof provider[venue.method] !== 'function') {
      return {
        venue: venue.name,
        complete: false,
        usableTimeframes: 0,
        error: `${venue.method} is unavailable`,
        timeframes: {},
      };
    }

    const results = await Promise.all(STRUCTURE_TIMEFRAMES.map(async (timeframe) => {
      const startedAt = Date.now();
      try {
        const candles = await provider[venue.method](
          pair,
          timeframe.interval,
          options.limit
        );
        return {
          label: timeframe.label,
          candles,
          inspection: this._inspectCandles(candles, timeframe, {
            minConfirmed: options.minConfirmed,
            latencyMs: Date.now() - startedAt,
          }),
        };
      } catch (error) {
        return {
          label: timeframe.label,
          candles: [],
          inspection: this._failedTimeframe(
            timeframe,
            Date.now() - startedAt,
            error?.message || String(error)
          ),
        };
      }
    }));

    const timeframes = Object.fromEntries(
      results.map((result) => [result.label, result.inspection])
    );
    const candleSets = options.includeCandles
      ? Object.fromEntries(results.map((result) => [result.label, result.candles]))
      : undefined;
    const usableTimeframes = Object.values(timeframes)
      .filter((result) => result.usable).length;

    return {
      venue: venue.name,
      complete: usableTimeframes === STRUCTURE_TIMEFRAMES.length,
      usableTimeframes,
      error: null,
      timeframes,
      ...(candleSets ? { candleSets } : {}),
    };
  }

  static _inspectCandles(rawCandles, timeframe, options = {}) {
    const candles = Array.isArray(rawCandles) ? rawCandles : [];
    const confirmed = candles.filter((candle) => candle?.confirm !== false);
    const timestamps = confirmed
      .map((candle) => Number(candle.timestamp))
      .filter(Number.isFinite);
    const uniqueTimestamps = new Set(timestamps);
    const invalidCandles = confirmed.filter((candle) => !this._isValidCandle(candle)).length;
    const volumeCandles = confirmed.filter((candle) => (
      Number.isFinite(Number(candle.volume)) && Number(candle.volume) > 0
    )).length;
    const expectedMs = timeframe.minutes * 60 * 1000;
    let gaps = 0;

    for (let index = 1; index < timestamps.length; index += 1) {
      if (timestamps[index] - timestamps[index - 1] > expectedMs * 1.5) gaps += 1;
    }

    const lastTimestamp = timestamps[timestamps.length - 1] || null;
    const ageMinutes = lastTimestamp
      ? Math.max(0, (Date.now() - lastTimestamp) / 60000)
      : null;
    const fresh = Number.isFinite(ageMinutes) && ageMinutes <= timeframe.minutes * 2.5;
    const duplicateCount = timestamps.length - uniqueTimestamps.size;
    const minConfirmed = options.minConfirmed || STRUCTURE_AUDIT_MIN_CONFIRMED_CANDLES;
    const volumeCoverage = confirmed.length
      ? volumeCandles / confirmed.length
      : 0;
    const gapRatio = confirmed.length > 1
      ? gaps / (confirmed.length - 1)
      : 1;
    const usable = (
      confirmed.length >= minConfirmed &&
      invalidCandles === 0 &&
      duplicateCount === 0 &&
      volumeCoverage >= 0.95 &&
      gapRatio <= 0.02 &&
      fresh
    );

    return {
      label: timeframe.label,
      interval: timeframe.interval,
      requested: STRUCTURE_AUDIT_CANDLE_LIMIT,
      received: candles.length,
      confirmed: confirmed.length,
      invalidCandles,
      duplicateCount,
      gaps,
      gapRatio: this._round(gapRatio * 100, 2),
      volumeCoverage: this._round(volumeCoverage * 100, 1),
      lastTimestamp: lastTimestamp ? new Date(lastTimestamp).toISOString() : null,
      ageMinutes: Number.isFinite(ageMinutes) ? this._round(ageMinutes, 1) : null,
      fresh,
      usable,
      latencyMs: options.latencyMs || 0,
      error: candles.length ? null : 'empty response or contract unavailable',
    };
  }

  static _failedTimeframe(timeframe, latencyMs, error) {
    return {
      label: timeframe.label,
      interval: timeframe.interval,
      requested: STRUCTURE_AUDIT_CANDLE_LIMIT,
      received: 0,
      confirmed: 0,
      invalidCandles: 0,
      duplicateCount: 0,
      gaps: 0,
      gapRatio: 100,
      volumeCoverage: 0,
      lastTimestamp: null,
      ageMinutes: null,
      fresh: false,
      usable: false,
      latencyMs,
      error,
    };
  }

  static _isValidCandle(candle) {
    const open = Number(candle?.open);
    const high = Number(candle?.high);
    const low = Number(candle?.low);
    const close = Number(candle?.close);

    return (
      Number.isFinite(open) &&
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      Number.isFinite(close) &&
      open > 0 &&
      high >= Math.max(open, close) &&
      low <= Math.min(open, close) &&
      high >= low
    );
  }

  static _selectPrimaryVenue(venues) {
    const ranked = Object.values(venues)
      .sort((a, b) => (
        Number(b.complete) - Number(a.complete) ||
        b.usableTimeframes - a.usableTimeframes ||
        VENUES.findIndex((venue) => venue.name === a.venue) -
          VENUES.findIndex((venue) => venue.name === b.venue)
      ));

    return ranked[0]?.usableTimeframes > 0 ? ranked[0].venue : null;
  }

  static _round(value, precision = 2) {
    const factor = 10 ** precision;
    return Math.round(Number(value || 0) * factor) / factor;
  }
}

module.exports = StructureDataAudit;
