create table if not exists research_scan_diagnostics (
  id bigserial primary key,
  experiment_id varchar(80) not null,
  project varchar(60) not null,
  strategy varchar(80) not null,
  scan_source varchar(60),
  scanned_pairs integer not null default 0,
  qualified_before_context integer not null default 0,
  qualified_after_context integer not null default 0,
  rejection_counts jsonb not null default '{}'::jsonb,
  context_rejection_counts jsonb not null default '{}'::jsonb,
  market_context jsonb,
  examples jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_scan_diagnostics_project_created
  on research_scan_diagnostics(project, experiment_id, created_at desc);

comment on table research_scan_diagnostics is
  'Research-only scan summaries. These rows never represent trades or paper signals.';

comment on column research_scan_diagnostics.rejection_counts is
  'Counts of strategy filters that rejected scanned pairs during this cycle.';

comment on column research_scan_diagnostics.context_rejection_counts is
  'Counts of otherwise qualified candidates rejected by the market-context gate.';
