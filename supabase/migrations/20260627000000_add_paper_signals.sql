create table if not exists paper_signals (
  id uuid primary key default gen_random_uuid(),
  user_id varchar(255) not null,
  pair varchar(20) not null,
  direction varchar(10) not null check (direction in ('LONG', 'SHORT')),
  strategy varchar(50),
  entry_mode varchar(50),
  market_regime varchar(50),
  strategy_version varchar(50),

  entry_price numeric(20, 8) not null,
  stop_loss numeric(20, 8) not null,
  take_profit numeric(20, 8) not null,
  confidence numeric(5, 2),
  rsi numeric(5, 2),
  volume numeric(10, 2),
  atr_percent numeric(10, 4),
  bb_position numeric(10, 2),
  bb_width numeric(10, 4),
  macd_bias varchar(20),
  signal_reason text,
  invalidation_rule text,

  status varchar(20) not null default 'WATCHING' check (status in ('WATCHING', 'TP_HIT', 'SL_HIT', 'TIMEOUT', 'CANCELLED')),
  result varchar(20),
  hit_price numeric(20, 8),
  max_favorable_price numeric(20, 8),
  max_adverse_price numeric(20, 8),
  time_to_result_minutes integer,

  source varchar(20) not null default 'AUTO_SCAN',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,

  foreign key (user_id) references users(telegram_id)
);

create index if not exists idx_paper_signals_user_created
  on paper_signals(user_id, created_at desc);

create index if not exists idx_paper_signals_user_status
  on paper_signals(user_id, status);

create unique index if not exists idx_paper_signals_one_watching_per_pair_direction
  on paper_signals(user_id, pair, direction)
  where status = 'WATCHING';
