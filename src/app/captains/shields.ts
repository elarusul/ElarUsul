/** Level shield tiers — more graphics will be added later (6 total). */
export const MAX_CAPTAIN_LEVEL = 600;
export const SHIELD_TIER_SIZE = 100;

export type ShieldTierId = 'bronze' | 'silver';

export interface ShieldTier {
  id: ShieldTierId;
  /** Inclusive lower bound. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  icon: string;
}

/** Currently available shield graphics (tiers 1–2 of 6). */
export const SHIELD_TIERS: ShieldTier[] = [
  { id: 'bronze', min: 1, max: 100, icon: 'shields/bronze.png' },
  { id: 'silver', min: 101, max: 200, icon: 'shields/silver.png' },
];

export function clampLevel(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_CAPTAIN_LEVEL, Math.max(1, Math.round(n)));
}

export function shieldForLevel(level: number): ShieldTier {
  const clamped = clampLevel(level);
  for (const tier of SHIELD_TIERS) {
    if (clamped >= tier.min && clamped <= tier.max) return tier;
  }
  // Until higher-tier art arrives, keep silver for levels above 200.
  return SHIELD_TIERS[SHIELD_TIERS.length - 1];
}
