const {
  EXTREME_PROJECT,
  EXTREME_EXPERIMENT_ID,
  EXTREME_WIDE_MIN_TURNOVER_USD,
  EXTREME_WIDE_ANOMALY_SCORE,
  EXTREME_WIDE_EXAMPLE_LIMIT,
} = require('../config/extremeRadar');

class ExtremeWideRadar {
  static async scan(provider, options = {}) {
    let tickers = await provider.getGateFuturesTickers();
    let marketSource = 'GATE';

    if (!tickers.length && typeof provider.getOkxSwapTickers === 'function') {
      tickers = await provider.getOkxSwapTickers();
      marketSource = 'OKX';
    }

    const minTurnoverUsd = options.minTurnoverUsd || EXTREME_WIDE_MIN_TURNOVER_USD;
    const anomalyScore = options.anomalyScore || EXTREME_WIDE_ANOMALY_SCORE;
    const reports = [];
    const rejectionCounts = {};

    for (const ticker of tickers) {
      const report = this.analyzeTicker(ticker, { marketSource, minTurnoverUsd });
      if (!report.eligible) {
        rejectionCounts[report.rejectionReason] =
          (rejectionCounts[report.rejectionReason] || 0) + 1;
        continue;
      }
      reports.push(report);
    }

    reports.sort((a, b) => b.score - a.score);
    const anomalies = reports.filter((report) => report.score >= anomalyScore);

    return {
      project: EXTREME_PROJECT,
      experimentId: EXTREME_EXPERIMENT_ID,
      strategy: 'EXTREME_WIDE_RADAR_V1',
      marketSource,
      scannedPairs: tickers.length,
      eligiblePairs: reports.length,
      anomalyCount: anomalies.length,
      minTurnoverUsd,
      anomalyScore,
      rejectionCounts,
      reports,
      anomalies,
      generatedAt: new Date().toISOString(),
      signalsGenerated: 0,
      eventsCreated: 0,
    };
  }

  static analyzeTicker(ticker, options = {}) {
    const pair = String(ticker.symbol || '').toUpperCase();
    const lastPrice = this._number(ticker.lastPrice);
    const turnover24h = this._number(ticker.turnover24h);
    const minTurnoverUsd = options.minTurnoverUsd || EXTREME_WIDE_MIN_TURNOVER_USD;

    if (!pair.endsWith('USDT') || !Number.isFinite(lastPrice) || lastPrice <= 0) {
      return {
        pair,
        eligible: false,
        rejectionReason: 'INVALID_TICKER',
      };
    }

    if (!Number.isFinite(turnover24h) || turnover24h < minTurnoverUsd) {
      return {
        pair,
        eligible: false,
        rejectionReason: 'LOW_TURNOVER',
      };
    }

    const priceChange24hPercent = this._priceChangePercent(ticker);
    const range24hPercent = this._rangePercent(ticker);
    const fundingPercent = Number.isFinite(this._number(ticker.fundingRate))
      ? this._number(ticker.fundingRate) * 100
      : null;
    const openInterestUsd = this._nullableNumber(ticker.openInterestUsd);
    const spreadPercent = this._spreadPercent(ticker);
    const score = Math.min(100, (
      this._scorePriceChange(priceChange24hPercent) +
      this._scoreRange(range24hPercent) +
      this._scoreFunding(fundingPercent) +
      this._scoreTurnover(turnover24h) +
      this._scoreOpenInterest(openInterestUsd)
    ));
    const anomalyType = this._classify({
      priceChange24hPercent,
      range24hPercent,
      fundingPercent,
    });

    return {
      pair,
      eligible: true,
      score,
      anomalyType,
      marketSource: ticker.marketSource || options.marketSource || 'UNKNOWN',
      lastPrice,
      priceChange24hPercent: this._round(priceChange24hPercent, 2),
      range24hPercent: this._round(range24hPercent, 2),
      fundingPercent: this._roundNullable(fundingPercent, 4),
      turnover24h: this._round(turnover24h, 2),
      openInterestUsd: this._roundNullable(openInterestUsd, 2),
      spreadPercent: this._roundNullable(spreadPercent, 4),
      reasons: this._buildReasons({
        priceChange24hPercent,
        range24hPercent,
        fundingPercent,
        turnover24h,
        openInterestUsd,
      }),
      riskFlags: this._buildRiskFlags({
        priceChange24hPercent,
        range24hPercent,
        fundingPercent,
        spreadPercent,
      }),
    };
  }

