const StructureLevelEngine = require('./structureLevelEngine');
const {
  STRUCTURE_PROJECT,
  STRUCTURE_WIDE_EXPERIMENT_ID,
  STRUCTURE_TIMEFRAMES,
  STRUCTURE_AUDIT_CANDLE_LIMIT,
  STRUCTURE_AUDIT_MIN_CONFIRMED_CANDLES,
  STRUCTURE_WIDE_SCAN_LIMIT,
  STRUCTURE_WIDE_CONCURRENCY,
  STRUCTURE_WIDE_MIN_TURNOVER_USD,
  STRUCTURE_WIDE_MAX_SPREAD_PERCENT,
  STRUCTURE_WIDE_MAX_ZONE_DISTANCE_PERCENT,
  STRUCTURE_WIDE_CANDIDATE_SCORE,
  STRUCTURE_WIDE_REPORT_LIMIT,
} = require('../config/structure');

class StructureWideRadar {
  static async scan(provider, options = {}) {
    const startedAt = Date.now();
    const settings = this._settings(options);
    const [tickers, spotSymbols] = await Promise.all([
      provider.getGateFuturesTickers(),
      typeof provider.getGateSpotSymbols === 'function'
        ? provider.getGateSpotSymbols()
        : Promise.resolve([]),
    ]);
    const spotUniverse = new Set(spotSymbols);
    const spotVerificationEnabled = spotUniverse.size > 0;
    const rejectionCounts = {};
    const liquidUniverse = [];

    tickers.forEach((ticker) => {
      const eligibility = this._checkTicker(ticker, settings, {
        spotUniverse,
        spotVerificationEnabled,
      });
      if (!eligibility.eligible) {
        this._count(rejectionCounts, eligibility.reason);
        return;
      }
      liquidUniverse.push({
        ...ticker,
        spreadPercent: eligibility.spreadPercent,
      });
    });

    liquidUniverse.sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h));
    const selected = liquidUniverse.slice(0, settings.scanLimit);
    if (liquidUniverse.length > selected.length) {
      rejectionCounts.DEEP_SCAN_LIMIT = liquidUniverse.length - selected.length;
    }

    const deepResults = await this._mapWithConcurrency(
      selected,
      settings.concurrency,
      (ticker) => this._analyzePair(provider, ticker, settings)
    );
    const reports = [];

    deepResults.forEach((result) => {
      if (!result.eligible) {
        this._count(rejectionCounts, result.rejectionReason);
        return;
      }
      reports.push(result);
      if (!result.candidate) {
        this._count(rejectionCounts, result.rejectionReason);
      }
    });

    reports.sort((a, b) => b.score - a.score);
    const candidates = reports.filter((report) => report.candidate);

    return {
      project: STRUCTURE_PROJECT,
      experimentId: STRUCTURE_WIDE_EXPERIMENT_ID,
      strategy: 'STRUCTURE_WIDE_RADAR_V1',
      marketSource: 'GATE',
      marketScope: spotVerificationEnabled
        ? 'GATE_FUTURES_SPOT_INTERSECTION'
        : 'GATE_FUTURES_UNVERIFIED',
      spotVerificationEnabled,
      spotPairs: spotUniverse.size,
      scannedPairs: tickers.length,
      liquidPairs: liquidUniverse.length,
      deepScanSelected: selected.length,
      analyzedPairs: reports.length,
      candidateCount: candidates.length,
      settings,
      rejectionCounts,
      reports,
      candidates,
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
      signalsGenerated: 0,
      eventsCreated: 0,
      paperSignalsCreated: 0,
      alertsSent: 0,
    };
  }

  static async _analyzePair(provider, ticker, settings) {
    const pair = String(ticker.symbol || '').toUpperCase();
    const candleEntries = await Promise.all(
      STRUCTURE_TIMEFRAMES.map(async (timeframe) => {
        const candles = await provider.getGateFuturesKlines(
          pair,
          timeframe.interval,
          STRUCTURE_AUDIT_CANDLE_LIMIT
        );
        return [timeframe.label, candles];
      })
    );
    const candleSets = Object.fromEntries(candleEntries);
    const dataReady = STRUCTURE_TIMEFRAMES.every((timeframe) => (
      this._confirmedCount(candleSets[timeframe.label]) >=
        STRUCTURE_AUDIT_MIN_CONFIRMED_CANDLES
    ));

    if (!dataReady) {
      return {
        pair,
        eligible: false,
        rejectionReason: 'DATA_NOT_READY',
      };
    }

    const levels = StructureLevelEngine.analyzeCandleSets(pair, candleSets, {
      source: 'GATE',
    });
    if (levels.status !== 'LEVELS_FOUND') {
      return {
        pair,
        eligible: false,
        rejectionReason: 'NO_LEVELS',
      };
    }

    return this._buildReport(ticker, levels, settings);
  }

  static _buildReport(ticker, levels, settings) {
    const location = this._selectLocation(levels);
    if (!location) {
      return {
        pair: levels.pair,
        eligible: true,
        candidate: false,
        rejectionReason: 'NO_NEARBY_ZONE',
        score: levels.compression.state === 'COMPRESSED' ? 15 : 0,
        setup: 'NO_NEARBY_ZONE',
        structure: levels.structure,
        compression: levels.compression,
        currentPrice: levels.currentPrice,
        turnover24h: Number(ticker.turnover24h),
        spreadPercent: this._spreadPercent(ticker),
      };
    }

    const score = this._score(location, levels.compression);
    const nearZone = location.distancePercent <= settings.maxZoneDistancePercent;
    const scoreQualified = score >= settings.candidateScore;
    const hasSetupQuality = (
      levels.compression.state === 'COMPRESSED' ||
      (
        location.type !== 'INSIDE_ZONE' &&
        location.distancePercent <= 0.5
      )
    );
    const candidate = nearZone && scoreQualified && hasSetupQuality;

    return {
      pair: levels.pair,
      eligible: true,
      candidate,
      rejectionReason: candidate ? null : (
        !nearZone
          ? 'ZONE_TOO_FAR'
          : !scoreQualified
            ? 'SCORE_BELOW_THRESHOLD'
            : 'NO_COMPRESSION_OR_EDGE'
      ),
      score,
      setup: this._setup(location, levels.compression),
      location: location.type,
      currentPrice: levels.currentPrice,
      zone: location.zone,
      zoneDistancePercent: location.distancePercent,
      structure: levels.structure,
      compression: levels.compression,
      turnover24h: Number(ticker.turnover24h),
      spreadPercent: this._spreadPercent(ticker),
      priceChange24hPercent: Number(ticker.priceChange24hPercent || 0),
      reasons: this._reasons(location, levels.compression),
      signalsGenerated: 0,
    };
  }

  static _selectLocation(levels) {
    if (levels.activeZones?.length) {
      return {
        type: 'INSIDE_ZONE',
        zone: levels.activeZones[0],
        distancePercent: 0,
      };
    }

    const options = [
      levels.resistance?.[0]
        ? { type: 'RESISTANCE', zone: levels.resistance[0] }
        : null,
      levels.support?.[0]
        ? { type: 'SUPPORT', zone: levels.support[0] }
        : null,
    ].filter(Boolean);

    if (!options.length) return null;
    options.sort((a, b) => a.zone.distancePercent - b.zone.distancePercent);
    return {
      ...options[0],
      distancePercent: options[0].zone.distancePercent,
    };
  }

  static _score(location, compression) {
    const zoneQuality = Math.round(Number(location.zone.score || 0) * 0.55);
    const distanceScore = location.type === 'INSIDE_ZONE'
      ? 25
      : location.distancePercent <= 0.25
        ? 23
        : location.distancePercent <= 0.5
          ? 20
          : location.distancePercent <= 1
            ? 15
            : location.distancePercent <= 2
              ? 8
              : 3;
    const compressionScore = compression.state === 'COMPRESSED'
      ? 15
      : compression.state === 'NORMAL'
        ? 5
        : 0;
    const confluenceScore = location.zone.timeframes?.length >= 2 ? 5 : 0;

    return Math.min(
      100,
      zoneQuality + distanceScore + compressionScore + confluenceScore
    );
  }

  static _setup(location, compression) {
    if (location.type === 'INSIDE_ZONE') return 'AT_KEY_ZONE';
    if (location.type === 'RESISTANCE') {
      return compression.state === 'COMPRESSED'
        ? 'COMPRESSED_BELOW_RESISTANCE'
        : 'NEAR_RESISTANCE';
    }
    return compression.state === 'COMPRESSED'
      ? 'COMPRESSED_ABOVE_SUPPORT'
      : 'NEAR_SUPPORT';
  }

  static _reasons(location, compression) {
    const reasons = [
      `${location.type}_${location.distancePercent}%`,
      `ZONE_SCORE_${location.zone.score}`,
      `TOUCHES_${location.zone.touches}`,
    ];
    if (location.zone.timeframes?.length >= 2) reasons.push('4H_1H_CONFLUENCE');
    if (compression.state === 'COMPRESSED') reasons.push('1H_COMPRESSION');
    return reasons;
  }

  static _checkTicker(ticker, settings, market = {}) {
    const pair = String(ticker.symbol || '').toUpperCase();
    const lastPrice = Number(ticker.lastPrice);
    const turnover = Number(ticker.turnover24h);
    if (!pair.endsWith('USDT') || !Number.isFinite(lastPrice) || lastPrice <= 0) {
      return { eligible: false, reason: 'INVALID_TICKER' };
    }
    if (
      market.spotVerificationEnabled &&
      !market.spotUniverse.has(pair)
    ) {
      return { eligible: false, reason: 'NOT_IN_GATE_SPOT' };
    }
    if (!Number.isFinite(turnover) || turnover < settings.minTurnoverUsd) {
      return { eligible: false, reason: 'LOW_TURNOVER' };
    }

    const spreadPercent = this._spreadPercent(ticker);
    if (
      Number.isFinite(spreadPercent) &&
      spreadPercent > settings.maxSpreadPercent
    ) {
      return { eligible: false, reason: 'WIDE_SPREAD', spreadPercent };
    }
    return { eligible: true, spreadPercent };
  }

  static toDiagnostic(scan, limit = STRUCTURE_WIDE_REPORT_LIMIT) {
    return {
      experiment_id: scan.experimentId,
      project: scan.project,
      strategy: scan.strategy,
      scan_source: scan.marketSource,
      scanned_pairs: scan.scannedPairs,
      qualified_before_context: scan.analyzedPairs,
      qualified_after_context: scan.candidateCount,
      rejection_counts: scan.rejectionCounts,
      context_rejection_counts: {},
      market_context: {
        mode: 'STRUCTURE_WIDE_DIAGNOSTIC_ONLY',
        marketScope: scan.marketScope,
        spotVerificationEnabled: scan.spotVerificationEnabled,
        spotPairs: scan.spotPairs,
        liquidPairs: scan.liquidPairs,
        deepScanSelected: scan.deepScanSelected,
        settings: scan.settings,
        signalsGenerated: 0,
        eventsCreated: 0,
        paperSignalsCreated: 0,
        alertsSent: 0,
      },
      examples: scan.reports.slice(0, limit).map((report) => ({
        pair: report.pair,
        score: report.score,
        candidate: report.candidate,
        setup: report.setup,
        location: report.location || null,
        zoneDistancePercent: report.zoneDistancePercent ?? null,
        zone: report.zone || null,
        structure: report.structure,
        compression: report.compression,
        turnover24h: report.turnover24h,
        spreadPercent: report.spreadPercent,
        reasons: report.reasons || [],
      })),
    };
  }

  static async _mapWithConcurrency(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = await worker(items[index], index);
        } catch (error) {
          results[index] = {
            pair: String(items[index]?.symbol || ''),
            eligible: false,
            rejectionReason: 'ANALYSIS_ERROR',
            error: error?.message || String(error),
          };
        }
      }
    }));

    return results;
  }

  static _settings(options) {
    return {
      scanLimit: Math.floor(options.scanLimit || STRUCTURE_WIDE_SCAN_LIMIT),
      concurrency: Math.floor(options.concurrency || STRUCTURE_WIDE_CONCURRENCY),
      minTurnoverUsd: options.minTurnoverUsd ||
        STRUCTURE_WIDE_MIN_TURNOVER_USD,
      maxSpreadPercent: options.maxSpreadPercent ||
        STRUCTURE_WIDE_MAX_SPREAD_PERCENT,
      maxZoneDistancePercent: options.maxZoneDistancePercent ||
        STRUCTURE_WIDE_MAX_ZONE_DISTANCE_PERCENT,
      candidateScore: options.candidateScore ||
        STRUCTURE_WIDE_CANDIDATE_SCORE,
    };
  }

  static _confirmedCount(candles = []) {
    return candles.filter((candle) => candle?.confirm !== false).length;
  }

  static _spreadPercent(ticker) {
    const bid = Number(ticker.bidPrice);
    const ask = Number(ticker.askPrice);
    const mid = (bid + ask) / 2;
    return Number.isFinite(bid) && Number.isFinite(ask) && mid > 0
      ? Math.round(((ask - bid) / mid) * 1000000) / 10000
      : null;
  }

  static _count(counts, reason) {
    counts[reason] = (counts[reason] || 0) + 1;
  }
}

module.exports = StructureWideRadar;
