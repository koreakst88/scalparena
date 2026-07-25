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

1. Применить миграции из `supabase/migrations`, включая experiment, project isolation и candle-path resolution миграции от `20260719`
2. Включить флаги:

```env
PAPER_SIGNAL_TRACKING_ENABLED=true
PAPER_SIGNAL_AUTO_LOG_ENABLED=true
PAPER_SIGNAL_ALERTS_ENABLED=true
PAPER_SIGNAL_EXPERIMENT_ID=SCALPARENA_V2_20260719
CANDIDATE_V3_EXPERIMENT_ID=CANDIDATE_V3_20260720
PUMP_V2_EXPERIMENT_ID=PUMP_V2_ATR13_20260725
PAPER_SIGNAL_SLIPPAGE_BPS=5
MARKET_CONTEXT_V1_ENABLED=true
```

После этого `/scan` и авто-скан будут записывать paper-сигналы, tracker будет отмечать `TP_HIT`, `SL_HIT` или `TIMEOUT`. `/signals candidate 30` показывает только новую выборку Candidate V3, `/signals candidate_v2 30` — замороженную V2, а `/signals pump all` — текущий PumpHunter. Архив V1 доступен через `/signals legacy candidate_v1 30`.

Старые записи сохраняются как `LEGACY_PRE_20260719`. Новые paper-сигналы получают отдельные `project`, `experiment_id`, версию стратегии, источник рынка, timeframe и параметры динамического выхода.

Candidate Engine и PumpHunter изолированы по `project` и `experiment_id`: активный сигнал одного проекта не блокирует такую же пару в другом проекте. Защита от повторных активных сигналов продолжает действовать внутри каждого проекта.

Paper tracker проверяет OHLC-путь после входа и использует `high/low` свечей для TP, SL, MFE и MAE. Если одна свеча пересекла оба уровня, порядок считается неоднозначным и консервативно записывается `SL_HIT`. Источник свечей соответствует сохранённому `market_source`; snapshot текущей цены остаётся резервным способом проверки.

Market Context V1 размечает shadow-сигналы по состоянию BTC (`RISK_ON`, `RISK_OFF`, `NEUTRAL`, `HIGH_VOL`) и исследовательскому решению (`ALLOW`, `CAUTION`, `BLOCK`). На первом этапе эта метка не блокирует запись сигнала: она нужна для сравнения статистики без подгонки результата.

Команда `/research` показывает готовность текущей V2-выборки: минимум 30 завершённых сигналов на каждый shadow-проект и минимум 10 завершённых сигналов в каждой исследовательской группе `ALLOW`, `CAUTION`, `BLOCK`. Записи без контекстной метки показываются отдельно как `UNTAGGED`.

Обычный `/signals` показывает фактическую paper P&L-модель отдельно от MFE-потенциала: результат по сохранённой цене выхода, taker-комиссии, adverse slippage и портфельный лимит в две одновременные позиции. `PAPER_SIGNAL_SLIPPAGE_BPS` задаёт проскальзывание на каждую сторону сделки; значение по умолчанию — 5 bps.

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
CANDIDATE_V3_ENABLED=true
CANDIDATE_V3_MAX_PER_CYCLE=1
```

Telegram команды:

- `/candidate_auto status` - показать текущий режим и пороги
- `/candidate_auto on` - включить авто-candidates для текущего runtime
- `/candidate_auto off` - выключить авто-candidates для текущего runtime
- `/candidateauto on/off/status` - короткий alias без underscore

Антиспам-фильтры: отправляются только готовые входы, пары с активным paper-сигналом пропускаются, по каждой паре действует cooldown.

Candidate V3 заменяет убыточный V2 в silent paper-режиме. Он ждёт закрытый пробой, отдельный ретест и возврат за уровень, использует 5-минутный тренд, ограничивает перегретый объём и поздний вход, ставит стоп за структурой ретеста и применяет BTC-контекст. Telegram-алерты и реальные сделки для V3 отключены. Новая выборка доступна через `/signals candidate 7`, старая V2 — только через `/signals candidate_v2 30`.

## PumpHunter Lab

Отдельный paper-only режим для агрессивных pump continuation сигналов. Он не заменяет `/scan` и `/candidates`, а добавляет новый тип сигналов `PUMP_HUNTER`.

```env
PUMP_HUNTER_SCAN_LIMIT=40
PUMP_HUNTER_KLINE_INTERVAL=15
PUMP_HUNTER_KLINE_LIMIT=96
PUMP_HUNTER_ACTIONABLE_LIMIT=3
PUMP_HUNTER_USE_TESTNET=false
PUMP_HUNTER_REST_BASES=api.bybit.com,api.bytick.com,api.bytick.nl,api.bybit-tr.com,api.bybit.kz
PUMP_V2_SHADOW_ENABLED=true
PUMP_V2_SHADOW_MAX_PER_CYCLE=2
```

Telegram команды:

- `/pump` - топ pump-кандидатов сейчас
- `/pump full` - подробная диагностика
- `/pump paper` - записать готовые pump-входы в paper tracking
- `/pump debug` - проверить доступ к Bybit public REST
- `/signals pump edge 7` - посмотреть MFE/плюсовые движения PumpHunter и money model

Логика v3: ищем монеты, которые уже дали fresh move от локального low, но еще не выглядят слишком поздними. PumpHunter строит динамический exit plan: TP1 +2%, TP2 +3%, main TP +3/+5/+8% по силе сетапа, SL -4/-5/-6%, moon level +20% считается отдельно как бонус-уровень. `/signals pump edge` считает MFE-потенциал и денежную модель по текущему балансу, margin/leverage из RiskManager, комиссии включены. Live Bybit orders OFF.

Pump State Machine V2 работает параллельно и не меняет основной PumpHunter. Он требует последовательность ignition → breakout → low-volume retest → reclaim, пишет только `ENTRY_READY` в отдельный silent shadow-проект и не отправляет Telegram-алерты. Отчёт: `/signals pump_v2 7`.

Для Pump V2.1 tracker параллельно считает research-only staged exits по свечному пути: 50% позиции на TP1 `+2%` или `+3%`, затем перенос остатка в безубыток со следующей свечи и сопровождение до исходного структурного TP. Основные TP/SL сигнала не меняются. Сравнение с комиссиями и проскальзыванием: `/signals pump_v2 exits 30`.

## Deployment

На Railway - см. `deployment/Procfile`
