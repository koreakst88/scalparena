const SignalDetector = require('./signalDetector');

const CANDIDATE_MIN_SCORE = 70;
const CANDIDATE_MIN_RR = 1;

const STRATEGIES = {
  TREND_PULLBACK: {
    tpPercent: 0.01,
    slPercent: 0.007,
  },
  BREAKOUT: {
    tpPercent: 0.012,
    slPercent: 0.008,
  },
  MEAN_REVERSION: {
    tpPercent: 0.008,
    slPercent: 0.008,
  },
};

class CandidateEngine {
  static scanAll(provider) {
    const reports = [];
    const pairs = provider.getPairs();

    for (const pair of pairs) {
      const candles = provider.getCandles(pair, 50);
      reports.push(this.analyzePair(pair, candles));
    }

    return this.sortReports(reports);
  }

  static sortReports(reports) {
    return reports.sort((a, b) => {
      const rankDiff = this._getReportRank(b) - this._getReportRank(a);
      if (rankDiff !== 0) return rankDiff;
      if (b.best.score !== a.best.score) return b.best.score - a.best.score;
      if (b.best.riskReward !== a.best.riskReward) return b.best.riskReward - a.best.riskReward;
      return String(a.pair).localeCompare(String(b.pair));
    });
  }

  static analyzePair(pair, candles) {
    if (!candles || candles.length < 20) {
      return this._buildNoDataReport(pair, candles?.length || 0);
    }

    const context = SignalDetector._buildContext(candles);
    if (!context) {
      return this._buildNoDataReport(pair, candles.length, 'context unavailable');
    }

    const candidates = [
      this._buildTrendPullbackCandidate(pair, context),
      this._buildBreakoutCandidate(pair, context),
      this._buildMeanReversionCandidate(pair, context),
    ];

    const bestTradingCandidate = candidates
      .filter((candidate) => candidate.action !== 'NO_TRADE')
      .sort((a, b) => b.score - a.score)[0];

    const noTrade = this._buildNoTradeCandidate(pair, context, bestTradingCandidate);
    const allCandidates = [...candidates, noTrade].sort((a, b) => b.score - a.score);
    const best = allCandidates[0];

    return {
      pair,
      context: this._summarizeContext(context),
      best,
      candidates: allCandidates,
    };
  }

  static getActionableCandidates(reports, limit = 3) {
    return reports
      .map((report) => report.best)
      .filter((candidate) => candidate.action !== 'NO_TRADE')
      .filter((candidate) => candidate.score >= CANDIDATE_MIN_SCORE)
      .filter((candidate) => candidate.riskReward >= CANDIDATE_MIN_RR)
      .slice(0, limit);
  }

  static toPaperSignal(candidate) {
    if (!candidate || candidate.action === 'NO_TRADE') return null;

    return {
      pair: candidate.pair,
      type: candidate.direction,
      entryPrice: candidate.entryPrice,
      stopLoss: candidate.stopLoss,
      takeProfit: candidate.takeProfit,
      tpPercent: candidate.tpPercent,
      slPercent: candidate.slPercent,
      riskReward: candidate.riskReward,
      rsi: candidate.context.rsi,
      volume: candidate.context.volume,
      atr: candidate.context.atr,
      atrPercent: candidate.context.atrPercent,
      bbPosition: candidate.context.bbPosition,
      bbWidth: candidate.context.bbWidth,
      macd: candidate.context.macd,
      macdSignal: candidate.context.macdSignal,
      macdHistogram: candidate.context.macdHistogram,
      macdBias: candidate.context.macdBias,
      impulse: candidate.context.impulse,
      roc12: candidate.context.roc12,
      emaSpread: candidate.context.emaSpread,
      confidence: candidate.score,
      strategy: candidate.strategy,
      entryMode: candidate.entryMode,
      marketRegime: candidate.context.marketRegime,
      marketRegimeReason: candidate.context.marketRegimeReason,
      setupReason: candidate.summary,
      invalidationRule: candidate.invalidationRule,
    };
  }

  static _buildTrendPullbackCandidate(pair, context) {
    const direction = context.market.regime === 'TREND_DOWN' ? 'SHORT' : 'LONG';
    const score = this._scoreTrendPullback(direction, context);
    const config = STRATEGIES.TREND_PULLBACK;
    const candidate = this._buildTradeCandidate(pair, context, {
      direction,
      strategy: 'TREND_PULLBACK',
      entryMode: 'EMA20_PULLBACK',
      score,
      config,
    });

    candidate.reasons = this._getTrendPullbackReasons(direction, context);
    candidate.risks = this._getTrendPullbackRisks(direction, context);
    candidate.summary = this._buildSummary(candidate);
    return candidate;
  }

