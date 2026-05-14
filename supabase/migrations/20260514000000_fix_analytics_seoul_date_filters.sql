-- Use Asia/Seoul calendar dates for analytics windows.
-- UTC timestamps around local midnight should belong to the user's Seoul trading day.

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
  with bounds as (
    select
      ((now() at time zone 'Asia/Seoul')::date - (greatest(p_days, 1) - 1)) as start_date,
      (now() at time zone 'Asia/Seoul')::date as end_date
  )
  select
    t.pair,
    count(*) as trades,
    count(*) filter (where t.profit_loss > 0) as wins,
    count(*) filter (where t.profit_loss < 0) as losses,
    round((count(*) filter (where t.profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(sum(t.profit_loss), 0)::numeric, 4) as total_pnl,
    round(coalesce(avg(t.profit_loss), 0)::numeric, 4) as avg_pnl
  from trades t
  cross join bounds b
  where t.user_id = p_user_id
    and t.status = 'CLOSED'
    and date(t.entry_time at time zone 'Asia/Seoul') >= b.start_date
    and date(t.entry_time at time zone 'Asia/Seoul') <= b.end_date
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
  with bounds as (
    select
      ((now() at time zone 'Asia/Seoul')::date - (greatest(p_days, 1) - 1)) as start_date,
      (now() at time zone 'Asia/Seoul')::date as end_date
  )
  select
    t.pair,
    count(*) as trades,
    count(*) filter (where t.profit_loss > 0) as wins,
    count(*) filter (where t.profit_loss < 0) as losses,
    round((count(*) filter (where t.profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(sum(t.profit_loss), 0)::numeric, 4) as total_pnl,
    round(coalesce(avg(t.profit_loss), 0)::numeric, 4) as avg_pnl
  from trades t
  cross join bounds b
  where t.user_id = p_user_id
    and t.status = 'CLOSED'
    and date(t.entry_time at time zone 'Asia/Seoul') >= b.start_date
    and date(t.entry_time at time zone 'Asia/Seoul') <= b.end_date
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
  with bounds as (
    select
      ((now() at time zone 'Asia/Seoul')::date - (greatest(p_days, 1) - 1)) as start_date,
      (now() at time zone 'Asia/Seoul')::date as end_date
  )
  select
    coalesce(t.strategy, 'UNKNOWN') as strategy,
    count(*) as trades,
    count(*) filter (where t.profit_loss > 0) as wins,
    count(*) filter (where t.profit_loss < 0) as losses,
    round((count(*) filter (where t.profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(sum(t.profit_loss), 0)::numeric, 4) as total_pnl,
    round(coalesce(avg(t.profit_loss), 0)::numeric, 4) as avg_pnl
  from trades t
  cross join bounds b
  where t.user_id = p_user_id
    and t.status = 'CLOSED'
    and date(t.entry_time at time zone 'Asia/Seoul') >= b.start_date
    and date(t.entry_time at time zone 'Asia/Seoul') <= b.end_date
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
  with bounds as (
    select
      ((now() at time zone 'Asia/Seoul')::date - (greatest(p_days, 1) - 1)) as start_date,
      (now() at time zone 'Asia/Seoul')::date as end_date
  ),
  regime_trades as (
    select
      case
        when t.market_regime is null then 'NULL_REGIME'
        else t.market_regime
      end as regime,
      t.profit_loss
    from trades t
    cross join bounds b
    where t.user_id = p_user_id
      and t.status = 'CLOSED'
      and date(t.entry_time at time zone 'Asia/Seoul') >= b.start_date
      and date(t.entry_time at time zone 'Asia/Seoul') <= b.end_date
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
  with bounds as (
    select
      ((now() at time zone 'Asia/Seoul')::date - (greatest(p_days, 1) - 1)) as start_date,
      (now() at time zone 'Asia/Seoul')::date as end_date
  )
  select
    coalesce(t.macd_bias, 'UNKNOWN') as macd_bias,
    count(*) as trades,
    count(*) filter (where t.profit_loss > 0) as wins,
    count(*) filter (where t.profit_loss < 0) as losses,
    round((count(*) filter (where t.profit_loss > 0)::numeric / nullif(count(*), 0)) * 100, 2) as win_rate,
    round(coalesce(sum(t.profit_loss), 0)::numeric, 4) as total_pnl,
    round(coalesce(avg(t.profit_loss), 0)::numeric, 4) as avg_pnl
  from trades t
  cross join bounds b
  where t.user_id = p_user_id
    and t.status = 'CLOSED'
    and date(t.entry_time at time zone 'Asia/Seoul') >= b.start_date
    and date(t.entry_time at time zone 'Asia/Seoul') <= b.end_date
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
  with bounds as (
    select
      ((now() at time zone 'Asia/Seoul')::date - (greatest(p_days, 1) - 1)) as start_date,
      (now() at time zone 'Asia/Seoul')::date as end_date
  ),
  zoned as (
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
    cross join bounds b
    where t.user_id = p_user_id
      and t.status = 'CLOSED'
      and date(t.entry_time at time zone 'Asia/Seoul') >= b.start_date
      and date(t.entry_time at time zone 'Asia/Seoul') <= b.end_date
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
  with bounds as (
    select
      ((now() at time zone 'Asia/Seoul')::date - (greatest(p_days, 1) - 1)) as start_date,
      (now() at time zone 'Asia/Seoul')::date as end_date
  ),
  closed as (
    select
      t.*,
      extract(epoch from (t.exit_time - t.entry_time)) / 60 as hold_minutes
    from trades t
    cross join bounds b
    where t.user_id = p_user_id
      and t.status = 'CLOSED'
      and date(t.entry_time at time zone 'Asia/Seoul') >= b.start_date
      and date(t.entry_time at time zone 'Asia/Seoul') <= b.end_date
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
  with bounds as (
    select
      ((now() at time zone 'Asia/Seoul')::date - (greatest(p_days, 1) - 1)) as start_date,
      (now() at time zone 'Asia/Seoul')::date as end_date
  ),
  closed as (
    select
      coalesce(t.exit_reason, 'UNKNOWN') as reason,
      t.profit_loss
    from trades t
    cross join bounds b
    where t.user_id = p_user_id
      and t.status = 'CLOSED'
      and date(coalesce(t.exit_time, t.entry_time) at time zone 'Asia/Seoul') >= b.start_date
      and date(coalesce(t.exit_time, t.entry_time) at time zone 'Asia/Seoul') <= b.end_date
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
