alter table paper_signals
  add column if not exists resolution_method varchar(30),
  add column if not exists resolution_timeframe varchar(20),
  add column if not exists first_hit_ambiguous boolean not null default false,
  add column if not exists resolved_candle_at timestamptz,
  add column if not exists resolved_candle_high numeric(20, 8),
  add column if not exists resolved_candle_low numeric(20, 8);

comment on column paper_signals.resolution_method is
  'How the outcome was resolved: CANDLE_PATH, PRICE_SNAPSHOT or TIMEOUT.';

comment on column paper_signals.first_hit_ambiguous is
  'True when one OHLC candle crossed both TP and SL; the tracker records the conservative SL outcome.';
