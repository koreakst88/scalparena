// src/data/supabaseClient.js

const { createClient } = require('@supabase/supabase-js');
const RiskManager = require('../engine/riskManager');

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
    const { data, error } = await this.client.from('trades').insert([
      {
        user_id: userId,
        ...tradeData,
      },
    ]);

    if (error) throw error;
    return data;
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

  /**
   * Обновить баланс после сделки
   */
  async updateBalance(userId, profitLoss) {
    // Сначала получить текущий баланс
    const user = await this.getUser(userId);
    if (!user) throw new Error('User not found');

    const newBalance = RiskManager.updateBalance(user.account_balance, profitLoss);

    const { data, error } = await this.client
      .from('users')
      .update({
        account_balance: newBalance,
        last_activity: new Date(),
      })
      .eq('telegram_id', userId);

    if (error) throw error;

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
}

module.exports = SupabaseClient;
