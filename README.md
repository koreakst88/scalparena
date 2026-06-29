# ScalpArena - Telegram Bot для Scalp Trading

## Установка

1. Clone репозиторий
2. `npm install`
3. Copy `.env.example` to `.env` и заполнить значения
4. `npm run dev` для разработки

## Структура проекта

- `src/bot` - Telegram bot команды и handlers
- `src/engine` - Ядро стратегии (сигналы, индикаторы, RM)
- `src/data` - Интеграция с Bybit и Supabase
- `src/analytics` - Статистика и GPT анализ

## Paper Signal Lab

Alert-only режим для проверки качества сигналов без открытия сделок на Bybit.

1. Применить миграцию `supabase/migrations/20260627000000_add_paper_signals.sql`
2. Включить флаги:

```env
PAPER_SIGNAL_TRACKING_ENABLED=true
PAPER_SIGNAL_AUTO_LOG_ENABLED=true
PAPER_SIGNAL_ALERTS_ENABLED=true
```

После этого `/scan` и авто-скан будут записывать paper-сигналы, tracker будет отмечать `TP_HIT`, `SL_HIT` или `TIMEOUT`, а статистику можно смотреть через `/signals 7`, `/signals 30`, `/signals all`.

## Candidate Engine

Аналитический режим без live-ордеров:

- `/candidates` - топ торговых сценариев сейчас
- `/candidates full` - диагностика по всем 15 парам и причины ожидания
- `/candidates paper` - записать top candidates в `paper_signals` для проверки TP/SL/timeout

Candidate Engine не заменяет текущий `/scan`: он показывает не только строгие сигналы, но и “почти-сценарии” со score, рисками и альтернативами.

### Candidate Auto Scan

Alert-only авто-режим для Candidate Engine. Он не открывает сделки на Bybit: только присылает сильные рекомендации и записывает их в paper tracking.

```env
CANDIDATE_AUTO_SCAN_ENABLED=true
CANDIDATE_AUTO_SCAN_INTERVAL_MS=600000
CANDIDATE_AUTO_MIN_SCORE=75
CANDIDATE_AUTO_MIN_RR=1.2
CANDIDATE_AUTO_COOLDOWN_MINUTES=90
CANDIDATE_AUTO_MAX_ALERTS=2
```

Telegram команды:

- `/candidate_auto status` - показать текущий режим и пороги
- `/candidate_auto on` - включить авто-candidates для текущего runtime
- `/candidate_auto off` - выключить авто-candidates для текущего runtime
- `/candidateauto on/off/status` - короткий alias без underscore

Антиспам-фильтры: отправляются только готовые входы, пары с активным paper-сигналом пропускаются, по каждой паре действует cooldown.

## PumpHunter Lab

Отдельный paper-only режим для агрессивных pump continuation сигналов. Он не заменяет `/scan` и `/candidates`, а добавляет новый тип сигналов `PUMP_HUNTER`.

```env
PUMP_HUNTER_SCAN_LIMIT=40
PUMP_HUNTER_KLINE_INTERVAL=15
PUMP_HUNTER_KLINE_LIMIT=96
PUMP_HUNTER_ACTIONABLE_LIMIT=3
PUMP_HUNTER_USE_TESTNET=false
```

Telegram команды:

- `/pump` - топ pump-кандидатов сейчас
- `/pump full` - подробная диагностика
- `/pump paper` - записать готовые pump-входы в paper tracking

Логика v1: ищем монеты, которые уже дали fresh move от локального low, но еще не выглядят слишком поздними. TP +20%, SL -15%, live Bybit orders OFF.

## Deployment

На Railway - см. `deployment/Procfile`
