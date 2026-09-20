/** Formatting helpers shared by every screen. Pure, so they are easy to test. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${Math.round(bytes)} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${UNITS[unit]}`;
}

/** 0:07 · 4:31 · 1:02:09 — the shapes a media player would show. */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function formatDimensions(width?: number, height?: number): string {
  return width && height ? `${width} × ${height}` : '—';
}

/** 1080p, 4K and friends — what people actually call these sizes. */
export function resolutionLabel(width?: number, height?: number): string | undefined {
  if (!width || !height) return undefined;
  const shortSide = Math.min(width, height);
  if (shortSide >= 2000) return '4K';
  if (shortSide >= 1400) return '1440p';
  if (shortSide >= 1000) return '1080p';
  if (shortSide >= 700) return '720p';
  if (shortSide >= 460) return '480p';
  return `${shortSide}p`;
}
