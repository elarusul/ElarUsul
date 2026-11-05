import {
  ARMY_TYPES,
  ArmyType,
  DEFAULT_RATES,
  DEFAULT_TIERS,
  GUARDS_MAX_TIER,
  cloneGrid,
  emptyGrid,
} from './army.data';
import {
  DEFAULT_MONSTER_COIN_RATES,
  DEFAULT_MONSTER_SILVER_RATES,
  MONSTER_MIN_TIER,
  MONSTER_PLAN_MAX_TIER,
  MONSTER_RACES,
  MonsterGrid,
  MonsterRace,
  cloneMonsterGrid,
  emptyMonsterGrid,
} from './monsters.data';

const STORAGE_KEY = 'elar-usul.army-state';
const STORAGE_VERSION = 2;

export interface ArmyPersistedState {
  v: number;
  targetCapacity: number;
  dominance: number;
  /** How many identical marches/attacks to prepare for (multiplies targets). */
  attacks: number;
  maxTier: number;
  maxTierS: number;
  maxTierM: number;
  pyramidRatio: number;
  roundMonstersToTens: boolean;
  enabled: Record<ArmyType, boolean>;
  monstersEnabled: Record<MonsterRace, boolean>;
  current: Record<number, Record<ArmyType, number>>;
  rates: Record<number, Record<ArmyType, number>>;
  currentMonsters: MonsterGrid;
  monsterSilverRates: MonsterGrid;
  monsterCoinRates: MonsterGrid;
  showSilver: boolean;
}

const DEFAULT_ENABLED: Record<ArmyType, boolean> = {
  melee: true,
  ranged: true,
  mounted: true,
  flying: true,
};

const DEFAULT_MONSTERS_ENABLED: Record<MonsterRace, boolean> = {
  beast: true,
  giant: true,
  elemental: true,
  dragon: true,
};

/** Pierwsze uruchomienie (pusty storage): zera — dane pojawiają się po wczytaniu / wpisaniu. */
export function defaultArmyState(): ArmyPersistedState {
  const tiers = [...DEFAULT_TIERS];
  const monsterTiers = [3, 4];
  return {
    v: STORAGE_VERSION,
    targetCapacity: 0,
    dominance: 0,
    attacks: 1,
    maxTier: 5,
    maxTierS: 5,
    maxTierM: 4,
    pyramidRatio: 2,
    roundMonstersToTens: true,
    enabled: { ...DEFAULT_ENABLED },
    monstersEnabled: { ...DEFAULT_MONSTERS_ENABLED },
    current: emptyGrid(tiers),
    rates: cloneGrid(DEFAULT_RATES, tiers),
    currentMonsters: emptyMonsterGrid(monsterTiers),
    monsterSilverRates: cloneMonsterGrid(
      DEFAULT_MONSTER_SILVER_RATES,
      [3, 4, 5, 6, 7, 8, 9],
    ),
    monsterCoinRates: cloneMonsterGrid(
      DEFAULT_MONSTER_COIN_RATES,
      [3, 4, 5, 6, 7, 8, 9],
    ),
    showSilver: false,
  };
}

function asFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function reviveEnabled(
  raw: unknown,
  fallback: Record<ArmyType, boolean>,
): Record<ArmyType, boolean> {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  for (const type of ARMY_TYPES) {
    if (typeof obj[type] === 'boolean') out[type] = obj[type];
  }
  return out;
}

function reviveMonstersEnabled(
  raw: unknown,
  fallback: Record<MonsterRace, boolean>,
): Record<MonsterRace, boolean> {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  for (const race of MONSTER_RACES) {
    if (typeof obj[race] === 'boolean') out[race] = obj[race];
  }
  return out;
}

