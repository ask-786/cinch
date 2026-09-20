import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Determinate when `value` is a number, indeterminate when it is undefined —
 * which is the honest state while FFmpeg's own progress is untrustworthy.
 */
@Component({
  selector: 'app-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes drift {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }
    .drift { animation: drift 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
    @media (prefers-reduced-motion: reduce) {
      .drift { animation-duration: 3s; }
    }
  `,
  template: `
    <div
      class="h-2 w-full overflow-hidden rounded-full bg-line"
      role="progressbar"
      [attr.aria-valuenow]="value() ?? null"
      [attr.aria-valuemin]="value() === undefined ? null : 0"
      [attr.aria-valuemax]="value() === undefined ? null : 100"
      [attr.aria-label]="ariaLabel()"
    >
      @if (value() !== undefined) {
        <div
          class="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
          [style.width.%]="clamped()"
        ></div>
      } @else {
        <div class="drift h-full w-1/4 rounded-full bg-accent"></div>
      }
    </div>
  `,
})
export class Progress {
  /** 0–100, or undefined for indeterminate. */
  readonly value = input<number | undefined>(undefined);
  readonly ariaLabel = input('Progress');

  protected readonly clamped = computed(() => Math.min(100, Math.max(0, this.value() ?? 0)));
}
