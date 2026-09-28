import { describe, expect, it } from 'vitest';
import { ffprobeArgs, parseFfprobe, parseFrameRate } from './ffprobe';

describe('ffprobeArgs', () => {
  it('asks for JSON on a file rather than on stderr', () => {
    const args = ffprobeArgs('/mnt1/clip.mp4', '/probe.json');
    expect(args).toContain('-print_format');
    expect(args).toContain('json');
    expect(args.slice(-2)).toEqual(['-o', '/probe.json']);
  });

  it('asks for chapters, which strip metadata counts', () => {
    expect(ffprobeArgs('/mnt1/clip.mp4', '/probe.json')).toContain('-show_chapters');
  });
});

describe('parseFrameRate', () => {
  it('reduces the fractions ffprobe reports', () => {
    expect(parseFrameRate('30000/1001')).toBe(29.97);
    expect(parseFrameRate('25/1')).toBe(25);
    expect(parseFrameRate('60')).toBe(60);
  });

  it('rejects the placeholders it uses for still images and audio', () => {
    expect(parseFrameRate('0/0')).toBeUndefined();
    expect(parseFrameRate('90000/0')).toBeUndefined();
    expect(parseFrameRate(undefined)).toBeUndefined();
  });
});

describe('parseFfprobe', () => {
  const payload = JSON.stringify({
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        avg_frame_rate: '30000/1001',
        duration: '61.5',
      },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
    ],
    format: { duration: '61.541000', bit_rate: '2500000', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
  });

  it('reads both streams and the container', () => {
    const info = parseFfprobe(payload, 'video');
    expect(info).toMatchObject({
      source: 'ffprobe',
      kind: 'video',
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      audioCodec: 'aac',
      frameRate: 29.97,
      bitrate: 2_500_000,
      sampleRate: 48_000,
      channels: 2,
      hasVideo: true,
      hasAudio: true,
    });
    expect(info?.durationSeconds).toBeCloseTo(61.541);
  });

  it('notices a video with no audio track', () => {
    const silent = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'vp9', width: 640, height: 360 }],
      format: { duration: '3.0' },
    });
    const info = parseFfprobe(silent, 'video');
    expect(info?.hasAudio).toBe(false);
    expect(info?.audioCodec).toBeUndefined();
  });

  it('lists subtitle tracks in order, telling text from pictures', () => {
    const tracks = JSON.stringify({
      streams: [
        { codec_type: 'video', codec_name: 'h264' },
        { codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' } },
        { codec_type: 'audio', codec_name: 'aac' },
        { codec_type: 'subtitle', codec_name: 'ass', tags: { language: 'und', title: 'Signs' } },
        { codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle' },
      ],
      format: { duration: '3.0' },
    });
    expect(parseFfprobe(tracks, 'video')?.subtitles).toEqual([
      { codec: 'subrip', language: 'eng', title: undefined, text: true },
      { codec: 'ass', language: undefined, title: 'Signs', text: true },
      { codec: 'hdmv_pgs_subtitle', language: undefined, title: undefined, text: false },
    ]);
  });

  it('lists the audio tracks’ languages in order, leaving the untagged ones blank', () => {
    const tracks = JSON.stringify({
      streams: [
        { codec_type: 'video', codec_name: 'h264', tags: { language: 'eng' } },
        { codec_type: 'audio', codec_name: 'aac', tags: { language: 'spa' } },
        { codec_type: 'audio', codec_name: 'aac', tags: { language: 'und' } },
        { codec_type: 'audio', codec_name: 'ac3' },
      ],
      format: { duration: '3.0' },
    });
    expect(parseFfprobe(tracks, 'video')?.audioLanguages).toEqual(['spa', undefined, undefined]);
  });

  it('names the tags on the file and on its tracks, as they are', () => {
    const tagged = JSON.stringify({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          tags: {
            language: 'und',
            handler_name: 'Core Media Video',
            vendor_id: '[0][0][0][0]',
            encoder: 'Lavc61.19.101 libx264',
            creation_time: '2024-05-01T10:00:00.000000Z',
          },
        },
        { codec_type: 'subtitle', codec_name: 'ass', tags: { title: 'Signs', DURATION: '00:01' } },
        { codec_type: 'attachment', tags: { filename: 'font.ttf', mimetype: 'font/ttf' } },
      ],
      chapters: [{ id: 0 }, { id: 1 }],
      format: {
        duration: '3.0',
        tags: {
          major_brand: 'qt  ',
          minor_version: '0',
          compatible_brands: 'qt  ',
          encoder: 'Lavf61.7.103',
          'com.apple.quicktime.location.ISO6709': '+37.7749-122.4194+010.000/',
          'com.apple.quicktime.model': 'iPhone 15',
          TITLE: 'Holiday',
        },
      },
    });
    const info = parseFfprobe(tagged, 'video');
    expect(info?.tags).toEqual({
      file: [
        'major_brand',
        'minor_version',
        'compatible_brands',
        'encoder',
        'com.apple.quicktime.location.iso6709',
        'com.apple.quicktime.model',
        'title',
      ],
      tracks: [
        'language',
        'handler_name',
        'vendor_id',
        'encoder',
        'creation_time',
        'title',
        'duration',
        'filename',
        'mimetype',
      ],
    });
    expect(info?.chapters).toBe(2);
    expect(info?.attachments).toBe(1);
  });

  it('reports a file with nothing in it as nothing, not as unknown', () => {
    const bare = JSON.stringify({
      streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
      format: { duration: '3.0' },
    });
    const info = parseFfprobe(bare, 'audio');
    expect(info?.tags).toEqual({ file: [], tracks: [] });
    expect(info?.chapters).toBe(0);
    expect(info?.attachments).toBe(0);
  });

  it('gives up rather than guessing', () => {
    expect(parseFfprobe('not json', 'video')).toBeUndefined();
    expect(parseFfprobe('{}', 'video')).toBeUndefined();
  });
});
