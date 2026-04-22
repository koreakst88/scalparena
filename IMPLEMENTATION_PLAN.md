# IMPLEMENTATION PLAN
## ScalpArena - Telegram Bot для Scalp Trading

**Версия:** 1.0  
**Дата:** April 2026  
**Статус:** Ready to Code

---

## 1. PHASE OVERVIEW

### Phase 1: MVP (Manual Trading Bot)
**Duration:** 2-3 weeks  
**Goal:** Fully functional signal generation + manual trade logging  
**Deliverables:** Working Telegram bot + Supabase database

### Phase 2: Semi-Automation (Future)
**Duration:** 1 month  
**Goal:** Auto order placement on Bybit (user confirms)

### Phase 3: Full Automation (Future)
**Duration:** 1-2 months  
**Goal:** 24/7 trading, SaaS monetization

---

## 2. PHASE 1 DETAILED BREAKDOWN (2-3 WEEKS)

### Week 1: Foundation & Data Integration

#### Day 1-2: Project Setup
```
Tasks:
- [ ] Initialize Node.js project (npm init)
- [ ] Install dependencies:
      - express (API server)
      - node-telegram-bot-api (Telegram)
      - pg (PostgreSQL client)
      - openai (GPT API)
      - ws (WebSocket for Bybit)
- [ ] Setup environment variables (.env file)
- [ ] Configure logging (winston or similar)

Deliverable: Repo ready with all dependencies
Timeline: 2 hours
```

#### Day 2-3: Supabase Database Setup
```
Tasks:
- [ ] Create Supabase project
- [ ] Create tables (from Tech Spec):
      - trades
      - daily_stats
      - signals
      - users
      - pairs
- [ ] Setup indexes on frequently queried columns
- [ ] Setup connection pooling
- [ ] Test basic CRUD operations

Deliverable: Database with all tables populated
Timeline: 4 hours
```

#### Day 3-4: Bybit WebSocket Integration
```
Tasks:
- [ ] Create BybitDataProvider class
- [ ] Subscribe to 1h candles for 15 pairs
- [ ] Store candles in local cache (update every hour)
- [ ] Handle connection/reconnection logic
- [ ] Test data flow (log candles to console)

Deliverable: Real-time OHLCV data streaming
Timeline: 6 hours
Dependency: Project setup complete
```

#### Day 4-5: Technical Indicators Calculator
```
Tasks:
- [ ] Implement ATR calculation
- [ ] Implement RSI calculation
- [ ] Implement ROC calculation
- [ ] Implement MACD calculation
- [ ] Implement Bollinger Bands
- [ ] Unit test each indicator with sample data

Deliverable: All indicators working correctly
Timeline: 8 hours
Dependency: Bybit data available
```

### Week 2: Signal Detection & RM System

#### Day 6-7: Signal Detection Engine
```
Tasks:
- [ ] Implement momentum detection (impulse %)
- [ ] Implement retracement check (-1% from high)
- [ ] Implement volume spike detection (+25% above avg)
- [ ] Implement dynamic threshold (by ATR)
- [ ] Combine all conditions into entry rules
- [ ] Test on historical data (manual analysis)

Deliverable: Signal detection working on live data
Timeline: 10 hours
Dependency: Indicators working
```

#### Day 7-8: Risk Management System
```
Tasks:
- [ ] Implement position sizing calculator
- [ ] Implement dynamic leverage (by balance)
- [ ] Implement daily risk limiter
- [ ] Implement cool-off system (after losses)
- [ ] Implement RM validation (before opening)
- [ ] Add RM override confirmation

Deliverable: Full RM system functional
Timeline: 8 hours
Dependency: Database ready
```

#### Day 8-9: Signal Queue System
```
Tasks:
- [ ] Implement queue data structure
- [ ] Implement priority scoring (confidence, momentum, volume, history)
- [ ] Implement queue promotion (when position closes)
- [ ] Implement signal expiry (30 min validity)
- [ ] Implement max concurrent positions check (2-3)
- [ ] Test queue with multiple signals

Deliverable: Queue system working correctly
Timeline: 6 hours
Dependency: Signal detection + RM system
```

#### Day 9-10: Exit Logic & Monitoring
```
Tasks:
- [ ] Implement TP check (-1% from entry)
- [ ] Implement stop loss check (dynamic by ATR)
- [ ] Implement RSI exit (>75 + profit > $0.20)
- [ ] Implement timeout logic (1h soft, 1.5h hard)
- [ ] Implement position monitoring loop
- [ ] Log all exit reasons to database

Deliverable: Exit system fully functional
Timeline: 8 hours
Dependency: Position tracking, indicators
```

### Week 3: Telegram Bot & Analytics

#### Day 11-12: Telegram Bot Commands
```
Tasks:
- [ ] Setup Telegram bot (BotFather token)
- [ ] Implement /scan command (trigger signal detection)
- [ ] Implement /rm [size] command (RM calculator)
- [ ] Implement /status command (active positions)
- [ ] Implement /exit [price] command (close position)
- [ ] Implement /help command (command reference)
- [ ] Test all commands manually

Deliverable: All core commands working
Timeline: 10 hours
Dependency: All systems above ready
```

