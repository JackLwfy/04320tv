"""Add city/ASN fields to the dedicated analytics database after backup."""
from pathlib import Path
import sys
from maintenance import BASE, connect, guard, root_password

guard()
if not list((BASE / 'backups').glob('*.sql.gz')):
    raise RuntimeError('Create and verify a database backup first')
with connect(root_password()) as db:
    with db.cursor() as cur:
        if sys.argv[1:] == ['--activate']:
            cur.execute("UPDATE analytics_meta SET network_details_started_at=COALESCE(network_details_started_at,(SELECT MIN(received_at) FROM analytics_events WHERE is_test=0 AND (city<>'' OR network_asn>0)),UTC_TIMESTAMP(3)) WHERE id=1 AND schema_version>=3")
            print('NETWORK_DETAILS_ACTIVATED: first enable time preserved')
            sys.exit(0)
        if sys.argv[1:]:
            raise RuntimeError('Expected no arguments or --activate after deployment verification')
        sql = Path(__file__).with_suffix('.sql').read_text()
        for statement in '\n'.join(line for line in sql.splitlines() if not line.lstrip().startswith('--')).split(';'):
            if statement.strip():
                cur.execute(statement)
        cur.execute('SELECT schema_version FROM analytics_meta WHERE id=1')
        assert cur.fetchone()[0] >= 3
        cur.execute('SELECT city,network_asn,network_operator FROM analytics_events LIMIT 1')
print('NETWORK_DETAILS_MIGRATION_OK: additive fields, existing facts retained')
