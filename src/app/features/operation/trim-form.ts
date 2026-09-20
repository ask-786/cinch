import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import type {
  Operation,
  OperationContext,
  OptionValue,
  OptionValues,
} from '../../../media/operations/descriptor';
import { Button, Slider } from '../../components/ui';

/**
 * Trim's own form — the first user of the custom-form hatch (D23).
 *
 * The generated form could render two number boxes, but picking a cut means
 * watching the frame you are cutting on: the preview seeks to whichever handle
 * you moved last, and the buttons take their times from where you paused.
 */
@Component({
  selector: 'app-trim-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Slider],
  template: `
    <div class="space-y-5">
      @if (sourceUrl(); as url) {
        <video
          #preview
          [src]="url"
          class="max-h-80 w-full rounded-lg bg-black"
          controls
          preload="metadata"
          playsinline
        ></video>
      } @else {
        <div class="grid h-40 place-items-center rounded-lg bg-raised text-sm text-muted">
          No preview available
        </div>
      }

      <div class="grid gap-5 sm:grid-cols-2">
        <div>
          <app-slider
            label="Start"
            [min]="0"
            [max]="duration()"
            [step]="0.1"
            [value]="start()"
            [display]="clock(start())"
            (valueChange)="setStart($event)"
          />
          <button appButton variant="secondary" size="sm" type="button" class="mt-2" (click)="startHere()">
            Start here
          </button>
        </div>

        <div>
          <app-slider
            label="End"
            [min]="0"
            [max]="duration()"
            [step]="0.1"
            [value]="end()"
            [display]="clock(end())"
            (valueChange)="setEnd($event)"
          />
          <button appButton variant="secondary" size="sm" type="button" class="mt-2" (click)="endHere()">
            End here
          </button>
        </div>
      </div>

      <p class="text-sm text-muted">
        Keeping
        <span class="font-mono text-ink">{{ clock(end() - start()) }}</span>
        of
        <span class="font-mono">{{ clock(duration()) }}</span>
      </p>

      <label class="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          [checked]="exact()"
          (change)="onChange()({ exact: !exact() })"
          class="size-4 rounded border-line-strong accent-accent"
        />
        <span class="text-sm text-ink">Cut exactly — slower, re-encodes the picture</span>
      </label>
    </div>
  `,
})
export class TrimForm {
  readonly operation = input.required<Operation>();
  readonly options = input.required<OptionValues>();
  readonly context = input.required<OperationContext>();
  readonly onChange = input.required<(changes: Record<string, OptionValue>) => void>();

  private readonly preview = viewChild<ElementRef<HTMLVideoElement>>('preview');

  /** An object URL over the user's own File — nothing leaves the tab. */
  protected readonly sourceUrl = signal<string | undefined>(undefined);

  protected readonly start = computed(() => numberOf(this.options()['startSeconds']));
  protected readonly end = computed(() => numberOf(this.options()['endSeconds']));
  protected readonly exact = computed(() => this.options()['exact'] === true);
  protected readonly duration = computed(
    () => this.context().info?.durationSeconds ?? Math.max(this.end(), 1),
  );

  constructor() {
    effect((onCleanup) => {
      const file = this.context().media?.file;
      if (!file) {
        this.sourceUrl.set(undefined);
        return;
      }
      const url = URL.createObjectURL(file);
      this.sourceUrl.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
    });
  }

  protected setStart(value: number): void {
    const next = Math.min(value, Math.max(this.end() - 0.1, 0));
    this.onChange()({ startSeconds: next });
    this.seek(next);
  }

  protected setEnd(value: number): void {
    const next = Math.max(value, this.start() + 0.1);
    this.onChange()({ endSeconds: next });
    this.seek(next);
  }

  protected startHere(): void {
    const at = this.preview()?.nativeElement.currentTime;
    if (at !== undefined) this.setStart(at);
  }

  protected endHere(): void {
    const at = this.preview()?.nativeElement.currentTime;
    if (at !== undefined) this.setEnd(at);
  }

  protected clock(seconds: number): string {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
  }

  private seek(seconds: number): void {
    const video = this.preview()?.nativeElement;
    if (!video) return;
    video.pause();
    video.currentTime = seconds;
  }
}

function numberOf(value: OptionValue): number {
  return typeof value === 'number' ? value : 0;
}
