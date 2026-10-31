import { Component, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CAPTAINS } from './captains.data';
import { Captain, FACTIONS, RARITY_LABEL } from './captain.model';
import { clampLevel, shieldForLevel } from './shields';

const MAX_STARS = 7;
const STARS_STORAGE_KEY = 'elar-usul.captain-stars';
const LEVELS_STORAGE_KEY = 'elar-usul.captain-levels';
const ORDER_STORAGE_KEY = 'elar-usul.captain-order';

const CAPTAIN_BY_ID = new Map(CAPTAINS.map((captain) => [captain.id, captain]));

function clampStars(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_STARS, Math.max(0, Math.round(n)));
}

function defaultStarCounts(): Map<string, number> {
  return new Map(
    CAPTAINS.map((captain) => [captain.id, clampStars(captain.stars)]),
  );
}

function defaultLevels(): Map<string, number> {
  return new Map(
    CAPTAINS.map((captain) => [
      captain.id,
      clampLevel(captain.level ?? 1),
    ]),
  );
}

function defaultOrder(): string[] {
  return [
    ...CAPTAINS.filter((captain) => captain.group === 'special').map((c) => c.id),
    ...CAPTAINS.filter((captain) => captain.group === 'regular').map((c) => c.id),
  ];
}

function loadOrder(): string[] {
  const defaults = defaultOrder();
  try {
    const raw = localStorage.getItem(ORDER_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaults;
    const known = new Set(defaults);
    const order = parsed.filter(
      (id): id is string => typeof id === 'string' && known.has(id),
    );
    for (const id of defaults) {
      if (!order.includes(id)) order.push(id);
    }
    return order;
  } catch {
    return defaults;
  }
}

function saveOrder(order: readonly string[]): void {
  try {
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function loadMap(
  key: string,
  defaults: Map<string, number>,
  clamp: (value: unknown) => number,
): Map<string, number> {
  const values = new Map(defaults);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return values;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const captain of CAPTAINS) {
      if (Object.prototype.hasOwnProperty.call(parsed, captain.id)) {
        values.set(captain.id, clamp(parsed[captain.id]));
      }
    }
  } catch {
    // Keep defaults when storage is missing or corrupt.
  }
  return values;
}

function saveMap(
  key: string,
  values: ReadonlyMap<string, number>,
  fallback: (captain: Captain) => number,
): void {
  const payload: Record<string, number> = {};
  for (const captain of CAPTAINS) {
    payload[captain.id] = values.get(captain.id) ?? fallback(captain);
  }
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

@Component({
  selector: 'app-captains',
  imports: [FormsModule],
  templateUrl: './captains-page.html',
  styleUrl: './captains-page.css',
})
export class CaptainsPage {
  protected readonly maxStars = MAX_STARS;
  protected readonly starSlots = Array.from({ length: MAX_STARS }, (_, i) => i + 1);
  protected readonly starFull = 'stars/full.png';
  protected readonly starEmpty = 'stars/empty.png';

  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly starCounts = signal<ReadonlyMap<string, number>>(
    loadMap(STARS_STORAGE_KEY, defaultStarCounts(), clampStars),
  );
  protected readonly levels = signal<ReadonlyMap<string, number>>(
    loadMap(LEVELS_STORAGE_KEY, defaultLevels(), clampLevel),
  );
  protected readonly orderIds = signal<readonly string[]>(loadOrder());
  protected readonly draggingId = signal<string | null>(null);
  protected readonly dropTargetId = signal<string | null>(null);

  private suppressClick = false;

  constructor() {
    effect(() => {
      saveMap(STARS_STORAGE_KEY, this.starCounts(), (c) => clampStars(c.stars));
    });
    effect(() => {
      saveMap(LEVELS_STORAGE_KEY, this.levels(), (c) => clampLevel(c.level ?? 1));
    });
    effect(() => {
      saveOrder(this.orderIds());
    });
  }

  protected readonly captains = computed(() =>
    this.orderIds()
      .map((id) => CAPTAIN_BY_ID.get(id))
      .filter((captain): captain is Captain => !!captain),
  );

  protected readonly selectedCaptains = computed(() => {
    const selected = this.selectedIds();
    return this.captains().filter((captain) => selected.has(captain.id));
  });

  protected factionIcon(captain: Captain): string | null {
    return FACTIONS[captain.faction].icon ?? null;
  }

  protected rarityLabel(captain: Captain): string {
    return RARITY_LABEL[captain.rarity];
  }

  protected bonusLines(captain: Captain): readonly {
    label: string;
    value: string;
    hint: string;
  }[] {
    const level = this.levelOf(captain);
    return captain.levelBonuses.map((rate) => {
      const effective = rate.levelCap ? Math.min(level, rate.levelCap) : level;
      const raw = effective * rate.perLevel;
      const value = Number.isInteger(raw) ? String(raw) : raw.toFixed(1);
      const hint =
        rate.levelCap && level > rate.levelCap
          ? `(${rate.perLevel}% × poz. do ${rate.levelCap})`
          : `(${rate.perLevel}% × poz. ${effective})`;
      return { label: rate.label, value, hint };
    });
  }

  protected starsOf(captain: Captain): number {
    return this.starCounts().get(captain.id) ?? 0;
  }

  protected levelOf(captain: Captain): number {
    return this.levels().get(captain.id) ?? clampLevel(captain.level ?? 1);
  }

  protected shieldIcon(captain: Captain): string {
    return shieldForLevel(this.levelOf(captain)).icon;
  }

  protected isSelected(captain: Captain): boolean {
    return this.selectedIds().has(captain.id);
  }

  protected onCardClick(captain: Captain): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.toggle(captain);
  }

  protected toggle(captain: Captain): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(captain.id)) {
        next.delete(captain.id);
      } else {
        next.add(captain.id);
      }
      return next;
    });
  }

  protected onDragStart(captain: Captain, event: DragEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.star, .stars, .level-badge, .level-input')) {
      event.preventDefault();
      return;
    }
    this.draggingId.set(captain.id);
    this.dropTargetId.set(null);
    event.dataTransfer?.setData('text/plain', captain.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  protected onDragOver(captain: Captain, event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const dragging = this.draggingId();
    if (!dragging || dragging === captain.id) {
      this.dropTargetId.set(null);
      return;
    }
    this.dropTargetId.set(captain.id);
  }

  protected onDrop(captain: Captain, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const fromId =
      this.draggingId() || event.dataTransfer?.getData('text/plain') || null;
    const toId = captain.id;
    if (!fromId || fromId === toId) {
      this.clearDragState();
      return;
    }
    this.orderIds.update((order) => {
      const next = [...order];
      const from = next.indexOf(fromId);
      const to = next.indexOf(toId);
      if (from < 0 || to < 0) return order;
      next.splice(from, 1);
      next.splice(to, 0, fromId);
      return next;
    });
    this.suppressClick = true;
    this.clearDragState();
  }

  protected onDragEnd(): void {
    this.clearDragState();
  }

  private clearDragState(): void {
    this.draggingId.set(null);
    this.dropTargetId.set(null);
  }

  protected onStarClick(captain: Captain, slot: number, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const current = this.starsOf(captain);
    const next = slot <= current ? slot - 1 : slot;
    this.starCounts.update((map) => {
      const copy = new Map(map);
      copy.set(captain.id, clampStars(next));
      return copy;
    });
  }

  protected onLevelChange(captain: Captain, value: string | number): void {
    this.levels.update((map) => {
      const copy = new Map(map);
      copy.set(captain.id, clampLevel(value));
      return copy;
    });
  }

  protected stopCardToggle(event: Event): void {
    event.stopPropagation();
  }
}
