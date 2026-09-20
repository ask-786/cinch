import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  input,
  model,
  viewChild,
} from '@angular/core';

/**
 * Wraps the native <dialog>, which gives us the top layer, focus trapping and
 * Escape handling without a single line of our own.
 */
@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    dialog::backdrop {
      background: rgb(0 0 0 / 0.45);
      backdrop-filter: blur(2px);
    }
    dialog[open] {
      animation: rise 140ms cubic-bezier(0.2, 0, 0.2, 1);
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(6px) scale(0.99); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      dialog[open] { animation: none; }
    }
  `,
  template: `
    <dialog
      #dialog
      (close)="open.set(false)"
      (click)="onBackdropClick($event)"
      class="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-card border border-line bg-surface
             p-0 text-ink shadow-xl"
    >
      <div class="p-6" (click)="$event.stopPropagation()">
        <div class="flex items-start justify-between gap-4">
          <h2 class="text-lg font-semibold">{{ heading() }}</h2>
          <button
            type="button"
            (click)="close()"
            aria-label="Close"
            class="-m-1.5 rounded-md p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <svg class="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <div class="mt-4 text-sm text-muted">
          <ng-content />
        </div>
      </div>
    </dialog>
  `,
})
export class Dialog {
  readonly open = model(false);
  readonly heading = input.required<string>();

  private readonly element = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const dialog = this.element().nativeElement;
      if (this.open() && !dialog.open) dialog.showModal();
      else if (!this.open() && dialog.open) dialog.close();
    });
  }

  close(): void {
    this.open.set(false);
  }

  /** A click that lands on the dialog element itself is a click on the backdrop. */
  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === this.element().nativeElement) this.close();
  }
}