  static _buildBreakoutCandidate(pair, context) {
    const direction = context.market.regime === 'TREND_DOWN' ? 'SHORT' : 'LONG';
    const score = this._scoreBreakout(direction, context);
    const config = STRATEGIES.BREAKOUT;
    const candidate = this._buildTradeCandidate(pair, context, {
      direction,
      strategy: 'BREAKOUT',
      entryMode: 'VOLUME_BREAKOUT',
      score,
      config,
    });

    candidate.reasons = this._getBreakoutReasons(direction, context);
    candidate.risks = this._getBreakoutRisks(direction, context);
    candidate.summary = this._buildSummary(candidate);
    return candidate;
  }

  static _buildMeanReversionCandidate(pair, context) {
    const direction = 'SHORT';
    const score = this._scoreMeanReversion(direction, context);
    const config = STRATEGIES.MEAN_REVERSION;
    const candidate = this._buildTradeCandidate(pair, context, {
      direction,
      strategy: 'MEAN_REVERSION',
      entryMode: 'LOW_VOL_SHORT',
      score,
      config,
    });

    candidate.reasons = this._getMeanReversionReasons(direction, context);
    candidate.risks = this._getMeanReversionRisks(direction, context);
    candidate.summary = this._buildSummary(candidate);
    return candidate;
  }

  static _buildNoTradeCandidate(pair, context, bestTradingCandidate) {
    const bestScore = bestTradingCandidate?.score || 0;
    const score = bestScore >= CANDIDATE_MIN_SCORE
      ? Math.max(0, 100 - bestScore)
      : Math.min(85, 70 + Math.round((CANDIDATE_MIN_SCORE - bestScore) / 2));
    const risks = bestTradingCandidate?.risks?.length
      ? bestTradingCandidate.risks
      : ['нет сценария с достаточным преимуществом'];

    return {
      pair,
      action: 'NO_TRADE',
      strategy: 'NO_TRADE',
      entryMode: 'WAIT',
      direction: null,
      score,
      riskReward: 0,
      entryPrice: context.currentPrice,
      stopLoss: null,
      takeProfit: null,
      tpPercent: 0,
      slPercent: 0,
      context: this._summarizeContext(context),
      reasons: [`лучший торговый сценарий набрал ${bestScore}/100`],
      risks,
      summary: `NO_TRADE: лучший сценарий ${bestTradingCandidate?.strategy || 'UNKNOWN'} score ${bestScore}/100`,
      invalidationRule: 'Ждём более чистый сетап',
    };
  }

  static _buildTradeCandidate(pair, context, { direction, strategy, entryMode, score, config }) {
    const entryPrice = context.currentPrice;
    const stopLoss = direction === 'LONG'
      ? entryPrice * (1 - config.slPercent)
      : entryPrice * (1 + config.slPercent);
    const takeProfit = direction === 'LONG'
      ? entryPrice * (1 + config.tpPercent)
      : entryPrice * (1 - config.tpPercent);
    const riskReward = Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss);

