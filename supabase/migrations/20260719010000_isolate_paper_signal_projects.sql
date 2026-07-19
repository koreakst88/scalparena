drop index if exists idx_paper_signals_one_watching_per_pair_direction;

create unique index if not exists idx_paper_signals_one_watching_per_project_pair_direction
  on paper_signals(user_id, experiment_id, project, pair, direction)
  where status = 'WATCHING';

comment on index idx_paper_signals_one_watching_per_project_pair_direction is
  'Prevents duplicate active signals inside one project and experiment without coupling independent projects.';
