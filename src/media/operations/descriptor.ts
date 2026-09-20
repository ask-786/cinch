import type { MediaFile } from '../models/media-file';
import type { MediaInfo } from '../models/media-info';
import type { MediaKind } from '../models/media-kind';

/**
 * What an operation is, as data.
 *
 * Adding an operation means writing one of these and listing it in the
 * registry — no new component, no new route, no new screen. The generated form
 * reads `fields`, the job runner calls `build`, and the tests aim at both
 * without touching Angular.
 */

/** Everything a form control can hold. Options objects are flat on purpose. */
export type OptionValue = string | number | boolean | undefined;
export type OptionValues = Readonly<Record<string, OptionValue>>;

export interface OperationContext {
  readonly media?: MediaFile;
  readonly info?: MediaInfo;
}

export interface BuildPaths {
  readonly inputPath: string;
  readonly outputPath: string;
}

export interface Choice {
  readonly value: OptionValue;
  readonly label: string;
  /** A short aside — "Discord", "plays everywhere" — shown next to the label. */
  readonly note?: string;
  readonly disabled?: boolean;
}

type Choices<O extends OptionValues> =
  | readonly Choice[]
  | ((options: O, context: OperationContext) => readonly Choice[]);

interface FieldCommon<O extends OptionValues> {
  readonly key: keyof O & string;
  readonly label: string;
  readonly hint?: string;
  /**
   * Hidden fields keep their value — a field is hidden because it has nothing
   * to say about the current combination, not because the value is wrong.
   */
  readonly visibleWhen?: (options: O, context: OperationContext) => boolean;
  /** A plain-language caution under the control, e.g. the H.265 warning (D22). */
  readonly warnWhen?: (options: O, context: OperationContext) => string | undefined;
}

export interface SelectField<O extends OptionValues> extends FieldCommon<O> {
  readonly kind: 'select';
  readonly choices: Choices<O>;
}

/** Two or three mutually exclusive modes, shown as one row of buttons. */
export interface SegmentedField<O extends OptionValues> extends FieldCommon<O> {
  readonly kind: 'segmented';
  readonly choices: Choices<O>;
}

/** Preset values as pills — quality presets, target sizes. */
export interface ChipsField<O extends OptionValues> extends FieldCommon<O> {
  readonly kind: 'chips';
  readonly choices: Choices<O>;
}

export interface SliderField<O extends OptionValues> extends FieldCommon<O> {
  readonly kind: 'slider';
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  /** The value read out beside the label, e.g. "60 · CRF 23". */
  readonly display?: (options: O, context: OperationContext) => string;
  readonly endLabels?: readonly [string, string];
}

export interface ToggleField<O extends OptionValues> extends FieldCommon<O> {
  readonly kind: 'toggle';
}

export type Field<O extends OptionValues> =
  | SelectField<O>
  | SegmentedField<O>
  | ChipsField<O>
  | SliderField<O>
  | ToggleField<O>;

export type OperationGroup = 'video' | 'audio' | 'image' | 'subtitle';

export interface OperationDescriptor<O extends OptionValues> {
  readonly id: string;
  /** The URL segment, so a settings-bearing link can be shared (D8). */
  readonly route: string;
  readonly title: string;
  /** The label on the button that runs it: "Compress", "Extract audio". */
  readonly verb: string;
  readonly summary: string;
  readonly group: OperationGroup;
  /** Which kinds of file this can be pointed at. */
  readonly accepts: readonly MediaKind[];
  readonly defaults: O;
  readonly fields: readonly Field<O>[];
  /**
   * Names a hand-written form component instead of the generated one, for the
   * operations a schema cannot express — trim, crop, GIF (D23). The app layer
   * owns the id → component mapping so this file stays framework-free.
   */
  readonly customForm?: string;
  /** Why this file cannot be used, in the user's words. */
  readonly rejects?: (context: OperationContext) => string | undefined;
  /** Keeps impossible combinations from existing — runs after every change. */
  readonly normalize?: (options: O, context: OperationContext) => O;
  /** Cheap checks on combinations known to end badly (D17). */
  readonly preflight?: (options: O, context: OperationContext) => readonly string[];
  readonly build: (options: O, paths: BuildPaths, context: OperationContext) => string[];
  readonly outputExtension: (options: O, context: OperationContext) => string;
  /** Appended to the input's name: `holiday` + `compressed` → `holiday-compressed`. */
  readonly outputSuffix: string;
  readonly outputMime: (options: O, context: OperationContext) => string;
  readonly estimateBytes?: (options: O, context: OperationContext) => number | undefined;
  /** Seconds of output, when it differs from the input — trim's whole point. */
  readonly outputDuration?: (options: O, context: OperationContext) => number | undefined;
}

