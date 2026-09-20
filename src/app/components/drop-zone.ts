import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ACCEPT_ATTRIBUTE } from '../../media/models/media-kind';
import { Button } from './ui';

/**
 * Drag-and-drop plus a real file input, because drag-and-drop does not exist on
 * a phone and is awkward with a screen reader.
 */
@Component({
  selector: 'app-drop-zone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  host: {
    '(dragenter)': 'onDragEnter($event)',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
  },
  template: `
    <div
      class="rounded-card border-2 border-dashed px-6 text-center transition-colors duration-100"
      [class]="
        active()
          ? 'border-accent bg-accent-soft'
          : 'border-line bg-surface hover:border-line-strong'
      "
      [class.py-14]="!compact()"
      [class.py-8]="compact()"
    >
      <svg
        class="mx-auto transition-colors"
        [class]="active() ? 'text-accent' : 'text-faint'"
        [class.size-10]="!compact()"
        [class.size-7]="compact()"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>

      <p class="mt-4 text-base font-medium text-ink">
        {{ active() ? 'Let go to add it' : heading() }}
      </p>
      <p class="mt-1 text-sm text-muted">{{ subheading() }}</p>

      <button appButton variant="primary" size="md" class="mt-5" type="button" (click)="pick()">
        {{ buttonLabel() }}
      </button>

      <input
        #input
        type="file"
        multiple
        class="sr-only"
        [accept]="accept"
        (change)="onInputChange($event)"
      />
    </div>
  `,
})
export class DropZone {
  readonly heading = input('Drop a file here');
  readonly subheading = input('Video, audio, images or subtitles — nothing is uploaded');
  readonly buttonLabel = input('Choose a file');
  readonly compact = input(false, { transform: booleanAttribute });

  readonly filesPicked = output<readonly File[]>();

  protected readonly accept = ACCEPT_ATTRIBUTE;
  protected readonly active = signal(false);

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  /** dragenter/leave fire for descendants too; counting keeps the state stable. */
  private depth = 0;

  pick(): void {
    this.input().nativeElement.click();
  }

  protected onDragEnter(event: DragEvent): void {
    if (!hasFiles(event)) return;
    event.preventDefault();
    this.depth++;
    this.active.set(true);
  }

  protected onDragOver(event: DragEvent): void {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  protected onDragLeave(event: DragEvent): void {
    if (!hasFiles(event)) return;
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) this.active.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.depth = 0;
    this.active.set(false);

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) this.filesPicked.emit(files);
  }

  protected onInputChange(event: Event): void {
    const element = event.target as HTMLInputElement;
    const files = Array.from(element.files ?? []);
    // Reset so picking the same file twice in a row still fires a change.
    element.value = '';
    if (files.length > 0) this.filesPicked.emit(files);
  }
}

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}
