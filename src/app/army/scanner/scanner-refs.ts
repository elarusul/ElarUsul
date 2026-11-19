import {
  ARMY_TYPES,
  FLYING_MIN_TIER,
  GUARDS_MAX_TIER,
  isTypeAvailable,
  type ArmyType,
} from '../army.data';
import {
  MONSTER_MIN_TIER,
  MONSTER_NAMES,
  MONSTER_PLAN_MAX_TIER,
  MONSTER_RACES,
  type MonsterRace,
} from '../monsters.data';
import { guardsTierIcon, monsterTierIcon } from '../troop-icons';
import type { ScanRef } from './scanner.types';

const TYPE_PL: Record<ArmyType, string> = {
  melee: 'Włócznicy',
  ranged: 'Łucznicy',
  mounted: 'Jeźdźcy',
  flying: 'Gryfy',
};

/** Calculator-only refs for the current max tiers. */
export function buildScannerRefs(
  guardsMaxTier = GUARDS_MAX_TIER,
  monstersMaxTier = MONSTER_PLAN_MAX_TIER,
): ScanRef[] {
  const refs: ScanRef[] = [];

  for (let tier = 1; tier <= guardsMaxTier; tier++) {
    for (const type of ARMY_TYPES) {
      if (!isTypeAvailable(type, tier)) continue;
      if (type === 'flying' && tier < FLYING_MIN_TIER) continue;
      refs.push({
        kind: 'guards',
        tier,
        key: type,
        path: guardsTierIcon(type, tier),
        label: `G${tier} ${TYPE_PL[type]}`,
      });
    }
  }

  for (let tier = MONSTER_MIN_TIER; tier <= monstersMaxTier; tier++) {
    for (const race of MONSTER_RACES) {
      const name = MONSTER_NAMES[tier]?.[race] ?? race;
      refs.push({
        kind: 'monsters',
        tier,
        key: race,
        path: monsterTierIcon(race, tier),
        label: `M${tier} ${name}`,
      });
    }
  }

  return refs;
}

export function isArmyType(key: string): key is ArmyType {
  return (ARMY_TYPES as string[]).includes(key);
}

export function isMonsterRace(key: string): key is MonsterRace {
  return (MONSTER_RACES as string[]).includes(key);
}
