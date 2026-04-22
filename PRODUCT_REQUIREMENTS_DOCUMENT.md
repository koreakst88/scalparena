# PRODUCT REQUIREMENTS DOCUMENT (PRD) - СОКРАЩЁННЫЙ
## ScalpArena - Telegram Bot для Scalp Trading

**Версия:** 1.0  
**Дата:** April 2026  
**Статус:** Ready for Development (Phase 1)

---

## 1. PRODUCT OVERVIEW

**Цель:** Telegram bot для скальп-торговли с автоматическим обнаружением сигналов, жёстким RM и ИИ анализом.

**Ключевые особенности:**
- Real-time сканирование 15 криптовалютных пар
- Автоматическое обнаружение импульса + откат + volume + RSI
- Жёсткая система управления рисками (фиксированный 1% TP)
- Дневная статистика с GPT insights
- Queue система для управления позициями (max 2-3 concurrent)
- Динамический размер позиции и адаптивное плечо

**Target User:** Опытные скальперы, торгующие 8 AM - 12 AM Seoul Time

---

## 2. KEY USER FLOWS

### Flow 1: Daily Trading Start
```
8 AM → User opens bot → /scan → Select signal → /rm [size] → Open on Bybit 
→ User clicks [✅] → Position logged → Monitor → Close position → /exit [price]
→ End of day → /stats → See GPT insights
```

### Flow 2: Signal Detection & Selection
```
/scan command triggers:
1. Bot fetches latest 1h candles (15 pairs)
2. Calculates indicators (ATR, RSI, ROC, MACD, Volume)
3. Detects momentum signals (10-20% impulse)
4. Prioritizes by score (confidence, momentum, volume, history)
5. Returns top 3-5 signals as separate cards

User options for each signal:
[🟢 Я готов] → RM calculator
[📋 Детали] → Expanded view (advanced users)
[⏭️ Пропустить] → Skip to next
```

### Flow 3: Position Management
```
Signal → [🟢 Я готов] → RM Calculator shows:
  • Position size: $10 (default or user input)
  • Stop Loss: [dynamic by ATR]
  • Take Profit: -1% (FIXED)
  • Max Risk: $4

User opens position on Bybit manually, then clicks [✅ Я открыл]

Bot monitors for:
  ✓ TP hit (-1%) → Alert "🟢 TP ДОСТИГНУТА!"
  ✓ Stop hit → Alert "🔴 STOP ХИТ!"
  ✓ RSI > 75 + profit > $0.20 → Alert "⚡ RSI EXIT"
  ✓ 1 hour timeout → Soft alert "Want to exit?"
  ✓ 1.5 hour hard timeout → Force close

User closes on Bybit, then types /exit [price] to log
```

### Flow 4: Queue Management
```
IF active positions = 2 (at max) AND signal triggered:
  → Signal added to QUEUE (priority scored)
  → User gets: "⏳ СИГНАЛ В ОЧЕРЕДИ (позиция #3)"
  
WHEN one position closes:
  → Next signal in queue auto-promoted to ACTIVE
  → User gets: "🚀 ПОЗИЦИЯ ОТКРЫТА! (из очереди)"
  
IF signal expires (30 min validity):
  → Signal removed from queue
  → User gets: "❌ СИГНАЛ ИСТЁК"
```

### Flow 5: Daily Statistics & GPT
```
End of day: User types /stats
  → Bot collects all trades from 08:00 Seoul Time
  → Calculates: win rate, P&L, profit factor, RM violations
  → Sends stats card (Message 1)
  → Calls OpenAI GPT with trades + stats
  → Sends GPT insights card (Message 2)
```

---

## 3. TELEGRAM BOT COMMANDS

### Command Reference

| Command | Usage | Response |
|---------|-------|----------|
| `/scan` | `/scan` | Top 3-5 signals with full details |
| `/rm [size]` | `/rm 10` | RM calculator (SL, TP, max risk) |
| `/status` | `/status` | All active positions + queue |
| `/exit [price]` | `/exit 91.57` | Close position, calculate P&L |
| `/stats` | `/stats` | Daily stats + GPT insights |
| `/help` | `/help` | Command reference |

### Detailed Specifications

#### `/scan`
- Scans all 15 pairs simultaneously
- Fetches latest 1h candles from Bybit
- Returns top 3-5 signals by priority score
- Each signal = separate message card
- If no signals: "❌ Сигналов не найдено (спокойный рынок)"

#### `/rm [size]`
- Input: Position size (e.g., `/rm 10`)
- Output: RM calculator showing:
  - Entry price (current market)
  - Stop Loss (dynamic by ATR: 0.5%-1%)
  - Take Profit (fixed -1%)
  - Max Risk (2% of balance)
  - Daily Risk used vs limit
