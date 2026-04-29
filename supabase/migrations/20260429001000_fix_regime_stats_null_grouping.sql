-- Preserve actual market_regime values in analytics and expose NULLs explicitly.
-- This makes missing context visible as NULL_REGIME instead of hiding it as UNKNOWN.

create or replace function get_regime_stats(
  p_user_id text,
  p_days integer default 7
)
returns table (
  market_regime text,
  trades bigint,
  wins bigint,
  losses bigint,
  win_rate numeric,
  total_pnl numeric,
  avg_pnl numeric
)
language sql
stable
as $$
  with regime_trades as (
    select
      case
        when t.market_regime is null then 'NULL_REGIME'
        else t.market_regime
      end as regime,
      t.profit_loss
    from trades t
    where t.user_id = p_user_id
      and t.status = 'CLOSED'
      and t.entry_time >= now() - make_interval(days => p_days)
  )
  select
    regime as market_regime,
    count(*) as trades,
    count(*) filter (where profit_loss > 0) as wins,
    count(*) filter (where profit_loss < 0) as losses,
    round((count(*) filter (where profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(sum(profit_loss), 0)::numeric, 4) as total_pnl,
    round(coalesce(avg(profit_loss), 0)::numeric, 4) as avg_pnl
  from regime_trades
  group by regime
  order by total_pnl desc, win_rate desc;
$$;
