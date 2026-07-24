// src/engine/scheduler.js

const SignalDetector = require('./signalDetector');
const CandidateEngine = require('./candidateEngine');
const CandidateBreakoutV3 = require('./candidateBreakoutV3');
const PumpHunterEngine = require('./pumpHunterEngine');
const PumpStateMachineV2 = require('./pumpStateMachineV2');
const MarketContextV1 = require('./marketContextV1');
const RiskManager = require('./riskManager');
const {
  PAPER_SIGNAL_TRACKING_ENABLED,
  PAPER_SIGNAL_ALERTS_ENABLED,
  PAPER_SIGNAL_AUTO_LOG_ENABLED,
  CANDIDATE_AUTO_SCAN_INTERVAL_MS,
  CANDIDATE_AUTO_MIN_SCORE,
  CANDIDATE_AUTO_MIN_RR,
  CANDIDATE_AUTO_COOLDOWN_MINUTES,
  CANDIDATE_AUTO_MAX_ALERTS,
  CANDIDATE_V3_ENABLED,
  CANDIDATE_V3_MAX_PER_CYCLE,
} = require('../config/paperSignals');
const {
  PUMP_HUNTER_SCAN_LIMIT,
  PUMP_HUNTER_KLINE_INTERVAL,
  PUMP_HUNTER_KLINE_LIMIT,
  PUMP_HUNTER_ACTIONABLE_LIMIT,
  PUMP_HUNTER_FALLBACK_MARKET,
  PUMP_AUTO_SCAN_INTERVAL_MS,
  PUMP_AUTO_MIN_SCORE,
  PUMP_AUTO_COOLDOWN_MINUTES,
  PUMP_AUTO_MAX_ALERTS,
  PUMP_V2_SHADOW_ENABLED,
  PUMP_V2_SHADOW_MAX_PER_CYCLE,
} = require('../config/pumpHunter');
const {
  CURRENT_PAPER_EXPERIMENT_ID,
  CANDIDATE_V3_EXPERIMENT_ID,
  PAPER_PROJECTS,
} = require('../config/paperExperiment');
const { MARKET_CONTEXT_V1_ENABLED } = require('../config/marketContext');

const SCAN_INTERVAL_MS = 15 * 60 * 1000;
const SEOUL_TIMEZONE = process.env.TIMEZONE || 'Asia/Seoul';

class Scheduler {
  constructor(bot, db, provider) {
    this.bot = bot;
    this.db = db;
    this.provider = provider;
    this.scanTimer = null;
    this.candidateScanTimer = null;
    this.pumpScanTimer = null;
    this.resetTimer = null;
    this.lastScanTime = null;
    this.lastCandidateScanTime = null;
    this.lastPumpScanTime = null;
    this.candidateAlertCooldowns = new Map();
    this.pumpAlertCooldowns = new Map();
    this.candidateDiagnosticsUnavailable = false;
  }

  start() {
    if (this.scanTimer || this.candidateScanTimer || this.resetTimer) return;

    console.log('⏰ Scheduler started');

    this.scanTimer = setInterval(() => this._autoScan(), SCAN_INTERVAL_MS);
    this.candidateScanTimer = setInterval(
      () => this._candidateAutoScan(),
      CANDIDATE_AUTO_SCAN_INTERVAL_MS
    );
    this.pumpScanTimer = setInterval(
      () => this._pumpAutoScan(),
      PUMP_AUTO_SCAN_INTERVAL_MS
    );
    this._scheduleDailyReset();

    setTimeout(() => this._autoScan(), 5 * 60 * 1000);
    setTimeout(() => this._candidateAutoScan(), 6 * 60 * 1000);
    setTimeout(() => this._pumpAutoScan(), 7 * 60 * 1000);

    console.log('✅ Auto-scan every 15 min | Daily reset at 08:00 Seoul');
    console.log(
      `🧠 Candidate auto-scan every ${Math.round(CANDIDATE_AUTO_SCAN_INTERVAL_MS / 60000)} min ` +
      `| score>=${CANDIDATE_AUTO_MIN_SCORE} RR>=${CANDIDATE_AUTO_MIN_RR}`
    );
    console.log(
      `🚀 Pump auto-scan every ${Math.round(PUMP_AUTO_SCAN_INTERVAL_MS / 60000)} min ` +
      `| score>=${PUMP_AUTO_MIN_SCORE} max=${PUMP_AUTO_MAX_ALERTS}`
    );
    console.log('⏳ First auto-scan in 5 minutes (WS data accumulation)');
  }

