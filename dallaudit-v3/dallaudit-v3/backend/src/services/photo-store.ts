import { createHash } from 'node:crypto';
import { promises as fs, createWriteStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.resolve(__dirname, '../../../uploads');

const EXT_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function monthSlug() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface StoredFile {
  id: string;
  url: string;
  bytes: number;
  sha256: string;
  mimeType: string;
}

export async function savePhotoFromStream(
  fileId: string,
  mimeType: string,
  stream: NodeJS.ReadableStream,
  subfolder = 'photos'
): Promise<StoredFile> {
  const ext = EXT_MAP[mimeType.toLowerCase()];
  if (!ext) throw Object.assign(new Error(`MIME non supporté: ${mimeType}`), { statusCode: 415 });

  const dir = path.join(UPLOAD_ROOT, subfolder, monthSlug());
  await fs.mkdir(dir, { recursive: true });
  const abs = path.join(dir, `${fileId}${ext}`);

  const hash = createHash('sha256');
  let bytes = 0;
  const tee = new Transform({
    transform(chunk, _enc, cb) { hash.update(chunk); bytes += chunk.length; cb(null, chunk); },
  });
  await pipeline(stream, tee, createWriteStream(abs));

  const rel = path.relative(UPLOAD_ROOT, abs).split(path.sep).join('/');
  return { id: fileId, url: `/uploads/${rel}`, bytes, sha256: hash.digest('hex'), mimeType };
}

export async function deleteFile(urlPath: string): Promise<boolean> {
  const rel = urlPath.replace(/^\/uploads\//, '');
  const abs = path.join(UPLOAD_ROOT, rel);
  const normalized = path.normalize(abs);
  if (!normalized.startsWith(UPLOAD_ROOT)) throw Object.assign(new Error('Chemin invalide'), { statusCode: 400 });
  if (!existsSync(normalized)) return false;
  await fs.unlink(normalized);
  return true;
}

export async function getStorageStats(): Promise<{ count: number; totalBytes: number }> {
  async function walk(dir: string): Promise<string[]> {
    if (!existsSync(dir)) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) files.push(...await walk(full));
      else files.push(full);
    }
    return files;
  }
  const files = await walk(UPLOAD_ROOT);
  let total = 0;
  for (const f of files) total += (await fs.stat(f)).size;
  return { count: files.length, totalBytes: total };
}
