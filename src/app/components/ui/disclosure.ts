import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Native <details> so it is keyboard-accessible and findable by in-page search.
 * This is where every piece of FFmpeg vocabulary is allowed to surface.
 */
@Component({
  selector: 'app-disclosure',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    summary { list-style: none; }
    summary::-webkit-details-marker { display: none; }
    details[open] > summary svg { transform: rotate(90deg); }
  `,
  template: `
    <details [open]="open()" class="group" (toggle)="onToggle($event)">
      <summary
        class="flex cursor-pointer items-center gap-1.5 py-1 text-sm font-medium text-muted
               transition-colors hover:text-ink"
      >
        <svg class="size-3.5 transition-transform duration-150" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m6 4 4 4-4 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ summary() }}
      </summary>
      <div class="pt-3">
        <ng-content />
      </div>
    </details>
  `,
})
export class Disclosure {
  readonly summary = input.required<string>();
  readonly open = input(false);

  /** Opening a disclosure is the clearest signal of intent we get. */
  readonly toggled = output<boolean>();

  protected onToggle(event: Event): void {
    this.toggled.emit((event.target as HTMLDetailsElement).open);
  }
}