#### Day 12-13: Daily Statistics & Analytics
```
Tasks:
- [ ] Implement daily stats compilation (win rate, P&L, etc)
- [ ] Implement per-pair breakdown
- [ ] Implement profit factor calculation
- [ ] Implement RM violation tracking
- [ ] Implement cool-off trigger tracking
- [ ] Create stats card formatting (Telegram message)

Deliverable: /stats command working
Timeline: 6 hours
Dependency: Trade logging, database
```

#### Day 13-14: GPT Integration & Insights
```
Tasks:
- [ ] Setup OpenAI API client
- [ ] Create GPT prompt template for trade analysis
- [ ] Integrate GPT into /stats workflow
- [ ] Handle API errors gracefully
- [ ] Test GPT responses (quality check)
- [ ] Format insights into Telegram message

Deliverable: Full /stats with GPT insights
Timeline: 6 hours
Dependency: Daily stats working
```

#### Day 14-15: Error Handling & Edge Cases
```
Tasks:
- [ ] Add input validation for all commands
- [ ] Handle invalid prices (suspicious values)
- [ ] Handle position conflicts (max concurrent)
- [ ] Handle signal expiry gracefully
- [ ] Handle Bybit connection loss
- [ ] Handle OpenAI API failures
- [ ] Add error alerts to user

Deliverable: Robust error handling throughout
Timeline: 8 hours
Dependency: All systems complete
```

---

## 3. DEVELOPMENT DEPENDENCIES GRAPH

```
┌─────────────────────────────────────┐
│ Project Setup + Dependencies        │
│ (.env, npm packages)                │
└──────────────┬──────────────────────┘
               │
    ┌──────────┴─────────────┐
    │                        │
    ▼                        ▼
┌──────────────────┐  ┌──────────────────┐
│ Supabase Setup   │  │ Bybit WebSocket  │
│ (Database)       │  │ (Data Streaming) │
└──────────────────┘  └────────┬─────────┘
    │                          │
    │                          ▼
    │                ┌──────────────────┐
    │                │ Technical        │
    │                │ Indicators       │
    │                │ (ATR, RSI, etc)  │
    │                └────────┬─────────┘
    │                         │
    │                         ▼
    │                ┌──────────────────┐
    │                │ Signal Detection │
    │                │ Engine           │
    │                └────────┬─────────┘
    │                         │
    │       ┌─────────────────┴──────────────────┐
    │       │                                    │
    ▼       ▼                                    ▼
┌──────────────────┐              ┌──────────────────┐
│ Risk Management  │              │ Signal Queue     │
│ System           │              │ System           │
└────────┬─────────┘              └────────┬─────────┘
         │                                  │
         └──────────────┬───────────────────┘
                        │
                        ▼
            ┌──────────────────────┐
            │ Exit Logic &         │
            │ Position Monitoring  │
            └──────────┬───────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │ Telegram Bot Commands│
            │ (/scan, /rm, /exit)  │
            └──────────┬───────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
┌──────────────────┐       ┌──────────────────┐
│ Daily Stats &    │       │ GPT Integration  │
│ Analytics        │       │ & Insights       │
└──────────────────┘       └──────────────────┘
        │                         │
        └──────────────┬──────────┘
                       │
                       ▼
        ┌──────────────────────────┐
        │ Error Handling & Testing │
        └──────────────────────────┘
```

---

## 4. CRITICAL PATH (Minimum to MVP)

```
Week 1:
Day 1-2: Setup → Day 3-4: Database → Day 4-5: WebSocket
↓
Day 5-6: Indicators (depends on WebSocket)
↓
Week 2:
Day 6-7: Signal Detection (depends on Indicators)
↓
Day 8: Risk Management (depends on Database)
↓
Day 9: Queue System (depends on Signal Detection + RM)
↓
Day 10: Exit Logic (depends on Indicators + Queue)
↓
Week 3:
Day 11-12: Telegram Commands (depends on all above)
↓
Day 13: Daily Stats (depends on Telegram + Database)
↓
Day 14: GPT Integration (depends on Stats)
↓
Day 15: Error Handling (depends on all)

Total Critical Path: 15 working days (3 weeks)
```

---

## 5. RESOURCE REQUIREMENTS

### Development Team
- **1 Full-Stack Developer** (JavaScript/Node.js)
- **Time commitment:** 40 hours/week for 3 weeks

### External Services (Costs)
- **Supabase:** Free tier (PostgreSQL 500MB)
- **Railway:** $5-10/month (Node.js hosting)
- **Bybit API:** Free (read-only, no trading)
- **OpenAI GPT:** $3-4/month (estimated)
- **Telegram Bot API:** Free

**Total monthly cost:** $8-14

### Development Tools
- Git (version control)
- VSCode (IDE)
- Postman (API testing)
- Node.js 18+ (runtime)

---

## 6. TESTING STRATEGY

