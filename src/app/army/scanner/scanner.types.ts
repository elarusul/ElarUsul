import type { ArmyType } from '../army.data';
import type { MonsterRace } from '../monsters.data';

export type ScanUnitKind = 'guards' | 'monsters';

export interface ScanRef {
  kind: ScanUnitKind;
  tier: number;
  /** ArmyType for guards, MonsterRace for monsters */
  key: string;
  path: string;
  label: string;
}

export interface ScanHit {
  ref: ScanRef;
  count: number | null;
  score: number;
  ocrText: string;
  /** Crop of matched tile as data URL (for preview). */
  previewUrl: string;
  x: number;
  y: number;
  size: number;
}

export interface ScanResult {
  hits: ScanHit[];
  unmatchedTiles: number;
  durationMs: number;
}

export type GuardsScanGrid = Record<number, Partial<Record<ArmyType, number>>>;
export type MonstersScanGrid = Record<
  number,
  Partial<Record<MonsterRace, number>>
>;
