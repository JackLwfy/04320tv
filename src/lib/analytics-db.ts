import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import net from 'node:net';

let pool: Pool | undefined;

export function analyticsConfigured() {
  return !!(process.env.ANALYTICS_DB_HOST && process.env.ANALYTICS_DB_USER && process.env.ANALYTICS_DB_PASSWORD && process.env.ANALYTICS_DB_CA);
}

export function analyticsPool(): Pool {
  if (!analyticsConfigured()) throw new Error('统计数据库尚未配置。');
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.ANALYTICS_DB_TLS_NAME || process.env.ANALYTICS_DB_HOST,
      port: Number(process.env.ANALYTICS_DB_PORT || 3306),
      // The certificate DNS identity is independent of the fixed database IP.
      stream: () => net.createConnection({ host: process.env.ANALYTICS_DB_HOST!, port: Number(process.env.ANALYTICS_DB_PORT || 3306) }),
      user: process.env.ANALYTICS_DB_USER,
      password: process.env.ANALYTICS_DB_PASSWORD,
      database: process.env.ANALYTICS_DB_NAME || 'tv04320_analytics',
      ssl: { ca: process.env.ANALYTICS_DB_CA!.replace(/\\n/g, '\n'), rejectUnauthorized: true, verifyIdentity: true },
      charset: 'utf8mb4', timezone: 'Z', dateStrings: true,
      connectTimeout: 3000, connectionLimit: 2, maxIdle: 1, idleTimeout: 10000,
      waitForConnections: false, enableKeepAlive: true,
    });
  }
  return pool;
}

export async function analyticsConnectionHealth() {
  const connection = await analyticsPool().getConnection();
  const started = Date.now();
  try {
    const [rows] = await connection.query<RowDataPacket[]>({ sql: 'SELECT DATABASE() AS db, VERSION() AS version', timeout: 3000 });
    const [tls] = await connection.query<RowDataPacket[]>({ sql: "SHOW SESSION STATUS LIKE 'Ssl_cipher'", timeout: 3000 });
    if (!tls[0]?.Value) throw new Error('统计数据库连接未加密。');
    return { connected: true, database: rows[0].db as string, version: rows[0].version as string, encrypted: true, latencyMs: Date.now() - started };
  } finally { connection.release(); }
}
