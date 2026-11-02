/**
 * Shrink a screenshot in the browser before upload.
 * Long edge capped at 1920 px, re-encoded as WebP (JPEG fallback) at high quality,
 * which keeps in-game chat text readable while cutting a typical 3–5 MB PNG to a few hundred KB.
 * GIFs are left alone (they may be animated); if re-encoding makes a file bigger, the original is kept.
 */
const MAX_EDGE = 1920;
const QUALITY = 0.86;

export async function shrinkImage(file: File): Promise<File> {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // unreadable in this browser; let the server-side type/size checks decide
  }

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
  if (!blob || blob.size >= file.size) return file;

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
