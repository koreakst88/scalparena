-- Exit reason analytics for /patterns full.
-- Shows where the strategy wins/loses: manual exits, TP, SL, RSI exits, timeouts.

create or replace function get_exit_reason_stats(
  p_user_id text,
  p_days integer default 7
)
returns table (
  exit_reason text,
  trades bigint,
  wins bigint,
  losses bigint,
  win_rate numeric,
  avg_win numeric,
  avg_loss numeric,
  total_pnl numeric
)
language sql
stable
as $$
  with closed as (
    select
      coalesce(t.exit_reason, 'UNKNOWN') as reason,
      t.profit_loss
    from trades t
    where t.user_id = p_user_id
      and t.status = 'CLOSED'
      and coalesce(t.exit_time, t.entry_time) >= now() - make_interval(days => p_days)
  )
  select
    reason as exit_reason,
    count(*) as trades,
    count(*) filter (where profit_loss > 0) as wins,
    count(*) filter (where profit_loss < 0) as losses,
    round((count(*) filter (where profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(avg(profit_loss) filter (where profit_loss > 0), 0)::numeric, 4) as avg_win,
    round(coalesce(avg(profit_loss) filter (where profit_loss < 0), 0)::numeric, 4) as avg_loss,
    round(coalesce(sum(profit_loss), 0)::numeric, 4) as total_pnl
  from closed
  group by reason
  order by trades desc, total_pnl desc;
$$;
