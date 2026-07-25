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
    const [bybit, okx, gate] = await Promise.all([
      provider.auditBybitExtremeData(normalizedPair, options),
      provider.auditOkxExtremeData(normalizedPair, options),
      provider.auditGateExtremeData(normalizedPair, options),
    ]);
    const venues = { BYBIT: bybit, OKX: okx, GATE: gate };
    const primaryVenue = this._selectPrimaryVenue(venues);
    const effective = this._buildEffectiveCapabilities(venues, primaryVenue);
    const availableCount = CORE_CAPABILITIES.filter(
      (capability) => effective[capability]?.available
    ).length;
    const effectiveVenues = new Set(
      Object.values(effective)
        .filter((probe) => probe.available)
        .map((probe) => this._sourceVenue(probe.source))
        .filter(Boolean)
    );

    return {
      pair: normalizedPair,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      bybit,
      okx,
      gate,
      effective,
      primaryVenue,
      singleVenueComplete: this._countAvailable(venues[primaryVenue]) === CORE_CAPABILITIES.length,
      mixedVenues: effectiveVenues.size > 1,
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

  static _selectPrimaryVenue(venues) {
    return Object.entries(venues)
      .map(([venue, probes], index) => ({
        venue,
        count: this._countAvailable(probes),
        index,
      }))
      .sort((a, b) => b.count - a.count || a.index - b.index)[0].venue;
  }

  static _countAvailable(probes = {}) {
    return CORE_CAPABILITIES.filter((capability) => probes[capability]?.available).length;
  }

  static _buildEffectiveCapabilities(venues, primaryVenue) {
    const fallbackOrder = [
      primaryVenue,
      ...Object.keys(venues).filter((venue) => venue !== primaryVenue),
    ];

    return Object.fromEntries(CORE_CAPABILITIES.map((capability) => {
      const selected = fallbackOrder
        .map((venue) => venues[venue]?.[capability])
        .find((probe) => probe?.available);

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

  static _sourceVenue(source) {
    const value = String(source || '').toUpperCase();
    if (value.startsWith('BYBIT')) return 'BYBIT';
    if (value.startsWith('OKX')) return 'OKX';
    if (value.startsWith('GATE')) return 'GATE';
    return null;
  }
}

ExtremeDataAudit.CORE_CAPABILITIES = CORE_CAPABILITIES;

module.exports = ExtremeDataAudit;
