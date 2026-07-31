create table if not exists structure_events (
  id uuid primary key default gen_random_uuid(),
  project varchar(30) not null default 'STRUCTURE',
  experiment_id varchar(80) not null,
  pair varchar(30) not null,
  scenario varchar(30) not null
    check (scenario in ('RESISTANCE_TEST', 'SUPPORT_TEST', 'ZONE_COMPRESSION')),
  state varchar(20) not null default 'WATCH'
    check (state in ('WATCH', 'ARMED', 'TRIGGERED', 'EXPIRED', 'INVALIDATED', 'RESOLVED')),

  primary_venue varchar(30),
  source_integrity boolean not null default false,
  score numeric(5, 2),
  reference_price numeric(24, 12),
  zone_lower numeric(24, 12) not null,
  zone_upper numeric(24, 12) not null,
  zone_score numeric(5, 2),
  timeframe varchar(30) not null default '4H_1H_15M',

  metrics jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  transition_history jsonb not null default '[]'::jsonb,

  first_seen_at timestamptz not null default now(),
  armed_at timestamptz,
  triggered_at timestamptz,
  expires_at timestamptz,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (zone_lower > 0),
  check (zone_upper > zone_lower)
);

create unique index if not exists idx_structure_events_one_active_scenario
  on structure_events(experiment_id, pair, scenario)
  where state in ('WATCH', 'ARMED', 'TRIGGERED');

create index if not exists idx_structure_events_experiment_state_updated
  on structure_events(experiment_id, state, updated_at desc);

create index if not exists idx_structure_events_pair_created
  on structure_events(pair, created_at desc);

comment on table structure_events is
  'Research-only lifecycle for Structure Radar zone tests. Rows are not live orders or paper trades.';

comment on column structure_events.metrics is
  'Versioned observations of price, original zone, compression and structure state.';

comment on column structure_events.transition_history is
  'Append-only WATCH, ARMED, TRIGGERED and terminal transition history.';
