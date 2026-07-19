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

1. Применить миграции `supabase/migrations/20260627000000_add_paper_signals.sql` и `supabase/migrations/20260719000000_add_paper_signal_experiments.sql`
2. Включить флаги:

```env
PAPER_SIGNAL_TRACKING_ENABLED=true
PAPER_SIGNAL_AUTO_LOG_ENABLED=true
PAPER_SIGNAL_ALERTS_ENABLED=true
PAPER_SIGNAL_EXPERIMENT_ID=SCALPARENA_V2_20260719
```

После этого `/scan` и авто-скан будут записывать paper-сигналы, tracker будет отмечать `TP_HIT`, `SL_HIT` или `TIMEOUT`. Обычные `/signals 7`, `/signals candidates 30` и `/signals pump all` показывают текущий эксперимент. Архив доступен через `/signals legacy candidates 30`, а объединённая история через `/signals history pump all`.

Старые записи сохраняются как `LEGACY_PRE_20260719`. Новые paper-сигналы получают отдельные `project`, `experiment_id`, версию стратегии, источник рынка, timeframe и параметры динамического выхода.

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
PUMP_HUNTER_REST_BASES=api.bybit.com,api.bytick.com,api.bytick.nl,api.bybit-tr.com,api.bybit.kz
```

Telegram команды:

- `/pump` - топ pump-кандидатов сейчас
- `/pump full` - подробная диагностика
- `/pump paper` - записать готовые pump-входы в paper tracking
- `/pump debug` - проверить доступ к Bybit public REST
- `/signals pump edge 7` - посмотреть MFE/плюсовые движения PumpHunter и money model

Логика v3: ищем монеты, которые уже дали fresh move от локального low, но еще не выглядят слишком поздними. PumpHunter строит динамический exit plan: TP1 +2%, TP2 +3%, main TP +3/+5/+8% по силе сетапа, SL -4/-5/-6%, moon level +20% считается отдельно как бонус-уровень. `/signals pump edge` считает MFE-потенциал и денежную модель по текущему балансу, margin/leverage из RiskManager, комиссии включены. Live Bybit orders OFF.

## Deployment

На Railway - см. `deployment/Procfile`
