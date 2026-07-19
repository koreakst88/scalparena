const PumpStateMachineV2 = require('./pumpStateMachineV2');

const DEFAULT_SCAN_LIMIT = 60;
const DEFAULT_KLINE_INTERVAL = '15';
const DEFAULT_KLINE_LIMIT = 96;
const MIN_SCORE = 80;
const MIN_FRESH_FROM_LOW = 20;
const MAX_FRESH_FROM_LOW = 40;
const MIN_VOLUME_BOOST = 2;
const MIN_TURNOVER_24H = 5000000;
const MAX_DISTANCE_FROM_HIGH = 5;
const TP1_PERCENT = 2;
const TP2_PERCENT = 3;
const BASE_TP_PERCENT = 5;
const STRETCH_TP_PERCENT = 8;
const BASE_SL_PERCENT = 5;
const MOON_TP_PERCENT = 20;

class PumpHunterEngine {
  static async scan(provider, options = {}) {
    let marketSource = 'BYBIT';
    let tickers = await provider.getLinearTickers();

    if (!tickers.length) {
      const fallback = await this._loadFallbackTickers(provider, options);
      tickers = fallback.tickers;
      marketSource = fallback.marketSource;
    }

    const symbols = this._selectTickerUniverse(tickers, options.scanLimit || DEFAULT_SCAN_LIMIT);
    const reports = [];

    for (const ticker of symbols) {
      const candles = await this._loadCandles(provider, marketSource, ticker.symbol, options);
      const shadowV2 = PumpStateMachineV2.analyzeSymbol(ticker.symbol, ticker, candles, {
        marketSource,
        timeframe: options.interval || DEFAULT_KLINE_INTERVAL,
      });
      reports.push({
        ...this.analyzeSymbol(ticker.symbol, ticker, candles),
        marketSource,
        shadowV2,
      });
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

  static selectTickerUniverse(tickers, limit = DEFAULT_SCAN_LIMIT) {
    return this._selectTickerUniverse(tickers, limit);
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
    if (distanceFromHigh <= MAX_DISTANCE_FROM_HIGH) score += 8;
    if (tooExtended) score -= Math.min(30, (freshFromLow - MAX_FRESH_FROM_LOW) * 0.7);

    score = this._round(Math.max(0, Math.min(100, score)), 0);
    const action = (
      score >= MIN_SCORE &&
      freshFromLow >= MIN_FRESH_FROM_LOW &&
      freshFromLow <= MAX_FRESH_FROM_LOW &&
      volumeBoost >= MIN_VOLUME_BOOST &&
      turnover24h >= MIN_TURNOVER_24H &&
      distanceFromHigh <= MAX_DISTANCE_FROM_HIGH &&
      breakout
    ) ? 'TRADE' : 'WATCH';

    const entryPrice = this._round(current, 8);
    const exitPlan = this._buildExitPlan({
      score,
      freshFromLow,
      volumeBoost,
      distanceFromHigh,
    });
    const stopLoss = this._round(current * (1 - exitPlan.slPercent / 100), 8);
    const takeProfit = this._round(current * (1 + exitPlan.mainTpPercent / 100), 8);
    const tp1 = this._round(current * (1 + exitPlan.tp1Percent / 100), 8);
    const tp2 = this._round(current * (1 + exitPlan.tp2Percent / 100), 8);
    const stretchTakeProfit = this._round(current * (1 + exitPlan.stretchTpPercent / 100), 8);
    const moonTakeProfit = this._round(current * (1 + MOON_TP_PERCENT / 100), 8);

    return {
      pair,
      action,
      direction: 'LONG',
      strategy: 'PUMP_HUNTER',
      entryMode: 'FRESH_PUMP_CONTINUATION',
      score,
      exitProfile: exitPlan.profile,
      riskReward: this._round(exitPlan.mainTpPercent / exitPlan.slPercent, 2),
      entryPrice,
      stopLoss,
      takeProfit,
      tp1,
      tp2,
      stretchTakeProfit,
      moonTakeProfit,
      moonTpPercent: MOON_TP_PERCENT,
      tp1Percent: exitPlan.tp1Percent,
      tp2Percent: exitPlan.tp2Percent,
      stretchTpPercent: exitPlan.stretchTpPercent,
      tpPercent: exitPlan.mainTpPercent,
      slPercent: exitPlan.slPercent,
      freshFromLow: this._round(freshFromLow, 2),
      distanceFromHigh: this._round(distanceFromHigh, 2),
      priceChange24h: this._round(priceChange24h, 2),
      turnover24h: this._round(turnover24h, 2),
      volumeBoost: this._round(volumeBoost, 2),
      breakout,
      summary: `fresh +${this._round(freshFromLow, 1)}% from low, volume x${this._round(volumeBoost, 1)}`,
      reasons: this._buildReasons({ freshFromLow, volumeBoost, turnover24h, priceChange24h, breakout }),
      risks: this._buildRisks({ freshFromLow, distanceFromHigh, volumeBoost, turnover24h, breakout }),
      invalidationRule: `Сценарий отменяется ниже $${stopLoss} (-${exitPlan.slPercent}%)`,
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
      tp1: candidate.tp1,
      tp2: candidate.tp2,
      stretchTakeProfit: candidate.stretchTakeProfit,
      moonTakeProfit: candidate.moonTakeProfit,
      moonTpPercent: candidate.moonTpPercent,
      tp1Percent: candidate.tp1Percent,
      tp2Percent: candidate.tp2Percent,
      stretchTpPercent: candidate.stretchTpPercent,
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
      exitProfile: candidate.exitProfile,
      marketSource: candidate.marketSource,
      timeframe: candidate.timeframe || DEFAULT_KLINE_INTERVAL,
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

  static _shouldUseBinanceFallback(options) {
    return this._getFallbackMarkets(options).includes('binance');
  }

  static _shouldUseOkxFallback(options) {
    return this._getFallbackMarkets(options).includes('okx');
  }

  static _getFallbackMarkets(options) {
    return String(options.fallbackMarket || 'binance,okx')
      .split(',')
      .map((market) => market.trim().toLowerCase())
      .filter((market) => market && market !== 'none' && market !== 'off');
  }

  static async _loadFallbackTickers(provider, options) {
    if (this._shouldUseBinanceFallback(options) && provider.getBinanceFuturesTickers) {
      const tickers = await provider.getBinanceFuturesTickers();
      if (tickers.length) {
        return { marketSource: 'BINANCE_FUTURES_FALLBACK', tickers };
      }
    }

    if (this._shouldUseOkxFallback(options) && provider.getOkxSwapTickers) {
      const tickers = await provider.getOkxSwapTickers();
      if (tickers.length) {
        return { marketSource: 'OKX_SWAP_FALLBACK', tickers };
      }
    }

    return { marketSource: 'BYBIT', tickers: [] };
  }

  static async _loadCandles(provider, marketSource, symbol, options) {
    const interval = options.interval || DEFAULT_KLINE_INTERVAL;
    const limit = options.klineLimit || DEFAULT_KLINE_LIMIT;

    if (marketSource === 'BINANCE_FUTURES_FALLBACK' && provider.getBinanceFuturesKlines) {
      return provider.getBinanceFuturesKlines(symbol, interval, limit);
    }

    if (marketSource === 'OKX_SWAP_FALLBACK' && provider.getOkxSwapKlines) {
      return provider.getOkxSwapKlines(symbol, interval, limit);
    }

    return provider.getRestKlines(symbol, interval, limit);
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
    if (context.distanceFromHigh > MAX_DISTANCE_FROM_HIGH) risks.push(`далеко от high: -${this._round(context.distanceFromHigh, 1)}%`);
    if (context.volumeBoost < MIN_VOLUME_BOOST) risks.push(`volume x${this._round(context.volumeBoost, 1)} слабее ${MIN_VOLUME_BOOST}`);
    if (context.turnover24h < MIN_TURNOVER_24H) risks.push('ликвидность ниже фильтра');
    if (!context.breakout) risks.push('нет подтверждённого пробоя previous high');
    return risks.length ? risks : ['главный риск: поздний вход после импульса'];
  }

  static _buildExitPlan(context) {
    let mainTpPercent = BASE_TP_PERCENT;
    let slPercent = BASE_SL_PERCENT;
    let profile = 'balanced';

    if (context.score >= 92 && context.volumeBoost >= 4 && context.distanceFromHigh <= 2 && context.freshFromLow <= 35) {
      mainTpPercent = STRETCH_TP_PERCENT;
      slPercent = 6;
      profile = 'stretch';
    } else if (context.score < 86 || context.distanceFromHigh > 3.5 || context.volumeBoost < 2.5) {
      mainTpPercent = TP2_PERCENT;
      slPercent = 4;
      profile = 'quick';
    }

    return {
      profile,
      tp1Percent: TP1_PERCENT,
      tp2Percent: TP2_PERCENT,
      mainTpPercent,
      stretchTpPercent: STRETCH_TP_PERCENT,
      slPercent,
    };
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
    if (value <= 35) return 24;
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
    if (value >= 20000000) return 14;
    if (value >= 10000000) return 10;
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
