export type CaptainGroup = 'special' | 'regular';

export type FactionId = 'emerald' | 'azure' | 'crimson';

export type FrameId = 'gold' | 'purple' | 'teal' | 'copper';

export type CaptainRarity = 'mythic' | 'legendary' | 'epic' | 'rare';

export interface Faction {
  id: FactionId;
  name: string;
  emblem: string;
  color: string;
  /** Optional badge overlay shown on the captain portrait. */
  icon?: string;
}

export interface FrameStyle {
  id: FrameId;
  name: string;
  rarity: string;
  color: string;
}

/** Official per-level bonus rate from Total Battle wiki / support. */
export interface LevelBonusRate {
  /** Short Polish label for this rate line. */
  label: string;
  /** Percent points gained per captain level. */
  perLevel: number;
  /** Soft cap — bonus stops growing after this level (Carter, Doria). */
  levelCap?: number;
}

export interface Captain {
  id: string;
  name: string;
  group: CaptainGroup;
  image: string;
  faction: FactionId;
  frame: FrameId;
  rarity: CaptainRarity;
  level: number | null;
  stars: number;
  alert: boolean;
  fragments?: { current: number; total: number };
  /** Official short skill description (PL). */
  bonus: string;
  /** Official per-level rates used to compute current bonus. */
  levelBonuses: readonly LevelBonusRate[];
}

export const FACTIONS: Record<FactionId, Faction> = {
  emerald: {
    id: 'emerald',
    name: 'Szmaragdowa',
    emblem: 'Orzeł',
    color: '#1c8f84',
    icon: 'factions/emerald.png',
  },
  azure: {
    id: 'azure',
    name: 'Błękitna',
    emblem: 'Wilk',
    color: '#2d6fbe',
    icon: 'factions/azure.png',
  },
  crimson: { id: 'crimson', name: 'Szkarłatna', emblem: 'Smok', color: '#c4472d' },
};

export const FRAMES: Record<FrameId, FrameStyle> = {
  gold: { id: 'gold', name: 'Złota', rarity: 'Legendarny', color: '#c9a24a' },
  purple: { id: 'purple', name: 'Fioletowa', rarity: 'Epicki', color: '#9b4d9e' },
  teal: { id: 'teal', name: 'Turkusowa', rarity: 'Rzadki', color: '#3e8f8a' },
  copper: { id: 'copper', name: 'Miedziana', rarity: 'Nieodblokowany', color: '#a8563a' },
};

export const RARITY_LABEL: Record<CaptainRarity, string> = {
  mythic: 'Mityczny',
  legendary: 'Legendarny',
  epic: 'Epicki',
  rare: 'Rzadki',
};

export const LEVEL_BADGE = {
  name: 'Brązowa odznaka',
  color: '#f4e2bc',
  background: '#c47a2a',
};
