create or replace function get_top_pairs(
  p_user_id text,
  p_days integer default 7,
  p_min_trades integer default 3
)
returns table (
  pair text,
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
  select
    t.pair,
    count(*) as trades,
    count(*) filter (where t.profit_loss > 0) as wins,
    count(*) filter (where t.profit_loss < 0) as losses,
    round((count(*) filter (where t.profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(sum(t.profit_loss), 0)::numeric, 4) as total_pnl,
    round(coalesce(avg(t.profit_loss), 0)::numeric, 4) as avg_pnl
  from trades t
  where t.user_id = p_user_id
    and t.status = 'CLOSED'
    and t.entry_time >= now() - make_interval(days => p_days)
  group by t.pair
  having count(*) >= p_min_trades
  order by win_rate desc, total_pnl desc, trades desc;
$$;

create or replace function get_worst_pairs(
  p_user_id text,
  p_days integer default 7,
  p_min_trades integer default 3
)
returns table (
  pair text,
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
  select
    t.pair,
    count(*) as trades,
    count(*) filter (where t.profit_loss > 0) as wins,
    count(*) filter (where t.profit_loss < 0) as losses,
    round((count(*) filter (where t.profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(sum(t.profit_loss), 0)::numeric, 4) as total_pnl,
    round(coalesce(avg(t.profit_loss), 0)::numeric, 4) as avg_pnl
  from trades t
  where t.user_id = p_user_id
    and t.status = 'CLOSED'
    and t.entry_time >= now() - make_interval(days => p_days)
  group by t.pair
  having count(*) >= p_min_trades
  order by total_pnl asc, win_rate asc, trades desc;
$$;

create or replace function get_strategy_stats(
  p_user_id text,
  p_days integer default 7
)
returns table (
  strategy text,
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
  select
    coalesce(t.strategy, 'UNKNOWN') as strategy,
    count(*) as trades,
    count(*) filter (where t.profit_loss > 0) as wins,
    count(*) filter (where t.profit_loss < 0) as losses,
    round((count(*) filter (where t.profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(sum(t.profit_loss), 0)::numeric, 4) as total_pnl,
    round(coalesce(avg(t.profit_loss), 0)::numeric, 4) as avg_pnl
  from trades t
  where t.user_id = p_user_id
    and t.status = 'CLOSED'
    and t.entry_time >= now() - make_interval(days => p_days)
  group by coalesce(t.strategy, 'UNKNOWN')
  order by total_pnl desc, win_rate desc;
$$;

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
  select
    coalesce(t.market_regime, 'UNKNOWN') as market_regime,
    count(*) as trades,
    count(*) filter (where t.profit_loss > 0) as wins,
    count(*) filter (where t.profit_loss < 0) as losses,
    round((count(*) filter (where t.profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(sum(t.profit_loss), 0)::numeric, 4) as total_pnl,
    round(coalesce(avg(t.profit_loss), 0)::numeric, 4) as avg_pnl
  from trades t
  where t.user_id = p_user_id
    and t.status = 'CLOSED'
    and t.entry_time >= now() - make_interval(days => p_days)
  group by coalesce(t.market_regime, 'UNKNOWN')
  order by total_pnl desc, win_rate desc;
$$;

create or replace function get_macd_bias_stats(
  p_user_id text,
  p_days integer default 7
)
returns table (
  macd_bias text,
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
  select
    coalesce(t.macd_bias, 'UNKNOWN') as macd_bias,
    count(*) as trades,
    count(*) filter (where t.profit_loss > 0) as wins,
    count(*) filter (where t.profit_loss < 0) as losses,
    round((count(*) filter (where t.profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(sum(t.profit_loss), 0)::numeric, 4) as total_pnl,
    round(coalesce(avg(t.profit_loss), 0)::numeric, 4) as avg_pnl
  from trades t
  where t.user_id = p_user_id
    and t.status = 'CLOSED'
    and t.entry_time >= now() - make_interval(days => p_days)
  group by coalesce(t.macd_bias, 'UNKNOWN')
  order by total_pnl desc, win_rate desc;
$$;

create or replace function get_rsi_zone_stats(
  p_user_id text,
  p_days integer default 7
)
returns table (
  rsi_zone text,
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
  with zoned as (
    select
      t.profit_loss,
      case
        when t.rsi_at_entry is null then 'UNKNOWN'
        when t.rsi_at_entry < 30 then 'OVERSOLD_LT_30'
        when t.rsi_at_entry <= 40 then 'WEAK_30_40'
        when t.rsi_at_entry < 60 then 'NEUTRAL_40_60'
        when t.rsi_at_entry <= 70 then 'STRONG_60_70'
        else 'OVERBOUGHT_GT_70'
      end as zone
    from trades t
    where t.user_id = p_user_id
      and t.status = 'CLOSED'
      and t.entry_time >= now() - make_interval(days => p_days)
  )
  select
    zone as rsi_zone,
    count(*) as trades,
    count(*) filter (where profit_loss > 0) as wins,
    count(*) filter (where profit_loss < 0) as losses,
    round((count(*) filter (where profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(sum(profit_loss), 0)::numeric, 4) as total_pnl,
    round(coalesce(avg(profit_loss), 0)::numeric, 4) as avg_pnl
  from zoned
  group by zone
  order by total_pnl desc, win_rate desc;
$$;

create or replace function get_hold_time_stats(
  p_user_id text,
  p_days integer default 7
)
returns table (
  hold_time_bucket text,
  trades bigint,
  wins bigint,
  losses bigint,
  win_rate numeric,
  total_pnl numeric,
  avg_pnl numeric,
  avg_hold_minutes numeric
)
language sql
stable
as $$
  with closed as (
    select
      t.*,
      extract(epoch from (t.exit_time - t.entry_time)) / 60 as hold_minutes
    from trades t
    where t.user_id = p_user_id
      and t.status = 'CLOSED'
      and t.entry_time >= now() - make_interval(days => p_days)
      and t.exit_time is not null
  ),
  bucketed as (
    select
      profit_loss,
      hold_minutes,
      case
        when hold_minutes < 15 then 'LT_15M'
        when hold_minutes < 30 then '15_30M'
        when hold_minutes < 60 then '30_60M'
        when hold_minutes < 90 then '60_90M'
        else 'GT_90M'
      end as bucket
    from closed
  )
  select
    bucket as hold_time_bucket,
    count(*) as trades,
    count(*) filter (where profit_loss > 0) as wins,
    count(*) filter (where profit_loss < 0) as losses,
    round((count(*) filter (where profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(sum(profit_loss), 0)::numeric, 4) as total_pnl,
    round(coalesce(avg(profit_loss), 0)::numeric, 4) as avg_pnl,
    round(coalesce(avg(hold_minutes), 0)::numeric, 1) as avg_hold_minutes
  from bucketed
  group by bucket
  order by total_pnl desc, win_rate desc;
$$;
