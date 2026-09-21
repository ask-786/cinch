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

/** One file an operation is pointed at, with whatever we know about it so far. */
export interface OperationInput {
  readonly media: MediaFile;
  readonly info?: MediaInfo;
}

export interface OperationContext {
  /** The first input — the only one, for every single-input operation. */
  readonly media?: MediaFile;
  readonly info?: MediaInfo;
  /**
   * Every input, in the order the user arranged them. Only multi-input
   * operations need to read this; for the rest it holds `media` alone.
   */
  readonly inputs?: readonly OperationInput[];
}

export interface BuildPaths {
  /** Same as `inputPaths[0]`. */
  readonly inputPath: string;
  readonly inputPaths: readonly string[];
  /**
   * Where FFmpeg writes. For an operation with `outputs: 'many'` this holds
   * `SEQUENCE_TOKEN`, which FFmpeg replaces with 0001, 0002, …
   */
  readonly outputPath: string;
}

/**
 * The numbering FFmpeg's image2 and segment muxers expand. Always this token,
 * so the job runner can map each file it finds back to a name the user gets.
 */
export const SEQUENCE_TOKEN = '%04d';

/** How many files an operation takes. Absent means exactly one. */
export interface InputCount {
  readonly min: number;
  readonly max?: number;
}

export interface Choice {
  readonly value: OptionValue;
  readonly label: string;
  /** A short aside — "Discord", "plays everywhere" — shown next to the label. */
  readonly note?: string;
  readonly disabled?: boolean;
}

type Choices<O extends OptionValues> =
  readonly Choice[] | ((options: O, context: OperationContext) => readonly Choice[]);

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

/**
 * A typed-in number, for the values no list of choices can cover — a width, a
 * frame rate, a bitrate. An empty box reads as `undefined`, so a field can
 * mean "leave this alone" without needing a separate toggle.
 */
export interface NumberField<O extends OptionValues> extends FieldCommon<O> {
  readonly kind: 'number';
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Shown inside the box: "px", "fps", "kbps". */
  readonly suffix?: string;
  readonly placeholder?: string;
}

/** A typed-in line of text — a watermark caption, a title. */
export interface TextField<O extends OptionValues> extends FieldCommon<O> {
  readonly kind: 'text';
  readonly placeholder?: string;
  readonly maxLength?: number;
}

export type Field<O extends OptionValues> =
  | SelectField<O>
  | SegmentedField<O>
  | ChipsField<O>
  | SliderField<O>
  | ToggleField<O>
  | NumberField<O>
  | TextField<O>;

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
  /** Join, merge, stack: operations that read several files at once (D24). */
  readonly inputs?: InputCount;
  /**
   * Kinds the selection must include at least one of each, on top of the
   * count: replacing a video's sound takes a video and an audio file, and two
   * audio files are not enough.
   */
  readonly requires?: readonly MediaKind[];
  /**
   * `'many'` for operations that write a numbered run of files — frames,
   * thumbnails, segments. Their output path carries `SEQUENCE_TOKEN`, and the
   * result is saved as a folder or a zip.
   */
  readonly outputs?: 'one' | 'many';
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

export function inputCountOf(operation: Operation): InputCount {
  return operation.inputs ?? { min: 1, max: 1 };
}

export function isMultiInput(operation: Operation): boolean {
  const { min, max } = inputCountOf(operation);
  return min > 1 || max === undefined || max > 1;
}

export function hasManyOutputs(operation: Operation): boolean {
  return operation.outputs === 'many';
}

/**
 * The files an operation would run on, from everything the user selected:
 * the one they chose for a single-input operation, all of them (up to the
 * limit) for a multi-input one.
 */
export function pickInputs<T extends { readonly kind: MediaKind }>(
  operation: Operation,
  files: readonly T[],
): readonly T[] {
  const accepted = files.filter((file) => operation.accepts.includes(file.kind));
  const { max } = inputCountOf(operation);
  return max === undefined ? accepted : accepted.slice(0, max);
}

/** Whether a selection holds enough of the right files to open the operation. */
export function canRun(operation: Operation, kinds: readonly MediaKind[]): boolean {
  const matching = kinds.filter((kind) => operation.accepts.includes(kind)).length;
  const required = operation.requires ?? [];
  return matching >= inputCountOf(operation).min && required.every((kind) => kinds.includes(kind));
}

export function choicesOf(
  field: Field<OptionValues>,
  options: OptionValues,
  context: OperationContext,
): readonly Choice[] {
  // Sliders, toggles and typed-in fields have no list to offer.
  if (!('choices' in field)) return [];
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

/**
 * The name we suggest when saving: `holiday.mov` → `holiday-compressed.mp4`.
 * For a numbered run it is a pattern, `holiday-frames-%04d.jpg`, which
 * `sequenceName` fills in per file.
 */
export function outputNameFor(
  operation: Operation,
  options: OptionValues,
  context: OperationContext,
): string {
  const numbering = hasManyOutputs(operation) ? `-${SEQUENCE_TOKEN}` : '';
  return `${outputStem(operation, context)}${numbering}.${operation.outputExtension(options, context)}`;
}

/** The name for a numbered run saved as one archive: `holiday-frames.zip`. */
export function archiveNameFor(operation: Operation, context: OperationContext): string {
  return `${outputStem(operation, context)}.zip`;
}

/** `holiday-frames-%04d.jpg` + `0007` → `holiday-frames-0007.jpg`. */
export function sequenceName(pattern: string, number: string): string {
  return pattern.replace(SEQUENCE_TOKEN, number);
}

function outputStem(operation: Operation, context: OperationContext): string {
  const source = context.media?.name ?? 'output';
  const dot = source.lastIndexOf('.');
  // A `%` in the user's own file name would read as a second pattern.
  const stem = (dot > 0 ? source.slice(0, dot) : source).replaceAll('%', '');
  return `${stem}-${operation.outputSuffix}`;
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
  const inputPaths = context.inputs?.map((input) => input.media.name) ?? [
    context.media?.name ?? 'input',
  ];
  const paths = {
    inputPath: inputPaths[0] ?? 'input',
    inputPaths,
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