    return {
      pair,
      action: 'TRADE',
      strategy,
      entryMode,
      direction,
      score: this._clampScore(this._capScoreForStrategy(strategy, direction, score, context)),
      riskReward: this._round(riskReward, 2),
      entryPrice: this._round(entryPrice, 8),
      stopLoss: this._round(stopLoss, 8),
      takeProfit: this._round(takeProfit, 8),
      tpPercent: this._round(config.tpPercent * 100, 2),
      slPercent: this._round(config.slPercent * 100, 2),
      context: this._summarizeContext(context),
      invalidationRule: direction === 'LONG'
        ? `Сценарий отменяется ниже $${this._round(stopLoss, 8)}`
        : `Сценарий отменяется выше $${this._round(stopLoss, 8)}`,
    };
  }

  static _scoreTrendPullback(direction, context) {
    let score = 35;
    const expectedRegime = direction === 'LONG' ? 'TREND_UP' : 'TREND_DOWN';

    if (context.market.regime === expectedRegime) score += 22;
    else score -= 20;

    if (this._isMacdAligned(direction, context.macdBias)) score += 15;
    else if (this._isMacdAgainst(direction, context.macdBias)) score -= 18;

    score += this._scoreRange(context.rsi, 40, 60, 16);
    score += this._scoreMin(context.volume, 120, 180, 12);
    score += this._scoreMax(this._getEmaDistancePercent(context), 0.8, 2.5, 15);

    if (direction === 'LONG' && context.currentPrice >= context.market.ema20) score += 6;
    if (direction === 'SHORT' && context.currentPrice <= context.market.ema20) score += 6;
    if (Math.abs(context.market.roc12) >= 1.2) score += 5;

    return score;
  }

  static _capScoreForStrategy(strategy, direction, score, context) {
    if (strategy !== 'TREND_PULLBACK') return score;

    let capped = score;
    const expectedRegime = direction === 'LONG' ? 'TREND_UP' : 'TREND_DOWN';
    const emaDistance = this._getEmaDistancePercent(context);

    if (context.market.regime !== expectedRegime) capped = Math.min(capped, 55);
    if (!this._isMacdAligned(direction, context.macdBias)) capped = Math.min(capped, 65);
    if (emaDistance > 1.2) capped = Math.min(capped, 62);
    else if (emaDistance > 0.8) capped = Math.min(capped, 78);

    if (context.rsi < 35 || context.rsi > 65) capped = Math.min(capped, 62);
    else if (context.rsi < 40 || context.rsi > 60) capped = Math.min(capped, 72);

    if (direction === 'LONG' && context.currentPrice < context.market.ema20) capped = Math.min(capped, 60);
    if (direction === 'SHORT' && context.currentPrice > context.market.ema20) capped = Math.min(capped, 60);

    return capped;
  }

  static _scoreBreakout(direction, context) {
    let score = 30;
    const trendAligned = direction === 'LONG'
      ? context.market.regime === 'TREND_UP'
      : context.market.regime === 'TREND_DOWN';

    if (trendAligned) score += 16;
    if (this._isMacdAligned(direction, context.macdBias)) score += 14;
    else if (this._isMacdAgainst(direction, context.macdBias)) score -= 18;

    score += this._scoreMin(context.volume, 140, 220, 18);
    score += this._scoreMin(Math.abs(context.market.roc12), 1.5, 3.5, 14);

    if (direction === 'LONG') {
      score += this._scoreMin(context.bbPosition, 70, 95, 10);
      if (context.rsi > 72) score -= 16;
    } else {
      score += this._scoreMax(context.bbPosition, 30, 5, 10);
      if (context.rsi < 28) score -= 16;
    }

    return score;
  }

  static _scoreMeanReversion(direction, context) {
    let score = 25;

    if (context.market.regime === 'LOW_VOL_RANGE') score += 22;
    else if (context.market.regime === 'ACTIVE_RANGE') score += 6;
    else score -= 22;

    if (direction === 'SHORT') {
      score += this._scoreMin(context.rsi, 72, 85, 18);
      score += this._scoreMin(context.bbPosition, 80, 95, 14);
    }

    score += this._scoreMin(context.volume, 150, 220, 10);

    if (this._isMacdAligned(direction, context.macdBias)) score += 12;
    else if (this._isMacdAgainst(direction, context.macdBias)) score -= 18;

    return score;
  }

  static _getTrendPullbackReasons(direction, context) {
    return [
      `${direction === 'LONG' ? 'восходящий' : 'нисходящий'} режим: ${context.market.regime}`,
      `RSI ${this._round(context.rsi, 1)} около рабочей зоны 40-60`,
      `цена от EMA20: ${this._round(this._getEmaDistancePercent(context), 2)}%`,
      `MACD ${context.macdBias}`,
    ];
  }

  static _getTrendPullbackRisks(direction, context) {
    const risks = [];
    if (context.volume < 120) risks.push(`volume ${this._round(context.volume, 0)}% ниже 120%`);
    if (context.rsi < 40 || context.rsi > 60) risks.push(`RSI ${this._round(context.rsi, 1)} вне 40-60`);
    if (!this._isMacdAligned(direction, context.macdBias)) risks.push(`MACD не подтверждает ${direction}`);
    if (this._getEmaDistancePercent(context) > 0.8) risks.push('цена далековато от EMA20');
    return risks.length ? risks : ['ключевые фильтры подтверждены'];
  }

  static _getBreakoutReasons(direction, context) {
    return [
      `ROC12 ${context.market.roc12}%`,
      `volume ${this._round(context.volume, 0)}%`,
      `BB position ${this._round(context.bbPosition, 1)}%`,
      `MACD ${context.macdBias}`,
    ];
  }

  static _getBreakoutRisks(direction, context) {
    const risks = [];
    if (context.volume < 140) risks.push(`volume ${this._round(context.volume, 0)}% слабоват для breakout`);
    if (Math.abs(context.market.roc12) < 1.5) risks.push(`ROC12 ${context.market.roc12}% недостаточно сильный`);
    if (direction === 'LONG' && context.rsi > 72) risks.push(`RSI ${this._round(context.rsi, 1)} близко к перегреву`);
    if (direction === 'SHORT' && context.rsi < 28) risks.push(`RSI ${this._round(context.rsi, 1)} близко к перепроданности`);
    return risks.length ? risks : ['breakout подтверждён объёмом и импульсом'];
  }

  static _getMeanReversionReasons(direction, context) {
    return [
      `режим ${context.market.regime}`,
      `RSI ${this._round(context.rsi, 1)}`,
      `BB position ${this._round(context.bbPosition, 1)}%`,
      `MACD ${context.macdBias}`,
    ];
  }

  static _getMeanReversionRisks(direction, context) {
    const risks = [];
    if (context.market.regime !== 'LOW_VOL_RANGE') risks.push(`режим ${context.market.regime}, не LOW_VOL_RANGE`);
    if (context.rsi <= 72) risks.push(`RSI ${this._round(context.rsi, 1)} ниже зоны MR SHORT`);
    if (context.bbPosition < 80) risks.push(`BB position ${this._round(context.bbPosition, 1)}% ниже верхней зоны`);
    if (context.volume < 150) risks.push(`volume ${this._round(context.volume, 0)}% ниже 150%`);
    if (context.macdBias !== 'BEARISH') risks.push(`MACD ${context.macdBias}, нужен BEARISH`);
    return risks.length ? risks : ['строгий MR SHORT подтверждён'];
  }

  static _buildSummary(candidate) {
    return `${candidate.strategy} ${candidate.direction}: score ${candidate.score}/100, RR ${candidate.riskReward}`;
  }

  static _summarizeContext(context) {
    return {
      price: this._round(context.currentPrice, 8),
      rsi: this._round(context.rsi, 2),
      volume: this._round(context.volume, 2),
      atr: this._round(context.atr, 8),
      atrPercent: this._round(context.atrPercent, 2),
      bbPosition: this._round(context.bbPosition, 1),
      bbWidth: this._round(context.bbWidth, 2),
      macd: this._round(context.macd.macd, 4),
      macdSignal: this._round(context.macd.signal, 4),
      macdHistogram: this._round(context.macd.histogram, 4),
      macdBias: context.macdBias,
      impulse: this._round(context.candleImpulse, 2),
      roc12: context.market.roc12,
      emaSpread: context.market.emaSpread,
      marketRegime: context.market.regime,
      marketRegimeReason: context.market.reason,
    };
  }

  static _buildNoDataReport(pair, candleCount, reason = 'not enough candles') {
    const best = {
      pair,
      action: 'NO_TRADE',
      strategy: 'NO_DATA',
      entryMode: 'WAIT',
      direction: null,
      score: 0,
      riskReward: 0,
      reasons: [`${reason}: ${candleCount} candles`],
      risks: ['нужно больше рыночных данных'],
      summary: `NO_TRADE: ${reason}`,
    };

    return {
      pair,
      context: null,
      best,
      candidates: [best],
    };
  }

  static _getReportRank(report) {
    if (report.best.action === 'TRADE' && report.best.score >= CANDIDATE_MIN_SCORE) return 3;
    if (report.best.action === 'TRADE') return 2;
    if (report.best.strategy === 'NO_DATA') return 0;
    return 1;
  }

  static _scoreRange(value, min, max, points) {
    if (value >= min && value <= max) return points;
    const distance = value < min ? min - value : value - max;
    const penaltyWindow = 20;
    return Math.max(points * (1 - distance / penaltyWindow), -points);
  }

  static _scoreMin(value, min, strong, points) {
    if (value >= strong) return points;
    if (value >= min) return points * ((value - min) / (strong - min || 1));
    return -points * Math.min((min - value) / (min || 1), 1);
  }

  static _scoreMax(value, max, excellent, points) {
    if (value <= excellent) return points;
    if (value <= max) return points * ((max - value) / (max - excellent || 1));
    return -points * Math.min((value - max) / (max || 1), 1);
  }

  static _getEmaDistancePercent(context) {
    if (!context.currentPrice || !context.market?.ema20) return Infinity;
    return Math.abs((context.currentPrice - context.market.ema20) / context.currentPrice) * 100;
  }

  static _isMacdAligned(direction, macdBias) {
    return (
      direction === 'LONG' && macdBias === 'BULLISH' ||
      direction === 'SHORT' && macdBias === 'BEARISH'
    );
  }

  static _isMacdAgainst(direction, macdBias) {
    return (
      direction === 'LONG' && macdBias === 'BEARISH' ||
      direction === 'SHORT' && macdBias === 'BULLISH'
    );
  }

  static _clampScore(score) {
    return Math.round(Math.min(Math.max(score, 0), 100));
  }

  static _round(value, digits) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    const multiplier = 10 ** digits;
    return Math.round(numeric * multiplier) / multiplier;
  }
}

module.exports = CandidateEngine;
