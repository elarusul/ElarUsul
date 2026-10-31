/** Relative combat stats by tier (community approximation for epic stacking ratios). */
export type TroopRole = 'melee' | 'ranged' | 'mounted' | 'flying';
export type TroopKind = 'guardsmen' | 'specialists' | 'monsters';

export interface TierStats {
  tier: number;
  /** Relative unit health (higher tier = more HP per unit). */
  health: number;
  /** Relative unit strength. */
  strength: number;
  /** Relative leadership / dominance cost per unit. */
  cost: number;
}

/** Relative leadership cost by role (same tier). */
export const ROLE_COST: Record<TroopRole, number> = {
  melee: 4,
  mounted: 2,
  ranged: 1,
  flying: 1,
};

export const ROLE_LABELS: Record<TroopRole, string> = {
  melee: 'Wręcz',
  ranged: 'Dystans',
  mounted: 'Kawaleria',
  flying: 'Latanie',
};

/** Approx. relative HP/STR growth ~1.75× per tier (enough for 2:1 style stacking). */
export function tierStats(tier: number): TierStats {
  const factor = Math.pow(1.75, tier - 3);
  return {
    tier,
    health: 100 * factor,
    strength: 100 * factor,
    cost: 1,
  };
}

export function roleLabel(role: TroopRole): string {
  return ROLE_LABELS[role];
}

export function kindLabel(kind: TroopKind): string {
  switch (kind) {
    case 'guardsmen':
      return 'Gwardziści';
    case 'specialists':
      return 'Specjaliści';
    case 'monsters':
      return 'Potwory';
  }
}

export function stackCode(kind: TroopKind, tier: number): string {
  const prefix = kind === 'guardsmen' ? 'G' : kind === 'specialists' ? 'S' : 'M';
  return `${prefix}${tier}`;
}
