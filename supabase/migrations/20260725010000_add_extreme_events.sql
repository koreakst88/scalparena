create table if not exists extreme_events (
  id uuid primary key default gen_random_uuid(),
  project varchar(30) not null default 'EXTREME',
  experiment_id varchar(80) not null,
  pair varchar(30) not null,
  scenario varchar(30) not null
    check (scenario in ('SQUEEZE_LONG', 'CASCADE_SHORT')),
  state varchar(20) not null default 'WATCH'
    check (state in ('WATCH', 'ARMED', 'TRIGGERED', 'EXPIRED', 'INVALIDATED', 'RESOLVED')),

  primary_venue varchar(30),
  source_integrity boolean not null default false,
  score numeric(5, 2),
  reference_price numeric(24, 12),
  timeframe varchar(20),

  metrics jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  transition_history jsonb not null default '[]'::jsonb,

  first_seen_at timestamptz not null default now(),
  armed_at timestamptz,
  triggered_at timestamptz,
  expires_at timestamptz,
  resolved_at timestamptz,
  paper_signal_id uuid references paper_signals(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_extreme_events_one_active_scenario
  on extreme_events(experiment_id, pair, scenario)
  where state in ('WATCH', 'ARMED', 'TRIGGERED');

create index if not exists idx_extreme_events_experiment_state_updated
  on extreme_events(experiment_id, state, updated_at desc);

create index if not exists idx_extreme_events_pair_created
  on extreme_events(pair, created_at desc);

comment on table extreme_events is
  'Research-only lifecycle for Extreme Radar anomalies. This table does not represent live orders or paper trades.';

comment on column extreme_events.metrics is
  'Versioned market observations such as price acceleration, funding, OI, volume and orderbook quality.';

comment on column extreme_events.transition_history is
  'Append-only research history of WATCH, ARMED, TRIGGERED and terminal state transitions.';

comment on column extreme_events.paper_signal_id is
  'Optional future link created only after a TRIGGERED event is explicitly admitted to paper tracking.';
