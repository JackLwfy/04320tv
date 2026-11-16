import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { analyticsPool } from './analytics-db';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const IMAGE_NAME = /^[a-f0-9]{64}\.(jpg|png|webp)$/;
export function imageType(body: Buffer): { mime: string; extension: string } | null {
  if (body.length < 12 || body.length > MAX_IMAGE_BYTES) return null;
  if (body.subarray(0, 3).equals(Buffer.from([255,216,255]))) return { mime: 'image/jpeg', extension: 'jpg' };
  if (body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime: 'image/png', extension: 'png' };
  if (body.toString('ascii',0,4)==='RIFF' && body.toString('ascii',8,12)==='WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}
export function imageUploadAuthorized(headers: Headers, now = Date.now()) {
  const secret = process.env.NEWSLETTER_IMAGE_SECRET || '';
  const timestamp = headers.get('x-image-time') || '', hash = headers.get('x-image-sha256') || '', mac = headers.get('x-image-signature') || '';
  if (secret.length < 32 || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/.test(hash) || !/^[a-f0-9]{64}$/.test(mac)) return false;
  const expected = createHmac('sha256', secret).update(`newsletter-image\n${timestamp}\n${hash}`).digest();
  return timingSafeEqual(expected, Buffer.from(mac,'hex'));
}
export async function readImageBody(req: Request) {
  if (!req.body || Number(req.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('size');
  const reader = req.body.getReader(), chunks: Buffer[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('size'); } chunks.push(Buffer.from(part.value)); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function saveNewsletterImage(body: Buffer, expectedHash: string) {
  const type = imageType(body), hash = createHash('sha256').update(body).digest('hex');
  if (!type || hash !== expectedHash) throw new Error('image');
  await analyticsPool().execute({ sql: 'INSERT IGNORE INTO newsletter_images(sha256,mime,body) VALUES(?,?,?)', timeout: 5000 }, [hash, type.mime, body]);
  return `https://04320.com/newsletter-images/${hash}.${type.extension}`;
}
export async function loadNewsletterImage(name: string) {
  if (!IMAGE_NAME.test(name)) return null;
  const [hash, extension] = name.split('.');
  const [rows] = await analyticsPool().execute<RowDataPacket[]>({ sql: 'SELECT mime,body FROM newsletter_images WHERE sha256=?', timeout: 5000 }, [hash]);
  const row = rows[0]; if (!row || row.mime !== ({jpg:'image/jpeg',png:'image/png',webp:'image/webp'} as Record<string,string>)[extension]) return null;
  return { mime: String(row.mime), body: new Uint8Array(row.body), hash };
}
