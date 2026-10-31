import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ROLE_LABELS, TroopRole } from './troop-stats';
import { FIELD_HINTS } from './field-hints';

@Component({
  selector: 'app-stacking',
  imports: [FormsModule],
  templateUrl: './stacking-page.html',
  styleUrl: './stacking-page.css',
})
export class StackingPage {
  protected readonly hints = FIELD_HINTS;
  protected readonly openHint = signal<string | null>(null);

  protected readonly roles = Object.entries(ROLE_LABELS).map(([id, label]) => ({
    id: id as TroopRole,
    label,
  }));

  protected readonly leadership = signal(80000);
  protected readonly dominance = signal(2000);
  protected readonly authority = signal(500);
  protected readonly maxGuardsmenTier = signal(7);
  protected readonly maxSpecialistsTier = signal(6);
  protected readonly maxMonsterTier = signal(6);
  protected readonly guardsmenStacks = signal(4);
  protected readonly specialistsStacks = signal(2);
  protected readonly monsterStacks = signal(3);
  protected readonly role = signal<TroopRole>('mounted');
  protected readonly healthGapPercent = signal(1);
  protected readonly includeSpecialists = signal(true);
  protected readonly includeMonsters = signal(true);

  protected setNumber(
    signalRef: { set(value: number): void },
    value: string | number,
  ): void {
    const n = typeof value === 'number' ? value : Number(value);
    signalRef.set(Number.isFinite(n) ? n : 0);
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
