// src/data/supabaseClient.js

const { createClient } = require('@supabase/supabase-js');
const RiskManager = require('../engine/riskManager');

const TRADE_CONTEXT_FIELDS = [
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
      TRADE_CONTEXT_FIELDS.forEach((field) => delete fallbackPayload[field]);

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

    if (error) throw error;
    return data;
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

  async getTradesSince(userId, since) {
    const sinceIso = since instanceof Date ? since.toISOString() : since;

    const { data, error } = await this.client
      .from('trades')
      .select('*')
      .eq('user_id', String(userId))
      .gte('entry_time', sinceIso)
      .order('entry_time', { ascending: false });

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
}

module.exports = SupabaseClient;
