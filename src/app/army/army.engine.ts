import {
  ARMY_TYPES,
  ArmyType,
  OFFICIAL_LEADERSHIP,
  emptyRow,
  isTypeAvailable,
} from './army.data';

export interface ArmyPlanInput {
  /** Target Leadership (value after slash on the march screen). */
  targetCapacity: number;
  maxTier: number;
  /** Lower-tier budget multiplier vs next higher tier (classic ~1.75–2). */
  pyramidRatio: number;
  enabled: Record<ArmyType, boolean>;
}

export type ArmyGrid = Record<number, Record<ArmyType, number>>;

export interface ArmyPlanResult {
  targets: ArmyGrid;
  leadershipUsed: number;
  tiers: number[];
}

function unitLeadership(type: ArmyType): number {
  return OFFICIAL_LEADERSHIP[type];
}

function enabledTypes(tier: number, enabled: Record<ArmyType, boolean>): ArmyType[] {
  return ARMY_TYPES.filter((type) => enabled[type] && isTypeAvailable(type, tier));
}

/** Official Leadership used by a grid. */
export function measureLeadership(grid: ArmyGrid, tiers: number[]): number {
  let total = 0;
  for (const tier of tiers) {
    const row = grid[tier];
    if (!row) continue;
    for (const type of ARMY_TYPES) {
      if (!isTypeAvailable(type, tier)) continue;
      total += Math.max(0, row[type] ?? 0) * unitLeadership(type);
    }
  }
  return total;
}

/**
 * Pyramid army for a Leadership budget.
 * Equal Leadership share across unlocked types on each tier.
 * Gryfy only from G5 (cost 20).
 */
export function planArmyTargets(input: ArmyPlanInput): ArmyPlanResult {
  const maxTier = Math.max(1, Math.min(7, Math.floor(input.maxTier)));
  const ratio = Math.max(1.01, input.pyramidRatio);
  const tiers = Array.from({ length: maxTier }, (_, i) => i + 1);
  const targets: ArmyGrid = {};
  for (const tier of tiers) {
    targets[tier] = emptyRow();
  }

  const tierWeights = tiers.map((tier) => Math.pow(ratio, maxTier - tier));
  const totalTierWeight = tierWeights.reduce((a, b) => a + b, 0);
  const budget = Math.max(0, input.targetCapacity);

  tiers.forEach((tier, index) => {
    const types = enabledTypes(tier, input.enabled);
    if (!types.length || totalTierWeight <= 0) return;

    const tierBudget = (budget * tierWeights[index]) / totalTierWeight;
    const share = tierBudget / types.length;

    for (const type of types) {
      const w = unitLeadership(type);
      targets[tier][type] = w > 0 ? Math.floor(share / w) : 0;
    }
  });

  return {
    targets,
    leadershipUsed: measureLeadership(targets, tiers),
    tiers,
  };
}

export function gridTotals(grid: ArmyGrid, tiers: number[]): Record<ArmyType, number> {
  const totals = emptyRow();
  for (const tier of tiers) {
    const row = grid[tier];
    if (!row) continue;
    for (const type of ARMY_TYPES) {
      if (!isTypeAvailable(type, tier)) continue;
      totals[type] += row[type] ?? 0;
    }
  }
  return totals;
}

export function subtractGrids(
  targets: ArmyGrid,
  current: ArmyGrid,
  tiers: number[],
): ArmyGrid {
  const out: ArmyGrid = {};
  for (const tier of tiers) {
    out[tier] = emptyRow();
    for (const type of ARMY_TYPES) {
      if (!isTypeAvailable(type, tier)) {
        out[tier][type] = 0;
        continue;
      }
      out[tier][type] = Math.max(
        0,
        (targets[tier]?.[type] ?? 0) - (current[tier]?.[type] ?? 0),
      );
    }
  }
  return out;
}

export function silverForGrid(
  counts: ArmyGrid,
  rates: ArmyGrid,
  tiers: number[],
  onlyPositiveCounts = false,
): { perType: Record<ArmyType, number>; cells: ArmyGrid; total: number } {
  const cells: ArmyGrid = {};
  const perType = emptyRow();
  let total = 0;

  for (const tier of tiers) {
    cells[tier] = emptyRow();
    for (const type of ARMY_TYPES) {
      if (!isTypeAvailable(type, tier)) continue;
      const count = counts[tier]?.[type] ?? 0;
      const qty = onlyPositiveCounts ? Math.max(0, count) : count;
      const cost = qty * (rates[tier]?.[type] ?? 0);
      cells[tier][type] = cost;
      perType[type] += cost;
      total += cost;
    }
  }

  return { perType, cells, total };
}
