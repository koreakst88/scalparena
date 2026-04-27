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
   * Вызов OpenAI API
   */
  _callOpenAI(prompt) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: this.model,
        max_tokens: 300,
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
}

module.exports = GptAnalyzer;
