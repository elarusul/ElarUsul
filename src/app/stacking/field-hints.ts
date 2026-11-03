export const FIELD_HINTS: Record<string, { title: string; text: string }> = {
  leadership: {
    title: 'Leadership',
    text: 'Limit gwardzistów, specjalistów i inżynierów w marszu. Weź liczbę po ukośniku z ekranu „Start marszu” po wyborze kapitana (np. 12 000 / 80 000 → wpisz 80000).',
  },
  dominance: {
    title: 'Dominance',
    text: 'Limit wytrenowanych potworów w marszu. Też z ekranu marszu, liczba po ukośniku. Potwory stakujemy osobno od Leadership.',
  },
  authority: {
    title: 'Authority',
    text: 'Limit najemników. Kalkulator ich nie wylicza automatycznie - zostaw miejsce na końcu (np. Epic Monster Hunters), tak by ich HP było niższe niż najsłabszego staku Leadership.',
  },
  role: {
    title: 'Typ wojska',
    text: 'Główna klasa jednostek w stakach (wręcz / dystans / kawaleria / latanie). Na epika często bierze się kawalerię lub mieszankę - wybierz to, co masz najmocniej zbonusowane.',
  },
  maxG: {
    title: 'Max G (gwardia)',
    text: 'Najwyższy odblokowany poziom gwardzistów (np. 7 = G7). Kalkulator buduje piramidę od tego poziomu w dół.',
  },
  gStacks: {
    title: 'Staki G',
    text: 'Ile osobnych staków gwardii chcesz wysłać. Więcej staków = więcej tur ataku, ale każdy stak jest cieńszy. Typowo 3-5.',
  },
  useS: {
    title: 'Specjaliści',
    text: 'Włącza staki specjalistów. Zwykle ustawiamy ich tak, by ginęli przed gwardią - gwardia lepiej dokłada obrażenia do epika.',
  },
  maxS: {
    title: 'Max S',
    text: 'Najwyższy odblokowany poziom specjalistów (np. S6). Używane tylko gdy checkbox Specjaliści jest włączony.',
  },
  sStacks: {
    title: 'Staki S',
    text: 'Liczba staków specjalistów. Często 1-2 warstwy ofiarne przed gwardią.',
  },
  useM: {
    title: 'Potwory',
    text: 'Włącza staki potworów z limitu Dominance. Powinny atakować po wojskach Leadership, a przed najemnikami.',
  },
  maxM: {
    title: 'Max M',
    text: 'Najwyższy odblokowany poziom potworów (np. M6). Piramida Dominance idzie od tego poziomu w dół.',
  },
  mStacks: {
    title: 'Staki M',
    text: 'Ile staków potworów wysłać. Liczby są zaokrąglane w dół do pełnych dziesiątek (reguła 10% strat w świątyni).',
  },
  gap: {
    title: 'Luka HP %',
    text: 'Jak mocno rozsunąć łączne HP staków, żeby epik zabijał je w dobrej kolejności. 0,5-1% to bezpieczny start; za duża luka marnuje Leadership.',
  },
};
