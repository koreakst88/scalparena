// src/engine/feeCalculator.js

/**
 * Fee and P&L calculator for Bybit linear futures.
 * Taker fees are charged on notional value on both entry and exit.
 */

const BYBIT_TAKER_FEE = 0.00055;

class FeeCalculator {
  static calculatePnL({ entryPrice, exitPrice, margin, leverage, direction = 'SHORT' }) {
    const normalizedDirection = String(direction || 'SHORT').toUpperCase();
    const entryNotional = margin * leverage;
    const quantity = entryNotional / entryPrice;
    const exitNotional = quantity * exitPrice;

    const grossPnl = normalizedDirection === 'SHORT'
      ? (entryPrice - exitPrice) * quantity
      : (exitPrice - entryPrice) * quantity;

    const entryFee = entryNotional * BYBIT_TAKER_FEE;
    const exitFee = exitNotional * BYBIT_TAKER_FEE;
    const totalFees = entryFee + exitFee;
    const netPnl = grossPnl - totalFees;

    return {
      grossPnl: this._round(grossPnl, 8),
      entryFee: this._round(entryFee, 8),
      exitFee: this._round(exitFee, 8),
      totalFees: this._round(totalFees, 8),
      netPnl: this._round(netPnl, 8),
      qty: this._round(quantity, 8),
      entryNotional: this._round(entryNotional, 2),
      exitNotional: this._round(exitNotional, 2),
    };
  }

  static calculateMaxLoss(notional, slPercent) {
    const slLoss = notional * slPercent;
    const fees = notional * this.getRoundTripFee();
    return this._round(slLoss + fees, 4);
  }

  static calculateExpectedProfit(notional, tpPercent) {
    const tpGain = notional * tpPercent;
    const fees = notional * this.getRoundTripFee();
    return this._round(tpGain - fees, 4);
  }

  static getFeeRate() {
    return BYBIT_TAKER_FEE;
  }

  static getRoundTripFee() {
    return BYBIT_TAKER_FEE * 2;
  }

  static _round(value, decimals) {
    return Number(value.toFixed(decimals));
  }
}

module.exports = FeeCalculator;
