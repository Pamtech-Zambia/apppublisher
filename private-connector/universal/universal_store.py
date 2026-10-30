"""Persistent per-user Google Play connections: PostgreSQL in production, test-only SQLite.

No server-wide Play credentials, shared package allowlist or implicit cross-user grants.
Run schema.sql once via a private database console before deployment.
"""
import hashlib
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from cryptography.fernet import Fernet


def encrypt(value: str) -> str:
    return Fernet(os.environ['GOOGLE_TOKEN_ENCRYPTION_KEY'].encode()).encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    return Fernet(os.environ['GOOGLE_TOKEN_ENCRYPTION_KEY'].encode()).decrypt(value.encode()).decode()


def ready() -> bool:
    try:
        if not os.getenv('DATABASE_URL') or not os.environ.get('GOOGLE_TOKEN_ENCRYPTION_KEY'):
            return False
        Fernet(os.environ['GOOGLE_TOKEN_ENCRYPTION_KEY'].encode())
        return True
    except Exception:
        return False


@contextmanager
def db():
    if os.getenv('PLAY_TEST_SQLITE_PATH') and os.getenv('PYTEST_CURRENT_TEST'):
        con=sqlite3.connect(os.environ['PLAY_TEST_SQLITE_PATH'],timeout=15)
        con.row_factory=sqlite3.Row
        is_sqlite=True
    else:
        if not ready():
            raise RuntimeError('Persistent credential storage is not configured')
        import psycopg
        from psycopg.rows import dict_row
        con=psycopg.connect(os.environ['DATABASE_URL'],row_factory=dict_row,connect_timeout=8)
        is_sqlite=False
    try:
        yield con,is_sqlite
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def execute(con,is_sqlite,sql,args=(),one=False,all_rows=False):
    if is_sqlite:
        sql=sql.replace('%s','?')
    cur=con.execute(sql,args)
    if one:
        row=cur.fetchone()
        return dict(row) if row is not None else None
    if all_rows:
        return [dict(x) for x in cur.fetchall()]
    return None


def save_intent(subject,hashed_state,encrypted_verifier,expires,browser_cookie_hash):
    with db() as (con,s):
        execute(con,s,'INSERT INTO play_oauth_intents (state_hash,subject,verifier_cipher,expires_at,used,browser_cookie_hash) VALUES (%s,%s,%s,%s,FALSE,%s)',(hashed_state,subject,encrypted_verifier,expires,browser_cookie_hash))


def consume_intent(hashed_state,now,browser_cookie_hash):
    with db() as (con,s):
        # Atomic claim protects against replay/concurrent callbacks.
        return execute(con,s,'UPDATE play_oauth_intents SET used=TRUE WHERE state_hash=%s AND used=FALSE AND expires_at>%s AND browser_cookie_hash=%s RETURNING subject,verifier_cipher',(hashed_state,now,browser_cookie_hash),one=True)


def put_connection(subject,google_sub,google_email,refresh_cipher):
    ident=str(uuid.uuid4())
    with db() as (con,s):
        execute(con,s,'INSERT INTO play_google_connections (id,subject,google_sub,google_email,refresh_cipher,active) VALUES (%s,%s,%s,%s,%s,TRUE) ON CONFLICT(subject,google_sub) DO UPDATE SET google_email=excluded.google_email,refresh_cipher=excluded.refresh_cipher,active=TRUE',
                (ident,subject,google_sub,google_email,refresh_cipher))
        row=execute(con,s,'SELECT id FROM play_google_connections WHERE subject=%s AND google_sub=%s AND active=TRUE',(subject,google_sub),one=True)
    return row['id']


def connections(subject):
    with db() as (con,s):
        return execute(con,s,'SELECT id,google_email FROM play_google_connections WHERE subject=%s AND active=TRUE ORDER BY google_email',(subject,),all_rows=True)


def connection(subject,connection_id):
    with db() as (con,s):
        return execute(con,s,'SELECT id,google_sub,google_email,refresh_cipher FROM play_google_connections WHERE id=%s AND subject=%s AND active=TRUE',(connection_id,subject),one=True)


def disconnect(subject,connection_id):
    with db() as (con,s):
        execute(con,s,'DELETE FROM play_registered_apps WHERE subject=%s AND connection_id=%s',(subject,connection_id))
        execute(con,s,'DELETE FROM play_release_plans WHERE subject=%s AND connection_id=%s',(subject,connection_id))
        execute(con,s,'DELETE FROM play_google_connections WHERE id=%s AND subject=%s',(connection_id,subject))


def register_app(subject,connection_id,package):
    with db() as (con,s):
        execute(con,s,'INSERT INTO play_registered_apps (subject,connection_id,package_name) VALUES (%s,%s,%s) ON CONFLICT(subject,connection_id,package_name) DO NOTHING',(subject,connection_id,package))


def app_is_registered(subject,connection_id,package):
    with db() as (con,s):
        return bool(execute(con,s,'SELECT package_name FROM play_registered_apps WHERE subject=%s AND connection_id=%s AND package_name=%s',(subject,connection_id,package),one=True))


def apps(subject):
    with db() as (con,s):
        return execute(con,s,'SELECT a.connection_id,a.package_name,c.google_email FROM play_registered_apps a JOIN play_google_connections c ON c.id=a.connection_id AND c.subject=a.subject AND c.active=TRUE WHERE a.subject=%s ORDER BY a.package_name',(subject,),all_rows=True)


def add_plan(subject,connection_id,package,jti,expires):
    with db() as (con,s):
        execute(con,s,'INSERT INTO play_release_plans (jti,subject,connection_id,package_name,expires_at,used) VALUES (%s,%s,%s,%s,%s,FALSE)',(jti,subject,connection_id,package,expires))


def claim_plan(subject,connection_id,package,jti,now):
    # Single use, consumed BEFORE external side effect, so retries fail closed.
    with db() as (con,s):
        return bool(execute(con,s,'UPDATE play_release_plans SET used=TRUE WHERE jti=%s AND subject=%s AND connection_id=%s AND package_name=%s AND used=FALSE AND expires_at>%s RETURNING jti',(jti,subject,connection_id,package,now),one=True))


def save_browser_intent(subject,state_hash,google_verifier_cipher,auth0_verifier_cipher,nonce,expires):
    with db() as (con,s):
        execute(con,s,'INSERT INTO play_browser_intents (state_hash,subject,google_verifier_cipher,auth0_verifier_cipher,oidc_nonce,expires_at,used) VALUES (%s,%s,%s,%s,%s,%s,FALSE)',
                (state_hash,subject,google_verifier_cipher,auth0_verifier_cipher,nonce,expires))


def browser_intent(state_hash,now):
    with db() as (con,s):
        return execute(con,s,'SELECT subject,google_verifier_cipher,auth0_verifier_cipher,oidc_nonce FROM play_browser_intents WHERE state_hash=%s AND expires_at>%s AND used=FALSE',(state_hash,now),one=True)


def consume_browser_intent(state_hash,now):
    with db() as (con,s):
        return execute(con,s,'UPDATE play_browser_intents SET used=TRUE WHERE state_hash=%s AND used=FALSE AND expires_at>%s RETURNING subject,google_verifier_cipher,auth0_verifier_cipher,oidc_nonce',(state_hash,now),one=True)
