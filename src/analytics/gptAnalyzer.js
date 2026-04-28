// src/analytics/gptAnalyzer.js

const https = require('https');

class GptAnalyzer {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.model = 'gpt-4o';
  }

  /**
   * Генерировать дневные инсайты на основе сделок
   * @param {Array} trades - закрытые сделки за день
   * @param {Object} stats - дневная статистика
   * @returns {string} текст анализа на русском
   */
  async generateDailyInsights(trades, stats) {
    if (!this.apiKey) {
      return '⚠️ OpenAI API key не настроен. Добавь OPENAI_API_KEY в .env';
    }

    if (trades.length === 0) {
      return '📭 Сделок сегодня не было — анализировать нечего.';
    }

    // Подготовить краткую сводку сделок для GPT
    const tradeSummary = trades.slice(0, 10).map((trade) => ({
      pair: trade.pair,
      strategy: trade.strategy,
      market_regime: trade.market_regime,
      pnl: trade.profit_loss,
      duration: trade.exit_time
        ? Math.round((new Date(trade.exit_time) - new Date(trade.entry_time)) / 60000)
        : null,
      exit_reason: trade.exit_reason,
      rsi: trade.rsi_at_entry,
      macd_bias: trade.macd_bias,
      macd_histogram: trade.macd_histogram_at_entry,
      bb_position: trade.bb_position,
      bb_width: trade.bb_width,
      atr_percent: trade.atr_percent,
      volume: trade.volume_spike_percentage,
    }));

    const prompt = `
Ты — профессиональный аналитик крипто скальпинга. 
Проанализируй торговый день трейдера и дай краткий анализ на русском языке.

СТАТИСТИКА ДНЯ:
- Всего сделок: ${stats.total_trades}
- Прибыльных: ${stats.winning_trades} | Убыточных: ${stats.losing_trades}
- Win Rate: ${stats.win_rate}%
- Total P&L: $${stats.total_pnl}
- Avg Win: $${stats.avg_win} | Avg Loss: $${stats.avg_loss}
- Profit Factor: ${stats.profit_factor}
- Daily Risk Used: $${stats.daily_risk_used}/$${stats.daily_risk_limit}

ПАТТЕРНЫ СЕТАПОВ:
- Context Coverage: ${stats.context_coverage?.trades_with_context || 0}/${stats.context_coverage?.total_trades || stats.total_trades}
- Best Setup: ${JSON.stringify(stats.best_setup || null)}
- Worst Setup: ${JSON.stringify(stats.worst_setup || null)}
- Best Regime: ${JSON.stringify(stats.best_regime || null)}
- Best MACD Bias: ${JSON.stringify(stats.best_macd_bias || null)}

ПРИМЕРЫ СДЕЛОК (до 10):
${JSON.stringify(tradeSummary, null, 2)}

ТРЕБОВАНИЯ К ОТВЕТУ:
1. Оценка дня (1-2 предложения)
2. Что сработало хорошо (1 наблюдение)
3. Что можно улучшить (1 конкретный совет)
4. Итог (1 предложение)

Максимум 5-6 предложений. Пиши конкретно и по делу.
Не используй markdown разметку в ответе.
ВАЖНО: НЕ используй символы форматирования: звёздочки *, подчёркивания _, обратные кавычки \`, квадратные скобки [].
Пиши plain text без форматирования.
    `.trim();

    try {
      const response = await this._callOpenAI(prompt);
      return this._sanitizeTelegramText(response);
    } catch (err) {
      console.error('❌ GPT error:', err.message);
      return '⚠️ GPT анализ временно недоступен. Попробуй позже.';
    }
  }

  /**
   * Генерировать инсайты по детальной недельной аналитике.
   * @param {Object} analytics - Detailed analytics data
   * @returns {Promise<string>} GPT insights
   */
  async analyzeDetailedPatterns(analytics) {
    if (!this.apiKey) {
      return '⚠️ OpenAI API key не настроен. Добавь OPENAI_API_KEY в .env';
    }

    if (!this._hasAnalyticsData(analytics)) {
      return '💡 Пока недостаточно данных для AI-инсайтов. Нужно больше закрытых сделок с context-полями.';
    }

    const context = {
      topPairs: this._compactRows(analytics.topPairs, (pair) => ({
        pair: pair.pair,
        winRate: pair.win_rate,
        trades: pair.trades,
        pnl: pair.total_pnl,
      })),
      worstPairs: this._compactRows(analytics.worstPairs, (pair) => ({
        pair: pair.pair,
        winRate: pair.win_rate,
        trades: pair.trades,
        pnl: pair.total_pnl,
      })),
      regimes: this._compactRows(analytics.regimes, (regime) => ({
        regime: regime.market_regime,
        winRate: regime.win_rate,
        trades: regime.trades,
        pnl: regime.total_pnl,
      })),
      strategies: this._compactRows(analytics.strategies, (strategy) => ({
        strategy: strategy.strategy,
        winRate: strategy.win_rate,
        trades: strategy.trades,
        pnl: strategy.total_pnl,
      })),
      macdBias: this._compactRows(analytics.macdBias, (bias) => ({
        bias: bias.macd_bias,
        winRate: bias.win_rate,
        trades: bias.trades,
        pnl: bias.total_pnl,
      })),
      rsiZones: this._compactRows(analytics.rsiZones, (zone) => ({
        zone: zone.rsi_zone,
        winRate: zone.win_rate,
        trades: zone.trades,
        pnl: zone.total_pnl,
      })),
      holdTimes: this._compactRows(analytics.holdTimes, (holdTime) => ({
        bucket: holdTime.hold_time_bucket,
        winRate: holdTime.win_rate,
        trades: holdTime.trades,
        pnl: holdTime.total_pnl,
        avgHoldMinutes: holdTime.avg_hold_minutes,
      })),
    };

    const prompt = `
Ты опытный трейдер-аналитик. Проанализируй недельную статистику скальпинг-бота.

ДАННЫЕ:
${JSON.stringify(context, null, 2)}

Дай 3 конкретных инсайта на русском:

1. 🎯 ЧТО РАБОТАЕТ ЛУЧШЕ ВСЕГО
- Какая комбинация даёт лучший результат?
- Какие пары, режимы или зоны самые профитные?

2. ⚠️ ЧТО НЕ РАБОТАЕТ
- Какие паттерны дают убытки?
- Что стоит исключить или пересмотреть?

3. 💡 РЕКОМЕНДАЦИЯ НА ЗАВТРА
- Конкретное действие для улучшения результата.
- На что обратить внимание в следующих сделках?

Ограничения:
- Максимум 700 символов.
- Кратко, конкретно, без воды.
- Не используй markdown: без *, _, обратных кавычек и квадратных скобок.
    `.trim();

    try {
      const response = await this._callOpenAI(prompt, 450);
      return this._sanitizeTelegramText(response) || '💡 Недостаточно данных для анализа.';
    } catch (error) {
      console.error('❌ analyzeDetailedPatterns error:', error.message);
      return '💡 GPT анализ паттернов временно недоступен.';
    }
  }

  /**
   * Вызов OpenAI API
   */
  _callOpenAI(prompt, maxTokens = 300) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });

      const options = {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);

            if (json.error) {
              reject(new Error(json.error.message));
              return;
            }

            const text = json.choices?.[0]?.message?.content || '';
            resolve(text.trim());
          } catch (e) {
            reject(new Error('Failed to parse OpenAI response'));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  _sanitizeTelegramText(text) {
    return String(text)
      .replace(/[*_`\[\]]/g, '')
      .trim();
  }

  _compactRows(rows = [], mapper) {
    return rows.slice(0, 5).map(mapper);
  }

  _hasAnalyticsData(analytics) {
    return [
      analytics?.topPairs,
      analytics?.worstPairs,
      analytics?.regimes,
      analytics?.strategies,
      analytics?.macdBias,
      analytics?.rsiZones,
      analytics?.holdTimes,
    ].some((rows) => rows && rows.length > 0);
  }
}

module.exports = GptAnalyzer;
