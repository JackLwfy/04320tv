"""Add promotion attribution without rewriting existing analytics facts."""
import datetime as dt
import fcntl
from pathlib import Path
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
                cur.execute('SELECT schema_version FROM analytics_meta WHERE id=1')
                assert cur.fetchone()[0] >= 4
                cur.execute('SELECT promotion_id,promotion_visit_id FROM analytics_events LIMIT 0')
                cur.execute('SELECT promotion_id,promotion_visit_id FROM analytics_playback LIMIT 0')
                cur.execute('SELECT visit_id,link_id,last_activity_at FROM analytics_promotion_visits LIMIT 0')
                cur.execute('SELECT id,landing_path FROM analytics_promotion_links LIMIT 0')
    print('PROMOTIONS_MIGRATION_OK: additive schema v4; previous facts retained')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('FAILED', type(exc).__name__, 'Inspect server locally; credentials omitted')
        raise SystemExit(1)
