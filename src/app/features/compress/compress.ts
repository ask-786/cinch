import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { formatBytes, formatDuration } from '../../../media/humanize';
import { saveBlob, outputFileName } from '../../../media/file-system/save';
import type { MediaInfo } from '../../../media/models/media-info';
import {
  buildVideoCompressionArgs,
  DEFAULT_COMPRESSION,
  estimateOutputBytes,
  FORMAT_CODECS,
  qualityToCrf,
  toShellCommand,
  type AudioQuality,
  type VideoCodec,
  type VideoCompressionOptions,
  type VideoFormat,
} from '../../../media/operations/video-compress';
import { Button, Disclosure, Progress, Select, Slider, type SelectOption } from '../../components/ui';
import { JobRunner } from '../../core/job-runner';
import { Selection } from '../../core/selection';

const MIME: Readonly<Record<VideoFormat, string>> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
};

interface SizePreset {
  readonly label: string;
  readonly bytes: number;
  readonly note: string;
}

@Component({
  selector: 'app-compress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './compress.html',
  imports: [Button, DecimalPipe, Disclosure, Progress, Select, Slider],
})
export class Compress implements OnInit {
  private readonly router = inject(Router);
  protected readonly selection = inject(Selection);
  protected readonly runner = inject(JobRunner);

  /** The first video in the selection — Stage 5 turns this into a real queue. */
  protected readonly media = computed(() => this.selection.files().find((f) => f.kind === 'video'));
  protected readonly info = computed<MediaInfo | undefined>(() => {
    const media = this.media();
    return media ? this.selection.info().get(media.id) : undefined;
  });

  protected readonly options = signal<VideoCompressionOptions>(DEFAULT_COMPRESSION);
  protected readonly saveState = signal<'idle' | 'saving' | 'saved'>('idle');
  protected readonly copied = signal(false);

  /** The tail is the part that explains a failure; the rest is banner noise. */
  protected readonly logTail = computed(() => this.runner.logs().slice(-40).join('\n'));

  protected readonly formats: readonly SelectOption<VideoFormat>[] = [
    { value: 'mp4', label: 'MP4 — plays everywhere' },
    { value: 'webm', label: 'WebM — smaller, web only' },
    { value: 'mkv', label: 'MKV — anything goes' },
    { value: 'mov', label: 'MOV — QuickTime' },
  ];

  protected readonly audioChoices: readonly SelectOption<AudioQuality>[] = [
    { value: 'small', label: 'Smaller (96 kbps)' },
    { value: 'good', label: 'Good (128 kbps)' },
    { value: 'high', label: 'High (192 kbps)' },
    { value: 'none', label: 'Remove the audio' },
  ];

  protected readonly sizePresets: readonly SizePreset[] = [
    { label: '10 MB', bytes: 10_000_000, note: 'Discord' },
    { label: '25 MB', bytes: 25_000_000, note: 'Email' },
    { label: '50 MB', bytes: 50_000_000, note: '' },
    { label: '100 MB', bytes: 100_000_000, note: '' },
  ];

  protected readonly qualityPresets = [
    { label: 'Small', quality: 35 },
    { label: 'Balanced', quality: 60 },
    { label: 'High', quality: 80 },
  ] as const;

  protected readonly codecChoices = computed<readonly SelectOption<VideoCodec>[]>(() => {
    const labels: Record<VideoCodec, string> = {
      h264: 'H.264 — plays everywhere',
      h265: 'H.265 — smaller, fussier',
      vp9: 'VP9 — smaller, web only',
    };
    return FORMAT_CODECS[this.options().format].map((codec) => ({
      value: codec,
      label: labels[codec],
    }));
  });

  protected readonly heightChoices = computed<readonly SelectOption<string>[]>(() => {
    const sourceHeight = this.info()?.height;
    const all = [1080, 720, 480, 360];
    const usable = sourceHeight ? all.filter((h) => h < sourceHeight) : all;
    return [
      { value: '', label: sourceHeight ? `Keep ${sourceHeight}p` : 'Keep the original size' },
      ...usable.map((h) => ({ value: String(h), label: `${h}p` })),
    ];
  });

