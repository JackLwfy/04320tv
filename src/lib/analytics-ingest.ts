import crypto from 'node:crypto';
import { type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { analyticsPool } from './analytics-db';
import { type AnalyticsIdentity, rateBucket, visitorHash } from './analytics-auth';
import { businessDay, sqlDate, type ValidEvent } from './analytics-validation';
import type { AnalyticsNetwork } from './analytics-geography';

export async function analyticsRateLimit(key: string, limit: number, now = Date.now()) {
  const pool = analyticsPool();
  const bucket = rateBucket(key); const window = Math.floor(now / 60000);
  await pool.query({ sql: 'INSERT INTO analytics_rate_limits (bucket,window_start,hits) VALUES (?,?,1) ON DUPLICATE KEY UPDATE hits=hits+1', timeout: 3000 }, [bucket, window]);
  const [rows] = await pool.query<RowDataPacket[]>({ sql: 'SELECT hits FROM analytics_rate_limits WHERE bucket=? AND window_start=?', timeout: 3000 }, [bucket, window]);
  return Number(rows[0]?.hits) <= limit;
}

async function query(connection: PoolConnection, sql: string, values: unknown[] = []) {
  return connection.query<RowDataPacket[]>({ sql, timeout: 5000 }, values);
}

export async function recordRejected() {
  try { await analyticsPool().query({ sql: 'INSERT INTO analytics_ingest_daily (day,rejected) VALUES (?,1) ON DUPLICATE KEY UPDATE rejected=rejected+1', timeout: 2000 }, [businessDay()]); } catch { /* A failed metric must not create a second failure. */ }
}

export async function ingestEvents(events: ValidEvent[], identity: AnalyticsIdentity, dimensions: { device: string; browser: string }, network: AnalyticsNetwork = { ip: '', country: '', province: '' }) {
  const connection = await analyticsPool().getConnection();
  const visitor = visitorHash(identity.visitor, identity.test);
  const batch = crypto.randomUUID();
  const isTest = identity.test ? 1 : 0;
  const now = sqlDate(Date.now());
  // One logical search must remain one record even when a transport retry uses another event ID.
  const items = events.map(e => e.type === 'search' ? { ...e, id: e.searchId! } : e);
  try {
    await connection.beginTransaction();
    const [meta] = await query(connection, 'SELECT enabled FROM analytics_meta WHERE id=1');
    if (!meta[0]?.enabled) throw new Error('ANALYTICS_DISABLED');
    await query(connection, 'INSERT IGNORE INTO analytics_receipts (event_id,batch_id,visitor_id,is_test) VALUES ?', [items.map(e => [e.id, batch, visitor, isTest])]);
    const [receipts] = await query(connection, 'SELECT event_id FROM analytics_receipts WHERE batch_id=?', [batch]);
    const ids = new Set(receipts.map(row => row.event_id));
    const used = new Set<string>();
    const accepted = items.filter(e => ids.has(e.id) && !used.has(e.id) && !!used.add(e.id));
    const facts = accepted.filter(e => e.type !== 'playback');
    if (facts.length) {
      await query(connection, `INSERT IGNORE INTO analytics_events
        (event_id,occurred_at,visitor_id,session_id,kind,is_test,media,device,browser,source_key,source_name,source_origin,vod_id,title,episode,search_id,query_text,status,result_count,duration_ms,page,referrer,campaign,error_code,recommendation_id,network_ip,country,province,city,network_asn,network_operator) VALUES ?`,
      [facts.map(e => [e.id, sqlDate(e.at), visitor, identity.session, e.type, isTest, e.media || '', dimensions.device, dimensions.browser, e.sourceKey, e.sourceName || '', e.sourceOrigin || '', e.vodId || '', e.title || '', e.episode ?? null, e.searchId || null, e.query || '', e.searchStatus || '', e.resultCount || 0, e.durationMs || 0, e.page || '', e.referrer || '', e.campaign || '', e.errorCode || '', e.recommendationId || '', network.ip, network.country, network.province, network.city || '', network.asn || 0, network.operator || '未知'])]);
    }
    const outcomes = accepted.flatMap(e => (e.outcomes || []).map(o => [e.searchId, o.sourceKey, o.sourceName, o.sourceOrigin || 'custom', sqlDate(e.at), isTest, dimensions.device, dimensions.browser, o.status, o.durationMs, o.resultCount, o.errorCode || '']));
    if (outcomes.length) await query(connection, 'INSERT IGNORE INTO analytics_search_sources (search_id,source_key,source_name,source_origin,occurred_at,is_test,device,browser,status,duration_ms,result_count,error_code) VALUES ?', [outcomes]);
    const plays = accepted.filter(e => e.type === 'playback');
    if (plays.length) {
      // A resumed browser can have a new visit session; the original attempt metadata stays fixed.
      const maximum = ['played_ms', 'hidden_played_ms', 'buffer_ms', 'buffer_count', 'seek_buffer_ms'];
      const guard = 'VALUES(visitor_id)=visitor_id AND VALUES(is_test)=is_test AND VALUES(sequence_no)>sequence_no AND VALUES(updated_at)>=updated_at AND ' + maximum.map(k => `VALUES(${k})>=${k}`).join(' AND ');
      const latest = ['updated_at', 'received_at', 'status', 'position_ms', 'media_duration_ms', 'error_code'];
      const updates = [
        ...maximum.map(k => `${k}=IF(${guard},GREATEST(${k},VALUES(${k})),${k})`),
        ...latest.map(k => `${k}=IF(${guard},VALUES(${k}),${k})`),
        `first_frame_method=IF(${guard} AND first_frame_ms IS NULL,VALUES(first_frame_method),first_frame_method)`,
        `first_frame_ms=IF(${guard},COALESCE(first_frame_ms,VALUES(first_frame_ms)),first_frame_ms)`,
        `sequence_no=IF(${guard},VALUES(sequence_no),sequence_no)`,
      ].join(',');
      await query(connection, `INSERT INTO analytics_playback
        (attempt_id,watch_id,visitor_id,session_id,search_id,recommendation_id,started_at,updated_at,received_at,sequence_no,is_test,media,device,browser,source_key,source_name,source_origin,vod_id,title,episode,status,played_ms,hidden_played_ms,buffer_ms,buffer_count,seek_buffer_ms,first_frame_ms,first_frame_method,position_ms,media_duration_ms,error_code,previous_attempt_id,switch_reason)
        VALUES ? ON DUPLICATE KEY UPDATE ${updates}`,
      [plays.map(e => [e.attemptId, e.watchId, visitor, identity.session, e.searchId || null, e.recommendationId || '', sqlDate(e.startedAt!), sqlDate(e.at), now, e.sequence, isTest, e.media, dimensions.device, dimensions.browser, e.sourceKey, e.sourceName || '', e.sourceOrigin || '', e.vodId || '', e.title || '', e.episode ?? null, e.playbackStatus, e.playedMs || 0, e.hiddenPlayedMs || 0, e.bufferMs || 0, e.bufferCount || 0, e.seekBufferMs || 0, e.firstFrameMs ?? null, e.firstFrameMethod || '', e.positionMs || 0, e.mediaDurationMs || 0, e.errorCode || '', e.previousAttemptId || null, e.switchReason || ''])]);
    }
    if (accepted.length) {
      const oldest = sqlDate(Math.min(...accepted.map(e => e.at)));
      const newest = sqlDate(Math.max(...accepted.map(e => e.at)));
      await query(connection, 'INSERT INTO analytics_visitors (visitor_id,first_seen,last_seen,is_test) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE first_seen=LEAST(first_seen,VALUES(first_seen)),last_seen=GREATEST(last_seen,VALUES(last_seen))', [visitor, oldest, newest, isTest]);
    }
    const duplicates = items.length - accepted.length;
    if (!identity.test) await query(connection, 'INSERT INTO analytics_ingest_daily (day,accepted,duplicates,last_received_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE accepted=accepted+VALUES(accepted),duplicates=duplicates+VALUES(duplicates),last_received_at=VALUES(last_received_at)', [businessDay(), accepted.length, duplicates, now]);
    await connection.commit();
    return { accepted: accepted.length, duplicates };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
