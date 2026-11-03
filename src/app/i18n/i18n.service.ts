import { Injectable, computed, effect, signal } from '@angular/core';
import { DICTS, Lang } from './translations';

const STORAGE_KEY = 'elar-usul.lang';

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'pl' || saved === 'en') return saved;
  } catch {
    // ignore
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'pl';
  return nav.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang = signal<Lang>(detectLang());

  /** Read lang() inside so templates re-render on switch. */
  readonly t = computed(() => {
    const lang = this.lang();
    const dict = DICTS[lang];
    return (key: string, fallback?: string, vars?: Record<string, string | number>) => {
      let text = dict[key] ?? DICTS.pl[key] ?? fallback ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replaceAll(`%${k}%`, String(v));
        }
      }
      return text;
    };
  });

  constructor() {
    effect(() => {
      const lang = this.lang();
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // ignore
      }
      if (typeof document !== 'undefined') {
        document.documentElement.lang = lang;
        document.title = DICTS[lang]['doc.title'] ?? DICTS.pl['doc.title'];
      }
    });
  }

  setLang(lang: Lang): void {
    this.lang.set(lang);
  }

  toggle(): void {
    this.setLang(this.lang() === 'pl' ? 'en' : 'pl');
  }
}
