"""Register only the three dedicated 04320 jobs using aaPanel's internal API."""
import contextlib
import fcntl
import io
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

from maintenance import BASE, guard


def main():
    guard()
    script = BASE / 'maintenance.py'
    python = Path('/www/server/panel/pyenv/bin/python3')
    if not script.is_file() or script.is_symlink() or not python.is_file():
        raise RuntimeError('Install maintenance.py before registering jobs')
    script.chmod(0o600)
    jobs = [('rollup', 'minute-n', '5', '0', '0'),
            ('backup', 'day', '', '3', '17'),
            ('cleanup', 'day', '', '3', '37')]
    with (BASE / 'install-jobs.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        panel = sqlite3.connect('file:/www/server/panel/data/default.db?mode=ro', uri=True)
        panel.row_factory = sqlite3.Row
        os.chdir('/www/server/panel')
        sys.path[:0] = ['/www/server/panel', '/www/server/panel/class', '/www/server/panel/class_v2']
        import public
        import crontab_v2
        from BTPanel import app
        for task, cycle, interval, hour, minute in jobs:
            name = '04320 analytics ' + task
            command = f'{python} {script} {task}'
            existing = panel.execute('SELECT * FROM crontab WHERE name=?', (name,)).fetchall()
            if existing:
                if len(existing) != 1:
                    raise RuntimeError('Duplicate task name; review existing jobs')
                row = existing[0]
                if row['type'] != cycle or str(row['where1']) != interval or str(row['where_hour']) != hour or str(row['where_minute']) != minute or row['sType'] != 'toShell' or command not in row['sBody'] or int(row['status']) != 1:
                    raise RuntimeError('Existing task differs; preserve it and review manually: ' + name)
                cron = subprocess.run(['crontab', '-u', 'root', '-l'], capture_output=True, text=True, check=True).stdout
                if '/www/server/cron/' + row['echo'] not in cron:
                    raise RuntimeError('aaPanel record exists but root schedule is absent: ' + name)
                print('EXISTS', name)
                continue
            # Back up aaPanel state once, before the first API mutation.
            snapshot = BASE / 'aapanel-before-jobs.db'
            if not snapshot.exists():
                with sqlite3.connect(str(snapshot)) as backup:
                    panel.backup(backup)
                snapshot.chmod(0o600)
                result = subprocess.run(['crontab', '-u', 'root', '-l'], capture_output=True, text=True)
                if result.returncode not in (0, 1):
                    raise RuntimeError('Cannot snapshot root crontab')
                (BASE / 'crontab-before-jobs.txt').write_text(result.stdout, encoding='utf-8')
            args = public.dict_obj()
            values = dict(name=name, type=cycle, where1=interval, hour=hour, minute=minute,
                          save='7', backupTo='localhost', sType='toShell', sName='',
                          sBody=command, urladdress='', user='root', flock=0)
            for key, value in values.items():
                setattr(args, key, value)
            with app.test_request_context('/crontab?action=AddCrontab', method='POST'), contextlib.redirect_stdout(io.StringIO()):
                result = crontab_v2.crontab().AddCrontab(args)
            rows = panel.execute('SELECT echo,status FROM crontab WHERE name=?', (name,)).fetchall()
            if not isinstance(result, dict) or result.get('status') != 0 or len(rows) != 1 or int(rows[0]['status']) != 1:
                raise RuntimeError('aaPanel task registration failed; inspect state before retry: ' + name)
            cron = subprocess.run(['crontab', '-u', 'root', '-l'], capture_output=True, text=True, check=True).stdout
            if '/www/server/cron/' + rows[0]['echo'] not in cron:
                raise RuntimeError('Registered job missing from root crontab: ' + name)
            print('CREATED', name)
        panel.close()
        print('SCHEDULE rollup every 5 minutes; backup 03:17 and cleanup 03:37 in server local timezone')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('FAILED', type(exc).__name__, str(exc) if isinstance(exc, RuntimeError) else 'Inspect server locally; no credential output')
        sys.exit(1)
