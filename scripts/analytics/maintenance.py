"""Root-only maintenance for the dedicated 04320 statistics database."""
import datetime as dt
import fcntl
import gzip
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

import pymysql

BASE = Path('/root/04320-analytics')
DATABASE = 'tv04320_analytics'
TABLES = ('analytics_meta', 'analytics_receipts', 'analytics_events', 'analytics_search_sources',
          'analytics_playback', 'analytics_visitors', 'analytics_daily', 'analytics_rate_limits',
          'analytics_jobs', 'analytics_ingest_daily')


def guard():
    if os.geteuid() != 0 or socket.gethostname() != 'mail.fafamail.com':
        raise RuntimeError('Wrong maintenance host or user')
    addresses = subprocess.run(['ip', '-4', '-brief', 'address'], check=True, capture_output=True, text=True).stdout
    if '159.195.227.246/22' not in addresses:
        raise RuntimeError('Wrong maintenance IP')
    os.umask(0o077)
    if BASE.resolve() != BASE or not BASE.is_dir():
        raise RuntimeError('Invalid maintenance directory')


def root_password():
    with sqlite3.connect('file:/www/server/panel/data/default.db?mode=ro', uri=True) as panel:
        return panel.execute('SELECT mysql_root FROM config LIMIT 1').fetchone()[0]


def connect(password):
    db = pymysql.connect(host='127.0.0.1', user='root', password=password, database=DATABASE,
                         charset='utf8mb4', connect_timeout=5, read_timeout=180,
                         write_timeout=30, autocommit=True)
    with db.cursor() as cur:
        cur.execute("SET time_zone='+00:00'")
        cur.execute('SET SESSION lock_wait_timeout=5')
        cur.execute('SET SESSION innodb_lock_wait_timeout=5')
        cur.execute('SET SESSION max_statement_time=120')
    return db


def rollup(db):
    today = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=8)).date()
    with db.cursor() as cur:
        cur.execute('SELECT COUNT(*) FROM analytics_daily')
        count = 90 if cur.fetchone()[0] < 180 else 3
        days = {today - dt.timedelta(days=n) for n in range(count)}
        cur.execute('SELECT DISTINCT DATE(DATE_ADD(started_at,INTERVAL 8 HOUR)) FROM analytics_playback WHERE received_at>=UTC_TIMESTAMP()-INTERVAL 10 MINUTE')
        days.update(row[0] for row in cur.fetchall() if today - dt.timedelta(days=89) <= row[0] <= today)
    for day in sorted(days):
        start = dt.datetime.combine(day, dt.time()) - dt.timedelta(hours=8)
        end = start + dt.timedelta(days=1)
        db.begin()
        try:
            with db.cursor() as cur:
                for test in (0, 1):
                    params = (test, start, end)
                    cur.execute("""SELECT COALESCE(SUM(kind='page_view'),0),COUNT(DISTINCT visitor_id),
                        COUNT(DISTINCT session_id),COALESCE(SUM(kind='search'),0)
                        FROM analytics_events WHERE is_test=%s AND occurred_at>=%s AND occurred_at<%s""", params)
                    events = tuple(int(value) for value in cur.fetchone())
                    cur.execute("""SELECT COUNT(*),COALESCE(SUM(first_frame_ms IS NOT NULL),0),
                        COALESCE(SUM(played_ms>=30000 OR (media_duration_ms>0 AND media_duration_ms<30000 AND status='ended')),0),
                        COALESCE(SUM(played_ms),0),COALESCE(SUM(status IN ('error','timeout')),0)
                        FROM analytics_playback WHERE is_test=%s AND started_at>=%s AND started_at<%s""", params)
                    plays = tuple(int(value) for value in cur.fetchone())
                    cur.execute('SELECT first_frame_ms,COUNT(*) FROM analytics_playback WHERE is_test=%s AND started_at>=%s AND started_at<%s AND first_frame_ms IS NOT NULL GROUP BY first_frame_ms', params)
                    distribution = json.dumps([[int(ms), int(n)] for ms, n in cur.fetchall()], separators=(',', ':'))
                    cur.execute('''INSERT INTO analytics_daily
                        (day,is_test,views,visitors,sessions,searches,attempts,starts,effective_views,watch_ms,failures,frame_distribution)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON DUPLICATE KEY UPDATE views=VALUES(views),visitors=VALUES(visitors),sessions=VALUES(sessions),
                        searches=VALUES(searches),attempts=VALUES(attempts),starts=VALUES(starts),effective_views=VALUES(effective_views),
                        watch_ms=VALUES(watch_ms),failures=VALUES(failures),frame_distribution=VALUES(frame_distribution),updated_at=UTC_TIMESTAMP(3)''',
                                (day, test, *events, *plays, distribution))
            db.commit()
        except Exception:
            db.rollback()
            raise
    return f'Rebuilt {len(days)} Beijing days; test and production isolated'


