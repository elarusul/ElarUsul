import {
  ROLE_COST,
  TroopKind,
  TroopRole,
  stackCode,
  tierStats,
} from './troop-stats';

export interface StackPlanInput {
  leadership: number;
  dominance: number;
  authority: number;
  maxGuardsmenTier: number;
  maxSpecialistsTier: number;
  maxMonsterTier: number;
  guardsmenStacks: number;
  specialistsStacks: number;
  monsterStacks: number;
  role: TroopRole;
  /** Extra HP % on earlier-dying stacks so epic hits them first (0.5-2). */
  healthGapPercent: number;
  includeSpecialists: boolean;
  includeMonsters: boolean;
}

export interface PlannedStack {
  kind: TroopKind;
  tier: number;
  code: string;
  role: TroopRole;
  count: number;
  unitHealth: number;
  unitStrength: number;
  totalHealth: number;
  totalStrength: number;
  capacityUsed: number;
  /** 1 = dies first (hit by epic first). */
  deathOrder: number;
  /** 1 = attacks first (highest strength). */
  attackOrder: number;
}

export interface StackPlanResult {
  stacks: PlannedStack[];
  leadershipUsed: number;
  dominanceUsed: number;
  authorityHint: number;
  notes: string[];
}

function buildTier(maxTier: number, stackCount: number): number[] {
  const tiers: number[] = [];
  for (let t = maxTier; t >= 3 && tiers.length < stackCount; t--) {
    tiers.push(t);
  }
  return tiers;
}

/**
 * Epic stacking:
 * - Epic kills the stack with the highest total HP first.
 * - Within initiative, stacks attack in descending total strength.
 * - Goal: cheap/low tiers die first; strong tiers keep attacking.
 * - Classic approach: ~2× more of each lower tier, then nudge HP so death order is stable.
 */