  protected readonly estimate = computed(() => estimateOutputBytes(this.options(), this.info()));

  protected readonly savedPercent = computed(() => {
    const media = this.media();
    const estimate = this.estimate();
    if (!media || estimate === undefined) return undefined;
    return Math.round((1 - estimate / media.size) * 100);
  });

  protected readonly resultSavedPercent = computed(() => {
    const media = this.media();
    const result = this.runner.result();
    if (!media || !result) return undefined;
    return Math.round((1 - result.bytes / media.size) * 100);
  });

  protected readonly outputName = computed(() => {
    const media = this.media();
    return media ? outputFileName(media.name, 'compressed', this.options().format) : 'output.mp4';
  });

  /** The same builder the job uses, with real names instead of mount paths. */
  protected readonly command = computed(() => {
    const media = this.media();
    if (!media) return '';
    return toShellCommand(
      buildVideoCompressionArgs(this.options(), {
        inputPath: media.name,
        outputPath: this.outputName(),
        info: this.info(),
      }),
    );
  });

  protected readonly crf = computed(() => qualityToCrf(this.options().quality, this.options().codec));

  protected readonly eta = computed(() => {
    const state = this.runner.state();
    if (state.phase !== 'running' || !state.ratio || state.ratio < 0.02) return undefined;
    const remaining = (state.elapsedMs / state.ratio) * (1 - state.ratio);
    return remaining;
  });

  ngOnInit(): void {
    const media = this.media();
    if (!media) {
      void this.router.navigate(['/']);
      return;
    }
    // Opening this screen is intent: we need the duration, and warming the core
    // now means the Start button does not sit through a 32 MB download.
    void this.selection.deepProbe(media.id);
  }

  protected update(changes: Partial<VideoCompressionOptions>): void {
    this.options.update((current) => {
      const next = { ...current, ...changes };
      // Keep the codec possible for the chosen container.
      const allowed = FORMAT_CODECS[next.format];
      return allowed.includes(next.codec) ? next : { ...next, codec: allowed[0] };
    });
  }

  protected setQuality(value: number): void {
    this.update({ quality: value, mode: 'quality' });
  }

  protected setTarget(bytes: number): void {
    this.update({ mode: 'size', targetBytes: bytes });
  }

  protected readonly heightValue = computed(() => {
    const height = this.options().maxHeight;
    return height === undefined ? '' : String(height);
  });

  protected setHeight(value: string): void {
    this.update({ maxHeight: value ? Number(value) : undefined });
  }

  protected async start(): Promise<void> {
    const media = this.media();
    if (!media) return;

    const info = this.info();
    const options = this.options();

    await this.runner.run({
      media,
      outputName: this.outputName(),
      outputMime: MIME[options.format],
      build: (paths) => buildVideoCompressionArgs(options, { ...paths, info }),
      durationSeconds: info?.durationSeconds,
      sourceHeight: info?.height,
      estimatedOutputBytes: this.estimate(),
    });
  }

  protected async save(): Promise<void> {
    const result = this.runner.result();
    if (!result) return;

    this.saveState.set('saving');
    const outcome = await saveBlob(result.blob, this.outputName());
    this.saveState.set(outcome === 'cancelled' ? 'idle' : 'saved');
  }

  protected async copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.command());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard access can be refused; the command is on screen to select.
    }
  }

  protected startOver(): void {
    this.runner.reset();
    this.saveState.set('idle');
  }

  protected back(): void {
    this.runner.reset();
    void this.router.navigate(['/']);
  }

  protected readonly formatBytes = formatBytes;
  protected readonly formatDuration = formatDuration;

  protected formatElapsed(ms: number): string {
    return formatDuration(Math.round(ms / 1000));
  }
}
