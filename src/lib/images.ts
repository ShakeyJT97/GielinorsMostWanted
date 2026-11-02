/**
 * Shrink a screenshot in the browser before upload.
 * Long edge capped at 1920 px, re-encoded as WebP (JPEG fallback) at high quality,
 * which keeps in-game chat text readable while cutting a typical 3–5 MB PNG to a few hundred KB.
 * The file's real type is checked from its contents (not its name), and every image except GIFs is redrawn,
 * so a renamed program can't get through.
 */
const MAX_EDGE = 1920;
const QUALITY = 0.86;

/** What the file's first bytes say it is, whatever its name claims. */
export async function sniffImageType(file: File): Promise<'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const at = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

/**
 * Check the file really is a picture and redraw it as a fresh image, so whatever else was inside the
 * original file never reaches storage. Throws a friendly message if it isn't a real image.
 */
export async function shrinkImage(file: File): Promise<File> {
  const real = await sniffImageType(file);
  if (!real) throw new Error(`${file.name || 'That file'} isn't really an image. Only PNG, JPG, WebP or GIF screenshots can be uploaded.`);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name || 'That file'} couldn't be opened as a picture. Try taking the screenshot again.`);
  }
  if (bitmap.width * bitmap.height > 40_000_000) {
    bitmap.close();
    throw new Error(`${file.name} is enormous (${bitmap.width}×${bitmap.height}). Send a normal screenshot instead.`);
  }
  // GIFs may be animated, so they're kept as they are once we know they're genuine
  if (real === 'image/gif') { bitmap.close(); return new File([file], file.name, { type: 'image/gif' }); }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); return file; }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await encode(canvas, 'image/webp') ?? await encode(canvas, 'image/jpeg');
  if (!blob) throw new Error(`Couldn't prepare ${file.name}. Try a different browser.`);

  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const base = file.name.replace(/\.[^.]+$/, '') || 'screenshot';
  return new File([blob], `${base}.${ext}`, { type: blob.type, lastModified: Date.now() });
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b && b.type === type ? b : null), type, QUALITY);
  });
}

export const formatBytes = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
