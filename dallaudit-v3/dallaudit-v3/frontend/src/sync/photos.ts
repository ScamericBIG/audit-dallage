import { db } from './db';
import type { Photo } from './db';
import { syncEngine } from './queue';

interface CompressionOpts {
  maxDim?: number;
  thumbDim?: number;
  quality?: number;
}

interface Compressed {
  fullBlob: Blob;
  thumbBlob: Blob;
  origBytes: number;
  fullBytes: number;
  thumbBytes: number;
  dims: { w: number; h: number };
  mimeType: string;
}

export async function compressAndStorePhoto(file: File, obsId: string, opts: CompressionOpts = {}): Promise<Photo> {
  const result = await compressImage(file, opts);
  const photo: Photo = {
    id: 'ph_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16),
    obsId,
    fullBlob: result.fullBlob,
    thumbBlob: result.thumbBlob,
    mimeType: result.mimeType,
    origBytes: result.origBytes,
    fullBytes: result.fullBytes,
    thumbBytes: result.thumbBytes,
    dims: result.dims,
    createdAt: Date.now(),
    syncStatus: 'pending',
  };

  await db.photos.put(photo);

  const obs = await db.observations.get(obsId);
  if (obs) {
    const photoIds = [...(obs.photoIds ?? []), photo.id];
    await db.observations.update(obsId, { photoIds, updatedAt: Date.now(), syncStatus: 'pending' });
    await syncEngine.enqueue('updateObs', obsId, { ...obs, photoIds, updatedAt: Date.now() } as Record<string, unknown>);
  }

  await syncEngine.enqueue('pushPhoto', obsId, { photoId: photo.id });
  return photo;
}

async function compressImage(file: File, opts: CompressionOpts): Promise<Compressed> {
  const maxDim = opts.maxDim ?? 1920;
  const thumbDim = opts.thumbDim ?? 240;
  const quality = opts.quality ?? 0.82;

  const bitmap = await loadBitmap(file);
  try {
    const [full, thumb] = await Promise.all([
      encode(bitmap, maxDim, quality, 'image/jpeg'),
      encode(bitmap, thumbDim, 0.72, 'image/jpeg'),
    ]);
    return {
      fullBlob: full, thumbBlob: thumb,
      origBytes: file.size, fullBytes: full.size, thumbBytes: thumb.size,
      dims: { w: (bitmap as ImageBitmap).width ?? (bitmap as HTMLImageElement).naturalWidth,
               h: (bitmap as ImageBitmap).height ?? (bitmap as HTMLImageElement).naturalHeight },
      mimeType: 'image/jpeg',
    };
  } finally {
    if ('close' in bitmap) (bitmap as ImageBitmap).close();
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' as ImageOrientation }); } catch {}
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}

async function encode(source: ImageBitmap | HTMLImageElement, maxDim: number, quality: number, mime: string): Promise<Blob> {
  const isImg = source instanceof HTMLImageElement;
  const srcW = isImg ? source.naturalWidth : (source as ImageBitmap).width;
  const srcH = isImg ? source.naturalHeight : (source as ImageBitmap).height;
  const ratio = Math.min(maxDim / srcW, maxDim / srcH, 1);
  const w = Math.round(srcW * ratio);
  const h = Math.round(srcH * ratio);

  if ('OffscreenCanvas' in window) {
    const canvas = new OffscreenCanvas(w, h);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (canvas.getContext('2d') as any).drawImage(source, 0, 0, w, h);
    return canvas.convertToBlob({ type: mime, quality });
  }

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (canvas.getContext('2d') as any).drawImage(source, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Encodage échoué')), mime, quality)
  );
}

// ---- URL cache for blobs ----
const urlCache = new Map<string, string>();

export function blobToObjectURL(blob: Blob, key: string): string {
  const ex = urlCache.get(key);
  if (ex) return ex;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

export function releaseObjectURL(key: string) {
  const url = urlCache.get(key);
  if (url) { URL.revokeObjectURL(url); urlCache.delete(key); }
}
