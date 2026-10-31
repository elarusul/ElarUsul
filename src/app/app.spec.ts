import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render captains above the army calculator', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const headings = [...compiled.querySelectorAll('h1')].map((el) => el.textContent ?? '');
    expect(headings.some((text) => text.includes('Kapitanowie'))).toBe(true);
    expect(headings.some((text) => text.includes('Kalkulator pojemności armii'))).toBe(true);
    expect(compiled.querySelectorAll('.grid .card').length).toBe(27);
  });
});
