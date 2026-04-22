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

## Deployment

На Railway - см. `deployment/Procfile`

