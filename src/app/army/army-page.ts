import { DecimalPipe } from "@angular/common";
import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { I18nService } from "../i18n/i18n.service";
import {
  ARMY_TYPES,
  ArmyType,
  DEFAULT_RATES,
  FLOOR_SILVER,
  FLYING_MIN_TIER,
  GUARDS_MAX_TIER,
  classifyRatesOrigin,
  cloneGrid,
  emptyGrid,
  emptyRow,
  isTypeAvailable,
  ratesFromRangedBase,
} from "./army.data";
import {
  costForMonsterGrid,
  gridTotals,
  measureDominance,
  measureLeadership,
  monsterGridTotals,
  planArmyTargets,
  planMonsterTargets,
  normalizeAttacks,
  scaleGrid,
  scaleMonsterGrid,
  silverForGrid,
  subtractGrids,
  subtractMonsterGrids,
} from "./army.engine";
import {
  DEFAULT_MONSTER_COIN_RATES,
  DEFAULT_MONSTER_SILVER_RATES,
  MONSTER_DOMINANCE,
  MONSTER_FLOOR_DRAGON_COINS,
  MONSTER_FLOOR_SILVER,
  MONSTER_MIN_TIER,
  MONSTER_NAMES,
  MONSTER_PLAN_MAX_TIER,
  MONSTER_RACES,
  MonsterRace,
  cloneMonsterGrid,
  emptyMonsterGrid,
  emptyMonsterRow,
} from "./monsters.data";
import { loadArmyState, saveArmyState } from "./army.persist";
import { isArmyType, isMonsterRace } from "./scanner/scanner-refs";
import type { ScanHit } from "./scanner/scanner.types";
import { scanTroopScreenshot } from "./scanner/troop-scanner";
import { guardsTierIcon, monsterTierIcon } from "./troop-icons";

const SAVED = loadArmyState();

export interface ScanDraftRow {
  hit: ScanHit;
  count: number;
  include: boolean;
}

@Component({
  selector: "app-army",
  imports: [FormsModule, DecimalPipe],
  templateUrl: "./army-page.html",
  styleUrl: "./army-page.css",
})
export class ArmyPage {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly types = ARMY_TYPES;
  protected readonly monsterRaces = MONSTER_RACES;
  protected readonly flyingMinTier = FLYING_MIN_TIER;
  protected readonly monsterMinTier = MONSTER_MIN_TIER;
  protected readonly guardsMaxTier = GUARDS_MAX_TIER;
  protected readonly monsterPlanMaxTier = MONSTER_PLAN_MAX_TIER;

  protected typeLabel(type: ArmyType): string {
    return this.t()(`army.type.${type}`);
  }

  protected typeLabelEn(type: ArmyType): string {
    return this.t()(`army.type.${type}.en`);
  }

  protected raceLabel(race: MonsterRace): string {
    return this.t()(`army.race.${race}`);
  }

  protected raceLabelEn(race: MonsterRace): string {
    return this.t()(`army.race.${race}.en`);
  }

  protected monsterName(tier: number, race: MonsterRace): string {
    return MONSTER_NAMES[tier]?.[race] ?? "";
  }

  protected monsterCost(tier: number, race: MonsterRace): number {
    return MONSTER_DOMINANCE[tier]?.[race] ?? 0;
  }

  protected guardsTierIcon(type: ArmyType, tier: number): string {
    return guardsTierIcon(type, tier);
  }

  protected monsterTierIcon(race: MonsterRace, tier: number): string {
    return monsterTierIcon(race, tier);
  }

