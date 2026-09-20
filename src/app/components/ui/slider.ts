import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

/**
 * Range input with a filled track. The fill is a gradient on the input itself,
 * so the thumb stays native and draggable everywhere.
 */
@Component({
  selector: 'app-slider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    input[type='range'] {
      -webkit-appearance: none;
      appearance: none;
      height: 0.375rem;
      border-radius: 9999px;
      outline-offset: 4px;
    }
    input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 1.125rem;
      height: 1.125rem;
      border-radius: 9999px;
      background: var(--surface);
      border: 2px solid var(--accent);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
      cursor: grab;
    }
    input[type='range']::-webkit-slider-thumb:active {
      cursor: grabbing;
    }
    input[type='range']::-moz-range-thumb {
      width: 1.125rem;
      height: 1.125rem;
      border-radius: 9999px;
      background: var(--surface);
      border: 2px solid var(--accent);
      cursor: grab;
    }
    input[type='range']:disabled {
      opacity: 0.5;
    }
  `,
  template: `
    <div class="flex items-baseline justify-between gap-4">
      @if (label(); as text) {
        <label class="text-sm font-medium text-ink" [attr.for]="id()">{{ text }}</label>
      }
      @if (display(); as text) {
        <span class="font-mono text-sm tabular-nums text-muted">{{ text }}</span>
      }
    </div>
    <input
      type="range"
      [id]="id()"
      [min]="min()"
      [max]="max()"
      [step]="step()"
      [value]="value()"
      [disabled]="disabled()"
      [style.background]="track()"
      [attr.aria-label]="label() ? null : ariaLabel()"
      [attr.aria-valuetext]="display()"
      (input)="onInput($event)"
      class="mt-2 w-full"
    />
    @if (endLabels(); as labels) {
      <div class="mt-1.5 flex justify-between text-xs text-faint">
        <span>{{ labels[0] }}</span>
        <span>{{ labels[1] }}</span>
      </div>
    }
  `,
})
export class Slider {
  readonly value = model.required<number>();
  readonly min = input(0);
  readonly max = input(100);
  readonly step = input(1);
  readonly label = input<string>();
  readonly ariaLabel = input<string>();
  /** Formatted value shown on the right, e.g. "Balanced · CRF 23". */
  readonly display = input<string>();
  /** Captions under each end of the track, e.g. ['Smaller file', 'Better quality']. */
  readonly endLabels = input<readonly [string, string]>();
  readonly disabled = input(false);
  readonly id = input(`slider-${Math.random().toString(36).slice(2, 9)}`);

  protected readonly track = computed(() => {
    const span = this.max() - this.min() || 1;
    const pct = ((this.value() - this.min()) / span) * 100;
    return `linear-gradient(to right, var(--accent) ${pct}%, var(--line) ${pct}%)`;
  });

  protected onInput(event: Event): void {
    this.value.set(Number((event.target as HTMLInputElement).value));
  }
}
