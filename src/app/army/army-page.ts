import { DecimalPipe } from "@angular/common";
import {
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { I18nService } from "../i18n/i18n.service";
import {
  ARMY_TYPES,
  ArmyType,
  DEFAULT_CURRENT,
  DEFAULT_RATES,
  FLOOR_SILVER,
  FLYING_MIN_TIER,
  OFFICIAL_LEADERSHIP,
  cloneGrid,
  emptyGrid,
  emptyRow,
  isTypeAvailable,
} from "./army.data";
import {
  costForMonsterGrid,
  gridTotals,
  measureDominance,
  measureLeadership,
  monsterGridTotals,
  planArmyTargets,
  planMonsterTargets,
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
  MONSTER_RACES,
  MonsterRace,
  cloneMonsterGrid,
  emptyMonsterGrid,
  emptyMonsterRow,
} from "./monsters.data";
import { loadArmyState, saveArmyState } from "./army.persist";
import {
  recognizeTroopImage,
  revokeScanPreviews,
  type ScanFileResult,
  type ScanHit,
} from "./army-scan";
import { guardsTierIcon, monsterTierIcon } from "./troop-icons";

const SAVED = loadArmyState();

@Component({
  selector: "app-army",
  imports: [FormsModule, DecimalPipe],
  templateUrl: "./army-page.html",
  styleUrl: "./army-page.css",
})
export class ArmyPage implements OnDestroy {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly types = ARMY_TYPES;
  protected readonly monsterRaces = MONSTER_RACES;
  protected readonly leadership = OFFICIAL_LEADERSHIP;
  protected readonly flyingMinTier = FLYING_MIN_TIER;
  protected readonly monsterMinTier = MONSTER_MIN_TIER;

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
  protected readonly maxTier = signal(SAVED.maxTier);
  protected readonly maxTierS = signal(SAVED.maxTierS);
  protected readonly maxTierM = signal(SAVED.maxTierM);
  protected readonly pyramidRatio = signal(SAVED.pyramidRatio);
  protected readonly roundMonstersToTens = signal(SAVED.roundMonstersToTens);

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

  protected readonly scanItems = signal<ScanFileResult[]>([]);
  protected readonly scanBusy = signal(false);
  protected readonly scanDragOver = signal(false);
  protected readonly scanMessage = signal<string | null>(null);

  protected readonly scanHits = computed(() => {
    const merged = new Map<string, ScanHit>();
    for (const item of this.scanItems()) {
      for (const hit of item.hits) {
        const key =
          hit.kind === "guards"
            ? `g:${hit.type}:${hit.tier}`
            : `m:${hit.race}:${hit.tier}`;
        merged.set(key, hit);
      }
    }
    return [...merged.values()].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "guards" ? -1 : 1;
      if (a.tier !== b.tier) return a.tier - b.tier;
      const al = a.label.localeCompare(b.label);
      return al;
    });
  });

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
      roundToTens: this.roundMonstersToTens(),
    }),
  );

  protected readonly tiers = computed(() => this.plan().tiers);
  protected readonly monsterTiers = computed(() => this.monsterPlan().tiers);

  constructor() {
    effect(() => {
      const tiers = this.tiers();
      this.current.update((grid) =>
        this.ensureGrid(grid, tiers, DEFAULT_CURRENT),
      );
      this.rates.update((grid) => this.ensureGrid(grid, tiers, DEFAULT_RATES));
    });

    effect(() => {
      const tiers = this.monsterTiers();
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

    effect(() => {
      saveArmyState({
        v: 2,
        targetCapacity: this.targetCapacity(),
        dominance: this.dominance(),
        maxTier: this.maxTier(),
        maxTierS: this.maxTierS(),
        maxTierM: this.maxTierM(),
        pyramidRatio: this.pyramidRatio(),
        roundMonstersToTens: this.roundMonstersToTens(),
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

  protected readonly targets = computed(() => this.plan().targets);
  protected readonly monsterTargets = computed(() => this.monsterPlan().targets);

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

  protected setEnabled(type: ArmyType, value: boolean): void {
    this.enabled.update((current) => ({ ...current, [type]: value }));
  }

  protected setMonsterEnabled(race: MonsterRace, value: boolean): void {
    this.monstersEnabled.update((current) => ({ ...current, [race]: value }));
  }

  ngOnDestroy(): void {
    revokeScanPreviews(this.scanItems());
  }

  /** Zaznacza wartosc przy focusie, zeby wpisanie cyfry nadpisalo np. 0. */
  protected selectOnFocus(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    void Promise.resolve().then(() => input.select());
  }

  protected onScanDragOver(event: DragEvent): void {
    event.preventDefault();
    this.scanDragOver.set(true);
  }

  protected onScanDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.scanDragOver.set(false);
  }

  protected onScanDrop(event: DragEvent): void {
    event.preventDefault();
    this.scanDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files?.length) void this.addScanFiles(files);
  }

  protected onScanPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) void this.addScanFiles(input.files);
    input.value = "";
  }

  protected removeScanItem(id: string): void {
    this.scanItems.update((items) => {
      const victim = items.find((x) => x.id === id);
      if (victim) revokeScanPreviews([victim]);
      return items.filter((x) => x.id !== id);
    });
    this.scanMessage.set(null);
  }

  protected clearScanItems(): void {
    revokeScanPreviews(this.scanItems());
    this.scanItems.set([]);
    this.scanMessage.set(null);
  }

  protected applyScanHits(): void {
    const hits = this.scanHits();
    if (!hits.length) {
      this.scanMessage.set(this.t()("army.scan.empty"));
      return;
    }

    let guardMax = this.maxTier();
    let monsterMax = this.maxTierM();
    for (const hit of hits) {
      if (hit.kind === "guards") guardMax = Math.max(guardMax, hit.tier);
      else monsterMax = Math.max(monsterMax, hit.tier);
    }
    if (guardMax !== this.maxTier()) this.maxTier.set(Math.min(7, guardMax));
    if (monsterMax !== this.maxTierM()) {
      this.maxTierM.set(Math.min(9, Math.max(3, monsterMax)));
    }

    const guardTiers = Array.from(
      { length: Math.min(7, Math.max(guardMax, this.maxTier())) },
      (_, i) => i + 1,
    );
    const monsterTop = Math.min(9, Math.max(monsterMax, this.maxTierM()));
    const monsterTiers = Array.from(
      { length: monsterTop - 2 },
      (_, i) => i + 3,
    );

    this.current.update((grid) => {
      const next = cloneGrid(grid, guardTiers);
      for (const hit of hits) {
        if (hit.kind !== "guards" || !hit.type) continue;
        if (!isTypeAvailable(hit.type, hit.tier)) continue;
        if (!next[hit.tier]) next[hit.tier] = emptyRow();
        next[hit.tier][hit.type] = hit.count;
      }
      return next;
    });

    this.currentMonsters.update((grid) => {
      const next = cloneMonsterGrid(grid, monsterTiers);
      for (const hit of hits) {
        if (hit.kind !== "monster" || !hit.race) continue;
        if (!next[hit.tier]) next[hit.tier] = emptyMonsterRow();
        next[hit.tier][hit.race] = hit.count;
      }
      return next;
    });

    this.scanMessage.set(
      this.t()("army.scan.applied", undefined, { count: hits.length }),
    );
  }

  private async addScanFiles(fileList: FileList | File[]): Promise<void> {
    const images = [...fileList].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;

    const additions: ScanFileResult[] = images.map((file, index) => ({
      id: Date.now() + "-" + index + "-" + file.name,
      fileName: file.name,
      previewUrl: URL.createObjectURL(file),
      status: "pending" as const,
      progress: 0,
      text: "",
      hits: [],
    }));

    this.scanItems.update((items) => [...items, ...additions]);
    this.scanMessage.set(null);
    this.scanBusy.set(true);

    try {
      for (let i = 0; i < images.length; i++) {
        const id = additions[i].id;
        const file = images[i];
        this.patchScanItem(id, { status: "scanning", progress: 0.05 });
        try {
          const { text, hits } = await recognizeTroopImage(file, (prog) => {
            this.patchScanItem(id, { progress: prog });
          });
          this.patchScanItem(id, {
            status: "done",
            progress: 1,
            text,
            hits,
          });
        } catch {
          this.patchScanItem(id, {
            status: "error",
            progress: 1,
            error: this.t()("army.scan.error"),
            hits: [],
          });
        }
      }
    } finally {
      this.scanBusy.set(false);
    }
  }

  private patchScanItem(id: string, patch: Partial<ScanFileResult>): void {
    this.scanItems.update((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
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

  protected toggleHint(key: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.openHint.update((current) => (current === key ? null : key));
  }

  protected closeHint(): void {
    this.openHint.set(null);
  }
}
