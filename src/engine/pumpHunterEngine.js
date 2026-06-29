const DEFAULT_SCAN_LIMIT = 60;
const DEFAULT_KLINE_INTERVAL = '15';
const DEFAULT_KLINE_LIMIT = 96;
const MIN_SCORE = 70;
const MIN_FRESH_FROM_LOW = 20;
const MAX_FRESH_FROM_LOW = 60;
const MIN_VOLUME_BOOST = 1.5;
const MIN_TURNOVER_24H = 300000;

class PumpHunterEngine {
  static async scan(provider, options = {}) {
    const tickers = await provider.getLinearTickers();
    const symbols = this._selectTickerUniverse(tickers, options.scanLimit || DEFAULT_SCAN_LIMIT);
    const reports = [];

    for (const ticker of symbols) {
      const candles = await provider.getRestKlines(
        ticker.symbol,
        options.interval || DEFAULT_KLINE_INTERVAL,
        options.klineLimit || DEFAULT_KLINE_LIMIT
      );
      reports.push(this.analyzeSymbol(ticker.symbol, ticker, candles));
    }

    return this.sortReports(reports);
  }

  static sortReports(reports) {
    return reports.sort((a, b) => b.score - a.score);
  }

  static getActionable(reports, limit = 3) {
    return reports
      .filter((report) => report.action === 'TRADE')
      .filter((report) => report.score >= MIN_SCORE)
      .slice(0, limit);
  }

  static analyzeSymbol(pair, ticker, candles) {
    if (!candles || candles.length < 30) {
      return this._buildNoTrade(pair, 0, 'недостаточно свечей');
    }

    const current = candles[candles.length - 1].close;
    const localLow = Math.min(...candles.map((candle) => candle.low));
    const localHigh = Math.max(...candles.map((candle) => candle.high));
    const previousHigh = Math.max(...candles.slice(0, -1).map((candle) => candle.high));
    const freshFromLow = this._pct(current, localLow);
    const distanceFromHigh = localHigh > 0 ? ((localHigh - current) / localHigh) * 100 : 0;
    const priceChange24h = Number.parseFloat(ticker.price24hPcnt || 0) * 100;
    const turnover24h = Number.parseFloat(ticker.turnover24h || 0);
    const volumeBoost = this._calculateVolumeBoost(candles);
    const breakout = current >= previousHigh * 0.995;
    const tooExtended = freshFromLow > MAX_FRESH_FROM_LOW;

    let score = 20;
    score += this._scoreFreshMove(freshFromLow);
    score += this._scoreVolumeBoost(volumeBoost);
    score += this._scoreTurnover(turnover24h);
    score += this._score24hChange(priceChange24h);
    if (breakout) score += 12;
    if (distanceFromHigh <= 12) score += 8;
    if (tooExtended) score -= Math.min(30, (freshFromLow - MAX_FRESH_FROM_LOW) * 0.7);

    score = this._round(Math.max(0, Math.min(100, score)), 0);
    const action = (
      score >= MIN_SCORE &&
      freshFromLow >= MIN_FRESH_FROM_LOW &&
      freshFromLow <= MAX_FRESH_FROM_LOW &&
      volumeBoost >= MIN_VOLUME_BOOST &&
      turnover24h >= MIN_TURNOVER_24H
    ) ? 'TRADE' : 'WATCH';

    const entryPrice = this._round(current, 8);
    const stopLoss = this._round(current * 0.85, 8);
    const takeProfit = this._round(current * 1.2, 8);

    return {
      pair,
      action,
      direction: 'LONG',
      strategy: 'PUMP_HUNTER',
      entryMode: 'FRESH_PUMP_CONTINUATION',
      score,
      riskReward: 1.33,
      entryPrice,
      stopLoss,
      takeProfit,
      tpPercent: 20,
      slPercent: 15,
      freshFromLow: this._round(freshFromLow, 2),
      distanceFromHigh: this._round(distanceFromHigh, 2),
      priceChange24h: this._round(priceChange24h, 2),
      turnover24h: this._round(turnover24h, 2),
      volumeBoost: this._round(volumeBoost, 2),
      breakout,
      summary: `fresh +${this._round(freshFromLow, 1)}% from low, volume x${this._round(volumeBoost, 1)}`,
      reasons: this._buildReasons({ freshFromLow, volumeBoost, turnover24h, priceChange24h, breakout }),
      risks: this._buildRisks({ freshFromLow, distanceFromHigh, volumeBoost, turnover24h }),
      invalidationRule: `Сценарий отменяется ниже $${stopLoss} (-15%)`,
    };
  }