- Buttons: [✅ Я открыл позицию] [❌ Отмена]
- Validation: Check if violates daily risk limit

#### `/status`
- Shows all open positions (max 2-3)
- Shows all queued signals (with expiry time)
- For each position: entry, current price, P&L, time held, distance to SL/TP
- No auto-updates (only on demand)

#### `/exit [price]`
- Input: Exit price (e.g., `/exit 91.57`)
- Validates: Price should be reasonable
- Calculates P&L including 0.2% commissions
- Updates: Daily stats, win rate, daily risk used
- Promotes: Next signal from queue (if any)
- Logs to database for analytics

#### `/stats`
- Compiles all trades from current day (since 08:00 Seoul Time)
- Sends Message 1: Daily statistics card
  - Total trades, win rate, total P&L
  - Avg win/loss, profit factor
  - RM violations, cool-off triggers
  - Per-pair breakdown
- Sends Message 2: GPT insights (after 2-5 sec delay)
  - Assessment of day's performance
  - 2-3 key observations
  - One actionable recommendation

#### `/help`
- Lists all commands with brief descriptions
- Shows typical daily workflow
- Links to more info (if needed)

---

## 4. KEY MESSAGE TEMPLATES

### Signal Card (for `/scan`)
```
🎯 СИГНАЛ #1
━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 SOL/USDT SHORT

💰 Текущая цена: $92.50
📈 Импульс за час: +6.2%
📊 Откат от high: -0.8%
🔊 Volume: +35% (спайк подтверждён)

✅ ПАРАМЕТРЫ:
🟢 SHORT на $92.50
🛑 STOP: $93.98 (макс риск $4)
🟢 TP: $91.57 (фиксированный -1%)

🎯 Приоритет: 78% | Уверенность: 72%

[🟢 Я готов] [📋 Детали] [⏭️ Пропустить]
```

### RM Calculator (for `/rm 10`)
```
💼 RM КАЛЬКУЛЯТОР
════════════════════════════════
Размер позиции: $10
Цена входа: $92.50 (текущая)
Плечо: 10x (адаптивное по балансу)

🛑 STOP LOSS: $93.98
   (0.5% выше high часовой свечи)
   Max Loss: $4.00 (2% баланса)

🟢 TAKE PROFIT: $91.57
   (Фиксированный -1%, без изменений!)
   Expected Profit: $0.93

Daily Risk: 4/10 (40% used)
✅ RM CHECK: Всё в порядке!

[✅ Я открыл позицию] [❌ Отмена]
```

### Position Status (for `/status`)
```
🔥 АКТИВНЫЕ ПОЗИЦИИ (1/2)
════════════════════════════════

SOL/USDT SHORT
Entry: $92.50 | Current: $92.00 (-0.5%)
💰 P&L: +$1.50 ✅ | Time: 15 мин
🛑 SL: $93.98 (далеко) | 🟢 TP: $91.57 (близко!)

Command: /exit 92.00

⏳ ОЧЕРЕДЬ: 1 сигнал (ETH, приоритет 74%, откроется следующей)
```

### Daily Stats (for `/stats` Message 1)
```
📊 СТАТИСТИКА ДНЕВНОЙ ТОРГОВЛИ
════════════════════════════════

📈 РЕЗУЛЬТАТЫ:
Всего сделок: 20
✅ Прибыльные: 13 (65%)
❌ Убыточные: 7

💰 P&L:
Total: +$12.40 ✅
Avg Win: +$0.95
Avg Loss: -$2.85
Profit Factor: 1.35

Best: +$2.10 (SOL) | Worst: -$4.00 (XRP)

⏱️ Avg Hold Time: 23 мин

🛡️ RM STATS:
Daily Risk Used: 8/10 (80%)
RM Violations: 0 ✅
Cool-off: 0 ✅
```

### GPT Insights (for `/stats` Message 2)
```
🤖 AI INSIGHTS ОТ GPT
════════════════════════════════

Отличный день! Win rate 65% - это хорошо. 
Замечено: SOL твоя лучшая пара (67% WR), 
а BTC сложнее (50% WR, наверное спред выше).

Рекомендация: Завтра смотри больше сигналы SOL. 
Дисциплина идеальная - продолжай без TP override!

✅ До встречи завтра в 08:00!
```

---

## 5. ALERT & NOTIFICATION MESSAGES