### Unit Tests (Priority: HIGH)
```
- [ ] Indicator calculations (ATR, RSI, MACD)
- [ ] Signal detection logic
- [ ] P&L calculation (with commissions)
- [ ] Position sizing algorithm
- [ ] Queue promotion logic
```

### Integration Tests (Priority: HIGH)
```
- [ ] /scan → Signal generation → Queue management
- [ ] /rm → RM calculation → Validation
- [ ] /exit → Position close → Daily stats update
- [ ] Cool-off trigger → Position blocking
- [ ] Daily reset (08:00 Seoul Time)
```

### Manual Testing (Priority: MEDIUM)
```
- [ ] Telegram commands (all variants)
- [ ] Message formatting (readable, no emojis broken)
- [ ] Historical data analysis (backtest on 28-31 Mar)
- [ ] Edge cases (invalid inputs, network failures)
```

### Performance Testing (Priority: LOW)
```
- [ ] Signal detection < 5 seconds
- [ ] Telegram response < 2 seconds
- [ ] Database query < 1 second
```

---

## 7. DEPLOYMENT CHECKLIST

### Pre-Launch
- [ ] All unit tests passing (100%)
- [ ] All integration tests passing
- [ ] Code reviewed (self-review at minimum)
- [ ] Environment variables set (.env configured)
- [ ] Database backups configured
- [ ] Error logging configured (Sentry or similar)
- [ ] Telegram bot webhook/polling working
- [ ] Bybit API credentials validated
- [ ] OpenAI API key validated
- [ ] Rate limiting configured (Telegram API limits)

### Launch Day
- [ ] Deploy to Railway
- [ ] Test all commands live with small account
- [ ] Monitor logs for 24 hours
- [ ] Have rollback plan ready

### Post-Launch
- [ ] Monitor bot performance daily
- [ ] Fix any critical bugs immediately
- [ ] Collect user feedback
- [ ] Plan Phase 2 improvements

---

## 8. GITHUB STRUCTURE

```
scalparena/
├── src/
│   ├── bot/
│   │   ├── commands/
│   │   │   ├── scanCommand.js
│   │   │   ├── rmCommand.js
│   │   │   ├── exitCommand.js
│   │   │   ├── statusCommand.js
│   │   │   ├── statsCommand.js
│   │   │   └── helpCommand.js
│   │   ├── handlers/
│   │   │   ├── messageHandler.js
│   │   │   ├── callbackHandler.js
│   │   │   └── errorHandler.js
│   │   └── bot.js
│   ├── engine/
│   │   ├── signalDetector.js
│   │   ├── indicators.js
│   │   ├── riskManager.js
│   │   ├── positionMonitor.js
│   │   └── exitLogic.js
│   ├── queue/
│   │   └── signalQueue.js
│   ├── data/
│   │   ├── bybitProvider.js
│   │   ├── supabaseClient.js
│   │   └── cache.js
│   ├── analytics/
│   │   ├── stats.js
│   │   └── gptAnalyzer.js
│   └── index.js (entry point)
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── deployment/
    ├── Procfile (Railway)
    └── vercelconfig.json
```

---

## 9. TIMELINE SUMMARY

```
Week 1 (Days 1-5): Foundation
  • Project setup, Database, WebSocket, Indicators → 26 hours

Week 2 (Days 6-10): Core Logic
  • Signals, RM, Queue, Exit → 32 hours

Week 3 (Days 11-15): Bot & Polish
  • Telegram, Stats, GPT, Error handling → 30 hours

TOTAL: ~88 hours (Full-time dev: 2.2 weeks)
```

---

## 10. RISK MITIGATION

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Bybit API changes | HIGH | Subscribe to Bybit changelog, have fallback data source |
| OpenAI API costs | LOW | Monitor usage, set rate limits, cache responses |
| Database connection loss | HIGH | Implement reconnection logic, failover to cache |
| Telegram rate limits | MEDIUM | Implement request queuing, batch messages |
| Signal false positives | MEDIUM | Backtest on historical data before launch |
| RM calculation errors | CRITICAL | Unit test extensively, add manual validation |

---

## 11. SUCCESS CRITERIA

**MVP Launch Criteria:**
- ✅ All 6 commands working without errors
- ✅ Signal detection accuracy > 85% (vs manual analysis)
- ✅ Daily stats calculated correctly
- ✅ No lost trades or corrupted data
- ✅ Bot responds < 2 seconds to commands
- ✅ Uptime > 99% (excluding scheduled maintenance)

**Phase 1 Complete When:**
- 10+ trading days of successful operation
- Win rate tracking accurately
- GPT insights generating useful recommendations
- Zero critical bugs

---

## 12. NEXT PHASE (Phase 2: Semi-Automation)

**What to add:**
- Auto order placement on Bybit (user confirms before actual order)
- Real-time position monitoring with auto-updates
- Automatic position closing (TP/SL execution)
- Advanced strategy parameters (adjustable thresholds)

**Estimated additional time:** 3-4 weeks

---

**END OF DOCUMENT**
