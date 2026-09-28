/**
 * The core has no fontconfig, so `drawtext` and `subtitles` find no font
 * unless one is handed to them by path (D13). DejaVu Sans is shipped next to
 * the cores, unhashed for the same reason (D3), and written into the core's
 * filesystem before a job that draws text.
 *
 * DejaVu covers Latin, Greek and Cyrillic, which is most of what people type
 * into a caption. Its licence is the permissive Bitstream Vera one.
 */

export type FontWeight = 'regular' | 'bold';

export const FONT_FILES: Readonly<Record<FontWeight, string>> = {
  regular: 'DejaVuSans.ttf',
  bold: 'DejaVuSans-Bold.ttf',
};

/** Where the runner writes them inside the core. */
export const FONTS_DIR = '/fonts';

/** Absolute, so the worker resolves them against the site and not against itself. */
export function fontAssetUrls(): readonly { name: string; url: string }[] {
  return Object.values(FONT_FILES).map((name) => ({
    name,
    url: new URL(`fonts/${name}`, document.baseURI).href,
  }));
}

/** `fontfile=` for `drawtext`, under whichever folder this command is built for. */
export function fontPath(weight: FontWeight, fontsDir = FONTS_DIR): string {
  return `${fontsDir}/${FONT_FILES[weight]}`;
}
