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
import { displaySize } from '../../../media/models/media-info';
import type {
  Operation,
  OperationContext,
  OptionValue,
  OptionValues,
} from '../../../media/operations/descriptor';
import { OperationForm } from '../../components/operation-form';
import { Slider } from '../../components/ui';

type Corner = 'nw' | 'ne' | 'sw' | 'se';

interface Drag {
  readonly kind: 'move' | Corner;
  /** The finger or mouse that started it; a second finger on the box is ignored. */
  readonly pointerId: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly box: Box;
  readonly frame: { readonly width: number; readonly height: number };
  /** Frame pixels per screen pixel, fixed for the length of the drag. */
  readonly scale: number;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Crop's own form (D23): a box dragged over a still of the video, with the
 * generated fields underneath for the shape, the exact numbers and quality.
 *
 * The form only proposes a box. The descriptor's `normalize` keeps it inside
 * the picture, on even numbers and in shape, so a drag past the edge simply
 * stops there.
 */
@Component({
  selector: 'app-crop-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OperationForm, Slider],
  template: `
    <div class="space-y-5">
      @if (frame(); as size) {
        <div
          #stage
          class="relative mx-auto overflow-hidden rounded-lg bg-black select-none"
          [style.aspect-ratio]="size.width + ' / ' + size.height"
          [style.width]="'min(100%, calc(24rem * ' + size.width / size.height + '))'"
        >
          @if (sourceUrl(); as url) {
            <video
              #preview
              [src]="url"
              class="absolute inset-0 size-full object-fill"
              muted
              playsinline
              preload="auto"
              (loadedmetadata)="onLoaded()"
              (error)="playable.set(false)"
            ></video>
          }

          @if (box(); as b) {
            <div
              class="absolute cursor-move touch-none border-2 border-white shadow-[0_0_0_9999px_rgb(0_0_0/0.55)]"
              [style.left.%]="(b.x / size.width) * 100"
              [style.top.%]="(b.y / size.height) * 100"
              [style.width.%]="(b.width / size.width) * 100"
              [style.height.%]="(b.height / size.height) * 100"
              (pointerdown)="begin($event, 'move')"
              (pointermove)="drag($event)"
              (pointerup)="end($event)"
              (pointercancel)="end($event)"
            >
              <div class="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                @for (cell of thirds; track $index) {
                  <div class="border border-white/25"></div>
                }
              </div>
              @for (corner of corners; track corner) {
                <div
                  class="absolute size-4 touch-none rounded-sm border-2 border-white bg-accent"
                  [class]="cornerClass[corner]"
                  (pointerdown)="begin($event, corner)"
                ></div>
              }
            </div>
          }
        </div>

        <p class="text-center text-sm text-muted">
          @if (box(); as b) {
            Keeping
            <span class="font-mono text-ink">{{ b.width }} × {{ b.height }}</span>
            of
            <span class="font-mono">{{ size.width }} × {{ size.height }}</span>
          }
        </p>

        @if (!playable()) {
          <p class="text-center text-sm text-muted">
            This browser cannot show this video, so there is no picture to draw on. The box and the
            numbers below still work.
          </p>
        } @else if (duration() > 0) {
          <app-slider
            label="Frame to look at"
            [min]="0"
            [max]="duration()"
            [step]="0.1"
            [value]="seekTo()"
            [display]="clock(seekTo())"
            (valueChange)="seek($event)"
          />
        }
      } @else {
        <div class="grid h-40 place-items-center rounded-lg bg-raised text-sm text-muted">
          Measuring the picture…
        </div>
      }

      <app-operation-form
        [operation]="operation()"
        [options]="options()"
        [context]="context()"
        (changed)="onChange()($event)"
      />
    </div>
  `,
})
export class CropForm {
  readonly operation = input.required<Operation>();
  readonly options = input.required<OptionValues>();
  readonly context = input.required<OperationContext>();
  readonly onChange = input.required<(changes: Record<string, OptionValue>) => void>();

  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly preview = viewChild<ElementRef<HTMLVideoElement>>('preview');

  protected readonly corners: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];
  protected readonly cornerClass: Readonly<Record<Corner, string>> = {
    nw: 'left-0 top-0 cursor-nwse-resize',
    ne: 'right-0 top-0 cursor-nesw-resize',
    sw: 'bottom-0 left-0 cursor-nesw-resize',
    se: 'bottom-0 right-0 cursor-nwse-resize',
  };
  protected readonly thirds = Array.from({ length: 9 });

