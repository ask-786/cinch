import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface SelectOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
}

/** A native <select> in our clothing — no popup to reimplement, no a11y to get wrong. */
@Component({
  selector: 'app-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label(); as text) {
      <label class="mb-1.5 block text-sm font-medium text-ink" [attr.for]="id()">{{ text }}</label>
    }
    <div class="relative">
      <select
        [id]="id()"
        [disabled]="disabled()"
        [attr.aria-label]="label() ? null : ariaLabel()"
        (change)="onChange($event)"
        class="h-10 w-full appearance-none rounded-lg border border-line bg-surface pl-3 pr-9
               text-sm text-ink transition-colors hover:border-line-strong
               disabled:opacity-50 disabled:pointer-events-none"
      >
        @for (option of options(); track option.value) {
          <!-- Marking the option rather than binding the select's own value:
               the options do not exist yet when that binding first runs. -->
          <option
            [value]="option.value"
            [selected]="option.value === value()"
            [disabled]="option.disabled ?? false"
          >
            {{ option.label }}
          </option>
        }
      </select>
      <svg
        class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="m4 6 4 4 4-4"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
    @if (hint(); as text) {
      <p class="mt-1.5 text-xs text-muted">{{ text }}</p>
    }
  `,
})
export class Select<T extends string = string> {
  readonly options = input.required<readonly SelectOption<T>[]>();
  readonly value = model.required<T>();
  readonly label = input<string>();
  readonly ariaLabel = input<string>();
  readonly hint = input<string>();
  readonly disabled = input(false);
  readonly id = input(`select-${Math.random().toString(36).slice(2, 9)}`);

  protected onChange(event: Event): void {
    this.value.set((event.target as HTMLSelectElement).value as T);
  }
}
