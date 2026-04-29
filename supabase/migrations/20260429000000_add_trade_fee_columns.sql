-- Store gross P&L and Bybit taker fees separately.
-- Historical CLOSED trades are re-estimated from the previous formula:
-- old profit_loss = gross_pnl - (margin * 0.002)

ALTER TABLE trades
ADD COLUMN IF NOT EXISTS gross_pnl NUMERIC(18, 8),
ADD COLUMN IF NOT EXISTS entry_fee NUMERIC(18, 8),
ADD COLUMN IF NOT EXISTS exit_fee NUMERIC(18, 8);

UPDATE trades
SET
  gross_pnl = ROUND((profit_loss + (entry_size * 0.002))::numeric, 8),
  entry_fee = ROUND((entry_size * leverage * 0.00055)::numeric, 8),
  exit_fee = ROUND((((entry_size * leverage) / NULLIF(entry_price, 0)) * exit_price * 0.00055)::numeric, 8),
  profit_loss = ROUND((
    (profit_loss + (entry_size * 0.002)) -
    (entry_size * leverage * 0.00055) -
    (((entry_size * leverage) / NULLIF(entry_price, 0)) * exit_price * 0.00055)
  )::numeric, 8)
WHERE status = 'CLOSED'
  AND profit_loss IS NOT NULL
  AND entry_size IS NOT NULL
  AND leverage IS NOT NULL
  AND entry_price IS NOT NULL
  AND exit_price IS NOT NULL
  AND gross_pnl IS NULL;
