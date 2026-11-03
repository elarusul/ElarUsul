/**
 * Troop icons from Total Battle Wiki (totalbattlewiki.com/_astro/…).
 * Local copies under public/troops/.
 */

import type { ArmyType } from './army.data';
import type { MonsterRace } from './monsters.data';

const GUARDS_BY_TIER: Record<number, Record<ArmyType, string>> = {
  1: {
    melee: 'spearman-i.png',
    ranged: 'archer-i.png',
    mounted: 'rider-i.png',
    flying: 'battle-griffin-v.png',
  },
  2: {
    melee: 'spearman-ii.png',
    ranged: 'archer-ii.png',
    mounted: 'rider-ii.png',
    flying: 'battle-griffin-v.png',
  },
  3: {
    melee: 'spearman-iii.png',
    ranged: 'archer-iii.png',
    mounted: 'rider-iii.png',
    flying: 'battle-griffin-v.png',
  },
  4: {
    melee: 'spearman-iv.png',
    ranged: 'archer-iv.png',
    mounted: 'rider-iv.png',
    flying: 'battle-griffin-v.png',
  },
  5: {
    melee: 'spearman-v.png',
    ranged: 'archer-v.png',
    mounted: 'rider-v.png',
    flying: 'battle-griffin-v.png',
  },
  6: {
    melee: 'heavy-halberdier-vi.webp',
    ranged: 'heavy-arbalester-vi.webp',
    mounted: 'mounted-knight-vi.webp',
    flying: 'battle-griffin-vi.webp',
  },
  7: {
    melee: 'heavy-halberdier-vii.webp',
    ranged: 'heavy-arbalester-vii.webp',
    mounted: 'mounted-knight-vii.webp',
    flying: 'battle-griffin-vii.webp',
  },
};

/** Representative line icon (checkbox / column header). */
const GUARDS_LINE: Record<ArmyType, string> = {
  melee: 'spearman-i.png',
  ranged: 'archer-i.png',
  mounted: 'rider-i.png',
  flying: 'battle-griffin-v.png',
};

const MONSTERS_BY_TIER: Record<number, Record<MonsterRace, string>> = {
  3: {
    beast: 'battle-boar.png',
    giant: 'stone-gargoyle.png',
    elemental: 'water-elemental.png',
    dragon: 'emerald-dragon.png',
  },
  4: {
    beast: 'gorgon-medusa.png',
    giant: 'many-armed-giant.png',
    elemental: 'ice-phoenix.png',
    dragon: 'magic-dragon.png',
  },
  5: {
    beast: 'fearsome-manticore.webp',
    giant: 'ettin.webp',
    elemental: 'flaming-centaur.webp',
    dragon: 'desert-vanquisher.webp',
  },
  6: {
    beast: 'jungle-destroyer.webp',
    giant: 'troll-rider.webp',
    elemental: 'ruby-golem.webp',
    dragon: 'crystal-dragon.webp',
  },
  7: {
    beast: 'ancient-terror.webp',
    giant: 'destructive-colossus.webp',
    elemental: 'wind-lord.webp',
    dragon: 'black-dragon.webp',
  },
  8: {
    beast: 'trickster-i.webp',
    giant: 'kraken-i.webp',
    elemental: 'fire-phoenix-i.webp',
    dragon: 'devastator-i.webp',
  },
  9: {
    beast: 'trickster-ii.webp',
    giant: 'kraken-ii.webp',
    elemental: 'fire-phoenix-ii.webp',
    dragon: 'devastator-ii.webp',
  },
};

const MONSTER_LINE: Record<MonsterRace, string> = {
  beast: 'battle-boar.png',
  giant: 'stone-gargoyle.png',
  elemental: 'water-elemental.png',
  dragon: 'emerald-dragon.png',
};

export function guardsLineIcon(type: ArmyType): string {
  return `troops/guards/${GUARDS_LINE[type]}`;
}

export function guardsTierIcon(type: ArmyType, tier: number): string {
  const row = GUARDS_BY_TIER[tier] ?? GUARDS_BY_TIER[1];
  return `troops/guards/${row[type]}`;
}

export function monsterLineIcon(race: MonsterRace): string {
  return `troops/monsters/${MONSTER_LINE[race]}`;
}

export function monsterTierIcon(race: MonsterRace, tier: number): string {
  const row = MONSTERS_BY_TIER[tier] ?? MONSTERS_BY_TIER[3];
  return `troops/monsters/${row[race]}`;
}
