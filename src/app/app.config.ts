import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Route params arrive as component inputs, so the operation screen can read
    // `:operation` as a signal rather than subscribing to the ActivatedRoute.
    provideRouter(routes, withComponentInputBinding()),
  ],
};
