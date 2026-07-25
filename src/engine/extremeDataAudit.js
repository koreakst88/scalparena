const CORE_CAPABILITIES = [
  'ticker',
  'candles',
  'funding',
  'openInterest',
  'orderbook',
  'liquidations',
];

class ExtremeDataAudit {
  static async run(provider, pair, options = {}) {
    const normalizedPair = this.normalizePair(pair);
    const startedAt = new Date();
    const [bybit, okx] = await Promise.all([
      provider.auditBybitExtremeData(normalizedPair, options),
      provider.auditOkxExtremeData(normalizedPair, options),
    ]);
    const effective = this._buildEffectiveCapabilities(bybit, okx);
    const availableCount = CORE_CAPABILITIES.filter(
      (capability) => effective[capability]?.available
    ).length;

    return {
      pair: normalizedPair,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      bybit,
      okx,
      effective,
      availableCount,
      totalCapabilities: CORE_CAPABILITIES.length,
      readyForResearch: availableCount >= 4,
      signalsEnabled: false,
    };
  }

  static normalizePair(pair) {
    const normalized = String(pair || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    if (!normalized.endsWith('USDT') || normalized.length < 7) {
      throw new Error('Extreme audit pair must look like BTCUSDT');
    }

    return normalized;
  }

  static _buildEffectiveCapabilities(bybit = {}, okx = {}) {
    return Object.fromEntries(CORE_CAPABILITIES.map((capability) => {
      const primary = bybit[capability];
      const fallback = okx[capability];
      const selected = primary?.available ? primary : fallback?.available ? fallback : null;

      return [
        capability,
        selected
          ? {
            available: true,
            source: selected.source,
            records: selected.records,
            latencyMs: selected.latencyMs,
          }
          : {
            available: false,
            source: null,
            records: 0,
            latencyMs: null,
          },
      ];
    }));
  }
}

ExtremeDataAudit.CORE_CAPABILITIES = CORE_CAPABILITIES;

module.exports = ExtremeDataAudit;
