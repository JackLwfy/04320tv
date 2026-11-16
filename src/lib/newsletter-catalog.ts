import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { analyticsPool } from './analytics-db';
import { getEnvSources } from './env-sources';

export const MAX_CATALOG_BYTES = 64 * 1024;
const movieId = /^[0-9]{1,32}$/;
const sourceKey = /^env_[0-9]{1,6}$/;
const vodId = /^[A-Za-z0-9_-]{1,100}$/;

export function catalogAuthorized(headers: Headers, now = Date.now()) {
  const secret = process.env.NEWSLETTER_IMAGE_SECRET || '';
  const time = headers.get('x-catalog-time') || '';
  const hash = headers.get('x-catalog-sha256') || '';
  const signature = headers.get('x-catalog-signature') || '';
  if (secret.length < 32 || !/^\d{10}$/.test(time) || Math.abs(now / 1000 - Number(time)) > 300 || !/^[a-f0-9]{64}$/.test(hash) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(`newsletter-catalog\n${time}\n${hash}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export async function readCatalogBody(req: Request) {
  if (!req.body || Number(req.headers.get('content-length')) > MAX_CATALOG_BYTES) throw new Error('size');
  const reader = req.body.getReader(), chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_CATALOG_BYTES) { await reader.cancel(); throw new Error('size'); }
      chunks.push(Buffer.from(part.value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function parseCatalogBody(body: Buffer, hash: string) {
  if (createHash('sha256').update(body).digest('hex') !== hash) throw new Error('hash');
  const value = JSON.parse(body.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body');
  return value as Record<string, unknown>;
}

function allowedSource(key: string) {
  return sourceKey.test(key) && getEnvSources().some(source => source.key === key && !source.isAdult);
}

export async function listCatalog(afterRank: number, limit: number) {
  const [movies] = await analyticsPool().execute<RowDataPacket[]>({
    sql: 'SELECT douban_id,title,`type`,year,area,director,actors,description,poster,score,votes,tier,sort_rank,metadata_status,metadata_source,updated_at FROM newsletter_movies WHERE sort_rank>? ORDER BY sort_rank ASC LIMIT ?', timeout: 5000,
  }, [afterRank, limit]);
  return { movies, next_rank: movies.length ? movies[movies.length - 1].sort_rank : afterRank };
}

export async function saveCatalogLink(id: string, source: string, vod: string) {
  if (!movieId.test(id) || !allowedSource(source) || !vodId.test(vod)) return null;
  const [result] = await analyticsPool().execute<ResultSetHeader>({
    sql: "INSERT INTO newsletter_movie_links(douban_id,source_key,vod_id,checked_at) SELECT douban_id,?,?,UTC_TIMESTAMP() FROM newsletter_movies WHERE douban_id=? AND metadata_status='ready' AND poster IS NOT NULL AND poster<>'' AND BINARY poster REGEXP '^https://04320[.]com/newsletter-images/[a-f0-9]{64}[.](jpg|png|webp)$' ON DUPLICATE KEY UPDATE source_key=VALUES(source_key),vod_id=VALUES(vod_id),checked_at=VALUES(checked_at)", timeout: 5000,
  }, [source, vod, id]);
  if (!result.affectedRows) {
    const [rows] = await analyticsPool().execute<RowDataPacket[]>({
      sql: "SELECT l.douban_id FROM newsletter_movie_links l JOIN newsletter_movies m ON m.douban_id=l.douban_id WHERE l.douban_id=? AND l.source_key=? AND l.vod_id=? AND m.metadata_status='ready' AND BINARY m.poster REGEXP '^https://04320[.]com/newsletter-images/[a-f0-9]{64}[.](jpg|png|webp)$'", timeout: 5000,
    }, [id, source, vod]);
    if (!rows.length) return null;
  }
  return `https://04320.com/m/${id}`;
}

export async function catalogWatchUrl(id: string) {
  if (!movieId.test(id)) return null;
  const [rows] = await analyticsPool().execute<RowDataPacket[]>({
    sql: 'SELECT source_key,vod_id FROM newsletter_movie_links WHERE douban_id=?', timeout: 5000,
  }, [id]);
  const row = rows[0];
  if (!row || typeof row.source_key !== 'string' || typeof row.vod_id !== 'string' || !allowedSource(row.source_key) || !vodId.test(row.vod_id)) return null;
  return `https://04320.com/watch?${new URLSearchParams({ source: row.source_key, id: row.vod_id, index: '0' })}`;
}
