import { inject } from '@angular/core';
import { Router, type CanActivateFn, type Routes } from '@angular/router';
import { operationByRoute } from '../media/operations/registry';
import { Selection } from './core/selection';

/**
 * An operation URL needs two things to be meaningful: an operation that exists,
 * and a file it can be pointed at. A refresh loses the second — the file lives
 * in memory, not on a server — so it goes back to the start (D8).
 */
const operationIsUsable: CanActivateFn = (route) => {
  const operation = operationByRoute(route.paramMap.get('operation'));
  const selection = inject(Selection);

  if (operation && selection.files().some((file) => operation.accepts.includes(file.kind))) {
    return true;
  }
  return inject(Router).createUrlTree(['/']);
};

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
    title: 'Cinch — media tools that never leave your device',
  },
  {
    path: 'about',
    loadComponent: () => import('./features/about/about').then((m) => m.About),
    title: 'About — Cinch',
  },
  {
    // One route for every operation in the registry: the descriptor named by
    // this segment decides the form, the command and the output.
    path: ':operation',
    loadComponent: () => import('./features/operation/operation').then((m) => m.OperationScreen),
    canActivate: [operationIsUsable],
    title: (route) => {
      const operation = operationByRoute(route.paramMap.get('operation'));
      return operation ? `${operation.title} — Cinch` : 'Cinch';
    },
  },
  { path: '**', redirectTo: '' },
];
