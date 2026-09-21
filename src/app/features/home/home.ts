import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { chooseCore } from '../../../media/ffmpeg/core-routing';
import type { MediaKind } from '../../../media/models/media-kind';
import { groupOperations, operationsFor, OPERATIONS } from '../../../media/operations/registry';
import { DropZone } from '../../components/drop-zone';
import { JobList } from '../../components/job-list';
import { MediaInfoPanel } from '../../components/media-info-panel';
import { Button } from '../../components/ui';
import { FfmpegClient } from '../../core/ffmpeg-client';
import { Selection } from '../../core/selection';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, DropZone, JobList, MediaInfoPanel, RouterLink],
  templateUrl: './home.html',
})
export class Home {
  protected readonly selection = inject(Selection);
  private readonly ffmpeg = inject(FfmpegClient);

  constructor() {
    // A file on screen means a job is likely. Pull the core down while the
    // user reads, so the first click is not a 32 MB wait.
    effect(() => {
      if (this.selection.isEmpty()) return;
      const height = this.selection
        .files()
        .map((file) => this.selection.info().get(file.id)?.height)
        .find((value) => value !== undefined);
      this.ffmpeg.prewarm(
        chooseCore({ estimatedOutputBytes: 1, sourceHeight: height }, this.ffmpeg.capabilities),
      );
    });
  }

  /** Dropping several files is how the combine operations are discovered (D24). */
  protected readonly isMultiple = computed(() => this.selection.count() > 1);

  /** One per file, repeats kept: joining needs two videos, not one. */
  private readonly kinds = computed<readonly MediaKind[]>(() =>
    this.selection.files().map((file) => file.kind),
  );

  /** What can be done with what is on screen, straight from the registry. */
  protected readonly available = computed(() => groupOperations(operationsFor(this.kinds())));

  /** Everything Cinch can do, for the empty state's list. */
  protected readonly catalogue = groupOperations(OPERATIONS);

  protected readonly comingSoon: readonly string[] = [
    'Resize',
    'Crop',
    'Change frame rate',
    'Make a GIF',
    'Burn in subtitles',
  ];
}
