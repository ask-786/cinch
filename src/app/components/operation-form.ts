import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  choicesOf,
  decodeChoice,
  encodeChoice,
  visibleFields,
  type Choice,
  type Field,
  type Operation,
  type OperationContext,
  type OptionValue,
  type OptionValues,
} from '../../media/operations/descriptor';
import { Select, Slider, type SelectOption } from './ui';

interface FieldView {
  readonly field: Field<OptionValues>;
  readonly choices: readonly Choice[];
  readonly selectOptions: readonly SelectOption[];
  readonly selectValue: string;
  readonly value: OptionValue;
  readonly display: string;
  readonly warning?: string;
  readonly full: boolean;
}

/**
 * The form for any operation, generated from its descriptor's fields.
 *
 * Deliberately plain: a control per field, two columns where they fit. The
 * operations whose form is the interesting part — trim, crop, GIF — name a
 * custom component instead (D23) rather than pushing this one out of shape.
 */
@Component({
  selector: 'app-operation-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Select, Slider],
  template: `
    <div class="grid gap-5 sm:grid-cols-2">
      @for (view of views(); track view.field.key + view.field.kind) {
        <div [class.sm:col-span-2]="view.full">
          @switch (view.field.kind) {
            @case ('select') {
              <app-select
                [label]="view.field.label"
                [hint]="view.field.hint ?? ''"
                [options]="view.selectOptions"
                [value]="view.selectValue"
                (valueChange)="pickChoice(view, $event)"
              />
            }

            @case ('segmented') {
              <p class="mb-1.5 text-sm font-medium text-ink">{{ view.field.label }}</p>
              <div class="flex rounded-lg border border-line p-1">
                @for (choice of view.choices; track $index) {
                  <button
                    type="button"
                    [disabled]="choice.disabled ?? false"
                    (click)="set(view.field.key, choice.value)"
                    class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
                    [class]="
                      choice.value === view.value
                        ? 'bg-accent text-accent-ink'
                        : 'text-muted hover:text-ink'
                    "
                  >
                    {{ choice.label }}
                  </button>
                }
              </div>
            }

            @case ('chips') {
              <p class="mb-2 text-sm font-medium text-ink">{{ view.field.label }}</p>
              <div class="flex flex-wrap gap-2">
                @for (choice of view.choices; track $index) {
                  <button
                    type="button"
                    [disabled]="choice.disabled ?? false"
                    (click)="set(view.field.key, choice.value)"
                    class="rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40"
                    [class]="
                      choice.value === view.value
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line text-muted hover:border-line-strong hover:text-ink'
                    "
                  >
                    {{ choice.label }}
                    @if (choice.note) {
                      <span class="text-faint">· {{ choice.note }}</span>
                    }
                  </button>
                }
              </div>
            }

            @case ('slider') {
              <app-slider
                [label]="view.field.label"
                [min]="view.field.min"
                [max]="view.field.max"
                [step]="view.field.step ?? 1"
                [value]="asNumber(view.value)"
                [display]="view.display"
                [endLabels]="view.field.endLabels"
                (valueChange)="set(view.field.key, $event)"
              />
            }

            @case ('toggle') {
              <label class="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  [checked]="view.value === true"
                  (change)="set(view.field.key, view.value !== true)"
                  class="size-4 rounded border-line-strong accent-accent"
                />
                <span class="text-sm text-ink">{{ view.field.label }}</span>
              </label>
            }
          }

          @if (view.field.kind !== 'select' && view.field.hint) {
            <p class="mt-1.5 text-xs text-muted">{{ view.field.hint }}</p>
          }
          @if (view.warning) {
            <p class="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-xs leading-relaxed text-ink">
              {{ view.warning }}
            </p>
          }
        </div>
      }
    </div>
  `,
})
export class OperationForm {
  readonly operation = input.required<Operation>();
  readonly options = input.required<OptionValues>();
  readonly context = input.required<OperationContext>();

  /** One key at a time — the operation's `normalize` sorts out the rest. */
  readonly changed = output<Record<string, OptionValue>>();

  protected readonly views = computed<readonly FieldView[]>(() => {
    const options = this.options();
    const context = this.context();

    return visibleFields(this.operation(), options, context).map((field) => {
      const choices = choicesOf(field, options, context);
      const value = options[field.key];

      return {
        field,
        choices,
        selectOptions: choices.map((choice, index) => ({
          value: String(index),
          label: choice.note ? `${choice.label} — ${choice.note}` : choice.label,
          disabled: choice.disabled,
        })),
        selectValue: encodeChoice(choices, value),
        value,
        display: field.kind === 'slider' && field.display ? field.display(options, context) : '',
        warning: field.warnWhen?.(options, context),
        full: field.kind !== 'select',
      };
    });
  });

  protected set(key: string, value: OptionValue): void {
    this.changed.emit({ [key]: value });
  }

  protected pickChoice(view: FieldView, encoded: string): void {
    this.set(view.field.key, decodeChoice(view.choices, encoded));
  }

  protected asNumber(value: OptionValue): number {
    return typeof value === 'number' ? value : 0;
  }
}