function reviveArmyGrid(
  raw: unknown,
  fallback: Record<number, Record<ArmyType, number>>,
): Record<number, Record<ArmyType, number>> {
  const tiers = Object.keys(fallback)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const baseTiers =
    tiers.length > 0
      ? tiers
      : raw && typeof raw === 'object'
        ? Object.keys(raw as object)
            .map(Number)
            .filter((n) => Number.isFinite(n))
            .sort((a, b) => a - b)
        : [...DEFAULT_TIERS];

  const grid = cloneGrid(fallback, baseTiers.length ? baseTiers : DEFAULT_TIERS);
  if (!raw || typeof raw !== 'object') return grid;

  for (const [key, row] of Object.entries(raw as Record<string, unknown>)) {
    const tier = Number(key);
    if (!Number.isFinite(tier) || !row || typeof row !== 'object') continue;
    if (!grid[tier]) grid[tier] = { melee: 0, ranged: 0, mounted: 0, flying: 0 };
    const src = row as Record<string, unknown>;
    for (const type of ARMY_TYPES) {
      grid[tier][type] = Math.max(0, asFiniteNumber(src[type], grid[tier][type]));
    }
  }
  return grid;
}

function reviveMonsterGrid(raw: unknown, fallback: MonsterGrid): MonsterGrid {
  const tiers = Object.keys(fallback)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const fromRaw =
    raw && typeof raw === 'object'
      ? Object.keys(raw as object)
          .map(Number)
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b)
      : [];
  const allTiers = [...new Set([...tiers, ...fromRaw])].sort((a, b) => a - b);
  const grid = cloneMonsterGrid(fallback, allTiers.length ? allTiers : [3, 4]);
  if (!raw || typeof raw !== 'object') return grid;

  for (const [key, row] of Object.entries(raw as Record<string, unknown>)) {
    const tier = Number(key);
    if (!Number.isFinite(tier) || !row || typeof row !== 'object') continue;
    if (!grid[tier]) {
      grid[tier] = { beast: 0, giant: 0, elemental: 0, dragon: 0 };
    }
    const src = row as Record<string, unknown>;
    for (const race of MONSTER_RACES) {
      grid[tier][race] = Math.max(0, asFiniteNumber(src[race], grid[tier][race]));
    }
  }
  return grid;
}

export function loadArmyState(): ArmyPersistedState {
  const defaults = defaultArmyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ArmyPersistedState>;
    if (!parsed || typeof parsed !== 'object') return defaults;

    return {
      v: STORAGE_VERSION,
      targetCapacity: Math.max(0, asFiniteNumber(parsed.targetCapacity, defaults.targetCapacity)),
      dominance: Math.max(0, asFiniteNumber(parsed.dominance, defaults.dominance)),
      attacks: Math.max(
        1,
        Math.min(99, Math.round(asFiniteNumber(parsed.attacks, defaults.attacks))),
      ),
      maxTier: Math.max(
        1,
        Math.min(
          GUARDS_MAX_TIER,
          Math.round(asFiniteNumber(parsed.maxTier, defaults.maxTier)),
        ),
      ),
      maxTierS: Math.max(1, Math.min(9, Math.round(asFiniteNumber(parsed.maxTierS, defaults.maxTierS)))),
      maxTierM: Math.max(
        MONSTER_MIN_TIER,
        Math.min(
          MONSTER_PLAN_MAX_TIER,
          Math.round(asFiniteNumber(parsed.maxTierM, defaults.maxTierM)),
        ),
      ),
      pyramidRatio: Math.max(
        1.01,
        Math.min(5, asFiniteNumber(parsed.pyramidRatio, defaults.pyramidRatio)),
      ),
      roundMonstersToTens: asBoolean(
        parsed.roundMonstersToTens,
        defaults.roundMonstersToTens,
      ),
      enabled: reviveEnabled(parsed.enabled, defaults.enabled),
      monstersEnabled: reviveMonstersEnabled(
        parsed.monstersEnabled,
        defaults.monstersEnabled,
      ),
      current: reviveArmyGrid(parsed.current, defaults.current),
      rates: reviveArmyGrid(parsed.rates, defaults.rates),
      currentMonsters: reviveMonsterGrid(
        parsed.currentMonsters,
        defaults.currentMonsters,
      ),
      monsterSilverRates: reviveMonsterGrid(
        parsed.monsterSilverRates,
        defaults.monsterSilverRates,
      ),
      monsterCoinRates: reviveMonsterGrid(
        parsed.monsterCoinRates,
        defaults.monsterCoinRates,
      ),
      showSilver: asBoolean(parsed.showSilver, defaults.showSilver),
    };
  } catch {
    return defaults;
  }
}

export function saveArmyState(state: ArmyPersistedState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, v: STORAGE_VERSION }),
    );
  } catch {
    // Ignore quota / private-mode failures.
  }
}
