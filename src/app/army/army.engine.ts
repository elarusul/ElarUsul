import {
  ARMY_TYPES,
  ArmyType,
  OFFICIAL_LEADERSHIP,
  emptyRow,
  isTypeAvailable,
} from './army.data';
import {
  MONSTER_DOMINANCE,
  MONSTER_RACES,
  MonsterGrid,
  MonsterRace,
  emptyMonsterGrid,
  emptyMonsterRow,
  monsterTiersUpTo,
} from './monsters.data';

export interface ArmyPlanInput {
  /** Target Leadership (value after slash on the march screen). */
  targetCapacity: number;
  maxTier: number;
  /** Lower-tier unit multiplier vs next higher tier (classic ~2). */
  pyramidRatio: number;
  enabled: Record<ArmyType, boolean>;
}

export type ArmyGrid = Record<number, Record<ArmyType, number>>;

export interface ArmyPlanResult {
  targets: ArmyGrid;
  leadershipUsed: number;
  tiers: number[];
}

/**
 * Leadership share weights (Total Battle epic spreadsheet logic).
 * Melee/ranged same HP → same count → weight 3.
 * Mounted ~3× HP and L2 → 1/3 count for equal stack HP → weight 2 (= 2/3 of melee L).
 * Flying gets the same Leadership budget as mounted (weight 2).
 */
export const TYPE_SHARE_WEIGHT: Record<ArmyType, number> = {
  melee: 3,
  ranged: 3,
  mounted: 2,
  flying: 2,
};

function unitLeadership(type: ArmyType): number {
  return OFFICIAL_LEADERSHIP[type];
}

/** Types that are enabled and exist on at least one tier in range. */
function activeTypes(
  tiers: number[],
  enabled: Record<ArmyType, boolean>,
): ArmyType[] {
  return ARMY_TYPES.filter(
    (type) =>
      enabled[type] && tiers.some((tier) => isTypeAvailable(type, tier)),
  );
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
 * Pyramid army for a Leadership budget — spreadsheet logic:
 * 1) Split Leadership by type weights 3:3:2:2 (melee:ranged:mounted:flying).
 * 2) Within each type, split that budget across tiers by pyramid weights.
 * 3) Convert tier Leadership → unit count via official cost (1/1/2/20).
 */