  /** An object URL over the user's own File — nothing leaves the tab. */
  protected readonly sourceUrl = signal<string | undefined>(undefined);
  protected readonly seekTo = signal(0);
  /** False once the browser gives up on the file — HEVC in some browsers, older codecs anywhere. */
  protected readonly playable = signal(true);

  /** The picture the way it plays, which is what the box is measured on. */
  protected readonly frame = computed(() => displaySize(this.context().info));
  protected readonly duration = computed(() => this.context().info?.durationSeconds ?? 0);

  protected readonly box = computed<Box | undefined>(() => {
    const options = this.options();
    const [x, y, width, height] = [options['x'], options['y'], options['width'], options['height']];
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof width !== 'number' ||
      typeof height !== 'number'
    ) {
      return undefined;
    }
    return { x, y, width, height };
  });

  private dragging: Drag | undefined;

  constructor() {
    effect((onCleanup) => {
      const file = this.context().media?.file;
      if (!file) {
        this.sourceUrl.set(undefined);
        return;
      }
      const url = URL.createObjectURL(file);
      this.playable.set(true);
      this.sourceUrl.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
    });
  }

  /** The first frame is often black; a moment in shows the actual shot. */
  protected onLoaded(): void {
    this.seek(Math.min(1, this.duration() / 2));
  }

  protected seek(seconds: number): void {
    this.seekTo.set(seconds);
    const player = this.preview()?.nativeElement;
    if (player) player.currentTime = seconds;
  }

  protected begin(event: PointerEvent, kind: Drag['kind']): void {
    if (this.dragging) return;
    const box = this.box();
    const frame = this.frame();
    const stage = this.stage()?.nativeElement;
    if (!box || !frame || !stage) return;

    // A corner sits inside the box; without this the box would start a move too.
    event.stopPropagation();
    event.preventDefault();
    // Captured moves still bubble to the box, which handles every drag.
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);

    this.dragging = {
      kind,
      pointerId: event.pointerId,
      frame,
      pointerX: event.clientX,
      pointerY: event.clientY,
      box,
      scale: frame.width / stage.getBoundingClientRect().width,
    };
  }

  protected drag(event: PointerEvent): void {
    const drag = this.dragging;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const dx = Math.round((event.clientX - drag.pointerX) * drag.scale);
    const dy = Math.round((event.clientY - drag.pointerY) * drag.scale);
    const { x, y, width, height } = drag.box;

    if (drag.kind === 'move') {
      this.onChange()({ x: x + dx, y: y + dy });
      return;
    }

    const west = drag.kind === 'nw' || drag.kind === 'sw';
    const north = drag.kind === 'nw' || drag.kind === 'ne';
    // The opposite corner stays put, so the box can only grow as far as the
    // frame's edge on the dragged side. Stopping here, rather than leaving it
    // to the descriptor's clamp, keeps the far edge from sliding outwards.
    const roomX = west ? x + width : drag.frame.width - x;
    const roomY = north ? y + height : drag.frame.height - y;

    let nextWidth: number;
    let nextHeight: number;
    if (this.options()['aspect'] === 'free') {
      nextWidth = clamp(west ? width - dx : width + dx, 2, roomX);
      nextHeight = clamp(north ? height - dy : height + dy, 2, roomY);
    } else {
      // With a shape held, the height follows the width; the descriptor has
      // the final say, this only keeps the dragged corner under the pointer.
      const ratio = width / height;
      nextWidth = clamp(west ? width - dx : width + dx, 2, Math.min(roomX, roomY * ratio));
      nextHeight = nextWidth / ratio;
    }

    this.onChange()({
      width: nextWidth,
      height: Math.round(nextHeight),
      x: west ? x + width - nextWidth : x,
      y: north ? Math.round(y + height - nextHeight) : y,
    });
  }

  protected end(event: PointerEvent): void {
    if (event.pointerId === this.dragging?.pointerId) this.dragging = undefined;
  }

  protected clock(seconds: number): string {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    return `${minutes}:${(safe % 60).toFixed(1).padStart(4, '0')}`;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
