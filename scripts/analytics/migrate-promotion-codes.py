"""Assign stable eight-character public codes while retaining UUID identities."""
import datetime as dt
import fcntl
from pathlib import Path
import secrets
import pymysql
from maintenance import BASE, connect, guard, root_password


def main():
    guard()
    with (BASE / 'maintenance.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with connect(root_password()) as db:
            with db.cursor() as cur:
                cur.execute("SELECT status,finished_at FROM analytics_jobs WHERE name='backup'")
                backup = cur.fetchone()
                if (not backup or backup[0] != 'success' or not backup[1]
                        or dt.datetime.now(dt.timezone.utc).replace(tzinfo=None) - backup[1] > dt.timedelta(hours=1)
                        or not list((BASE / 'backups').glob('analytics_*.sql.gz'))):
                    raise RuntimeError('A restored and verified backup from the last hour is required')
                sql = Path(__file__).with_suffix('.sql').read_text(encoding='utf-8')
                for statement in '\n'.join(line for line in sql.splitlines() if not line.lstrip().startswith('--')).split(';'):
                    if statement.strip():
                        cur.execute(statement)
                db.begin()
                try:
                    cur.execute('SELECT id FROM analytics_promotion_links WHERE short_code IS NULL FOR UPDATE')
                    pending = [row[0] for row in cur.fetchall()]
                    for identifier in pending:
                        for attempt in range(3):
                            try:
                                cur.execute('UPDATE analytics_promotion_links SET short_code=%s WHERE id=%s AND short_code IS NULL', (secrets.token_urlsafe(6), identifier))
                                break
                            except pymysql.err.IntegrityError:
                                if attempt == 2:
                                    raise
                    cur.execute('SELECT COUNT(*) FROM analytics_promotion_links WHERE short_code IS NULL OR CHAR_LENGTH(short_code)<>8')
                    assert cur.fetchone()[0] == 0
                    cur.execute('UPDATE analytics_meta SET schema_version=GREATEST(schema_version,5) WHERE id=1')
                    db.commit()
                except Exception:
                    db.rollback()
                    raise
    print('PROMOTION_CODES_MIGRATION_OK: eight-character codes assigned; UUIDs and historical facts retained')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('FAILED', type(exc).__name__, 'Inspect server locally; credentials omitted')
        raise SystemExit(1)
