import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * A single-line input for the values no list of choices can hold — a width in
 * pixels, a line of text to draw over a frame.
 *
 * Numbers report as numbers rather than strings, so a descriptor's `build`
 * never has to parse what the form hands back. An empty box reports
 * `undefined` rather than `0`, which is how "leave this alone" is spelled.
 */
@Component({
  selector: 'app-text-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label(); as text) {
      <label class="mb-1.5 block text-sm font-medium text-ink" [attr.for]="id()">{{ text }}</label>
    }
    <div class="relative">
      <input
        [id]="id()"
        [type]="type()"
        [value]="value() ?? ''"
        [disabled]="disabled()"
        [attr.placeholder]="placeholder() || null"
        [attr.min]="type() === 'number' ? min() : null"
        [attr.max]="type() === 'number' ? max() : null"
        [attr.step]="type() === 'number' ? step() : null"
        [attr.inputmode]="type() === 'number' ? 'numeric' : null"
        [attr.aria-label]="label() ? null : ariaLabel()"
        (input)="onInput($event)"
        class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink
               transition-colors hover:border-line-strong focus:border-accent focus:outline-none
               disabled:pointer-events-none disabled:opacity-50"
        [class.pr-12]="!!suffix()"
      />
      @if (suffix(); as unit) {
        <span
          class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint"
        >
          {{ unit }}
        </span>
      }
    </div>
    @if (hint(); as text) {
      <p class="mt-1.5 text-xs text-muted">{{ text }}</p>
    }
  `,
})
export class TextInput {
  readonly value = model<string | number | undefined>();
  readonly type = input<'text' | 'number'>('text');
  readonly label = input<string>();
  readonly ariaLabel = input<string>();
  readonly hint = input<string>();
  readonly placeholder = input<string>('');
  /** The unit shown inside the box — "px", "fps", "kbps". */
  readonly suffix = input<string>('');
  readonly min = input<number>();
  readonly max = input<number>();
  readonly step = input<number>(1);
  readonly disabled = input(false);
  readonly id = input(`input-${Math.random().toString(36).slice(2, 9)}`);

  protected onInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;

    if (this.type() !== 'number') {
      this.value.set(raw);
      return;
    }

    // A half-typed number ("", "-") is not a number yet. Reporting undefined
    // keeps the field clearable instead of snapping it back to a stale value.
    const parsed = Number(raw);
    this.value.set(raw.trim() === '' || Number.isNaN(parsed) ? undefined : parsed);
  }
}