  static toDiagnostic(scan, exampleLimit = EXTREME_WIDE_EXAMPLE_LIMIT) {
    return {
      experiment_id: scan.experimentId,
      project: scan.project,
      strategy: scan.strategy,
      scan_source: scan.marketSource,
      scanned_pairs: scan.scannedPairs,
      qualified_before_context: scan.eligiblePairs,
      qualified_after_context: scan.anomalyCount,
      rejection_counts: scan.rejectionCounts,
      context_rejection_counts: {},
      market_context: {
        mode: scan.eventTracking?.enabled
          ? 'WIDE_RESEARCH_LIFECYCLE'
          : 'WIDE_DIAGNOSTIC_ONLY',
        minTurnoverUsd: scan.minTurnoverUsd,
        anomalyScore: scan.anomalyScore,
        signalsGenerated: 0,
        eventTracking: scan.eventTracking || null,
        eventsCreated: scan.eventsCreated || 0,
      },
      examples: scan.reports.slice(0, exampleLimit).map((report) => ({
        pair: report.pair,
        score: report.score,
        anomalyType: report.anomalyType,
        lastPrice: report.lastPrice,
        priceChange24hPercent: report.priceChange24hPercent,
        range24hPercent: report.range24hPercent,
        fundingPercent: report.fundingPercent,
        turnover24h: report.turnover24h,
        openInterestUsd: report.openInterestUsd,
        spreadPercent: report.spreadPercent,
        reasons: report.reasons,
        riskFlags: report.riskFlags,
      })),
    };
  }

  static _priceChangePercent(ticker) {
    const explicit = this._number(ticker.priceChange24hPercent);
    if (Number.isFinite(explicit)) return explicit;

    const decimal = this._number(ticker.price24hPcnt);
    return Number.isFinite(decimal) ? decimal * 100 : 0;
  }

  static _rangePercent(ticker) {
    const high = this._number(ticker.high24h);
    const low = this._number(ticker.low24h);
    return Number.isFinite(high) && Number.isFinite(low) && low > 0
      ? ((high - low) / low) * 100
      : 0;
  }

  static _spreadPercent(ticker) {
    const bid = this._number(ticker.bidPrice);
    const ask = this._number(ticker.askPrice);
    const mid = (bid + ask) / 2;
    return Number.isFinite(bid) && Number.isFinite(ask) && mid > 0
      ? ((ask - bid) / mid) * 100
      : null;
  }

  static _scorePriceChange(value) {
    const absolute = Math.abs(value);
    if (absolute >= 30) return 20;
    if (absolute >= 15) return 15;
    if (absolute >= 8) return 10;
    if (absolute >= 4) return 5;
    return 0;
  }

  static _scoreRange(value) {
    if (value >= 40) return 20;
    if (value >= 20) return 15;
    if (value >= 10) return 10;
    if (value >= 5) return 5;
    return 0;
  }

  static _scoreFunding(value) {
    if (!Number.isFinite(value)) return 0;
    const absolute = Math.abs(value);
    if (absolute >= 0.3) return 25;
    if (absolute >= 0.1) return 18;
    if (absolute >= 0.05) return 12;
    if (absolute >= 0.02) return 6;
    return 0;
  }

  static _scoreTurnover(value) {
    if (value >= 100000000) return 15;
    if (value >= 25000000) return 10;
    if (value >= 5000000) return 5;
    return 0;
  }

  static _scoreOpenInterest(value) {
    if (!Number.isFinite(value)) return 0;
    if (value >= 10000000) return 10;
    if (value >= 1000000) return 5;
    return 0;
  }

  static _classify({ priceChange24hPercent, range24hPercent, fundingPercent }) {
    if (priceChange24hPercent >= 5 && fundingPercent <= -0.05) {
      return 'SHORT_SQUEEZE_PRESSURE';
    }
    if (priceChange24hPercent <= -5 && fundingPercent >= 0.05) {
      return 'LONG_LIQUIDATION_RISK';
    }
    if (Math.abs(fundingPercent || 0) >= 0.1) {
      return 'FUNDING_DISLOCATION';
    }
    if (range24hPercent >= 15) {
      return 'VOLATILITY_EXPANSION';
    }
    return 'MARKET_ANOMALY';
  }

  static _buildReasons({
    priceChange24hPercent,
    range24hPercent,
    fundingPercent,
    turnover24h,
    openInterestUsd,
  }) {
    const reasons = [];
    if (Math.abs(priceChange24hPercent) >= 8) {
      reasons.push(`24H_MOVE_${priceChange24hPercent >= 0 ? 'UP' : 'DOWN'}`);
    }
    if (range24hPercent >= 15) reasons.push('WIDE_24H_RANGE');
    if (Math.abs(fundingPercent || 0) >= 0.05) reasons.push('EXTREME_FUNDING');
    if (turnover24h >= 25000000) reasons.push('HIGH_TURNOVER');
    if ((openInterestUsd || 0) >= 10000000) reasons.push('HIGH_OPEN_INTEREST');
    return reasons;
  }

  static _buildRiskFlags({
    priceChange24hPercent,
    range24hPercent,
    fundingPercent,
    spreadPercent,
  }) {
    const flags = [];
    if (Math.abs(priceChange24hPercent) >= 30) flags.push('ALREADY_EXTENDED');
    if (range24hPercent >= 40) flags.push('EXTREME_INTRADAY_RANGE');
    if (Math.abs(fundingPercent || 0) >= 0.3) flags.push('FUNDING_STRESS');
    if ((spreadPercent || 0) >= 0.5) flags.push('WIDE_SPREAD');
    return flags;
  }

  static _number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  static _nullableNumber(value) {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  static _round(value, decimals) {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  static _roundNullable(value, decimals) {
    return Number.isFinite(value) ? this._round(value, decimals) : null;
  }
}

module.exports = ExtremeWideRadar;
