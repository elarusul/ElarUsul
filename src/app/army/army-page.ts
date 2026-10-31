import { DecimalPipe } from "@angular/common";
import { Component, computed, effect, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  ARMY_TYPE_LABELS,
  ARMY_TYPE_LABELS_EN,
  ARMY_TYPES,
  ArmyType,
  DEFAULT_CURRENT,
  DEFAULT_RATES,
  DEFAULT_TIERS,
  FLOOR_SILVER,
  FLYING_MIN_TIER,
  OFFICIAL_LEADERSHIP,
  cloneGrid,
  emptyGrid,
  emptyRow,
  isTypeAvailable,
} from "./army.data";
import {
  gridTotals,
  measureLeadership,
  planArmyTargets,
  silverForGrid,
  subtractGrids,
} from "./army.engine";

@Component({
  selector: "app-army",
  imports: [FormsModule, DecimalPipe],
  templateUrl: "./army-page.html",
  styleUrl: "./army-page.css",
})
export class ArmyPage {
  protected readonly types = ARMY_TYPES;
  protected readonly typeLabels = ARMY_TYPE_LABELS;
  protected readonly typeLabelsEn = ARMY_TYPE_LABELS_EN;
  protected readonly leadership = OFFICIAL_LEADERSHIP;
  protected readonly flyingMinTier = FLYING_MIN_TIER;

  protected readonly targetCapacity = signal(58679);
  protected readonly maxTier = signal(5);
  protected readonly pyramidRatio = signal(2);
  protected readonly enabled = signal<Record<ArmyType, boolean>>({
    melee: true,
    ranged: true,
    mounted: true,
    flying: true,
  });

  protected readonly current = signal(cloneGrid(DEFAULT_CURRENT, DEFAULT_TIERS));
  protected readonly rates = signal(cloneGrid(DEFAULT_RATES, DEFAULT_TIERS));

  protected readonly openHint = signal<string | null>(null);

  protected readonly plan = computed(() =>
    planArmyTargets({
      targetCapacity: this.targetCapacity(),
      maxTier: this.maxTier(),
      pyramidRatio: this.pyramidRatio(),
      enabled: this.enabled(),
    }),
  );

  protected readonly tiers = computed(() => this.plan().tiers);

  constructor() {
    effect(() => {
      const tiers = this.tiers();
      this.current.update((grid) => this.ensureGrid(grid, tiers, DEFAULT_CURRENT));
      this.rates.update((grid) =>
        this.ensureGrid(grid, tiers, DEFAULT_RATES),
      );
    });
  }

  private ensureGrid(
    grid: Record<number, Record<ArmyType, number>>,
    tiers: number[],
    fallback: Record<number, Record<ArmyType, number>>,
  ): Record<number, Record<ArmyType, number>> {
    const next = cloneGrid(grid, tiers);
    for (const tier of tiers) {
      if (Object.prototype.hasOwnProperty.call(grid, tier)) continue;
      const row = fallback[tier];
      if (!row) continue;
      for (const type of ARMY_TYPES) {
        next[tier][type] = isTypeAvailable(type, tier) ? (row[type] ?? 0) : 0;
      }
    }
    return next;
  }

  protected readonly targets = computed(() => this.plan().targets);

  protected readonly targetTotals = computed(() =>
    gridTotals(this.targets(), this.tiers()),
  );

  protected readonly toBuy = computed(() =>
    subtractGrids(this.targets(), this.current(), this.tiers()),
  );

  protected readonly toBuyTotals = computed(() =>
    gridTotals(this.toBuy(), this.tiers()),
  );

  protected readonly armyValue = computed(() =>
    silverForGrid(this.current(), this.rates(), this.tiers()),
  );

  protected readonly buyCost = computed(() =>
    silverForGrid(this.toBuy(), this.rates(), this.tiers(), true),
  );

  protected readonly currentLeadership = computed(() =>
    measureLeadership(this.current(), this.tiers()),
  );

  protected available(type: ArmyType, tier: number): boolean {
    return isTypeAvailable(type, tier);
  }

  protected setNumber(
    signalRef: { set(value: number): void },
    value: string | number,
  ): void {
    const n = typeof value === "number" ? value : Number(value);
    signalRef.set(Number.isFinite(n) ? n : 0);
  }

  protected setEnabled(type: ArmyType, value: boolean): void {
    this.enabled.update((current) => ({ ...current, [type]: value }));
  }

  protected setCurrent(tier: number, type: ArmyType, value: string | number): void {
    if (!isTypeAvailable(type, tier)) return;
    const n = typeof value === "number" ? value : Number(value);
    this.current.update((grid) => {
      const next = cloneGrid(grid, this.tiers());
      if (!next[tier]) next[tier] = emptyRow();
      next[tier][type] = Number.isFinite(n) ? Math.max(0, n) : 0;
      return next;
    });
  }

  protected setRate(tier: number, type: ArmyType, value: string | number): void {
    if (!isTypeAvailable(type, tier)) return;
    const n = typeof value === "number" ? value : Number(value);
    this.rates.update((grid) => {
      const next = cloneGrid(grid, this.tiers());
      if (!next[tier]) next[tier] = emptyRow();
      next[tier][type] = Number.isFinite(n) ? Math.max(0, n) : 0;
      return next;
    });
  }

  protected resetRatesToFloor(): void {
    const tiers = this.tiers();
    const grid = emptyGrid(tiers);
    for (const tier of tiers) {
      const floor = FLOOR_SILVER[tier];
      if (!floor) continue;
      for (const type of ARMY_TYPES) {
        grid[tier][type] = isTypeAvailable(type, tier) ? (floor[type] ?? 0) : 0;
      }
    }
    this.rates.set(grid);
  }

  protected clearCurrent(): void {
    this.current.set(emptyGrid(this.tiers()));
  }

  protected toggleHint(key: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.openHint.update((current) => (current === key ? null : key));
  }

  protected closeHint(): void {
    this.openHint.set(null);
  }
}