// src/data/supabaseClient.js

const { createClient } = require('@supabase/supabase-js');
const RiskManager = require('../engine/riskManager');
const {
  EXTREME_PROJECT,
  EXTREME_EXPERIMENT_ID,
  EXTREME_EVENT_STATES,
} = require('../config/extremeRadar');

const TRADE_CONTEXT_FIELDS = [
  'strategy_version',
  'strategy',
  'entry_mode',
  'market_regime',
  'signal_confidence',
  'signal_reason',
  'invalidation_rule',
  'rsi_at_entry',
  'macd_at_entry',
  'macd_signal_at_entry',
  'macd_histogram_at_entry',
  'macd_bias',
  'bb_position',
  'bb_width',
  'atr_percent',
  'volume_spike_percentage',
];

const PAPER_EXPERIMENT_FIELDS = [
  'project',
  'experiment_id',
  'is_legacy',
  'market_source',
  'timeframe',
  'exit_profile',
  'tp1',
  'tp2',
  'stretch_take_profit',
  'moon_take_profit',
  'signal_metadata',
];

class SupabaseClient {
  constructor() {
    this.url = process.env.SUPABASE_URL;
    this.key = process.env.SUPABASE_KEY;

    if (!this.url || !this.key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in .env');
    }

    this.client = createClient(this.url, this.key);
    console.log('✅ Supabase client initialized');
  }

  // Метод для логирования сделок
  async logTrade(userId, tradeData) {
    const payload = {
      user_id: userId,
      ...tradeData,
    };

    const { data, error } = await this.client.from('trades').insert([payload]);

    if (!error) return data;

    if (this._isMissingTradeContextColumnError(error)) {
      console.warn('⚠️ Trade context columns missing in Supabase, retrying without context fields');
      const fallbackPayload = { ...payload };
      this._getMissingTradeContextFields(error).forEach((field) => delete fallbackPayload[field]);

      const { data: fallbackData, error: fallbackError } = await this.client
        .from('trades')
        .insert([fallbackPayload]);

      if (fallbackError) throw fallbackError;
      return fallbackData;
    }

    throw error;
  }

  // Метод для получения дневной статистики
  async getDailyStats(userId, date) {
    const { data, error } = await this.client
      .from('daily_stats')
      .select('*')
      .eq('user_id', userId)
      .eq('trade_date', date)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // 'not found' это нормально
    return data;
  }

  // Метод для создания/обновления дневной статистики
  async upsertDailyStats(userId, date, statsData) {
    const { data, error } = await this.client.from('daily_stats').upsert([
      {
        user_id: userId,
        trade_date: date,
        ...statsData,
      },
    ]);

    if (error) throw error;
    return data;
  }