export function planArmyTargets(input: ArmyPlanInput): ArmyPlanResult {
  const maxTier = Math.max(1, Math.min(7, Math.floor(input.maxTier)));
  const ratio = Math.max(1.01, input.pyramidRatio);
  const tiers = Array.from({ length: maxTier }, (_, i) => i + 1);
  const targets: ArmyGrid = {};
  for (const tier of tiers) {
    targets[tier] = emptyRow();
  }

  const budget = Math.max(0, input.targetCapacity);
  const types = activeTypes(tiers, input.enabled);
  if (!types.length || budget <= 0) {
    return { targets, leadershipUsed: 0, tiers };
  }

  const weightSum = types.reduce((sum, type) => sum + TYPE_SHARE_WEIGHT[type], 0);
  const tierWeights = tiers.map((tier) => Math.pow(ratio, maxTier - tier));

  for (const type of types) {
    const typeBudget = (budget * TYPE_SHARE_WEIGHT[type]) / weightSum;
    const cost = unitLeadership(type);
    if (cost <= 0) continue;

    const typeTiers = tiers.filter((tier) => isTypeAvailable(type, tier));
    if (!typeTiers.length) continue;

    const typeTierWeightSum = typeTiers.reduce(
      (sum, tier) => sum + tierWeights[tier - 1],
      0,
    );
    if (typeTierWeightSum <= 0) continue;

    for (const tier of typeTiers) {
      const tierLead =
        (typeBudget * tierWeights[tier - 1]) / typeTierWeightSum;
      targets[tier][type] = Math.floor(tierLead / cost);
    }
  }

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

export interface MonsterPlanInput {
  dominance: number;
  maxTier: number;
  pyramidRatio: number;
  enabled: Record<MonsterRace, boolean>;
  /** Official Temple tip: trim stacks to whole tens. */
  roundToTens: boolean;
}

export interface MonsterPlanResult {
  targets: MonsterGrid;
  dominanceUsed: number;
  tiers: number[];
}

function roundDownToTen(n: number): number {
  if (n < 10) return n;
  return Math.floor(n / 10) * 10;
}

export function measureDominance(grid: MonsterGrid, tiers: number[]): number {
  let total = 0;
  for (const tier of tiers) {
    const row = grid[tier];
    const costs = MONSTER_DOMINANCE[tier];
    if (!row || !costs) continue;
    for (const race of MONSTER_RACES) {
      total += Math.max(0, row[race] ?? 0) * costs[race];
    }
  }
  return total;
}

/**
 * Monster pyramid on Dominance:
 * equal Dominance share per enabled race, pyramid across M3…maxTier,
 * count = floor(tierDominance / official cost). Optional ×10 trim.
 */
export function planMonsterTargets(input: MonsterPlanInput): MonsterPlanResult {
  const tiers = monsterTiersUpTo(input.maxTier);
  const targets = emptyMonsterGrid(tiers);
  const budget = Math.max(0, input.dominance);
  const races = MONSTER_RACES.filter((race) => input.enabled[race]);
  const ratio = Math.max(1.01, input.pyramidRatio);

  if (!races.length || budget <= 0 || !tiers.length) {
    return { targets, dominanceUsed: 0, tiers };
  }

  const maxTier = tiers[tiers.length - 1];
  const tierWeights = tiers.map((tier) => Math.pow(ratio, maxTier - tier));
  const tierWeightSum = tierWeights.reduce((a, b) => a + b, 0);
  const raceBudget = budget / races.length;

  races.forEach((race) => {
    tiers.forEach((tier, index) => {
      const cost = MONSTER_DOMINANCE[tier]?.[race] ?? 0;
      if (cost <= 0 || tierWeightSum <= 0) return;
      const tierDom = (raceBudget * tierWeights[index]) / tierWeightSum;
      let count = Math.floor(tierDom / cost);
      if (input.roundToTens) count = roundDownToTen(count);
      targets[tier][race] = count;
    });
  });

  return {
    targets,
    dominanceUsed: measureDominance(targets, tiers),
    tiers,
  };
}

export function monsterGridTotals(
  grid: MonsterGrid,
  tiers: number[],
): Record<MonsterRace, number> {
  const totals = emptyMonsterRow();
  for (const tier of tiers) {
    const row = grid[tier];
    if (!row) continue;
    for (const race of MONSTER_RACES) {
      totals[race] += row[race] ?? 0;
    }
  }
  return totals;
}

export function subtractMonsterGrids(
  targets: MonsterGrid,
  current: MonsterGrid,
  tiers: number[],
): MonsterGrid {
  const out = emptyMonsterGrid(tiers);
  for (const tier of tiers) {
    for (const race of MONSTER_RACES) {
      out[tier][race] = Math.max(
        0,
        (targets[tier]?.[race] ?? 0) - (current[tier]?.[race] ?? 0),
      );
    }
  }
  return out;
}

export function costForMonsterGrid(
  counts: MonsterGrid,
  rates: MonsterGrid,
  tiers: number[],
  onlyPositiveCounts = false,
): { perRace: Record<MonsterRace, number>; cells: MonsterGrid; total: number } {
  const cells = emptyMonsterGrid(tiers);
  const perRace = emptyMonsterRow();
  let total = 0;

  for (const tier of tiers) {
    for (const race of MONSTER_RACES) {
      const count = counts[tier]?.[race] ?? 0;
      const qty = onlyPositiveCounts ? Math.max(0, count) : count;
      const cost = qty * (rates[tier]?.[race] ?? 0);
      cells[tier][race] = cost;
      perRace[race] += cost;
      total += cost;
    }
  }

  return { perRace, cells, total };
}