def cleanup(db):
    # Keep whole Beijing days so a retained daily aggregate never becomes partial.
    today = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=8)).date()
    cutoff = dt.datetime.combine(today - dt.timedelta(days=89), dt.time()) - dt.timedelta(hours=8)
    rules = [
        ('analytics_events', 'occurred_at<%s', (cutoff,)),
        ('analytics_playback', 'started_at<%s', (cutoff,)),
        ('analytics_search_sources', 'occurred_at<%s', (cutoff,)),
        ('analytics_receipts', 'received_at<UTC_TIMESTAMP()-INTERVAL 2 DAY', ()),
        ('analytics_daily', 'day<%s', (today - dt.timedelta(days=399),)),
        ('analytics_visitors', 'last_seen<UTC_TIMESTAMP()-INTERVAL 400 DAY', ()),
        ('analytics_ingest_daily', 'day<%s', (today - dt.timedelta(days=399),)),
        ('analytics_rate_limits', 'window_start<%s', (int(time.time() // 60) - 1440,)),
    ]
    deleted = 0
    deadline = time.monotonic() + 600
    for table, condition, params in rules:
        while True:
            with db.cursor() as cur:
                cur.execute(f'DELETE FROM `{table}` WHERE {condition} LIMIT 1000', params)
                removed = cur.rowcount
            deleted += removed
            if removed < 1000:
                break
            if time.monotonic() > deadline:
                raise RuntimeError('Cleanup time budget exceeded; committed batches retained')
            time.sleep(0.05)
    return f'Deleted {deleted} expired rows in batches'


def backup(db, password):
    directory = BASE / 'backups'
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.is_symlink() or directory.resolve().parent != BASE:
        raise RuntimeError('Invalid backup directory')
    directory.chmod(0o700)
    suffix = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '_' + secrets.token_hex(4)
    restore = DATABASE + '_restore_' + suffix.lower()
    if not re.fullmatch(r'tv04320_analytics_restore_\d{8}t\d{6}z_[0-9a-f]{8}', restore):
        raise RuntimeError('Invalid restore target')
    dump_binary = next((path for path in ['/www/server/mysql/bin/mariadb-dump', '/www/server/mysql/bin/mysqldump'] if Path(path).is_file()), None)
    client_binary = next((path for path in ['/www/server/mysql/bin/mariadb', '/www/server/mysql/bin/mysql'] if Path(path).is_file()), None)
    if not dump_binary or not client_binary:
        raise RuntimeError('Database backup tools unavailable')
    created = False
    with tempfile.TemporaryDirectory(prefix='backup-', dir=BASE) as work:
        work = Path(work)
        option = work / 'client.cnf'
        escaped = password.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r')
        option.write_text('[client]\nuser=root\nhost=127.0.0.1\nprotocol=tcp\npassword="' + escaped + '"\n', encoding='utf-8')
        option.chmod(0o600)
        sql = work / 'snapshot.sql'
        with db.cursor() as cur:
            cur.execute('SHOW TABLES')
            if set(row[0] for row in cur.fetchall()) != set(TABLES):
                raise RuntimeError('Schema changed; review backup table allowlist')
            # Lock only this dedicated schema briefly so dump and counts share one snapshot.
            cur.execute('LOCK TABLES ' + ','.join(f'`{table}` READ' for table in TABLES))
            try:
                counts = {}
                for table in TABLES:
                    cur.execute(f'SELECT COUNT(*) FROM `{table}`')
                    counts[table] = cur.fetchone()[0]
                with sql.open('xb') as output:
                    subprocess.run([dump_binary, '--defaults-extra-file=' + str(option), '--single-transaction',
                                    '--skip-lock-tables', '--skip-add-locks', '--no-tablespaces', '--hex-blob',
                                    '--skip-comments', '--default-character-set=utf8mb4', DATABASE],
                                   stdout=output, stderr=subprocess.PIPE, check=True, timeout=120)
            finally:
                cur.execute('UNLOCK TABLES')
            cur.execute(f'CREATE DATABASE `{restore}` CHARACTER SET utf8mb4')
            created = True
            try:
                with sql.open('rb') as source:
                    subprocess.run([client_binary, '--defaults-extra-file=' + str(option), restore], stdin=source,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True, timeout=300)
                for table, expected in counts.items():
                    cur.execute(f'SELECT COUNT(*) FROM `{restore}`.`{table}`')
                    if cur.fetchone()[0] != expected:
                        raise RuntimeError('Restore row count mismatch: ' + table)
                destination = directory / ('analytics_' + suffix + '.sql.gz')
                temporary = directory / (destination.name + '.partial')
                try:
                    with sql.open('rb') as source, temporary.open('xb') as raw:
                        with gzip.GzipFile(fileobj=raw, mode='wb') as compressed:
                            shutil.copyfileobj(source, compressed)
                    temporary.chmod(0o600)
                    temporary.replace(destination)
                finally:
                    temporary.unlink(missing_ok=True)
            finally:
                if created:
                    cur.execute(f'DROP DATABASE `{restore}`')
    verified = sorted((path for path in directory.iterdir() if re.fullmatch(r'analytics_\d{8}T\d{6}Z_[0-9a-f]{8}\.sql\.gz', path.name) and path.is_file() and not path.is_symlink()), key=lambda path: path.name, reverse=True)
    for old in verified[7:]:
        old.unlink()
    return f'Backup restored and {len(TABLES)} table row counts verified; retained {min(7, len(verified))} copies'


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('rollup', 'cleanup', 'backup'):
        raise RuntimeError('Usage: maintenance.py rollup|cleanup|backup')
    guard()
    task = sys.argv[1]
    with (BASE / 'maintenance.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('SKIPPED maintenance already running')
            return
        password = root_password()
        db = connect(password)
        started = time.monotonic()
        try:
            with db.cursor() as cur:
                cur.execute("INSERT INTO analytics_jobs (name,status,started_at) VALUES (%s,'running',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE status='running',started_at=UTC_TIMESTAMP(3),finished_at=NULL,detail=''", (task,))
            detail = backup(db, password) if task == 'backup' else rollup(db) if task == 'rollup' else cleanup(db)
            status = 'success'
        except Exception as exc:
            status = 'failed'
            detail = type(exc).__name__ + ': inspect server locally; credentials omitted'
        finally:
            with db.cursor() as cur:
                cur.execute('UPDATE analytics_jobs SET status=%s,finished_at=UTC_TIMESTAMP(3),duration_ms=%s,detail=%s WHERE name=%s',
                            (status, min(4294967295, int((time.monotonic() - started) * 1000)), detail[:200], task))
            db.close()
        print(task, status, detail)
        if status != 'success':
            sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('FAILED', type(exc).__name__, 'Inspect server locally; no credential output')
        sys.exit(1)