export function planEpicStacks(input: StackPlanInput): StackPlanResult {
  const notes: string[] = [];
  const roleCost = ROLE_COST[input.role];
  const gap = Math.max(0, input.healthGapPercent) / 100;

  type Draft = {
    kind: TroopKind;
    tier: number;
    weight: number;
    unitHealth: number;
    unitStrength: number;
    unitCost: number;
    pool: 'leadership' | 'dominance';
  };

  const drafts: Draft[] = [];

  const gTiers = buildTier(input.maxGuardsmenTier, input.guardsmenStacks);
  gTiers.forEach((tier, indexFromTop) => {
    const stats = tierStats(tier);
    // Lower tiers (later in death) get higher weight → more units → die first after HP nudge.
    const depth = gTiers.length - 1 - indexFromTop;
    drafts.push({
      kind: 'guardsmen',
      tier,
      weight: Math.pow(2, depth),
      unitHealth: stats.health,
      unitStrength: stats.strength,
      unitCost: stats.cost * roleCost,
      pool: 'leadership',
    });
  });

  if (input.includeSpecialists && input.specialistsStacks > 0) {
    const sTiers = buildTier(input.maxSpecialistsTier, input.specialistsStacks);
    sTiers.forEach((tier, indexFromTop) => {
      const stats = tierStats(tier);
      const depth = sTiers.length - 1 - indexFromTop;
      // Specialists should generally die before same-tier guardsmen vs epic.
      drafts.push({
        kind: 'specialists',
        tier,
        weight: Math.pow(2, depth) * 1.05,
        unitHealth: stats.health * 0.98,
        unitStrength: stats.strength * 1.05,
        unitCost: stats.cost * roleCost,
        pool: 'leadership',
      });
    });
    notes.push(
      'Specjaliści są lekko podbite wagą HP, żeby ginęli przed gwardzistami tego samego poziomu (gwardia lepiej bić epika).',
    );
  }

  const leadDrafts = drafts.filter((d) => d.pool === 'leadership');
  const leadDenom = leadDrafts.reduce(
    (sum, d) => sum + d.weight * d.unitCost,
    0,
  );

  const leadershipStacks: PlannedStack[] = leadDrafts.map((d) => {
    const raw = leadDenom > 0 ? (input.leadership * d.weight) / leadDenom : 0;
    const count = Math.max(0, Math.floor(raw));
    const totalHealth = count * d.unitHealth;
    const totalStrength = count * d.unitStrength;
    return {
      kind: d.kind,
      tier: d.tier,
      code: stackCode(d.kind, d.tier),
      role: input.role,
      count,
      unitHealth: d.unitHealth,
      unitStrength: d.unitStrength,
      totalHealth,
      totalStrength,
      capacityUsed: count * d.unitCost,
      deathOrder: 0,
      attackOrder: 0,
    };
  });

  // Nudge counts so lower-priority (cheaper) stacks have slightly more HP → die first.
  const sortedByStrength = [...leadershipStacks].sort(
    (a, b) => a.totalStrength - b.totalStrength,
  );
  sortedByStrength.forEach((stack, i) => {
    const targetMult = 1 + gap * (sortedByStrength.length - 1 - i);
    const desiredHp = stack.totalHealth * targetMult;
    if (stack.unitHealth > 0) {
      stack.count = Math.max(0, Math.floor(desiredHp / stack.unitHealth));
      stack.totalHealth = stack.count * stack.unitHealth;
      stack.totalStrength = stack.count * stack.unitStrength;
      const draft = leadDrafts.find(
        (d) => d.kind === stack.kind && d.tier === stack.tier,
      );
      stack.capacityUsed = stack.count * (draft?.unitCost ?? roleCost);
    }
  });

  // Scale to fit leadership exactly (as close as possible).
  const usedLead = leadershipStacks.reduce((s, x) => s + x.capacityUsed, 0);
  if (usedLead > 0 && input.leadership > 0) {
    const scale = input.leadership / usedLead;
    leadershipStacks.forEach((stack) => {
      stack.count = Math.max(0, Math.floor(stack.count * scale));
      stack.totalHealth = stack.count * stack.unitHealth;
      stack.totalStrength = stack.count * stack.unitStrength;
      const draft = leadDrafts.find(
        (d) => d.kind === stack.kind && d.tier === stack.tier,
      );
      stack.capacityUsed = stack.count * (draft?.unitCost ?? roleCost);
    });
  }

  const monsterStacks: PlannedStack[] = [];
  if (input.includeMonsters && input.monsterStacks > 0 && input.dominance > 0) {
    const mTiers = buildTier(input.maxMonsterTier, input.monsterStacks);
    const mDrafts = mTiers.map((tier, indexFromTop) => {
      const stats = tierStats(tier);
      const depth = mTiers.length - 1 - indexFromTop;
      return {
        kind: 'monsters' as const,
        tier,
        weight: Math.pow(2, depth),
        unitHealth: stats.health * 2.2,
        unitStrength: stats.strength * 2.4,
        unitCost: 1,
      };
    });
    const mDenom = mDrafts.reduce((sum, d) => sum + d.weight * d.unitCost, 0);
    mDrafts.forEach((d) => {
      const raw = mDenom > 0 ? (input.dominance * d.weight) / mDenom : 0;
      // Round monsters down to multiple of 10 (temple 10% loss rule).
      let count = Math.max(0, Math.floor(raw / 10) * 10);
      monsterStacks.push({
        kind: 'monsters',
        tier: d.tier,
        code: stackCode('monsters', d.tier),
        role: input.role,
        count,
        unitHealth: d.unitHealth,
        unitStrength: d.unitStrength,
        totalHealth: count * d.unitHealth,
        totalStrength: count * d.unitStrength,
        capacityUsed: count * d.unitCost,
        deathOrder: 0,
        attackOrder: 0,
      });
    });
    notes.push(
      'Potwory zaokrąglone w dół do pełnych dziesiątek (świątynia nie oddaje ułamków 10% strat).',
    );
    notes.push(
      'Potwory powinny atakować po wojskach Leadership, a przed najemnikami (Authority).',
    );
  }

  const all = [...leadershipStacks, ...monsterStacks].filter((s) => s.count > 0);

  // Death order: highest total HP dies first (epic target).
  [...all]
    .sort((a, b) => b.totalHealth - a.totalHealth)
    .forEach((stack, i) => {
      stack.deathOrder = i + 1;
    });

  // Attack order: highest total strength attacks first.
  [...all]
    .sort((a, b) => b.totalStrength - a.totalStrength)
    .forEach((stack, i) => {
      stack.attackOrder = i + 1;
    });

  notes.unshift(
    'Przeciw epikowi wszystkie staki giną - HP nie chroni, tylko ustawia kolejność śmierci.',
  );
  notes.push(
    'Epik zwykle wybiera Twój stak z najwyższym łącznym HP. Silniejsze staki powinny mieć nieco mniej HP i więcej siły.',
  );
  notes.push(
    'Wpisz swoje limity z ekranu marszu (po wyborze kapitana). Relatywne HP/STR to przybliżenie - dokładne bonusy z raportu bitwy poprawią wynik.',
  );

  if (input.authority > 0) {
    notes.push(
      `Authority ${input.authority}: najemnicy (np. Epic Monster Hunters) dokładaj na końcu - ich łączne HP powinno być niższe niż najsłabszego staku Leadership, żeby ginęli na końcu.`,
    );
  }

  return {
    stacks: all.sort((a, b) => a.deathOrder - b.deathOrder),
    leadershipUsed: leadershipStacks.reduce((s, x) => s + x.capacityUsed, 0),
    dominanceUsed: monsterStacks.reduce((s, x) => s + x.capacityUsed, 0),
    authorityHint: input.authority,
    notes,
  };
}