  static toPaperSignal(candidate) {
    if (!candidate || candidate.action !== 'TRADE') return null;

    return {
      pair: candidate.pair,
      type: candidate.direction,
      entryPrice: candidate.entryPrice,
      stopLoss: candidate.stopLoss,
      takeProfit: candidate.takeProfit,
      tpPercent: candidate.tpPercent,
      slPercent: candidate.slPercent,
      riskReward: candidate.riskReward,
      rsi: null,
      volume: candidate.volumeBoost * 100,
      atrPercent: null,
      bbPosition: null,
      bbWidth: null,
      macdBias: 'PUMP',
      confidence: candidate.score,
      strategy: candidate.strategy,
      entryMode: candidate.entryMode,
      marketRegime: 'PUMP_MOMENTUM',
      setupReason: candidate.summary,
      invalidationRule: candidate.invalidationRule,
    };
  }

  static _selectTickerUniverse(tickers, limit) {
    return tickers
      .filter((ticker) => String(ticker.symbol || '').endsWith('USDT'))
      .filter((ticker) => !String(ticker.symbol || '').includes('-'))
      .filter((ticker) => Number.parseFloat(ticker.turnover24h || 0) >= MIN_TURNOVER_24H)
      .sort((a, b) => Number.parseFloat(b.price24hPcnt || 0) - Number.parseFloat(a.price24hPcnt || 0))
      .slice(0, limit);
  }

  static _calculateVolumeBoost(candles) {
    const recent = candles.slice(-4);
    const base = candles.slice(-28, -4);
    const recentAvg = this._avg(recent.map((candle) => candle.volume));
    const baseAvg = this._avg(base.map((candle) => candle.volume));
    if (!baseAvg) return 0;
    return recentAvg / baseAvg;
  }

  static _buildReasons(context) {
    const reasons = [];
    if (context.freshFromLow >= MIN_FRESH_FROM_LOW) reasons.push(`fresh +${this._round(context.freshFromLow, 1)}% от локального дна`);
    if (context.volumeBoost >= MIN_VOLUME_BOOST) reasons.push(`volume x${this._round(context.volumeBoost, 1)}`);
    if (context.turnover24h >= MIN_TURNOVER_24H) reasons.push(`turnover 24h $${this._formatMoney(context.turnover24h)}`);
    if (context.priceChange24h > 0) reasons.push(`24h change +${this._round(context.priceChange24h, 1)}%`);
    if (context.breakout) reasons.push('пробой локального high');
    return reasons.length ? reasons : ['pump-фильтры пока слабые'];
  }

  static _buildRisks(context) {
    const risks = [];
    if (context.freshFromLow > MAX_FRESH_FROM_LOW) risks.push(`уже далеко от дна: +${this._round(context.freshFromLow, 1)}%`);
    if (context.distanceFromHigh > 20) risks.push(`далеко от high: -${this._round(context.distanceFromHigh, 1)}%`);
    if (context.volumeBoost < MIN_VOLUME_BOOST) risks.push(`volume x${this._round(context.volumeBoost, 1)} слабее ${MIN_VOLUME_BOOST}`);
    if (context.turnover24h < MIN_TURNOVER_24H) risks.push('ликвидность ниже фильтра');
    return risks.length ? risks : ['главный риск: поздний вход после импульса'];
  }

  static _buildNoTrade(pair, score, reason) {
    return {
      pair,
      action: 'NO_TRADE',
      direction: null,
      strategy: 'PUMP_HUNTER',
      entryMode: 'WAIT',
      score,
      riskReward: 0,
      summary: reason,
      reasons: [reason],
      risks: ['нужно больше данных'],
    };
  }

  static _scoreFreshMove(value) {
    if (value < 10) return 0;
    if (value < MIN_FRESH_FROM_LOW) return 12;
    if (value <= 45) return 24;
    if (value <= MAX_FRESH_FROM_LOW) return 18;
    return 6;
  }

  static _scoreVolumeBoost(value) {
    if (value >= 5) return 22;
    if (value >= 3) return 18;
    if (value >= MIN_VOLUME_BOOST) return 12;
    return 0;
  }

  static _scoreTurnover(value) {
    if (value >= 10000000) return 14;
    if (value >= 3000000) return 10;
    if (value >= MIN_TURNOVER_24H) return 6;
    return 0;
  }

  static _score24hChange(value) {
    if (value >= 20 && value <= 80) return 12;
    if (value > 0 && value < 20) return 6;
    if (value > 80) return 4;
    return 0;
  }

  static _pct(current, base) {
    if (!base) return 0;
    return ((current - base) / base) * 100;
  }

  static _avg(values) {
    const valid = values.filter((value) => Number.isFinite(value));
    if (!valid.length) return 0;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  static _round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  static _formatMoney(value) {
    if (value >= 1000000) return `${this._round(value / 1000000, 1)}M`;
    if (value >= 1000) return `${this._round(value / 1000, 1)}K`;
    return String(this._round(value, 0));
  }
}

module.exports = PumpHunterEngine;
