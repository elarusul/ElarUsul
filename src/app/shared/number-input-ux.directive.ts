import { Directive, HostListener } from '@angular/core';

/**
 * UX for numeric fields app-wide:
 * - focus selects the whole value so typing replaces e.g. 0
 * - strips leading zeros while typing (05 → 5; keeps bare 0 / 0.)
 */
@Directive({
  selector: 'input[type="number"]',
})
export class NumberInputUxDirective {
  @HostListener('focus', ['$event'])
  onFocus(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    void Promise.resolve().then(() => input.select());
  }

  @HostListener('input', ['$event'])
  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value;
    if (!raw || raw === '0' || raw === '0.') return;
    const stripped = raw.replace(/^0+(?=\d)/, '');
    if (stripped === raw) return;
    const pos = input.selectionStart ?? stripped.length;
    const delta = raw.length - stripped.length;
    input.value = stripped;
    const nextPos = Math.max(0, pos - delta);
    input.setSelectionRange(nextPos, nextPos);
  }
}
