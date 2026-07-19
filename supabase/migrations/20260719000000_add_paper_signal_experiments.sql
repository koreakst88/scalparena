alter table paper_signals
  add column if not exists project varchar(30) not null default 'UNKNOWN',
  add column if not exists experiment_id varchar(80) not null default 'LEGACY_UNVERSIONED',
  add column if not exists is_legacy boolean not null default true,
  add column if not exists market_source varchar(50),
  add column if not exists timeframe varchar(20),
  add column if not exists exit_profile varchar(30),
  add column if not exists tp1 numeric(20, 8),
  add column if not exists tp2 numeric(20, 8),
  add column if not exists stretch_take_profit numeric(20, 8),
  add column if not exists moon_take_profit numeric(20, 8),
  add column if not exists signal_metadata jsonb not null default '{}'::jsonb;

-- Everything recorded before this migration remains available as the legacy baseline.
update paper_signals
set
  project = case
    when strategy = 'PUMP_HUNTER' or source in ('PUMP_HUNTER', 'PUMP_AUTO') then 'PUMP'
    when source in ('CANDIDATE_ENGINE', 'CANDIDATE_AUTO') then 'CANDIDATE'
    else 'HYBRID'
  end,
  experiment_id = 'LEGACY_PRE_20260719',
  is_legacy = true,
  market_source = coalesce(market_source, 'UNKNOWN_LEGACY'),
  timeframe = coalesce(timeframe, 'UNKNOWN_LEGACY')
where experiment_id = 'LEGACY_UNVERSIONED';

create index if not exists idx_paper_signals_user_experiment_created
  on paper_signals(user_id, experiment_id, created_at desc);

create index if not exists idx_paper_signals_user_project_created
  on paper_signals(user_id, project, created_at desc);

comment on column paper_signals.experiment_id is
  'Immutable statistics cohort. New strategy behavior must use a new experiment id.';

comment on column paper_signals.is_legacy is
  'Legacy rows stay queryable but are excluded from current experiment reports.';
