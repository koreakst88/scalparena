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

## Deployment

На Railway - см. `deployment/Procfile`