  stop() {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.candidateScanTimer) {
      clearInterval(this.candidateScanTimer);
      this.candidateScanTimer = null;
    }
    if (this.pumpScanTimer) {
      clearInterval(this.pumpScanTimer);
      this.pumpScanTimer = null;
    }
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    console.log('⏰ Scheduler stopped');
  }

  async _autoScan() {
    // Crypto trades 24/7, so auto-scan should never be blocked by session hours.
    console.log('🔍 Auto-scan triggered...');
    this.lastScanTime = new Date();

    try {
      const signals = SignalDetector.scanAll(this.provider);

      if (signals.length === 0) {
        console.log('📭 Auto-scan: no signals found');
        return;
      }

      console.log(`🎯 Auto-scan: ${signals.length} signal(s) found`);

      const { data: users, error } = await this.db.client
        .from('users')
        .select('*')
        .eq('auto_scan_enabled', true);

      if (error || !users?.length) return;

      for (const user of users) {
        await this._sendSignalsToUser(user, signals);
      }
    } catch (error) {
      console.error('❌ Auto-scan error:', error.message);
    }
  }

  async _candidateAutoScan() {
    console.log('🧠 Candidate auto-scan triggered...');
    this.lastCandidateScanTime = new Date();

    try {
      const { data: users, error } = await this.db.client
        .from('users')
        .select('*')
        .eq('auto_scan_enabled', true);

      if (error || !users?.length) return;

      const enabledUsers = users.filter((user) => (
        typeof this.bot._isCandidateAutoEnabled === 'function' &&
        this.bot._isCandidateAutoEnabled(user.telegram_id)
      ));

      if (!enabledUsers.length) {
        console.log('🧠 Candidate auto-scan: disabled for all users');
        return;
      }

      const reports = CandidateEngine.scanAll(this.provider);
      await this._recordCandidateV3(enabledUsers);
      const candidates = this._getStrictCandidateAlerts(reports);

      if (!candidates.length) {
        console.log('🧠 Candidate auto-scan: no strict candidates');
        return;
      }

      console.log(`🧠 Candidate auto-scan: ${candidates.length} strict candidate(s) found`);

      for (const user of enabledUsers) {
        await this._sendCandidateAlertsToUser(user, candidates);
      }
    } catch (error) {
      console.error('❌ Candidate auto-scan error:', error.message);
    }
  }

  async _pumpAutoScan() {
    console.log('🚀 PumpHunter auto-scan triggered...');
    this.lastPumpScanTime = new Date();

    try {
      const { data: users, error } = await this.db.client
        .from('users')
        .select('*')
        .eq('auto_scan_enabled', true);

      if (error || !users?.length) return;

      const enabledUsers = users.filter((user) => (
        typeof this.bot._isPumpAutoEnabled === 'function' &&
        this.bot._isPumpAutoEnabled(user.telegram_id)
      ));

      if (!enabledUsers.length) {
        console.log('🚀 PumpHunter auto-scan: disabled for all users');
        return;
      }

      const reports = await PumpHunterEngine.scan(this.provider, {
        scanLimit: PUMP_HUNTER_SCAN_LIMIT,
        interval: PUMP_HUNTER_KLINE_INTERVAL,
        klineLimit: PUMP_HUNTER_KLINE_LIMIT,
        fallbackMarket: PUMP_HUNTER_FALLBACK_MARKET,
      });
      await this._recordPumpV2Shadow(enabledUsers, reports);
      const candidates = this._getStrictPumpAlerts(reports);

      if (!candidates.length) {
        console.log('🚀 PumpHunter auto-scan: no strict pump entries');
        return;
      }

      console.log(`🚀 PumpHunter auto-scan: ${candidates.length} strict pump entry candidate(s) found`);

      for (const user of enabledUsers) {
        await this._sendPumpAlertsToUser(user, candidates);
      }
    } catch (error) {
      console.error('❌ PumpHunter auto-scan error:', error.message);
    }
  }

  _getStrictCandidateAlerts(reports) {
    return CandidateEngine.getActionableCandidates(reports, 15)
      .filter((candidate) => candidate.score >= CANDIDATE_AUTO_MIN_SCORE)
      .filter((candidate) => candidate.riskReward >= CANDIDATE_AUTO_MIN_RR)
      .slice(0, CANDIDATE_AUTO_MAX_ALERTS);
  }

  async _recordCandidateV3(users = []) {
    if (!CANDIDATE_V3_ENABLED || !PAPER_SIGNAL_TRACKING_ENABLED) return;

    const reports = CandidateBreakoutV3.scanAll(this.provider);
    const marketContext = MARKET_CONTEXT_V1_ENABLED
      ? MarketContextV1.analyze(this.provider.getCandles('BTCUSDT', 100), {
        timeframe: String(process.env.BYBIT_WS_INTERVAL || '1'),
        source: 'BYBIT_WEBSOCKET',
      })
      : null;
    const rawCandidates = CandidateBreakoutV3.getActionableCandidates(
      reports,
      CANDIDATE_V3_MAX_PER_CYCLE
    );
    const contextualCandidates = marketContext
      ? rawCandidates.map((candidate) => MarketContextV1.attach(candidate, marketContext))
      : rawCandidates;
    const candidates = contextualCandidates.filter((candidate) => (
      CandidateBreakoutV3.isAllowedByMarketContext(candidate)
    ));
    await this._recordCandidateV3Diagnostics({
      reports,
      rawCandidates,
      contextualCandidates,
      candidates,
      marketContext,
    });

    if (!candidates.length) {
      console.log(
        `🔬 Candidate V3: no qualified retest entries | ${this._formatShadowDiagnostics(reports)} | ` +
        `market=${marketContext?.state || 'OFF'} | ` +
        `contextRejected=${contextualCandidates.length - candidates.length}`
      );
      return;
    }

    console.log(
      `🔬 Candidate V3: ${candidates.length} qualified setup(s) | ` +
      `market=${marketContext?.state || 'OFF'} | ${this._formatContextDecisions(candidates)}`
    );

    for (const user of users) {
      const userId = String(user.telegram_id);
      const activeSignals = await this.db.getActivePaperSignals(userId, {
        project: PAPER_PROJECTS.CANDIDATE_V3,
        experimentId: CANDIDATE_V3_EXPERIMENT_ID,
      });
      const activePairs = new Set(activeSignals.map((signal) => this._normalizePair(signal.pair)));
      const recentSignals = await this.db.getPaperSignalsSince(
        userId,
        new Date(Date.now() - 12 * 60 * 60 * 1000)
      );
      let savedCount = 0;

      for (const candidate of candidates) {
        const pair = this._normalizePair(candidate.pair);
        if (activePairs.has(pair)) continue;
        if (this._isCandidateV3PairCoolingDown(pair, recentSignals)) continue;

        const saved = await this.bot._trackPaperSignal(
          userId,
          {
            ...CandidateBreakoutV3.toPaperSignal(candidate),
            experimentId: CANDIDATE_V3_EXPERIMENT_ID,
          },
          'CANDIDATE_V3'
        );
        if (saved) {
          savedCount += 1;
          activePairs.add(pair);
        }
      }

      console.log(`🔬 Candidate V3: saved ${savedCount} signal(s) for ${userId}; alerts=OFF`);
    }
  }

  async _recordCandidateV3Diagnostics({
    reports = [],
    rawCandidates = [],
    contextualCandidates = [],
    candidates = [],
    marketContext = null,
  } = {}) {
    if (this.candidateDiagnosticsUnavailable) return;
    if (typeof this.db.createResearchScanDiagnostic !== 'function') return;

    const rejectionCounts = reports.reduce((result, report) => {
      const reasons = report.diagnostic?.rejectionReasons?.length
        ? report.diagnostic.rejectionReasons
        : [report.reason || 'UNKNOWN'];
      reasons.forEach((reason) => {
        result[reason] = (result[reason] || 0) + 1;
      });
      return result;
    }, {});
    const contextRejectionCounts = contextualCandidates.reduce((result, candidate) => {
      if (CandidateBreakoutV3.isAllowedByMarketContext(candidate)) return result;
      const decision = candidate.marketContext?.decision || 'UNMARKED';
      result[decision] = (result[decision] || 0) + 1;
      return result;
    }, {});
    const examples = reports
      .map((report) => ({
        pair: report.pair,
        action: report.action,
        reason: report.reason,
        direction: report.diagnostic?.direction || null,
        score: report.diagnostic?.score || null,
        volumeRatio: report.diagnostic?.volumeRatio ?? null,
        bodyRatio: report.diagnostic?.bodyRatio ?? null,
        retestVolumeRatio: report.diagnostic?.retestVolumeRatio ?? null,
        entryDistanceAtr: report.diagnostic?.entryDistanceAtr ?? null,
        trend5m: report.diagnostic?.trend5m || null,
      }))
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 5);

    try {
      await this.db.createResearchScanDiagnostic({
        experiment_id: CANDIDATE_V3_EXPERIMENT_ID,
        project: PAPER_PROJECTS.CANDIDATE_V3,
        strategy: 'BREAKOUT_V3_SHADOW',
        scan_source: 'BYBIT_WEBSOCKET',
        scanned_pairs: reports.length,
        qualified_before_context: rawCandidates.length,
        qualified_after_context: candidates.length,
        rejection_counts: rejectionCounts,
        context_rejection_counts: contextRejectionCounts,
        market_context: marketContext,
        examples,
      });
    } catch (error) {
      const message = String(error?.message || '');
      const missingTable = (
        error?.code === '42P01' ||
        error?.code === 'PGRST205' ||
        message.includes('research_scan_diagnostics')
      );
      if (missingTable) {
        this.candidateDiagnosticsUnavailable = true;
        console.warn(
          '⚠️ Candidate V3 diagnostics table is unavailable; apply migration ' +
          '20260725000000_add_research_scan_diagnostics.sql'
        );
        return;
      }
      console.error('❌ Candidate V3 diagnostics write failed:', message);
    }
  }

  _isCandidateV3PairCoolingDown(pair, signals = []) {
    const now = Date.now();
    return signals.some((signal) => {
      if (signal.project !== PAPER_PROJECTS.CANDIDATE_V3) return false;
      if (signal.experiment_id !== CANDIDATE_V3_EXPERIMENT_ID) return false;
      if (this._normalizePair(signal.pair) !== pair) return false;
      const createdAt = new Date(signal.created_at).getTime();
      if (!Number.isFinite(createdAt)) return false;
      const cooldownHours = signal.status === 'SL_HIT' ? 12 : 6;
      return now - createdAt < cooldownHours * 60 * 60 * 1000;
    });
  }

  _formatShadowDiagnostics(reports = []) {
    const counts = reports.reduce((result, report) => {
      const reason = report.reason || 'UNKNOWN';
      result[reason] = (result[reason] || 0) + 1;
      return result;
    }, {});

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `${reason}=${count}`)
      .join(', ');
  }

  _formatContextDecisions(candidates = []) {
    const counts = candidates.reduce((result, candidate) => {
      const decision = candidate.marketContext?.decision || 'UNMARKED';
      result[decision] = (result[decision] || 0) + 1;
      return result;
    }, {});

    return Object.entries(counts)
      .map(([decision, count]) => `${decision}=${count}`)
      .join(', ');
  }

  _getStrictPumpAlerts(reports) {
    return PumpHunterEngine.getActionable(reports, PUMP_HUNTER_ACTIONABLE_LIMIT)
      .filter((candidate) => candidate.score >= PUMP_AUTO_MIN_SCORE)
      .slice(0, PUMP_AUTO_MAX_ALERTS);
  }

  async _recordPumpV2Shadow(users = [], reports = []) {
    if (!PUMP_V2_SHADOW_ENABLED || !PAPER_SIGNAL_TRACKING_ENABLED) return;

    const candidates = PumpStateMachineV2.getEntryReady(
      reports,
      PUMP_V2_SHADOW_MAX_PER_CYCLE
    );
    const stateSummary = this._formatPumpV2Diagnostics(reports);

    if (!candidates.length) {
      console.log(`🧬 Pump State V2 shadow: no ENTRY_READY | ${stateSummary}`);
      return;
    }

    console.log(`🧬 Pump State V2 shadow: ${candidates.length} ENTRY_READY | ${stateSummary}`);

    for (const user of users) {
      const userId = String(user.telegram_id);
      const activeSignals = await this.db.getActivePaperSignals(userId, {
        project: PAPER_PROJECTS.PUMP_V2_SHADOW,
        experimentId: CURRENT_PAPER_EXPERIMENT_ID,
      });
      const activePairs = new Set(activeSignals.map((signal) => this._normalizePair(signal.pair)));
      let savedCount = 0;

      for (const candidate of candidates) {
        if (activePairs.has(this._normalizePair(candidate.pair))) continue;

        const saved = await this.bot._trackPaperSignal(
          userId,
          PumpStateMachineV2.toPaperSignal(candidate),
          'PUMP_V2_SHADOW'
        );
        if (saved) {
          savedCount += 1;
          activePairs.add(this._normalizePair(candidate.pair));
        }
      }

      console.log(`🧬 Pump State V2 shadow: saved ${savedCount} signal(s) for ${userId}; alerts=OFF`);
    }
  }

  _formatPumpV2Diagnostics(reports = []) {
    const counts = reports.reduce((result, report) => {
      const state = report.shadowV2?.state || 'NO_STATE';
      result[state] = (result[state] || 0) + 1;
      return result;
    }, {});

    const states = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([state, count]) => `${state}=${count}`)
      .join(', ');
    const marketState = reports.find((report) => report.shadowV2?.marketContext)?.shadowV2
      ?.marketContext?.state;
    const entryCandidates = PumpStateMachineV2.getEntryReady(reports, reports.length);
    const decisions = this._formatContextDecisions(entryCandidates);

    return `${states} | market=${marketState || 'OFF'}${decisions ? ` | ${decisions}` : ''}`;
  }

  async _sendPumpAlertsToUser(user, candidates) {
    const userId = String(user.telegram_id);
    const activeSignals = PAPER_SIGNAL_TRACKING_ENABLED
      ? await this.db.getActivePaperSignals(userId, {
        project: PAPER_PROJECTS.PUMP,
        experimentId: CURRENT_PAPER_EXPERIMENT_ID,
      })
      : [];
    const activePairs = new Set(
      activeSignals.map((signal) => this._normalizePair(signal.pair))
    );

    const alertable = candidates.filter((candidate) => {
      const pair = this._normalizePair(candidate.pair);

      if (activePairs.has(pair)) {
        console.log(`🧪 Pump ${pair} skipped for ${userId}: active Pump paper signal exists`);
        return false;
      }

      if (this._isPumpPairInCooldown(userId, pair)) {
        console.log(`⏸️ Pump ${pair} skipped for ${userId}: alert cooldown`);
        return false;
      }

      return true;
    }).slice(0, PUMP_AUTO_MAX_ALERTS);

    if (!alertable.length) return;

    const source = alertable[0]?.marketSource || 'BYBIT';
    const paperModeText = PAPER_SIGNAL_TRACKING_ENABLED
      ? 'Сигналы записываю в paper.'
      : 'Paper tracking OFF: пришлю алерт, но статистика не запишется.';

    await this.bot._sendPlain(
      userId,
      `🚀 PumpHunter auto: найдено ${alertable.length} pump-вход(ов).\n` +
      `Источник данных: ${this._formatPumpSource(source)}.\n` +
      `Live Bybit orders: OFF. ${paperModeText}`
    );

    for (const candidate of alertable) {
      const paperSignal = await this.bot._trackPaperSignal(
        userId,
        PumpHunterEngine.toPaperSignal(candidate),
        'PUMP_AUTO'
      );
      this._markPumpPairAlerted(userId, candidate.pair);

      await this.bot._sendPlain(
        userId,
        this._formatPumpAutoAlert(candidate, paperSignal),
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📊 Pump V1 · 7д', callback_data: 'pump_stats' },
              ],
            ],
          },
        }
      );
    }
  }

  _formatPumpAutoAlert(candidate, paperSignal) {
    return [
      '🚀 ГОТОВЫЙ PUMP-ВХОД (auto)',
      '━━━━━━━━━━━━━━━━━━━━',
      `${candidate.pair} LONG`,
      `Score ${candidate.score}/100 | RR ${candidate.riskReward} | ${candidate.exitProfile || 'dynamic'}`,
      `Entry $${candidate.entryPrice} | Main TP $${candidate.takeProfit} (+${candidate.tpPercent}%) | SL $${candidate.stopLoss} (-${candidate.slPercent}%)`,
      `TP1 $${candidate.tp1} (+${candidate.tp1Percent || 2}%) | TP2 $${candidate.tp2} (+${candidate.tp2Percent || 3}%) | Stretch $${candidate.stretchTakeProfit} (+${candidate.stretchTpPercent || 8}%)`,
      `Moon TP $${candidate.moonTakeProfit} (+${candidate.moonTpPercent || 20}%) — не основной тейк`,
      `Fresh +${candidate.freshFromLow}% от low | 24h ${candidate.priceChange24h}% | volume x${candidate.volumeBoost}`,
      `Turnover 24h $${PumpHunterEngine._formatMoney(candidate.turnover24h)} | от high -${candidate.distanceFromHigh}%`,
      `Источник: ${this._formatPumpSource(candidate.marketSource)}`,
      `Причина: ${candidate.summary}`,
      paperSignal
        ? '🧪 Записано в paper для TP/SL/timeout статистики'
        : '⚠️ Paper не записан: tracking выключен или дубль по этому сетапу',
      '',
      'Реальная сделка на Bybit не открывается автоматически.',
    ].join('\n');
  }

  async _sendCandidateAlertsToUser(user, candidates) {
    const userId = String(user.telegram_id);
    const activeSignals = PAPER_SIGNAL_TRACKING_ENABLED
      ? await this.db.getActivePaperSignals(userId, {
        project: PAPER_PROJECTS.CANDIDATE,
        experimentId: CURRENT_PAPER_EXPERIMENT_ID,
      })
      : [];
    const activePairs = new Set(
      activeSignals.map((signal) => this._normalizePair(signal.pair))
    );

    const alertable = candidates.filter((candidate) => {
      const pair = this._normalizePair(candidate.pair);

      if (activePairs.has(pair)) {
        console.log(`🧪 Candidate ${pair} skipped for ${userId}: active Candidate paper signal exists`);
        return false;
      }

      if (this._isCandidatePairInCooldown(userId, pair)) {
        console.log(`⏸️ Candidate ${pair} skipped for ${userId}: alert cooldown`);
        return false;
      }

      return true;
    }).slice(0, CANDIDATE_AUTO_MAX_ALERTS);

    if (!alertable.length) return;

    const paperModeText = PAPER_SIGNAL_TRACKING_ENABLED
      ? 'Сигналы записываю в paper.'
      : 'Paper tracking OFF: пришлю алерт, но статистика не запишется.';

    await this.bot._sendPlain(
      userId,
      `🧠 Candidate auto: найдено ${alertable.length} готовых вход(ов).\n` +
      `Live Bybit orders: OFF. ${paperModeText}`
    );

    for (const candidate of alertable) {
      const paperSignal = await this.bot._trackPaperSignal(
        userId,
        CandidateEngine.toPaperSignal(candidate),
        'CANDIDATE_AUTO'
      );
      this._markCandidatePairAlerted(userId, candidate.pair);

      await this.bot._sendPlain(
        userId,
        this._formatCandidateAutoAlert(candidate, paperSignal),
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📊 Candidate V1 · 7д', callback_data: 'candidates_stats' },
              ],
            ],
          },
        }
      );
    }
  }

  _formatCandidateAutoAlert(candidate, paperSignal) {
    return [
      '🧠 ГОТОВЫЙ ВХОД (candidate auto)',
      '━━━━━━━━━━━━━━━━━━━━',
      `${candidate.pair} ${candidate.direction}`,
      `${this._formatSignalLabel(candidate.strategy)} | score ${candidate.score}/100 | RR ${candidate.riskReward}`,
      `Entry $${candidate.entryPrice} | TP $${candidate.takeProfit} | SL $${candidate.stopLoss}`,
      `${this._formatSignalLabel(candidate.context.marketRegime)} | RSI ${candidate.context.rsi} | Vol ${candidate.context.volume}% | MACD ${candidate.context.macdBias}`,
      `Причина: ${candidate.summary}`,
      paperSignal
        ? '🧪 Записано в paper для TP/SL/timeout статистики'
        : '⚠️ Paper не записан: tracking выключен или дубль по этому сетапу',
      '',
      'Реальная сделка на Bybit не открывается автоматически.',
    ].join('\n');
  }

  _isCandidatePairInCooldown(userId, pair) {
    const key = this._candidateCooldownKey(userId, pair);
    const lastAlertAt = this.candidateAlertCooldowns.get(key);
    if (!lastAlertAt) return false;

    const cooldownMs = CANDIDATE_AUTO_COOLDOWN_MINUTES * 60 * 1000;
    if (Date.now() - lastAlertAt > cooldownMs) {
      this.candidateAlertCooldowns.delete(key);
      return false;
    }

    return true;
  }

  _markCandidatePairAlerted(userId, pair) {
    this.candidateAlertCooldowns.set(
      this._candidateCooldownKey(userId, pair),
      Date.now()
    );
  }

  _candidateCooldownKey(userId, pair) {
    return `${userId}:${this._normalizePair(pair)}`;
  }

  _isPumpPairInCooldown(userId, pair) {
    const key = this._pumpCooldownKey(userId, pair);
    const lastAlertAt = this.pumpAlertCooldowns.get(key);
    if (!lastAlertAt) return false;

    const cooldownMs = PUMP_AUTO_COOLDOWN_MINUTES * 60 * 1000;
    if (Date.now() - lastAlertAt > cooldownMs) {
      this.pumpAlertCooldowns.delete(key);
      return false;
    }

    return true;
  }

  _markPumpPairAlerted(userId, pair) {
    this.pumpAlertCooldowns.set(
      this._pumpCooldownKey(userId, pair),
      Date.now()
    );
  }

  _pumpCooldownKey(userId, pair) {
    return `${userId}:${this._normalizePair(pair)}`;
  }

  _formatPumpSource(source) {
    if (source === 'BINANCE_FUTURES_FALLBACK') return 'Binance futures fallback';
    if (source === 'OKX_SWAP_FALLBACK') return 'OKX swap fallback';
    return 'Bybit futures';
  }

  async _sendSignalsToUser(user, signals) {
    const userId = user.telegram_id;
    const today8am = this._getToday8am();
    const trades = await this.db.getTradesSince(userId, today8am.toISOString());
    const stats = RiskManager.calcDailyStats(trades, user.balance_at_8am || user.account_balance);

    if (stats.daily_risk_used >= stats.daily_risk_limit) {
      console.log(`⛔ User ${userId}: daily limit reached, signals skipped`);
      return;
    }

    const recentTrades = trades
      .filter((trade) => trade.status === 'CLOSED')
      .sort((a, b) => new Date(b.exit_time) - new Date(a.exit_time));

    const cooloff = RiskManager.checkCooloff(recentTrades);
    if (cooloff.needed && new Date() < cooloff.endsAt) {
      console.log(`⏸️ User ${userId}: in cool-off, signals skipped`);
      return;
    }

    const openPositions = await this.db.getOpenPositions(userId);
    const openPairs = new Set(
      openPositions.map((position) => this._normalizePair(position.pair))
    );
    const maxPositions = RiskManager.getMaxPositions();
    const pairCooldownTrades = await this.db.getClosedTradesExitedSince(
      userId,
      new Date(Date.now() - RiskManager.getPairCooldownMinutes() * 60 * 1000)
    );

    if (openPositions.length >= maxPositions) {
      console.log(`📊 User ${userId}: max ${maxPositions} positions reached`);
      return;
    }

    const filteredSignals = signals.filter((signal) => {
      if (openPairs.has(this._normalizePair(signal.pair))) {
        console.log(`⏭️ Skip ${signal.pair}: already has open position`);
        return false;
      }

      const pairCooldown = RiskManager.checkPairCooldown(pairCooldownTrades, signal.pair);
      if (pairCooldown.active) {
        console.log(`⏸️ Skip ${signal.pair}: pair cooldown ${pairCooldown.remainingMinutes} min`);
        return false;
      }

      return true;
    });

    if (filteredSignals.length === 0) {
      console.log(`📭 User ${userId}: all signals filtered out (existing positions)`);
      return;
    }

    const slotsAvailable = maxPositions - openPositions.length;
    const top = filteredSignals.slice(0, Math.min(3, slotsAvailable));

    console.log(
      `📊 Signal selection for ${userId}: raw=${signals.length} filtered=${filteredSignals.length} ` +
      `open=${openPositions.length}/${maxPositions} slots=${slotsAvailable} sending=${top.length}`
    );
    console.log(`✅ Selected: ${this._formatSignalListForLogs(top)}`);

    const skipped = filteredSignals.slice(top.length);
    if (skipped.length > 0) {
      console.log(`⏭️ Not sent: ${this._formatSignalListForLogs(skipped)}`);
    }

    await this.bot._send(
      userId,
      `🔔 *Авто-скан: найдено ${filteredSignals.length} сигнал(ов), отправляю ${top.length} лучших*` +
        `${PAPER_SIGNAL_TRACKING_ENABLED ? '\n🧪 Paper tracking: ON, live trading: OFF' : ''}`
    );

    for (let i = 0; i < top.length; i++) {
      const signal = top[i];
      let paperSignal = null;
      if (PAPER_SIGNAL_AUTO_LOG_ENABLED) {
        paperSignal = await this.bot._trackPaperSignal(userId, signal, 'AUTO_SCAN');
      }

      if (!PAPER_SIGNAL_ALERTS_ENABLED && paperSignal) {
        continue;
      }

      const signalId = this.bot._storePendingSignal(signal);
      const strategyLabel = this.bot._formatSignalLabel(signal.strategy);
      const regimeLabel = this.bot._formatSignalLabel(signal.marketRegime);
      const entryModeLabel = this.bot._formatSignalLabel(signal.entryMode);
      const position = RiskManager.calculatePosition(
        user.account_balance,
        signal.entryPrice,
        signal.atrPercent,
        {
          slPercent: signal.slPercent / 100,
          tpPercent: signal.tpPercent / 100,
        }
      );

      await this.bot._send(
        userId,
        `
🎯 *СИГНАЛ #${i + 1}* (авто)
━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *${signal.pair}* ${signal.type === 'SHORT' ? '🔴 SHORT' : '🟢 LONG'}
🧠 Strategy: *${strategyLabel}* (${entryModeLabel})
🌡️ Regime: *${regimeLabel}*
💰 Цена: \`$${signal.entryPrice}\`
🧾 Причина: ${signal.setupReason}
🎯 RSI: *${signal.rsi}*
📉 MACD: *${signal.macdBias}* (hist ${signal.macdHistogram})
📊 BB Position: *${signal.bbPosition}%*
🔊 Volume: *${signal.volume}%*
📏 BB Width: *${signal.bbWidth}%*
🚫 Invalidation: ${signal.invalidationRule}

🛑 SL: \`$${signal.stopLoss}\`
🟢 TP: \`$${signal.takeProfit}\`
💼 Margin: *$${position.margin}* | RR: *${position.riskReward}*

🎯 Уверенность: *${signal.confidence}%*
${paperSignal ? '\n🧪 Paper signal записан для отслеживания' : ''}
      `,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🟢 Я открыл позицию',
                  callback_data: `open_${signalId}`,
                },
                {
                  text: '⏭️ Пропустить',
                  callback_data: `skip_${signal.pair}`,
                },
              ],
            ],
          },
        }
      );
    }
  }

  _scheduleDailyReset() {
    const msUntilReset = this._getMsUntilNext8am();
    console.log(`⏰ Next daily reset in ${Math.round(msUntilReset / 60000)} minutes`);

    this.resetTimer = setTimeout(async () => {
      await this._dailyReset();
      this._scheduleDailyReset();
    }, msUntilReset);
  }

  async _dailyReset() {
    console.log('🌅 Daily reset triggered (08:00 Seoul Time)');

    try {
      const { data: users, error } = await this.db.client.from('users').select('*');
      if (error || !users?.length) return;

      for (const user of users) {
        await this.db.snapshotBalanceAt8am(user.telegram_id);

        await this.bot._send(
          user.telegram_id,
          `
☀️ *Доброе утро! Новый торговый день.*
━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 Баланс: *$${user.account_balance}*
🛡️ Дневной лимит риска: *$${RiskManager.getDailyLimit(user.account_balance)}*
📊 Макс позиций: *${RiskManager.getMaxPositions()}*

🔍 Авто-скан запущен. Первый скан через 5 мин.
/scan — запустить вручную
        `
        );
      }

      console.log(`✅ Daily reset complete for ${users.length} users`);
    } catch (error) {
      console.error('❌ Daily reset error:', error.message);
    }
  }

  _getSeoulParts(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: SEOUL_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );

    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
    };
  }

  _getMsUntilNext8am() {
    const now = new Date();
    const parts = this._getSeoulParts(now);
    const nextSeoulDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 8 - 9, 0, 0, 0));

    if (parts.hour >= 8) {
      nextSeoulDate.setUTCDate(nextSeoulDate.getUTCDate() + 1);
    }

    return nextSeoulDate.getTime() - now.getTime();
  }

  _getToday8am() {
    const parts = this._getSeoulParts();
    const targetDay = parts.hour < 8 ? parts.day - 1 : parts.day;
    return new Date(Date.UTC(parts.year, parts.month - 1, targetDay, 8 - 9, 0, 0, 0));
  }

  _normalizePair(pair) {
    return pair?.includes('USDT') ? pair : `${pair}USDT`;
  }

  _formatSignalListForLogs(signals) {
    if (!signals.length) return 'none';

    return signals
      .map((signal) => (
        `${signal.pair} ${signal.type} conf=${signal.confidence}% ` +
        `rsi=${Number(signal.rsi).toFixed(1)} bb=${Number(signal.bbPosition).toFixed(1)}%`
      ))
      .join(', ');
  }

  _formatSignalLabel(value) {
    return String(value || 'UNKNOWN').replace(/_/g, ' ');
  }

  getStatus() {
    return {
      lastScan: this.lastScanTime,
      nextScan: new Date(Date.now() + SCAN_INTERVAL_MS),
      lastCandidateScan: this.lastCandidateScanTime,
      nextCandidateScan: new Date(Date.now() + CANDIDATE_AUTO_SCAN_INTERVAL_MS),
      lastPumpScan: this.lastPumpScanTime,
      nextPumpScan: new Date(Date.now() + PUMP_AUTO_SCAN_INTERVAL_MS),
      cryptoMarketOpen: true,
      msUntilReset: this._getMsUntilNext8am(),
    };
  }
}

module.exports = Scheduler;