/**
 * The registry holds descriptors of many different option types, so it stores
 * them type-erased. Authoring stays fully typed: write the descriptor against
 * your own options interface and hand it to this.
 */
export type Operation = OperationDescriptor<OptionValues>;

export function defineOperation<O extends OptionValues>(
  descriptor: OperationDescriptor<O>,
): Operation {
  return descriptor as unknown as Operation;
}

/* ---------- reading a descriptor ---------- */

export function choicesOf(
  field: Field<OptionValues>,
  options: OptionValues,
  context: OperationContext,
): readonly Choice[] {
  if (field.kind === 'slider' || field.kind === 'toggle') return [];
  return typeof field.choices === 'function' ? field.choices(options, context) : field.choices;
}

export function isVisible(
  field: Field<OptionValues>,
  options: OptionValues,
  context: OperationContext,
): boolean {
  return field.visibleWhen ? field.visibleWhen(options, context) : true;
}

export function visibleFields(
  operation: Operation,
  options: OptionValues,
  context: OperationContext,
): readonly Field<OptionValues>[] {
  return operation.fields.filter((field) => isVisible(field, options, context));
}

/**
 * Applies one change and lets the operation put the result back in order — a
 * new container may rule out the current codec, a new mode may need a default.
 */
export function applyChange(
  operation: Operation,
  options: OptionValues,
  changes: Partial<Record<string, OptionValue>>,
  context: OperationContext,
): OptionValues {
  const next = { ...options, ...changes };
  return operation.normalize ? operation.normalize(next, context) : next;
}

export function initialOptions(operation: Operation, context: OperationContext): OptionValues {
  return operation.normalize
    ? operation.normalize(operation.defaults, context)
    : operation.defaults;
}

/**
 * A native <select> only deals in strings, and several of our choices are
 * numbers or absent. Encoding by position keeps `undefined` and `0` distinct.
 */
export function encodeChoice(choices: readonly Choice[], value: OptionValue): string {
  const index = choices.findIndex((choice) => choice.value === value);
  return index === -1 ? '' : String(index);
}

export function decodeChoice(choices: readonly Choice[], encoded: string): OptionValue {
  const choice = choices[Number(encoded)];
  return choice ? choice.value : undefined;
}

/** The name we suggest when saving: `holiday.mov` → `holiday-compressed.mp4`. */
export function outputNameFor(
  operation: Operation,
  options: OptionValues,
  context: OperationContext,
): string {
  const source = context.media?.name ?? 'output';
  const dot = source.lastIndexOf('.');
  const stem = dot > 0 ? source.slice(0, dot) : source;
  return `${stem}-${operation.outputSuffix}.${operation.outputExtension(options, context)}`;
}

/**
 * The command a person could paste into a terminal (D21) — built from the same
 * function the job runs, with real file names instead of mount paths.
 */
export function previewCommand(
  operation: Operation,
  options: OptionValues,
  context: OperationContext,
): string {
  const paths = {
    inputPath: context.media?.name ?? 'input',
    outputPath: outputNameFor(operation, options, context),
  };
  return toShellCommand(operation.build(options, paths, context));
}

export function toShellCommand(args: readonly string[]): string {
  const quoted = args.map((arg) =>
    /[\s'"*?$&|<>()]/.test(arg) ? `'${arg.split(`'`).join(`'\\''`)}'` : arg,
  );
  return `ffmpeg ${quoted.join(' ')}`;
}

/** `12.5` → `00:00:12.500`, which is the form FFmpeg never misreads. */
export function timestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${secs.toFixed(3).padStart(6, '0')}`;
}
