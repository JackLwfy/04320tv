"""One-time, root-only provisioning on the approved aaPanel host. No secrets on stdout."""
import contextlib
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import time

import pymysql

BASE = Path('/root/04320-analytics')
NAME = 'tv04320_analytics'
USER = 'tv04320_stats'


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def main():
    assert os.geteuid() == 0
    assert socket.gethostname() == 'mail.fafamail.com', 'Wrong host'
    assert '159.195.227.246/22' in run('ip', '-4', '-brief', 'address'), 'Wrong IP'
    os.umask(0o077)
    BASE.mkdir(exist_ok=True, mode=0o700)
    panel = sqlite3.connect('file:/www/server/panel/data/default.db?mode=ro', uri=True)
    password = panel.execute('SELECT mysql_root FROM config LIMIT 1').fetchone()[0]
    db = pymysql.connect(host='127.0.0.1', user='root', password=password, connect_timeout=5, autocommit=True)
    cur = db.cursor()
    cur.execute("SET time_zone='+00:00'")
    if sys.argv[1] == 'create':
        assert not (BASE / 'connection.json').exists(), 'Provisioning already started; inspect before retry'
        assert not panel.execute('SELECT id FROM databases WHERE name=? OR username=?', (NAME, USER)).fetchone()
        cur.execute('SELECT SCHEMA_NAME FROM information_schema.schemata WHERE SCHEMA_NAME=%s', (NAME,))
        assert not cur.fetchone(), 'Database already exists'
        with sqlite3.connect(str(BASE / 'aapanel-before.db')) as backup:
            panel.backup(backup)
        secret = secrets.token_urlsafe(36)
        (BASE / 'connection.json').write_text(json.dumps({'host': '159.195.227.246', 'port': 3306, 'database': NAME, 'user': USER, 'password': secret, 'ingestSecret': secrets.token_hex(32)}))
        os.chdir('/www/server/panel')
        sys.path[:0] = ['/www/server/panel', '/www/server/panel/class', '/www/server/panel/class_v2']
        import public
        import database_v2
        from BTPanel import app
        args = public.dict_obj()
        for key, value in dict(name=NAME, db_user=USER, password=secret, codeing='utf8mb4', sid=0, active=True, address='%', ps='04320TV analytics only', dtype='MySQL').items():
            setattr(args, key, value)
        with app.test_request_context('/database?action=AddDatabase', method='POST'), contextlib.redirect_stdout(io.StringIO()):
            result = database_v2.database().AddDatabase(args)
        assert panel.execute('SELECT id FROM databases WHERE name=? AND username=?', (NAME, USER)).fetchone(), 'aaPanel creation did not complete: ' + str(result.get('status'))
        cur.execute("SELECT Host FROM mysql.user WHERE User=%s", (USER,))
        for (host,) in cur.fetchall():
            cur.execute('REVOKE ALL PRIVILEGES, GRANT OPTION FROM %s@%s', (USER, host))
            cur.execute('GRANT SELECT, INSERT, UPDATE, DELETE ON `' + NAME + '`.* TO %s@%s', (USER, host))
            cur.execute('ALTER USER %s@%s REQUIRE SSL WITH MAX_USER_CONNECTIONS 12', (USER, host))
        print('AAPANEL_DATABASE_CREATED', NAME)
    elif sys.argv[1] == 'schema':
        assert panel.execute('SELECT id FROM databases WHERE name=? AND username=?', (NAME, USER)).fetchone()
        schema = Path(__file__).with_name('schema.sql').read_text()
        cur.execute('USE `' + NAME + '`')
        for statement in '\n'.join(line for line in schema.splitlines() if not line.lstrip().startswith('--')).split(';'):
            if statement.strip():
                cur.execute(statement)
        print('SCHEMA_APPLIED', NAME)
    elif sys.argv[1] == 'activate':
        # A hostname change can leave the SysV script looking for a different pid file.
        cur.execute('SELECT @@pid_file')
        pid_file = cur.fetchone()[0]
        assert pid_file.startswith('/www/server/data/') and Path(pid_file).exists()
        cur.execute('SELECT COUNT(*) FROM information_schema.innodb_trx')
        assert cur.fetchone()[0] == 0, 'Active transactions; wait before restarting'
        tls = Path('/www/server/mysql/04320-tls')
        run('openssl', 'verify', '-CAfile', str(tls / 'ca.pem'), str(tls / 'server-cert.pem'))
        cnf = Path('/etc/my.cnf')
        original = (BASE / 'my.cnf.before').read_text()
        rollback = original.replace('[mysqld]', '[mysqld]\npid-file=' + pid_file, 1)
        settings = '\n'.join(['[mysqld]', 'pid-file=' + pid_file, 'ssl-ca=' + str(tls / 'ca.pem'), 'ssl-cert=' + str(tls / 'server-cert.pem'), 'ssl-key=' + str(tls / 'server-key.pem'), 'tls-version=TLSv1.2,TLSv1.3'])
        cnf.write_text(original.replace('[mysqld]', settings, 1))
        run('/www/server/mysql/bin/mariadbd', '--defaults-file=/etc/my.cnf', '--verbose', '--help')
        db.close()
        start = time.monotonic()
        try:
            run('systemctl', 'restart', 'mysqld')
            db = pymysql.connect(host='127.0.0.1', user='root', password=password, connect_timeout=5)
            cur = db.cursor()
            cur.execute("SHOW VARIABLES LIKE 'have_ssl'")
            assert cur.fetchone()[1] == 'YES'
        except Exception:
            cnf.write_text(rollback)
            run('systemctl', 'restart', 'mysqld')
            raise RuntimeError('TLS activation failed; previous TLS settings restored') from None
        values = json.loads((BASE / 'connection.json').read_text())
        values['ca'] = (tls / 'ca.pem').read_text()
        (BASE / 'connection.json').write_text(json.dumps(values))
        connection = pymysql.connect(host='127.0.0.1', user=USER, password=values['password'], database=NAME, ssl={'ca': str(tls / 'ca.pem'), 'check_hostname': True}, connect_timeout=5)
        q = connection.cursor()
        q.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
        assert q.fetchone()[1]
        connection.close()
        print('TLS_ENABLED_AND_VERIFIED', round(time.monotonic() - start, 2), 'seconds')
    elif sys.argv[1] == 'tls':
        cur.execute("SHOW VARIABLES LIKE 'have_ssl'")
        assert cur.fetchone()[1] == 'DISABLED', 'TLS already configured; inspect without overwriting'
        cnf = Path('/etc/my.cnf')
        assert not (BASE / 'my.cnf.before').exists(), 'TLS setup already started; inspect before retry'
        shutil.copy2(cnf, BASE / 'my.cnf.before')
        tls = Path('/www/server/mysql/04320-tls')
        tls.mkdir(mode=0o750)
        run('openssl', 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', str(BASE / 'ca-key.pem'))
        run('openssl', 'req', '-new', '-x509', '-sha256', '-days', '3650', '-key', str(BASE / 'ca-key.pem'), '-out', str(tls / 'ca.pem'), '-subj', '/CN=04320 Analytics Database CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign')
        run('openssl', 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', str(tls / 'server-key.pem'))
        run('openssl', 'req', '-new', '-sha256', '-key', str(tls / 'server-key.pem'), '-out', str(BASE / 'server.csr'), '-subj', '/CN=159.195.227.246')
        ext = BASE / 'server.ext'
        ext.write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyAgreement\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:159.195.227.246,IP:100.93.94.107,IP:127.0.0.1,DNS:mail.fafamail.com\n')
        run('openssl', 'x509', '-req', '-sha256', '-days', '825', '-in', str(BASE / 'server.csr'), '-CA', str(tls / 'ca.pem'), '-CAkey', str(BASE / 'ca-key.pem'), '-CAcreateserial', '-out', str(tls / 'server-cert.pem'), '-extfile', str(ext))
        run('openssl', 'verify', '-CAfile', str(tls / 'ca.pem'), str(tls / 'server-cert.pem'))
        shutil.chown(tls, user='mysql', group='mysql')
        for file in tls.iterdir():
            shutil.chown(file, user='mysql', group='mysql')
            file.chmod(0o640)
        settings = '\n'.join(['[mysqld]', 'ssl-ca=' + str(tls / 'ca.pem'), 'ssl-cert=' + str(tls / 'server-cert.pem'), 'ssl-key=' + str(tls / 'server-key.pem'), 'tls-version=TLSv1.2,TLSv1.3'])
        cnf.write_text(cnf.read_text().replace('[mysqld]', settings, 1))
        run('/www/server/mysql/bin/mariadbd', '--defaults-file=/etc/my.cnf', '--verbose', '--help')
        cur.execute('SELECT COUNT(*) FROM information_schema.innodb_trx')
        assert cur.fetchone()[0] == 0, 'Active transactions; wait before restarting'
        db.close()
        start = time.monotonic()
        try:
            run('systemctl', 'restart', 'mysqld')
            db = pymysql.connect(host='127.0.0.1', user='root', password=password, connect_timeout=5)
            cur = db.cursor()
            cur.execute("SHOW VARIABLES LIKE 'have_ssl'")
            assert cur.fetchone()[1] == 'YES'
        except Exception:
            shutil.copy2(BASE / 'my.cnf.before', cnf)
            run('systemctl', 'restart', 'mysqld')
            raise RuntimeError('TLS activation failed; previous config restored') from None
        print('TLS_ENABLED', round(time.monotonic() - start, 2), 'seconds')
        values = json.loads((BASE / 'connection.json').read_text())
        values['ca'] = (tls / 'ca.pem').read_text()
        (BASE / 'connection.json').write_text(json.dumps(values))
        connection = pymysql.connect(host='127.0.0.1', user=USER, password=values['password'], database=NAME, ssl={'ca': str(tls / 'ca.pem'), 'check_hostname': True}, connect_timeout=5)
        q = connection.cursor()
        q.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
        assert q.fetchone()[1]
        connection.close()
        print('DEDICATED_ACCOUNT_TLS_OK')
    else:
        raise RuntimeError('Expected create, tls, activate or schema')
    db.close()
    panel.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('FAILED', type(exc).__name__, str(exc) if isinstance(exc, (AssertionError, RuntimeError)) else 'Inspect server locally; no credential output')
        sys.exit(1)
