"""Add IP/province fields to the existing dedicated database after backup."""
from pathlib import Path
import sys
from maintenance import BASE, connect, guard, root_password

guard()
if not list((BASE / 'backups').glob('*.sql.gz')):
    raise RuntimeError('Create and verify a database backup first')
with connect(root_password()) as db:
    with db.cursor() as cur:
        if sys.argv[1:] == ['--activate']:
            cur.execute("UPDATE analytics_meta SET geography_started_at=COALESCE(geography_started_at,(SELECT MIN(received_at) FROM analytics_events WHERE is_test=0 AND network_ip<>''),UTC_TIMESTAMP(3)) WHERE id=1 AND schema_version=2")
            print('GEOGRAPHY_ACTIVATED: first enable time preserved')
            sys.exit(0)
        if sys.argv[1:]:
            raise RuntimeError('Expected no arguments for migration or --activate after deployment verification')
        sql = Path(__file__).with_suffix('.sql').read_text()
        for statement in '\n'.join(line for line in sql.splitlines() if not line.lstrip().startswith('--')).split(';'):
            if statement.strip():
                cur.execute(statement)
        cur.execute('SELECT schema_version FROM analytics_meta WHERE id=1')
        assert cur.fetchone()[0] == 2
        cur.execute('SELECT network_ip,country,province FROM analytics_events LIMIT 1')
print('GEOGRAPHY_MIGRATION_OK: additive fields, existing facts retained')
