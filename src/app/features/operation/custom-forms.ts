import type { Type } from '@angular/core';
import type {
  Operation,
  OperationContext,
  OptionValue,
  OptionValues,
} from '../../../media/operations/descriptor';

/**
 * The escape hatch (D23). An operation whose form a schema cannot express —
 * trim's two handles, crop's rectangle, GIF's frame picker — names a key here
 * and gets a hand-written component instead of the generated one.
 *
 * Outputs are passed as an `onChange` callback rather than an Angular output:
 * `NgComponentOutlet` binds inputs only, and a callback keeps the host free of
 * a container component just to reach the emitter.
 */
// A type alias, not an interface: only aliases carry the implicit index
// signature `NgComponentOutlet`'s `inputs` map asks for.
export type CustomFormInputs = {
  readonly operation: Operation;
  readonly options: OptionValues;
  readonly context: OperationContext;
  readonly onChange: (changes: Record<string, OptionValue>) => void;
};

export const CUSTOM_FORMS: Readonly<Record<string, () => Promise<Type<unknown>>>> = {
  trim: () => import('./trim-form').then((m) => m.TrimForm),
};
