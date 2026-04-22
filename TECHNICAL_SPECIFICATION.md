# TECHNICAL SPECIFICATION
## ScalpArena - Telegram Bot для Scalp Trading

**Версия:** 1.0  
**Дата:** April 2026  
**Статус:** Ready for Development (Phase 1)

---

## TABLE OF CONTENTS

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Core Algorithms](#core-algorithms)
4. [Database Schema](#database-schema)
5. [API Integration](#api-integration)
6. [Signal Detection Engine](#signal-detection-engine)
7. [Exit Logic](#exit-logic)
8. [Risk Management System](#risk-management-system)
9. [Queue Management](#queue-management)
10. [Data Models](#data-models)
11. [Error Handling](#error-handling)
12. [Performance & Scalability](#performance--scalability)

---

## 1. SYSTEM OVERVIEW

### 1.1 Purpose
ScalpArena - это Telegram bot для скальп-торговли на криптовалютах с использованием Dynamic Momentum Scalping стратегии на 1-часовых свечах.

### 1.2 Key Features
- Real-time анализ 15 криптовалютных пар
- Автоматическое обнаружение сигналов на основе импульса + volume + технических индикаторов
- Жёсткая система управления рисками (Risk Management)
- Дневная статистика с GPT анализом
- Queue система для управления множественными сигналами
- Динамический размер позиции и плечо
- Фиксированный Take Profit (-1%) для дисциплины

### 1.3 Phase 1 Scope (Текущая фаза)
- Ручное открытие позиций на Bybit (бот только генерирует сигналы)
- Ручное логирование сделок через Telegram команды
- Telegram bot интерфейс
- Supabase для хранения истории
- OpenAI GPT для анализа сделок в конце дня

---

## 2. ARCHITECTURE

### 2.1 High-Level System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    TELEGRAM BOT                          │
│  (Node.js + node-telegram-bot-api)                      │
├─────────────────────────────────────────────────────────┤
│  Commands:                                              │
│  • /scan - Trigger signal scan                          │
│  • /status - Check active positions                     │
│  • /rm [size] - RM calculator                          │
│  • /log_trade - Manual trade logging                    │
│  • /exit [price] - Close position                       │
│  • /stats - Daily statistics                           │
│  • /help - Command help                                │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│              BACKEND (Node.js + Express)                │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  SIGNAL DETECTION ENGINE                         │  │
│  │  ├─ OHLCV Data Fetcher (Bybit WebSocket)        │  │
│  │  ├─ Technical Indicators Calculator              │  │
│  │  │  ├─ ATR (volatility)                         │  │
│  │  │  ├─ RSI (overbought/oversold)                │  │
│  │  │  ├─ ROC (rate of change)                     │  │
│  │  │  ├─ Volume Profile                          │  │
│  │  │  ├─ MACD (trend)                            │  │
│  │  │  └─ Bollinger Bands                         │  │
│  │  ├─ Entry Rules Validator                       │  │
│  │  └─ Signal Scorer & Prioritizer                 │  │
│  └──────────────────────────────────────────────────┘  │
│                          │                              │
│  ┌──────────────────────▼──────────────────────────┐  │
│  │  QUEUE MANAGER                                   │  │
│  │  ├─ Signal Queue (max 2-3 concurrent)           │  │
│  │  ├─ Priority Scoring                            │  │
│  │  ├─ Validity Check (30 min max)                 │  │
│  │  └─ Duplicate Prevention                        │  │
│  └──────────────────────────────────────────────────┘  │
│                          │                              │
│  ┌──────────────────────▼──────────────────────────┐  │
│  │  RISK MANAGEMENT SYSTEM                          │  │
│  │  ├─ Per-Trade Risk Calculator                   │  │
│  │  ├─ Daily Risk Limiter                          │  │
│  │  ├─ Position Sizing Engine                      │  │
│  │  ├─ Cool-off System                             │  │
│  │  └─ Stop Loss / Take Profit Manager             │  │
│  └──────────────────────────────────────────────────┘  │
│                          │                              │
│  ┌──────────────────────▼──────────────────────────┐  │
│  │  TRADE JOURNAL & ANALYTICS                       │  │
│  │  ├─ Trade Logger                                │  │
│  │  ├─ Daily Statistics Calculator                 │  │
│  │  ├─ Win Rate / Profit Factor                    │  │
│  │  └─ GPT Insights Generator                      │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
└────────────┬────────────────────────────────────────────┘
             │
    ┌────────┴────────┬──────────────┬──────────────┐
    │                 │              │              │
    ▼                 ▼              ▼              ▼
┌─────────┐      ┌──────────┐  ┌──────────┐   ┌──────────┐
│  Bybit  │      │ Supabase │  │ OpenAI   │   │ Railway  │
│  API    │      │PostgreSQL│  │  GPT API │   │Deployment│
└─────────┘      └──────────┘  └──────────┘   └──────────┘
```

### 2.2 Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Telegram Bot API | User interface |
| **Backend** | Node.js 18+ | Core logic |
| **Framework** | Express.js 4.x | API routing |
| **Database** | Supabase (PostgreSQL) | Trade history, statistics |
| **Real-time Data** | Bybit WebSocket | OHLCV feeds |
| **AI Analysis** | OpenAI GPT-4o | Trade insights |
| **Hosting** | Railway | Server deployment |
| **Language** | JavaScript/TypeScript | Implementation |

### 2.3 Deployment Architecture

```
┌──────────────────────────────────────────────┐
│         Railway (Node.js Server)             │
│  ├─ Express.js API                           │
│  ├─ Signal Detection Engine                  │
│  └─ Telegram Bot Handler                     │
└──────────────────────────────────────────────┘
         │         │         │
         ▼         ▼         ▼
    ┌────────┬─────────┬──────────┐
    │ Bybit  │Supabase │ OpenAI   │
    │WebSocket│ PostgreSQL│API    │
    └────────┴─────────┴──────────┘
```

---

## 3. CORE ALGORITHMS

### 3.1 Dynamic Momentum Scalping Strategy

#### Entry Logic

```javascript
// Pseudo-code for signal detection

function detectSignal(pair) {
  const currentCandle = getLatestHourlyCandle(pair);
  const hourOpen = currentCandle.open;
  const hourHigh = currentCandle.high;
  const currentPrice = currentCandle.close;
  
  // Step 1: Calculate momentum
  const momentum = ((currentPrice - hourOpen) / hourOpen) * 100;
  
  // Step 2: Dynamic threshold based on volatility
  const atr = calculateATR(pair, 14);
  let threshold;
  if (atr < 2) threshold = 3;      // Low volatility
  else if (atr < 5) threshold = 5;  // Medium volatility
  else if (atr < 10) threshold = 8; // High volatility
  else threshold = 12;               // Very high volatility
  
  // Step 3: Check momentum exceeds threshold
  if (Math.abs(momentum) < threshold) {
    return null; // No signal
  }
  
  // Step 4: Check for retracement from high
  const retrace = ((hourHigh - currentPrice) / hourHigh) * 100;
  
  // Option A: Retracement of -1% from high
  if (retrace < 1.0) {
    return null; // No retracement yet
  }
  
  // Option B: OR High RSI (>75)
  const rsi = calculateRSI(pair, 14);
  if (rsi > 75) {
    // Valid alternative entry
  } else if (retrace < 1.0) {
    return null; // Neither condition met
  }
  
  // Step 5: Volume confirmation
  const avgVolume = getAverageVolume(pair, 20);
  const volumeSpike = (currentCandle.volume / avgVolume) * 100;
  
  if (volumeSpike < 120) { // Volume should be 20%+ above average
    return null; // No volume confirmation
  }
  
  // Step 6: Additional confirmations (MACD, etc)
  const macd = calculateMACD(pair);
  if (macd.signal < 0 && momentum > 0) {
    // For shorts: momentum up but MACD still negative (valid)
  }
  
  // All conditions met
  return {
    pair: pair,
    type: 'SHORT',
    entryPrice: currentPrice,
    momentum: momentum,
    rsi: rsi,
    volumeSpike: volumeSpike,
    confidence: calculateConfidence(momentum, rsi, volumeSpike),
    timestamp: new Date()
  };
}

function calculateConfidence(momentum, rsi, volumeSpike) {
  let confidence = 50; // Base 50%
  
  // Momentum contribution (0-20%)
  confidence += (Math.abs(momentum) / 20) * 20;
  
  // RSI contribution (0-15%)
  if (rsi > 70) confidence += 15;
  else if (rsi > 65) confidence += 10;
  else if (rsi > 60) confidence += 5;
  
  // Volume contribution (0-15%)
  confidence += ((volumeSpike - 100) / 50) * 15;
  
  return Math.min(confidence, 100);
}
```

#### Dynamic Threshold Table

| ATR Range | Threshold | Rationale |
|-----------|-----------|-----------|
| < 2% | +3-5% | Low vol → lower threshold |
| 2-5% | +5-8% | Medium vol → normal |
| 5-10% | +8-15% | High vol → higher threshold |
| > 10% | +12-20% | Extreme vol → much higher |

---

## 4. DATABASE SCHEMA

### 4.1 Supabase Tables

#### Table: `trades`
```sql
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL,
  
  -- Trade Details
  pair VARCHAR(20) NOT NULL,
  trade_type VARCHAR(10) CHECK (trade_type IN ('SHORT', 'LONG')),
  
  -- Entry Details
  entry_price DECIMAL(20, 8) NOT NULL,
  entry_time TIMESTAMP NOT NULL,
  entry_size DECIMAL(20, 8) NOT NULL,
  leverage DECIMAL(5, 2) NOT NULL,
  
  -- Exit Details
  exit_price DECIMAL(20, 8),
  exit_time TIMESTAMP,
  exit_reason VARCHAR(50) CHECK (exit_reason IN (
    'TP_HIT', 'STOP_HIT', 'RSI_EXIT', 'TIMEOUT_1H', 'TIMEOUT_HARD', 'MANUAL'
  )),
  
  -- P&L Calculation
  profit_loss DECIMAL(20, 8),
  pnl_percentage DECIMAL(10, 4),
  
  -- Risk Management
  stop_loss DECIMAL(20, 8) NOT NULL,
  take_profit DECIMAL(20, 8) NOT NULL,
  max_risk DECIMAL(20, 8) NOT NULL,
  
  -- Indicators at Entry
  momentum_percentage DECIMAL(10, 4),
  rsi_at_entry DECIMAL(5, 2),
  volume_spike_percentage DECIMAL(10, 2),
  confidence_score DECIMAL(5, 2),
  
  -- Status
  status VARCHAR(20) CHECK (status IN ('OPEN', 'CLOSED', 'PENDING')),
  
  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

CREATE INDEX idx_trades_user_date ON trades(user_id, created_at DESC);
CREATE INDEX idx_trades_pair_status ON trades(pair, status);
```

#### Table: `daily_stats`
```sql
CREATE TABLE daily_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL,
  
  -- Date
  trade_date DATE NOT NULL,
  
  -- Statistics
  total_trades INT DEFAULT 0,
  winning_trades INT DEFAULT 0,
  losing_trades INT DEFAULT 0,
  win_rate DECIMAL(5, 2),
  
  -- P&L
  total_pnl DECIMAL(20, 8),
  avg_win DECIMAL(20, 8),
  avg_loss DECIMAL(20, 8),
  profit_factor DECIMAL(10, 4),
  
  -- Risk
  daily_risk_used DECIMAL(20, 8),
  daily_risk_limit DECIMAL(20, 8),
  rm_violations INT DEFAULT 0,
  cooloff_triggers INT DEFAULT 0,
  
  -- Balance
  starting_balance DECIMAL(20, 8),
  ending_balance DECIMAL(20, 8),
  
  -- Signals
  signals_generated INT DEFAULT 0,
  signals_executed INT DEFAULT 0,
  signals_skipped INT DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(user_id, trade_date),
  FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);
```

#### Table: `signals`
```sql
CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL,
  
  -- Signal Details
  pair VARCHAR(20) NOT NULL,
  signal_type VARCHAR(10) CHECK (signal_type IN ('SHORT', 'LONG')),
  
  -- Technical Data
  entry_price DECIMAL(20, 8) NOT NULL,
  momentum_percentage DECIMAL(10, 4),
  rsi DECIMAL(5, 2),
  volume_spike DECIMAL(10, 2),
  atr DECIMAL(20, 8),
  
  -- Calculated Parameters
  stop_loss DECIMAL(20, 8) NOT NULL,
  take_profit DECIMAL(20, 8) NOT NULL,
  max_risk DECIMAL(20, 8) NOT NULL,
  confidence_score DECIMAL(5, 2),
  
  -- Queue Status
  queue_position INT,
  priority_score DECIMAL(10, 2),
  status VARCHAR(20) CHECK (status IN (
    'ACTIVE', 'QUEUED', 'EXECUTED', 'EXPIRED', 'SKIPPED'
  )),
  
  -- Timing
  generated_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL, -- 30 min validity
  executed_at TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(telegram_id),
  FOREIGN KEY (pair) REFERENCES pairs(name)
);

CREATE INDEX idx_signals_user_status ON signals(user_id, status);
CREATE INDEX idx_signals_pair_active ON signals(pair, status) WHERE status = 'ACTIVE';
```

#### Table: `users`
```sql
CREATE TABLE users (
  telegram_id VARCHAR(255) PRIMARY KEY,
  
  -- User Settings
  username VARCHAR(255),
  
  -- Account Settings
  account_balance DECIMAL(20, 8) NOT NULL DEFAULT 200,
  daily_risk_percentage DECIMAL(5, 2) DEFAULT 5,
  risk_per_trade_percentage DECIMAL(5, 2) DEFAULT 2,
  max_concurrent_positions INT DEFAULT 2,
  
  -- Strategy Settings
  tp_percentage DECIMAL(5, 2) DEFAULT 1.0, -- Always -1%
  leverage INT DEFAULT 10,
  
  -- Feature Flags
  demo_mode BOOLEAN DEFAULT FALSE,
  auto_scan_enabled BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  timezone VARCHAR(50) DEFAULT 'Asia/Seoul'
);
```

#### Table: `pairs`
```sql
CREATE TABLE pairs (
  name VARCHAR(20) PRIMARY KEY,
  
  -- Pair Info
  display_name VARCHAR(50),
  exchange VARCHAR(50) DEFAULT 'BYBIT',
  symbol VARCHAR(50), -- SOLUSDT
  
  -- Current Stats
  current_price DECIMAL(20, 8),
  atr_14 DECIMAL(20, 8),
  rsi_14 DECIMAL(5, 2),
  
  -- Historical
  win_rate DECIMAL(5, 2),
  total_trades_all_users INT DEFAULT 0,
  
  -- Settings
  enabled BOOLEAN DEFAULT TRUE,
  min_volume_usd DECIMAL(20, 2) DEFAULT 100000,
  
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. API INTEGRATION

### 5.1 Bybit WebSocket Integration

#### Connection & Data Fetching

```javascript
const WebSocket = require('ws');

class BybitDataProvider {
  constructor() {
    this.ws = null;
    this.subscriptions = new Map(); // pair -> callback functions
    this.candleBuffer = {}; // Store current candle data
  }
  
  connect() {
    // Use testnet for Phase 1
    this.ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
    
    this.ws.on('open', () => {
      console.log('Bybit WebSocket connected');
      this.subscribeToCandles();
    });
    
    this.ws.on('message', (data) => {
      this.handleMessage(JSON.parse(data));
    });
    
    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  }
  
  subscribeToCandles() {
    const pairs = ['SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'ETUSDT',
                   'OPUSDT', 'ARBUSDT', 'NEARUSDT', 'RENDER', 'PEPEUSDT',
                   'SHIBUSDT', 'JUPUSDT', 'WIFUSDT', 'BTCUSDT', 'TRUMPUSDT'];
    
    const subscription = {
      op: 'subscribe',
      args: pairs.map(p => `candle.1h.${p}`) // 1 hour candles
    };
    
    this.ws.send(JSON.stringify(subscription));
  }
  
  handleMessage(message) {
    if (message.topic && message.topic.includes('candle.1h')) {
      const pair = extractPairFromTopic(message.topic);
      const candle = {
        open: parseFloat(message.data[0][1]),
        high: parseFloat(message.data[0][2]),
        low: parseFloat(message.data[0][3]),
        close: parseFloat(message.data[0][4]),
        volume: parseFloat(message.data[0][5]),
        timestamp: parseInt(message.data[0][0])
      };
      
      this.candleBuffer[pair] = candle;
      
      // Trigger callbacks
      if (this.subscriptions.has(pair)) {
        this.subscriptions.get(pair).forEach(cb => cb(candle));
      }
    }
  }
  
  onCandleUpdate(pair, callback) {
    if (!this.subscriptions.has(pair)) {
      this.subscriptions.set(pair, []);
    }
    this.subscriptions.get(pair).push(callback);
  }
  
  getLatestCandle(pair) {
    return this.candleBuffer[pair];
  }
}
```

### 5.2 OpenAI Integration

```javascript
const { OpenAI } = require('openai');

class InsightAnalyzer {
  constructor(apiKey) {
    this.client = new OpenAI({ apiKey });
  }
  
  async generateDailyInsights(trades, stats) {
    const tradesInfo = trades.map(t => ({
      pair: t.pair,
      entry: t.entry_price,
      exit: t.exit_price,
      pnl: t.profit_loss,
      duration: (t.exit_time - t.entry_time) / 60, // minutes
      exitReason: t.exit_reason
    }));
    
    const prompt = `
    You are a professional crypto scalp trading analyst. Analyze this trading day:
    
    Stats:
    - Total trades: ${stats.total_trades}
    - Win rate: ${stats.win_rate}%
    - Total P&L: $${stats.total_pnl}
    - Avg Win: $${stats.avg_win}
    - Avg Loss: $${stats.avg_loss}
    - Profit Factor: ${stats.profit_factor}
    
    Sample Trades:
    ${JSON.stringify(tradesInfo.slice(0, 5), null, 2)}
    
    Provide:
    1. Assessment of trading performance
    2. Patterns observed (what worked, what didn't)
    3. One specific recommendation for improvement
    
    Keep response concise (3-5 sentences max). Write in Russian.
    `;
    
    const response = await this.client.messages.create({
      model: 'gpt-4o',
      max_tokens: 300,
      messages: [
        { role: 'user', content: prompt }
      ]
    });
    
    return response.content[0].text;
  }
}
```

---

## 6. SIGNAL DETECTION ENGINE

### 6.1 Technical Indicators Calculator

```javascript
class TechnicalIndicators {
  // ATR (Average True Range)
  static calculateATR(candles, period = 14) {
    const trueRanges = [];
    
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trueRanges.push(tr);
    }
    
    const atr = trueRanges.slice(-period)
      .reduce((a, b) => a + b, 0) / period;
    
    return atr;
  }
  
  // RSI (Relative Strength Index)
  static calculateRSI(prices, period = 14) {
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }
    
    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? -c : 0);
    
    const avgGain = gains.slice(-period).reduce((a, b) => a + b) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b) / period;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return rsi;
  }
  
  // ROC (Rate of Change)
  static calculateROC(prices, period = 12) {
    const current = prices[prices.length - 1];
    const previous = prices[prices.length - 1 - period];
    
    return ((current - previous) / previous) * 100;
  }
  
  // MACD (Moving Average Convergence Divergence)
  static calculateMACD(prices) {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    
    const macdLine = ema12 - ema26;
    const signalLine = this.calculateEMA(
      [macdLine],
      9
    );
    
    return {
      macd: macdLine,
      signal: signalLine,
      histogram: macdLine - signalLine
    };
  }
  
  // Helper: EMA (Exponential Moving Average)
  static calculateEMA(prices, period) {
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
    
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }
}
```

### 6.2 Signal Scorer

```javascript
class SignalScorer {
  static calculateScore(signal) {
    let score = 0;
    
    // Confidence contribution (40%)
    const confidence = signal.confidence_score;
    score += (confidence / 100) * 40;
    
    // Momentum contribution (30%)
    const momentum = Math.min(signal.momentum_percentage / 20, 1);
    score += momentum * 30;
    
    // Volume contribution (20%)
    const volumeSpike = Math.min((signal.volume_spike - 100) / 100, 1);
    score += Math.max(volumeSpike, 0) * 20;
    
    // Historical win rate contribution (10%)
    const pairWinRate = signal.pair_historical_wr || 0.5;
    score += (pairWinRate / 100) * 10;
    
    return Math.min(score, 100);
  }
}
```

---

## 7. EXIT LOGIC

### 7.1 Exit Trigger System

```javascript
class ExitTriggerManager {
  static evaluateExit(position, currentCandle) {
    const checks = [
      this.checkTPHit(position, currentCandle),
      this.checkStopHit(position, currentCandle),
      this.checkRSIExit(position, currentCandle),
      this.checkTimeout(position),
      this.checkHardTimeout(position)
    ];
    
    // Return first triggered exit
    return checks.find(c => c !== null);
  }
  
  static checkTPHit(position, currentCandle) {
    if (position.type === 'SHORT') {
      if (currentCandle.close <= position.take_profit) {
        return {
          triggered: true,
          reason: 'TP_HIT',
          exitPrice: position.take_profit,
          priority: 1
        };
      }
    }
    return null;
  }
  
  static checkStopHit(position, currentCandle) {
    if (position.type === 'SHORT') {
      if (currentCandle.close >= position.stop_loss) {
        return {
          triggered: true,
          reason: 'STOP_HIT',
          exitPrice: position.stop_loss,
          priority: 2
        };
      }
    }
    return null;
  }
  
  static checkRSIExit(position, currentCandle) {
    const rsi = TechnicalIndicators.calculateRSI(
      getCurrentPriceHistory(position.pair, 14)
    );
    
    if (position.type === 'SHORT' && rsi > 75) {
      const profitUSD = (position.entry_price - currentCandle.close) * 
                        (position.size * position.leverage);
      
      // Only exit if there's profit > $0.20
      if (profitUSD > 0.20) {
        return {
          triggered: true,
          reason: 'RSI_EXIT',
          exitPrice: currentCandle.close,
          priority: 3
        };
      }
    }
    return null;
  }
  
  static checkTimeout(position) {
    const hoursHeld = (Date.now() - position.entry_time) / (1000 * 60 * 60);
    
    if (hoursHeld >= 1.0) {
      return {
        triggered: true,
        reason: 'TIMEOUT_1H',
        exitPrice: null, // Use current market price
        priority: 4
      };
    }
    return null;
  }
  
  static checkHardTimeout(position) {
    const hoursHeld = (Date.now() - position.entry_time) / (1000 * 60 * 60);
    
    if (hoursHeld >= 1.5) {
      return {
        triggered: true,
        reason: 'TIMEOUT_HARD',
        exitPrice: null, // Force close at market
        priority: 5
      };
    }
    return null;
  }
}
```

---

## 8. RISK MANAGEMENT SYSTEM

### 8.1 Position Sizing

```javascript
class RiskManager {
  static calculatePositionSize(balance, riskPerTrade = 0.02) {
    const maxRiskDollars = balance * riskPerTrade;
    const leverage = this.calculateLeverage(balance);
    
    // Position size = max risk / (stop loss % * leverage)
    const stopLossPercent = this.getDynamicStopLoss();
    const positionSize = maxRiskDollars / (stopLossPercent * leverage);
    
    return {
      size: positionSize,
      leverage: leverage,
      maxRisk: maxRiskDollars,
      stopLossPercent: stopLossPercent
    };
  }
  
  static calculateLeverage(balance) {
    if (balance < 500) return 10;      // $200-500: 10x
    else if (balance < 1000) return 5; // $500-1000: 5x
    else return 2;                      // $1000+: 2x
  }
  
  static getDynamicStopLoss() {
    const atr = getAverageATRForAllPairs();
    
    if (atr < 2) return 0.005;        // 0.5%
    else if (atr < 5) return 0.0075;  // 0.75%
    else return 0.01;                  // 1%
  }
  
  static validateDailyRisk(userStats, newRisk, dailyLimit = 0.05) {
    const balance = userStats.starting_balance;
    const dailyRiskLimit = balance * dailyLimit;
    const alreadyUsed = userStats.daily_risk_used;
    
    return (alreadyUsed + newRisk) <= dailyRiskLimit;
  }
  
  static shouldTriggerCooloff(userStats) {
    const recentTrades = userStats.recent_trades.slice(-3);
    const losingTradeCount = recentTrades.filter(t => t.profit_loss < 0).length;
    
    if (losingTradeCount >= 2) {
      return {
        triggered: true,
        duration: losingTradeCount === 2 ? 30 : 60, // minutes
        reason: losingTradeCount === 2 ? '2_losses' : '3_losses'
      };
    }
    
    return { triggered: false };
  }
}
```

### 8.2 Daily Risk Limiter

```javascript
class DailyRiskLimiter {
  static getRemainingDailyRisk(userStats) {
    const balance = userStats.starting_balance;
    const dailyLimit = balance * 0.05; // 5% daily max
    
    return dailyLimit - userStats.daily_risk_used;
  }
  
  static canOpenPosition(userStats, requiredRisk) {
    const remaining = this.getRemainingDailyRisk(userStats);
    return remaining >= requiredRisk;
  }
  
  static resetDailyStats(userId) {
    // Called at 8 AM Seoul Time
    const now = new Date();
    if (isSeoulMorning8AM(now)) {
      // Reset daily_risk_used, daily_trades, etc
      updateUserDailyStats(userId, {
        daily_risk_used: 0,
        trades_today: 0
      });
    }
  }
}
```

---

## 9. QUEUE MANAGEMENT

### 9.1 Signal Queue System

```javascript
class SignalQueue {
  constructor(maxConcurrent = 2) {
    this.queue = [];
    this.active = new Map(); // pair -> signal
    this.maxConcurrent = maxConcurrent;
  }
  
  addSignal(signal) {
    // Check if pair already has active position
    if (this.active.has(signal.pair)) {
      signal.status = 'QUEUED';
      signal.queue_position = this.queue.length + 1;
      signal.expires_at = new Date(Date.now() + 30 * 60 * 1000); // 30 min validity
      
      this.queue.push(signal);
      return { queued: true, position: signal.queue_position };
    }
    
    // Can open immediately
    if (this.active.size < this.maxConcurrent) {
      signal.status = 'ACTIVE';
      this.active.set(signal.pair, signal);
      
      return { queued: false, opened: true };
    }
    
    // Queue if at max capacity
    signal.status = 'QUEUED';
    signal.queue_position = this.queue.length + 1;
    signal.expires_at = new Date(Date.now() + 30 * 60 * 1000);
    
    this.queue.push(signal);
    return { queued: true, position: signal.queue_position };
  }
  
  closePosition(pair) {
    this.active.delete(pair);
    
    // Promote from queue
    if (this.queue.length > 0) {
      const nextSignal = this.queue.shift();
      
      // Check validity
      if (nextSignal.expires_at > new Date()) {
        nextSignal.status = 'ACTIVE';
        this.active.set(nextSignal.pair, nextSignal);
        
        return {
          promoted: true,
          signal: nextSignal
        };
      } else {
        return {
          promoted: false,
          reason: 'EXPIRED'
        };
      }
    }
    
    return { promoted: false };
  }
  
  getQueueStats() {
    return {
      active_count: this.active.size,
      queued_count: this.queue.length,
      max_concurrent: this.maxConcurrent,
      can_open_new: this.active.size < this.maxConcurrent
    };
  }
}
```

---

## 10. DATA MODELS

### 10.1 TypeScript Interfaces

```typescript
interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

interface Signal {
  id: string;
  pair: string;
  type: 'SHORT' | 'LONG';
  entryPrice: number;
  momentum: number;
  rsi: number;
  volumeSpike: number;
  confidence: number;
  stopLoss: number;
  takeProfit: number;
  maxRisk: number;
  status: 'ACTIVE' | 'QUEUED' | 'EXECUTED' | 'EXPIRED' | 'SKIPPED';
  queuePosition?: number;
  generatedAt: Date;
  expiresAt: Date;
}

interface Position {
  id: string;
  signal: Signal;
  userId: string;
  
  entryPrice: number;
  entryTime: Date;
  size: number;
  leverage: number;
  
  currentPrice?: number;
  currentPnL?: number;
  
  stopLoss: number;
  takeProfit: number;
  maxRisk: number;
  
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
}

interface Trade {
  id: string;
  position: Position;
  
  exitPrice: number;
  exitTime: Date;
  exitReason: 'TP_HIT' | 'STOP_HIT' | 'RSI_EXIT' | 'TIMEOUT_1H' | 'TIMEOUT_HARD' | 'MANUAL';
  
  profitLoss: number;
  profitLossPercent: number;
  
  commissionFee: number;
  fundingCost: number;
  
  netPnL: number; // P&L minus fees
}

interface DailyStats {
  userId: string;
  date: Date;
  
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // percentage
  
  totalPnL: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number; // avgWin / avgLoss
  
  dailyRiskUsed: number;
  dailyRiskLimit: number;
  rmViolations: number;
  cooloffTriggered: boolean;
}
```

---

## 11. ERROR HANDLING

### 11.1 Error Classification

```javascript
const ErrorTypes = {
  // API Errors
  BYBIT_CONNECTION_ERROR: 'Connection to Bybit failed',
  BYBIT_INVALID_DATA: 'Invalid data from Bybit',
  OPENAI_API_ERROR: 'OpenAI API call failed',
  
  // Database Errors
  DB_CONNECTION_ERROR: 'Database connection lost',
  DB_QUERY_ERROR: 'Database query failed',
  
  // Logic Errors
  INSUFFICIENT_BALANCE: 'Insufficient balance for position',
  INVALID_POSITION_SIZE: 'Position size calculation failed',
  SIGNAL_EXPIRED: 'Signal has expired (30 min max)',
  
  // Risk Errors
  DAILY_LIMIT_EXCEEDED: 'Daily risk limit exceeded',
  RM_VIOLATION: 'Risk management rule violated',
  MAX_POSITIONS_EXCEEDED: 'Maximum concurrent positions exceeded',
  
  // Telegram Errors
  TELEGRAM_MESSAGE_FAILED: 'Failed to send Telegram message',
  COMMAND_INVALID_PARAMS: 'Command parameters invalid'
};

class ErrorHandler {
  static handle(error, context) {
    console.error(`[${context}] ${error.message}`);
    
    // Log to database for monitoring
    logError({
      type: error.type || 'UNKNOWN',
      message: error.message,
      context: context,
      timestamp: new Date(),
      userId: context.userId
    });
    
    // Notify user if critical
    if (this.isCritical(error)) {
      notifyUserTelegram(context.userId, `⚠️ Error: ${error.message}`);
    }
  }
  
  static isCritical(error) {
    return ['DAILY_LIMIT_EXCEEDED', 'DB_CONNECTION_ERROR'].includes(error.type);
  }
}
```

---

## 12. PERFORMANCE & SCALABILITY

### 12.1 Optimization Strategies

- **Caching**: Cache OHLCV data locally to reduce API calls
- **Batch Processing**: Process multiple signals in batch for efficiency
- **Database Indexing**: Strategic indexes on frequently queried columns
- **Connection Pooling**: Reuse database connections
- **Async/Await**: Non-blocking operations throughout

### 12.2 Monitoring & Metrics

```javascript
class Metrics {
  static track(name, value) {
    // Send to monitoring service
    // Examples:
    // - signal_detection_time
    // - queue_processing_time
    // - database_query_time
    // - telegram_response_time
    // - open_positions_count
    // - daily_signals_count
  }
}
```

### 12.3 Load Testing Requirements

- Handle 15 simultaneous WebSocket streams
- Process 20+ signals per day
- Store and query 1000+ trades per user per month
- Support multiple concurrent users

---

## DEPLOYMENT CHECKLIST

- [ ] Environment variables configured (.env)
- [ ] Database migrations run
- [ ] Bybit WebSocket subscriptions active
- [ ] OpenAI API key validated
- [ ] Telegram bot token registered
- [ ] Error logging configured
- [ ] Monitoring dashboards set up
- [ ] Backup strategy implemented
- [ ] Security audit completed

---

## APPENDIX A: CALCULATION EXAMPLES

### A.1 Position Sizing Example

```
Balance: $200
Risk per trade: 2%
Leverage: 10x
ATR: 2.1% (low volatility)
Stop Loss: 0.5% (dynamic)

Position Size = (Balance × Risk%) / (SL% × Leverage)
             = ($200 × 0.02) / (0.005 × 10)
             = $4 / $0.05
             = $80 on exchange (but with 10x leverage = $8 actual)
             
In practice: $10 position size
Max Risk: $4
```

### A.2 P&L Calculation Example

```
Entry: $92.50 (SHORT)
Exit: $91.57 (TP hit)
Size: $10
Leverage: 10x

Gross Profit = (Entry - Exit) × Size × Leverage
            = ($92.50 - $91.57) × $10 × 10
            = $0.93 × $100
            = $93

Commission (0.2%): -$0.02
Funding (minimal): -$0.0001

Net P&L: $93 - $0.02 - $0.0001 ≈ $0.91
```

---

## DOCUMENT HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | April 2026 | Eugene | Initial specification |

---

**END OF DOCUMENT**
