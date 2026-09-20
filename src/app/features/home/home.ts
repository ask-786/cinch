import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { chooseCore } from '../../../media/ffmpeg/core-routing';
import { DropZone } from '../../components/drop-zone';
import { MediaInfoPanel } from '../../components/media-info-panel';
import { Button } from '../../components/ui';
import { FfmpegClient } from '../../core/ffmpeg-client';
import { Selection } from '../../core/selection';

interface Capability {
  readonly title: string;
  readonly items: readonly string[];
}

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, DropZone, MediaInfoPanel, RouterLink],
  templateUrl: './home.html',
})
export class Home {
  protected readonly selection = inject(Selection);
  private readonly ffmpeg = inject(FfmpegClient);

  constructor() {
    // A file on screen means a job is likely. Pull the core down while the
    // user reads, so the first Compress click is not a 32 MB wait.
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
  protected readonly hasVideo = computed(() => this.selection.files().some((f) => f.kind === 'video'));

  protected readonly capabilities: readonly Capability[] = [
    { title: 'Video', items: ['Compress', 'Convert', 'Resize', 'Crop', 'Trim', 'Change frame rate'] },
    { title: 'Audio', items: ['Extract from video', 'Convert', 'Trim', 'Volume', 'Fade', 'Merge'] },
    { title: 'Images & GIF', items: ['Frames from video', 'Make a GIF', 'Thumbnails', 'Images to video'] },
    { title: 'Subtitles', items: ['Extract', 'Convert', 'Burn into the picture'] },
  ];
}