### Position Events
```
🟢 TP ДОСТИГНУТА!
P&L: +$0.93, Time: 15 мин
Закрой позицию на Bybit и напиши /exit

🔴 STOP ХИТ!
P&L: -$4.00, Time: 42 мин
Позиция закрыта автоматически

⚡ RSI > 75
P&L: +$0.50 (маленький профит, есть риск)
Рекомендуем закрыть прибыльную позицию

⏰ TIMEOUT 1 HOUR
Позиция открыта 1 час без TP достигнутой.
Хочешь закрыть? [Да] [Нет]
```

### Queue & Risk Events
```
⏳ СИГНАЛ В ОЧЕРЕДИ
Позиция #3 добавлена в очередь (приоритет 78%)
Откроется когда закроется одна из открытых позиций

🚀 ПОЗИЦИЯ ОТКРЫТА!
Сигнал из очереди автоматически активирован (ETH SHORT)

⚠️ COOL-OFF АКТИВИРОВАН
2 убыточные сделки подряд (дисциплина!)
Пауза 30 минут перед новыми сделками

⚠️ DAILY LIMIT БЛИЗОК!
Осталось $2 из дневного риска ($10)
Будь осторожнее со следующей сделкой
```

### Error Messages
```
❌ СИГНАЛ ИСТЁК
Позиция не открыта (сигнал действует только 30 мин)
Запроси /scan для новых сигналов

❌ НЕВОЗМОЖНО ОТКРЫТЬ ПОЗИЦИЮ
Дневной риск исчерпан. Торговля остановлена до завтра 08:00

❌ НАРУШЕНИЕ RM!
Риск этой сделки $6, макс $4 на сделку
Хочешь открыть всё равно? (рискованно) [Да] [Нет]

⚠️ ЦЕНА ВХОДА УСТАРЕВШАЯ
Сигнал был сгенерирован 25 минут назад, цена могла измениться
Текущая цена: $92.60 (сигнал был на $92.50)
Всё ещё хочешь открыть? [Да] [Нет]
```

---

## 6. USER SETTINGS (Phase 1 MVP)

**Fixed (не меняются):**
- TP: Always -1% (hard-coded, no override)
- Risk per trade: 2% of balance
- Daily risk limit: 5% of balance
- Max concurrent positions: 2-3
- Trading hours: 8 AM - 12 AM Seoul Time

**Configurable (future Phase 2):**
- Position size (default $10)
- Leverage (default 10x for $200 balance)
- Risk per trade percentage (currently 2%)

---

## 7. ERROR HANDLING & EDGE CASES

### User Input Validation
```
/exit invalid_price
→ "❌ Цена некорректна. Пример: /exit 91.57"

/rm 0
→ "❌ Размер должен быть > 0. Пример: /rm 10"

/exit 50000 (for SOL pair at $90)
→ "⚠️ Цена странная (50x от entry). Подтвердишь? [Да] [Нет]"
```

### Position Conflicts
```
User tries to open 3rd position (max 2):
→ "⏳ Макс 2 позиции одновременно"
→ "Сигнал добавлен в очередь (позиция #3)"

User tries /exit when no open positions:
→ "❌ Нет открытых позиций. Типи /status для проверки"
```

### Timezone & Reset
```
At 08:00 Seoul Time:
→ Daily stats reset
→ Daily risk limit reset
→ Daily trade count reset
→ Cool-off counter reset

User types /stats in Korea at 07:55:
→ Shows yesterday's stats (not today yet)
```

### Data Loss Prevention
```
Bot disconnects during position:
→ Reconnect and restore from database
→ Show user: "⚠️ Соединение восстановлено. Твоя позиция еще открыта"
→ Fetch latest P&L from cache

GPT API fails:
→ Don't fail entire /stats
→ Show stats card + message: "⚠️ AI insights недоступны сейчас"
```

---

## 8. TESTING CHECKLIST

- [ ] `/scan` returns valid signals with correct scoring
- [ ] RM calculator correctly computes SL, TP, max risk
- [ ] Queue system promotes signals when position closes
- [ ] Signal expires after 30 minutes
- [ ] P&L calculation includes 0.2% commission
- [ ] Daily stats reset at 08:00 Seoul Time
- [ ] GPT insights generated and formatted correctly
- [ ] Cool-off triggers after 2 consecutive losses
- [ ] Daily risk limit enforced
- [ ] Hard timeout closes position at 1.5 hours
- [ ] All alert messages send on time
- [ ] Telegram message parsing handles edge cases

---

## 9. SUCCESS METRICS (Phase 1)

- **Uptime:** Bot responds to commands < 2 seconds
- **Accuracy:** Signal detection matches manual analysis 90%+ of time
- **User Experience:** All commands work without errors
- **Data Integrity:** All trades logged correctly, P&L accurate
- **Reliability:** No lost positions or corrupted data

---

**END OF DOCUMENT**