  private formatAmount(value: number): string {
    const locale = this.i18n.lang() === "pl" ? "pl-PL" : "en-US";
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
      value,
    );
  }

  protected valueFootHtml(): string {
    return this.t()("army.valueFoot", undefined, {
      total: this.formatAmount(this.armyValue().total),
    });
  }

  protected buyCostFootHtml(): string {
    return this.t()("army.buyCostFoot", undefined, {
      total: this.formatAmount(this.buyCost().total),
    });
  }

  protected monsterValueFootHtml(): string {
    return this.t()("army.monsterValueFoot", undefined, {
      silver: this.formatAmount(this.monsterValueSilver().total),
      coins: this.formatAmount(this.monsterValueCoins().total),
    });
  }

  protected monsterBuyCostFootHtml(): string {
    return this.t()("army.monsterBuyCostFoot", undefined, {
      silver: this.formatAmount(this.monsterBuySilver().total),
      coins: this.formatAmount(this.monsterBuyCoins().total),
    });
  }

  protected readonly targetCapacity = signal(SAVED.targetCapacity);
  protected readonly dominance = signal(SAVED.dominance);
  protected readonly attacks = signal(normalizeAttacks(SAVED.attacks ?? 1));
  protected readonly maxTier = signal(
    Math.min(GUARDS_MAX_TIER, Math.max(1, SAVED.maxTier)),
  );
  protected readonly maxTierS = signal(SAVED.maxTierS);
  protected readonly maxTierM = signal(
    Math.min(
      MONSTER_PLAN_MAX_TIER,
      Math.max(MONSTER_MIN_TIER, SAVED.maxTierM),
    ),
  );
  protected readonly pyramidRatio = signal(SAVED.pyramidRatio);

  protected readonly enabled = signal<Record<ArmyType, boolean>>({
    ...SAVED.enabled,
  });

  protected readonly monstersEnabled = signal<Record<MonsterRace, boolean>>({
    ...SAVED.monstersEnabled,
  });

  protected readonly current = signal(cloneGrid(SAVED.current, Object.keys(SAVED.current).map(Number).sort((a, b) => a - b)));
  protected readonly rates = signal(cloneGrid(SAVED.rates, Object.keys(SAVED.rates).map(Number).sort((a, b) => a - b)));
  protected readonly currentMonsters = signal(
    cloneMonsterGrid(
      SAVED.currentMonsters,
      Object.keys(SAVED.currentMonsters)
        .map(Number)
        .sort((a, b) => a - b),
    ),
  );
  protected readonly monsterSilverRates = signal(
    cloneMonsterGrid(
      SAVED.monsterSilverRates,
      Object.keys(SAVED.monsterSilverRates)
        .map(Number)
        .sort((a, b) => a - b),
    ),
  );
  protected readonly monsterCoinRates = signal(
    cloneMonsterGrid(
      SAVED.monsterCoinRates,
      Object.keys(SAVED.monsterCoinRates)
        .map(Number)
        .sort((a, b) => a - b),
    ),
  );

  protected readonly openHint = signal<string | null>(null);
  protected readonly showSilver = signal(SAVED.showSilver);

  protected readonly scanBusy = signal(false);
  protected readonly scanProgress = signal("");
  protected readonly scanError = signal<string | null>(null);
  protected readonly scanStatus = signal<string | null>(null);
  protected readonly scanDraft = signal<ScanDraftRow[]>([]);
  private fileInput: HTMLInputElement | null = null;

  protected readonly plan = computed(() =>
    planArmyTargets({
      targetCapacity: this.targetCapacity(),
      maxTier: this.maxTier(),
      pyramidRatio: this.pyramidRatio(),
      enabled: this.enabled(),
    }),
  );

  protected readonly monsterPlan = computed(() =>
    planMonsterTargets({
      dominance: this.dominance(),
      maxTier: this.maxTierM(),
      pyramidRatio: this.pyramidRatio(),
      enabled: this.monstersEnabled(),
      roundToTens: true,
    }),
  );

  protected readonly tiers = computed(() => this.plan().tiers);

  protected readonly ratesOrigin = computed(() =>
    classifyRatesOrigin(this.rates(), this.tiers()),
  );
  protected readonly monsterTiers = computed(() => this.monsterPlan().tiers);

  constructor() {
    effect(() => {
      const tiers = this.tiers();
      untracked(() => {
        this.current.update((grid) =>
          this.ensureGrid(grid, tiers, emptyGrid(tiers)),
        );
        this.rates.update((grid) =>
          this.ensureGrid(grid, tiers, DEFAULT_RATES),
        );
      });
    });

    effect(() => {
      const tiers = this.monsterTiers();
      untracked(() => {
        this.currentMonsters.update((grid) =>
          this.ensureMonsterGrid(grid, tiers, emptyMonsterGrid(tiers)),
        );
        this.monsterSilverRates.update((grid) =>
          this.ensureMonsterGrid(grid, tiers, DEFAULT_MONSTER_SILVER_RATES),
        );
        this.monsterCoinRates.update((grid) =>
          this.ensureMonsterGrid(grid, tiers, DEFAULT_MONSTER_COIN_RATES),
        );
      });
    });

    effect(() => {
      saveArmyState({
        v: 2,
        targetCapacity: this.targetCapacity(),
        dominance: this.dominance(),
        attacks: this.attacks(),
        maxTier: this.maxTier(),
        maxTierS: this.maxTierS(),
        maxTierM: this.maxTierM(),
        pyramidRatio: this.pyramidRatio(),
        roundMonstersToTens: true,
        enabled: this.enabled(),
        monstersEnabled: this.monstersEnabled(),
        current: this.current(),
        rates: this.rates(),
        currentMonsters: this.currentMonsters(),
        monsterSilverRates: this.monsterSilverRates(),
        monsterCoinRates: this.monsterCoinRates(),
        showSilver: this.showSilver(),
      });
    });
  }

  private ensureMonsterGrid(
    grid: Record<number, Record<MonsterRace, number>>,
    tiers: number[],
    fallback: Record<number, Record<MonsterRace, number>>,
  ): Record<number, Record<MonsterRace, number>> {
    const next = cloneMonsterGrid(grid, tiers);
    for (const tier of tiers) {
      if (Object.prototype.hasOwnProperty.call(grid, tier)) continue;
      const row = fallback[tier];
      if (!row) {
        next[tier] = emptyMonsterRow();
        continue;
      }
      for (const race of MONSTER_RACES) {
        next[tier][race] = row[race] ?? 0;
      }
    }
    return next;
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

  /** Single-march composition from capacity / dominance. */
  protected readonly marchTargets = computed(() => this.plan().targets);
  protected readonly marchMonsterTargets = computed(
    () => this.monsterPlan().targets,
  );

  /** Targets × attacks — stockpile needed for N identical marches. */
  protected readonly targets = computed(() =>
    scaleGrid(this.marchTargets(), this.tiers(), this.attacks()),
  );
  protected readonly monsterTargets = computed(() =>
    scaleMonsterGrid(
      this.marchMonsterTargets(),
      this.monsterTiers(),
      this.attacks(),
    ),
  );

  protected readonly targetTotals = computed(() =>
    gridTotals(this.targets(), this.tiers()),
  );

  protected readonly monsterTargetTotals = computed(() =>
    monsterGridTotals(this.monsterTargets(), this.monsterTiers()),
  );

  protected readonly toBuy = computed(() =>
    subtractGrids(this.targets(), this.current(), this.tiers()),
  );

  protected readonly monstersToBuy = computed(() =>
    subtractMonsterGrids(
      this.monsterTargets(),
      this.currentMonsters(),
      this.monsterTiers(),
    ),
  );

  protected readonly neededLeadership = computed(
    () => this.plan().leadershipUsed * this.attacks(),
  );

  protected readonly neededDominance = computed(
    () => this.monsterPlan().dominanceUsed * this.attacks(),
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

  protected readonly monsterValueSilver = computed(() =>
    costForMonsterGrid(
      this.currentMonsters(),
      this.monsterSilverRates(),
      this.monsterTiers(),
    ),
  );

  protected readonly monsterValueCoins = computed(() =>
    costForMonsterGrid(
      this.currentMonsters(),
      this.monsterCoinRates(),
      this.monsterTiers(),
    ),
  );

  protected readonly monsterBuySilver = computed(() =>
    costForMonsterGrid(
      this.monstersToBuy(),
      this.monsterSilverRates(),
      this.monsterTiers(),
      true,
    ),
  );

  protected readonly monsterBuyCoins = computed(() =>
    costForMonsterGrid(
      this.monstersToBuy(),
      this.monsterCoinRates(),
      this.monsterTiers(),
      true,
    ),
  );

  protected readonly currentLeadership = computed(() =>
    measureLeadership(this.current(), this.tiers()),
  );

  protected readonly currentDominance = computed(() =>
    measureDominance(this.currentMonsters(), this.monsterTiers()),
  );

  protected available(type: ArmyType, tier: number): boolean {
    return isTypeAvailable(type, tier);
  }

  protected raceEnabled(race: MonsterRace): boolean {
    return this.monstersEnabled()[race];
  }

  /** Usuwa zera wiodące (np. 05 → 5); samo 0 zostaje. Liczby całkowite ≥ 0. */
  protected parseAmount(value: string | number): number {
    if (typeof value === "number") {
      return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    }
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const stripped = raw.replace(/^0+(?=\d)/, "");
    const n = Number(stripped);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }

  /** Czyści wiodące 0 w polu podczas wpisywania. */
  protected stripLeadingZeros(event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value;
    if (!raw || raw === "0" || raw === "0.") return;
    const stripped = raw.replace(/^0+(?=\d)/, "");
    if (stripped === raw) return;
    const pos = input.selectionStart ?? stripped.length;
    const delta = raw.length - stripped.length;
    input.value = stripped;
    const nextPos = Math.max(0, pos - delta);
    input.setSelectionRange(nextPos, nextPos);
  }

  protected setNumber(
    signalRef: { set(value: number): void },
    value: string | number,
  ): void {
    if (typeof value === "number") {
      signalRef.set(Number.isFinite(value) ? value : 0);
      return;
    }
    const raw = String(value ?? "").trim();
    if (!raw) {
      signalRef.set(0);
      return;
    }
    const stripped = raw.replace(/^0+(?=\d)/, "");
    const n = Number(stripped);
    signalRef.set(Number.isFinite(n) ? n : 0);
  }

  protected setMaxTier(value: string | number): void {
    const n = this.parseAmount(value);
    this.maxTier.set(Math.min(GUARDS_MAX_TIER, Math.max(1, n)));
  }

  protected setMaxTierM(value: string | number): void {
    const n = this.parseAmount(value);
    this.maxTierM.set(
      Math.min(MONSTER_PLAN_MAX_TIER, Math.max(MONSTER_MIN_TIER, n)),
    );
  }

  /** 0.5 ↔ 1 ↔ 2 ↔ … (strzałki / spinner). */
  protected bumpAttacks(direction: 1 | -1): void {
    const cur = this.attacks();
    if (direction > 0) {
      this.attacks.set(cur < 1 ? 1 : Math.min(99, Math.round(cur) + 1));
      return;
    }
    if (cur <= 0.5) {
      this.attacks.set(0.5);
      return;
    }
    if (cur <= 1) {
      this.attacks.set(0.5);
      return;
    }
    this.attacks.set(Math.max(1, Math.round(cur) - 1));
  }

  protected onAttacksKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.bumpAttacks(1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.bumpAttacks(-1);
    }
  }

  protected setAttacks(value: string | number): void {
    const raw =
      typeof value === 'number'
        ? value
        : Number(String(value ?? '').trim().replace(',', '.'));
    const prev = this.attacks();
    if (!Number.isFinite(raw)) {
      this.attacks.set(normalizeAttacks(raw, 1));
      return;
    }
    // Native spinner: step 0.5 daje 1→0.5 (OK) oraz 1→1.5 / 2→1.5 — mapujemy na 0.5,1,2,3…
    if (raw !== prev && Math.abs(raw - prev) <= 1.0001) {
      this.bumpAttacks(raw > prev ? 1 : -1);
      return;
    }
    // 1.5, 2.5… wpisane / wklejone → najbliższa dozwolona (bez połów powyżej 1)
    this.attacks.set(normalizeAttacks(raw, 1));
  }

  /** Zaznacza wartosc przy focusie, zeby wpisanie cyfry nadpisalo np. 0. */
  protected selectOnFocus(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    void Promise.resolve().then(() => input.select());
  }

  protected setCurrent(
    tier: number,
    type: ArmyType,
    value: string | number,
  ): void {
    if (!isTypeAvailable(type, tier)) return;
    const n = this.parseAmount(value);
    this.current.update((grid) => {
      const next = cloneGrid(grid, this.tiers());
      if (!next[tier]) next[tier] = emptyRow();
      next[tier][type] = n;
      return next;
    });
  }

  protected setCurrentMonster(
    tier: number,
    race: MonsterRace,
    value: string | number,
  ): void {
    const n = this.parseAmount(value);
    this.currentMonsters.update((grid) => {
      const next = cloneMonsterGrid(grid, this.monsterTiers());
      if (!next[tier]) next[tier] = emptyMonsterRow();
      next[tier][race] = n;
      return next;
    });
  }

  protected setRate(
    tier: number,
    type: ArmyType,
    value: string | number,
  ): void {
    if (!isTypeAvailable(type, tier)) return;
    const n = this.parseAmount(value);
    this.rates.update((grid) => {
      const next = cloneGrid(grid, this.tiers());
      if (!next[tier]) next[tier] = emptyRow();
      next[tier][type] = n;
      return next;
    });
  }

  protected setMonsterSilverRate(
    tier: number,
    race: MonsterRace,
    value: string | number,
  ): void {
    const n = this.parseAmount(value);
    this.monsterSilverRates.update((grid) => {
      const next = cloneMonsterGrid(grid, this.monsterTiers());
      if (!next[tier]) next[tier] = emptyMonsterRow();
      next[tier][race] = n;
      return next;
    });
  }

  protected setMonsterCoinRate(
    tier: number,
    race: MonsterRace,
    value: string | number,
  ): void {
    const n = this.parseAmount(value);
    this.monsterCoinRates.update((grid) => {
      const next = cloneMonsterGrid(grid, this.monsterTiers());
      if (!next[tier]) next[tier] = emptyMonsterRow();
      next[tier][race] = n;
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

  protected deriveRatesFromRanged(): void {
    this.rates.set(ratesFromRangedBase(this.rates(), this.tiers()));
  }

  protected resetMonsterRatesToFloor(): void {
    const tiers = this.monsterTiers();
    const silver = emptyMonsterGrid(tiers);
    const coins = emptyMonsterGrid(tiers);
    for (const tier of tiers) {
      for (const race of MONSTER_RACES) {
        silver[tier][race] = MONSTER_FLOOR_SILVER[tier]?.[race] ?? 0;
        coins[tier][race] = MONSTER_FLOOR_DRAGON_COINS[tier]?.[race] ?? 0;
      }
    }
    this.monsterSilverRates.set(silver);
    this.monsterCoinRates.set(coins);
  }

  protected clearCurrent(): void {
    this.current.set(emptyGrid(this.tiers()));
  }

  protected clearCurrentMonsters(): void {
    this.currentMonsters.set(emptyMonsterGrid(this.monsterTiers()));
  }

  protected openScanPicker(): void {
    if (this.scanBusy()) return;
    if (!this.fileInput) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        input.value = "";
        if (file) void this.runScan(file);
      });
      this.fileInput = input;
    }
    this.fileInput.click();
  }

  private async runScan(file: File): Promise<void> {
    this.scanBusy.set(true);
    this.scanError.set(null);
    this.scanStatus.set(null);
    this.scanDraft.set([]);
    this.scanProgress.set(this.t()("army.scan.busy"));
    try {
      const result = await scanTroopScreenshot(file, {
        guardsMaxTier: this.maxTier(),
        monstersMaxTier: this.maxTierM(),
        onProgress: (message) => this.scanProgress.set(message),
        onHit: (hit) => this.appendScanHit(hit),
      });
      if (!result.hits.length) {
        this.scanDraft.set([]);
        this.scanStatus.set(this.t()("army.scan.empty"));
        return;
      }
      // Final authoritative list (clash winners only)
      this.scanDraft.set(
        result.hits.map((hit) => ({
          hit,
          count: hit.count ?? 0,
          include: hit.count != null && hit.count > 0,
        })),
      );
      this.scanStatus.set(
        this.t()("army.scan.done", undefined, {
          n: String(result.hits.length),
          ms: String(result.durationMs),
        }),
      );
    } catch (err) {
      console.error(err);
      this.scanError.set(this.t()("army.scan.error"));
    } finally {
      this.scanBusy.set(false);
      this.scanProgress.set("");
    }
  }

  /** Show each match in the review list as soon as it is found. */
  private appendScanHit(hit: ScanHit): void {
    this.scanDraft.update((rows) => {
      const clashes = (a: ScanHit, b: ScanHit) => {
        const lim = Math.min(a.size, b.size) * 0.45;
        return Math.abs(a.x - b.x) < lim && Math.abs(a.y - b.y) < lim;
      };

      for (let i = 0; i < rows.length; i++) {
        if (!clashes(rows[i].hit, hit)) continue;
        if (rows[i].hit.score >= hit.score) return rows;
        const next = rows.slice();
        next[i] = {
          hit,
          count: hit.count ?? 0,
          include: hit.count != null && hit.count > 0,
        };
        return next;
      }

      return [
        ...rows,
        {
          hit,
          count: hit.count ?? 0,
          include: hit.count != null && hit.count > 0,
        },
      ];
    });
  }

  protected setScanCount(index: number, value: string | number): void {
    const n = this.parseAmount(value);
    this.scanDraft.update((rows) =>
      rows.map((row, i) =>
        i === index ? { ...row, count: n, include: n > 0 } : row,
      ),
    );
  }

  protected toggleScanRow(index: number, include: boolean): void {
    this.scanDraft.update((rows) =>
      rows.map((row, i) => (i === index ? { ...row, include } : row)),
    );
  }

  protected cancelScanDraft(): void {
    this.scanDraft.set([]);
    this.scanStatus.set(null);
    this.scanError.set(null);
  }

  protected applyScanDraft(): void {
    const rows = this.scanDraft().filter((r) => r.include && r.count >= 0);
    if (!rows.length) {
      this.cancelScanDraft();
      return;
    }

    this.current.update((grid) => {
      const next = cloneGrid(grid, this.tiers());
      for (const row of rows) {
        if (row.hit.ref.kind !== "guards") continue;
        if (!isArmyType(row.hit.ref.key)) continue;
        const tier = row.hit.ref.tier;
        if (!next[tier] || !isTypeAvailable(row.hit.ref.key, tier)) continue;
        next[tier][row.hit.ref.key] = row.count;
      }
      return next;
    });

    this.currentMonsters.update((grid) => {
      const next = cloneMonsterGrid(grid, this.monsterTiers());
      for (const row of rows) {
        if (row.hit.ref.kind !== "monsters") continue;
        if (!isMonsterRace(row.hit.ref.key)) continue;
        const tier = row.hit.ref.tier;
        if (!next[tier]) continue;
        next[tier][row.hit.ref.key] = row.count;
      }
      return next;
    });

    this.cancelScanDraft();
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
