import { Injectable, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'cinch.theme';

/**
 * Owns the `dark` class on <html>. The initial value is already applied by the
 * inline script in index.html; this service keeps it in sync afterwards.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly media = matchMedia('(prefers-color-scheme: dark)');

  readonly preference = signal<ThemePreference>(read());
  readonly isDark = signal(document.documentElement.classList.contains('dark'));

  constructor() {
    this.media.addEventListener('change', () => {
      if (this.preference() === 'system') this.apply('system');
    });
  }

  set(preference: ThemePreference): void {
    this.preference.set(preference);
    try {
      if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Private mode — the preference just won't survive a reload.
    }
    this.apply(preference);
  }

  /** Cycles light → dark → light, following the system value on first toggle. */
  toggle(): void {
    this.set(this.isDark() ? 'light' : 'dark');
  }

  private apply(preference: ThemePreference): void {
    const dark = preference === 'dark' || (preference === 'system' && this.media.matches);
    document.documentElement.classList.toggle('dark', dark);
    this.isDark.set(dark);
  }
}

function read(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : 'system';
  } catch {
    return 'system';
  }
}
