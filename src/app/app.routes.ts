import { inject } from '@angular/core';
import { Router, type CanActivateFn, type Routes } from '@angular/router';
import { Selection } from './core/selection';

/**
 * A refresh loses the selection — the file lives in memory, not on a server —
 * so an operation URL without one goes back to the start (D8).
 */
const hasVideoSelected: CanActivateFn = () => {
  const selection = inject(Selection);
  if (selection.files().some((file) => file.kind === 'video')) return true;
  return inject(Router).createUrlTree(['/']);
};

/**
 * One lazy chunk per feature. Operations get their own routes in Stage 5 so a
 * settings-bearing URL can be shared and reopened.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
    title: 'Cinch — media tools that never leave your device',
  },
  {
    path: 'compress',
    loadComponent: () => import('./features/compress/compress').then((m) => m.Compress),
    canActivate: [hasVideoSelected],
    title: 'Compress video — Cinch',
  },
  {
    path: 'about',
    loadComponent: () => import('./features/about/about').then((m) => m.About),
    title: 'About — Cinch',
  },
  { path: '**', redirectTo: '' },
];