  // Метод для получения пользователя
  async getUser(userId) {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('telegram_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  // Метод для создания/обновления пользователя
  async upsertUser(userId, userData) {
    const { data, error } = await this.client.from('users').upsert([
      {
        telegram_id: userId,
        ...userData,
      },
    ]);

    if (error) throw error;
    return data;
  }

  // Метод для получения всех открытых позиций пользователя
  async getOpenPositions(userId) {
    const { data, error } = await this.client
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'OPEN')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // Метод для закрытия позиции
  async closePosition(tradeId, exitData) {
    const { data, error } = await this.client
      .from('trades')
      .update({
        status: 'CLOSED',
        ...exitData,
      })
      .eq('id', tradeId);

    if (!error) return data;

    if (this._isMissingFeeColumnError(error)) {
      console.warn('⚠️ Fee columns missing in Supabase, retrying close without fee fields');
      const fallbackExitData = { ...exitData };
      delete fallbackExitData.gross_pnl;
      delete fallbackExitData.entry_fee;
      delete fallbackExitData.exit_fee;

      const { data: fallbackData, error: fallbackError } = await this.client
        .from('trades')
        .update({
          status: 'CLOSED',
          ...fallbackExitData,
        })
        .eq('id', tradeId);

      if (fallbackError) throw fallbackError;
      return fallbackData;
    }

    throw error;
  }

  // Метод для получения сигналов
  async getSignals(userId, status = 'ACTIVE') {
    const { data, error } = await this.client
      .from('signals')
      .select('*')
      .eq('user_id', userId)
      .eq('status', status)
      .order('priority_score', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async createPaperSignal(userId, signalData) {
    const payload = {
      user_id: String(userId),
      ...signalData,
    };

    const { data, error } = await this.client
      .from('paper_signals')
      .insert([payload])
      .select()
      .single();

    if (error?.code === '23505') {
      console.log(`🧪 Paper signal duplicate skipped: ${payload.pair} ${payload.direction}`);
      return null;
    }

    if (error && this._isMissingPaperExperimentColumnError(error)) {
      console.warn('⚠️ Paper experiment columns missing, retrying with legacy payload');
      const legacyPayload = { ...payload };
      PAPER_EXPERIMENT_FIELDS.forEach((field) => delete legacyPayload[field]);

      const retry = await this.client
        .from('paper_signals')
        .insert([legacyPayload])
        .select()
        .single();

      if (retry.error?.code === '23505') return null;
      if (retry.error) throw retry.error;
      return retry.data;
    }

    if (error) throw error;
    return data;
  }

  async createResearchScanDiagnostic(diagnosticData) {
    const { data, error } = await this.client
      .from('research_scan_diagnostics')
      .insert([diagnosticData])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async createExtremeEvent(eventData) {
    const payload = {
      ...eventData,
      project: EXTREME_PROJECT,
      experiment_id: eventData.experiment_id || EXTREME_EXPERIMENT_ID,
    };

    const { data, error } = await this.client
      .from('extreme_events')
      .insert([payload])
      .select()
      .single();

    if (error?.code === '23505') {
      console.log(
        `⚡ Extreme event duplicate skipped: ${payload.pair} ${payload.scenario}`
      );
      return null;
    }

    if (error) throw error;
    return data;
  }

  async updateExtremeEvent(eventId, updates) {
    const { data, error } = await this.client
      .from('extreme_events')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', eventId)
      .eq('project', EXTREME_PROJECT)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getActiveExtremeEvents(filters = {}) {
    let query = this.client
      .from('extreme_events')
      .select('*')
      .eq('project', EXTREME_PROJECT)
      .eq('experiment_id', filters.experimentId || EXTREME_EXPERIMENT_ID)
      .in('state', [
        EXTREME_EVENT_STATES.WATCH,
        EXTREME_EVENT_STATES.ARMED,
        EXTREME_EVENT_STATES.TRIGGERED,
      ])
      .order('updated_at', { ascending: false });

    if (filters.pair) {
      query = query.eq('pair', String(filters.pair).toUpperCase());
    }

    if (filters.scenario) {
      query = query.eq('scenario', filters.scenario);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getExtremeEventsSince(since, filters = {}) {
    const sinceIso = since instanceof Date ? since.toISOString() : since;
    let query = this.client
      .from('extreme_events')
      .select('*')
      .eq('project', EXTREME_PROJECT)
      .eq('experiment_id', filters.experimentId || EXTREME_EXPERIMENT_ID)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false });

    if (filters.state) {
      query = query.eq('state', filters.state);
    }

    if (filters.scenario) {
      query = query.eq('scenario', filters.scenario);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  _isMissingPaperExperimentColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return PAPER_EXPERIMENT_FIELDS.some((field) => message.includes(field.toLowerCase())) && (
      error?.code === 'PGRST204' ||
      message.includes('column') ||
      message.includes('schema cache')
    );
  }

  async getActivePaperSignals(userId = null, filters = {}) {
    let query = this.client
      .from('paper_signals')
      .select('*')
      .eq('status', 'WATCHING')
      .order('created_at', { ascending: true });

    if (userId) {
      query = query.eq('user_id', String(userId));
    }

    if (filters.project) {
      query = query.eq('project', filters.project);
    }

    if (filters.experimentId) {
      query = query.eq('experiment_id', filters.experimentId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async updatePaperSignal(signalId, updates) {
    const { data, error } = await this.client
      .from('paper_signals')
      .update(updates)
      .eq('id', signalId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getPaperSignalsSince(userId, since) {
    const sinceIso = since instanceof Date ? since.toISOString() : since;

    const { data, error } = await this.client
      .from('paper_signals')
      .select('*')
      .eq('user_id', String(userId))
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ getPaperSignalsSince error:', error.message);
      return [];
    }

    return data || [];
  }

  async getTradesSince(userId, since, options = {}) {
    const sinceIso = since instanceof Date ? since.toISOString() : since;
    let query = this.client
      .from('trades')
      .select('*')
      .eq('user_id', String(userId))
      .gte('entry_time', sinceIso);

    query = this._applyStrategyVersionFilter(query, options.strategyVersion);

    const { data, error } = await query.order('entry_time', { ascending: false });

    if (error) {
      console.error('❌ getTradesSince error:', error.message);
      return [];
    }

    return data || [];
  }

  async getClosedTradesExitedSince(userId, since) {
    const sinceIso = since instanceof Date ? since.toISOString() : since;

    const { data, error } = await this.client
      .from('trades')
      .select('*')
      .eq('user_id', String(userId))
      .eq('status', 'CLOSED')
      .gte('exit_time', sinceIso)
      .order('exit_time', { ascending: false });

    if (error) {
      console.error('❌ getClosedTradesExitedSince error:', error.message);
      return [];
    }

    return data || [];
  }

  // ============================================
  // DETAILED ANALYTICS METHODS
  // ============================================

  async getTopPairs(userId, days = 7, minTrades = 3, strategyVersion = null) {
    return this._callAnalyticsRpc('get_top_pairs', {
      p_user_id: String(userId),
      p_days: days,
      p_min_trades: minTrades,
      p_strategy_version: strategyVersion,
    });
  }

  async getWorstPairs(userId, days = 7, minTrades = 3, strategyVersion = null) {
    return this._callAnalyticsRpc('get_worst_pairs', {
      p_user_id: String(userId),
      p_days: days,
      p_min_trades: minTrades,
      p_strategy_version: strategyVersion,
    });
  }

  async getRegimeStats(userId, days = 7, strategyVersion = null) {
    return this._callAnalyticsRpc('get_regime_stats', {
      p_user_id: String(userId),
      p_days: days,
      p_strategy_version: strategyVersion,
    });
  }

  async getStrategyStats(userId, days = 7, strategyVersion = null) {
    return this._callAnalyticsRpc('get_strategy_stats', {
      p_user_id: String(userId),
      p_days: days,
      p_strategy_version: strategyVersion,
    });
  }

  async getMacdBiasStats(userId, days = 7, strategyVersion = null) {
    return this._callAnalyticsRpc('get_macd_bias_stats', {
      p_user_id: String(userId),
      p_days: days,
      p_strategy_version: strategyVersion,
    });
  }

  async getMACDBiasStats(userId, days = 7) {
    return this.getMacdBiasStats(userId, days);
  }

  async getRsiZoneStats(userId, days = 7, strategyVersion = null) {
    return this._callAnalyticsRpc('get_rsi_zone_stats', {
      p_user_id: String(userId),
      p_days: days,
      p_strategy_version: strategyVersion,
    });
  }

  async getRSIZoneStats(userId, days = 7) {
    return this.getRsiZoneStats(userId, days);
  }

  async getHoldTimeStats(userId, days = 7, strategyVersion = null) {
    return this._callAnalyticsRpc('get_hold_time_stats', {
      p_user_id: String(userId),
      p_days: days,
      p_strategy_version: strategyVersion,
    });
  }

  async getExitReasonStats(userId, days = 7, strategyVersion = null) {
    return this._callAnalyticsRpc('get_exit_reason_stats', {
      p_user_id: String(userId),
      p_days: days,
      p_strategy_version: strategyVersion,
    });
  }

  /**
   * Обновить баланс после сделки
   */
  async updateBalance(userId, profitLoss) {
    const { data: user, error: userError } = await this.client
      .from('users')
      .select('account_balance')
      .eq('telegram_id', String(userId))
      .single();

    if (userError || !user) {
      console.error('❌ updateBalance user error:', userError?.message || 'User not found');
      return null;
    }

    const newBalance = parseFloat(
      RiskManager.updateBalance(user.account_balance, profitLoss).toFixed(4)
    );

    const { error } = await this.client
      .from('users')
      .update({
        account_balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('telegram_id', String(userId));

    if (error) {
      console.error('❌ updateBalance error:', error.message);
      return null;
    }

    console.log(`💰 Balance updated: $${user.account_balance} → $${newBalance}`);
    return newBalance;
  }

  /**
   * Зафиксировать баланс на 08:00 (вызывать при дневном сбросе)
   */
  async snapshotBalanceAt8am(userId) {
    const user = await this.getUser(userId);
    if (!user) throw new Error('User not found');

    const today = new Date().toISOString().split('T')[0];

    // Не снимать снимок дважды в один день
    if (user.last_balance_reset === today) return user.balance_at_8am;

    const { data, error } = await this.client
      .from('users')
      .update({
        balance_at_8am: user.account_balance,
        last_balance_reset: today,
      })
      .eq('telegram_id', userId);

    if (error) throw error;

    console.log(`📸 Balance snapshot at 08:00: $${user.account_balance}`);
    return user.account_balance;
  }

  /**
   * Пополнение депозита (/deposit N)
   */
  async depositBalance(userId, amount) {
    const user = await this.getUser(userId);
    if (!user) throw new Error('User not found');

    const newBalance = parseFloat((user.account_balance + amount).toFixed(8));

    const { data, error } = await this.client
      .from('users')
      .update({ account_balance: newBalance })
      .eq('telegram_id', userId);

    if (error) throw error;

    console.log(`💵 Deposit: +$${amount} → new balance $${newBalance}`);
    return newBalance;
  }

  async test() {
    try {
      const { data, error } = await this.client.from('pairs').select('*').limit(1);
      if (error) throw error;
      console.log('✅ Supabase connection OK');
      return true;
    } catch (error) {
      console.error('❌ Supabase connection failed:', error.message);
      return false;
    }
  }

  _isMissingTradeContextColumnError(error) {
    const message = error?.message || '';
    return (
      error?.code === 'PGRST204' &&
      TRADE_CONTEXT_FIELDS.some((field) => message.includes(field))
    );
  }

  _getMissingTradeContextFields(error) {
    const message = error?.message || '';
    const missing = TRADE_CONTEXT_FIELDS.filter((field) => message.includes(field));
    return missing.length > 0 ? missing : TRADE_CONTEXT_FIELDS;
  }

  async _callAnalyticsRpc(name, params) {
    const rpcParams = { ...params };
    if (rpcParams.p_strategy_version == null) {
      delete rpcParams.p_strategy_version;
    }

    const { data, error } = await this.client.rpc(name, rpcParams);

    if (error) {
      console.error(`❌ ${name} RPC error:`, error.message || error);
      return [];
    }

    return data || [];
  }

  _isMissingFeeColumnError(error) {
    const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
    return ['gross_pnl', 'entry_fee', 'exit_fee'].some((field) => message.includes(field));
  }

  _applyStrategyVersionFilter(query, strategyVersion) {
    if (!strategyVersion) return query;
    return query.eq('strategy_version', strategyVersion);
  }
}

module.exports = SupabaseClient;
