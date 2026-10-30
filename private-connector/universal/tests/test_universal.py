import importlib.util
import io
import json
import os
import sqlite3
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from cryptography.fernet import Fernet
import pytest

ROOT=Path(__file__).parents[1]
import sys
sys.path.insert(0,str(ROOT))
import app
import google_oauth
import universal_store as store
from fastapi.testclient import TestClient

@pytest.fixture
def configured(tmp_path,monkeypatch):
    dbpath=tmp_path/'play.sqlite'
    con=sqlite3.connect(dbpath)
    con.executescript((ROOT/'schema.sql').read_text())
    con.close()
    values={
        'PLAY_TEST_SQLITE_PATH':str(dbpath),
        'DATABASE_URL':'postgresql://placeholder-not-actually-used-in-test',
        'MCP_PUBLIC_URL':'https://publisher.example.com',
        'AUTH_ISSUER':'https://tenant.example.com/',
        'AUTH_AUDIENCE':'https://publisher.example.com/api/mcp',
        'GOOGLE_OAUTH_CLIENT_ID':'test-client-id',
        'GOOGLE_OAUTH_CLIENT_SECRET':'not-a-real-google-secret',
        'AUTH0_WEB_CLIENT_ID':'auth0-browser-client',
        'AUTH0_WEB_CLIENT_SECRET':'auth0-browser-secret',
        'GOOGLE_TOKEN_ENCRYPTION_KEY':Fernet.generate_key().decode(),
        'PLAY_APPROVAL_SIGNING_KEY':'x'*64,
        'PLAY_ENABLE_TEST_WRITES':'NO',
    }
    for k,v in values.items():monkeypatch.setenv(k,v)
    for k in ('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON','PLAY_SUBJECT_PACKAGES_JSON','GOOGLE_PLAY_AUTH_MODE'):
        monkeypatch.delenv(k,raising=False)
    return monkeypatch


def test_config_requires_database_encryption_and_oauth(configured):
    assert app.settings_ready()
    assert app.health()['static_package_allowlist_required'] is False
    configured.delenv('DATABASE_URL')
    assert not app.settings_ready()


def test_encrypted_refresh_tokens_and_user_isolation(configured):
    secret=store.encrypt('refresh-ONLY-FOR-A')
    assert 'refresh-ONLY-FOR-A' not in secret
    assert store.decrypt(secret)=='refresh-ONLY-FOR-A'
    cid=store.put_connection('alice','google-alice','alice@example.com',secret)
    assert store.connection('alice',cid)['refresh_cipher']==secret
    assert store.connection('bob',cid) is None
    assert store.connections('bob')==[]
    store.register_app('alice',cid,'com.alice.app')
    assert store.app_is_registered('alice',cid,'com.alice.app')
    assert not store.app_is_registered('bob',cid,'com.alice.app')
    assert len(store.apps('alice'))==1 and store.apps('bob')==[]


def test_user_can_connect_multiple_google_accounts(configured):
    a=store.put_connection('a','google-1','first@example.com',store.encrypt('one'))
    b=store.put_connection('a','google-2','second@example.com',store.encrypt('two'))
    store.register_app('a',a,'org.example.one')
    store.register_app('a',b,'org.example.two')
    assert len(store.connections('a'))==2 and len(store.apps('a'))==2
    store.disconnect('a',a)
    assert len(store.connections('a'))==1 and len(store.apps('a'))==1
    assert store.connection('a',b) is not None


def test_pkce_and_browser_reverification(configured):
    link=google_oauth.connect_link('auth0|one')
    parsed=urlparse(link)
    data=parse_qs(parsed.query)
    assert parsed.hostname=='publisher.example.com'
    assert parsed.path=='/oauth/browser/start'
    state=data['state'][0]
    browser_url=google_oauth.browser_login_url(state)
    params=parse_qs(urlparse(browser_url).query)
    assert urlparse(browser_url).hostname=='tenant.example.com'
    assert params['code_challenge_method']==['S256']
    assert params['redirect_uri']==['https://publisher.example.com/oauth/browser/identity-callback']
    assert params['scope']==['openid']
    assert not store.consume_intent(__import__('hashlib').sha256(state.encode()).hexdigest(),__import__('time').time(),'wrong-hash')


def test_browser_identity_mismatch_rejected(configured,monkeypatch):
    link=google_oauth.connect_link('auth0|alice')
    state=parse_qs(urlparse(link).query)['state'][0]
    class FakeResponse:
        status_code=200
        def json(self): return {'id_token':'dummy'}
    class FakeClient:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,*args,**kwargs):return FakeResponse()
    class FakeKey:
        key='unused'
    class FakeJWK:
        def __init__(self,*args,**kwargs):pass
        def get_signing_key_from_jwt(self,*args):return FakeKey()
    monkeypatch.setattr(google_oauth.httpx,'Client',FakeClient)
    monkeypatch.setattr(google_oauth,'PyJWKClient',FakeJWK)
    monkeypatch.setattr(google_oauth.jwt,'decode',lambda *a,**kw:{'sub':'auth0|attacker','nonce':'not-important'})
    with pytest.raises(PermissionError,match='differs'):
        google_oauth.identity_confirm(state,'fakecode')
    with pytest.raises(PermissionError,match='already used'):
        google_oauth.identity_confirm(state,'fakecode')


def test_google_callback_requires_bound_cookie(configured):
    with pytest.raises(PermissionError,match='Missing browser session'):
        google_oauth.complete('state','code','')


def test_unverified_app_not_authorized(configured,monkeypatch):
    cid=store.put_connection('alice','google-alice','alice@example.com',store.encrypt('refresh'))
    identity={'sub':'alice','scopes':{'play:read','play:write'}}
    with pytest.raises(PermissionError):app.permitted(identity,'com.some.app')
    with pytest.raises(PermissionError):app.use_google({'sub':'bob','scopes':identity['scopes']},cid)
    store.register_app('alice',cid,'com.some.app')
    assert not store.app_is_registered('bob',cid,'com.some.app')


def test_permission_recheck_and_production_block(configured,monkeypatch):
    cid=store.put_connection('alice','google-alice','alice@example.com',store.encrypt('refresh'))
    store.register_app('alice',cid,'com.example.app')
    identity={'sub':'alice','scopes':{'play:read','play:write'}}
    app.ACTIVE_CONNECTION.set(cid)
    monkeypatch.setattr(app,'release_snapshot',lambda p,t:({'track':'qa','releases':[]},[{'versionCode':7,'sha256':'a'*64}]))
    with pytest.raises(ValueError):app.prepare_release(identity,'com.example.app','production',7,'test')
    plan=app.prepare_release(identity,'com.example.app','qa',7,'test')
    assert not plan['applied']
    assert 'connection_id' in __import__('jwt').decode(plan['approval_token'],os.environ['PLAY_APPROVAL_SIGNING_KEY'],algorithms=['HS256'],audience='play-approval')
    with pytest.raises(PermissionError):app.commit_release(identity,plan['approval_token'],plan['confirmation'])
    app.ACTIVE_CONNECTION.set(None)


def test_release_approval_is_one_use(configured):
    cid=store.put_connection('alice','google-alice','alice@example.com',store.encrypt('refresh'))
    import time
    store.add_plan('alice',cid,'com.example.one','nonce',int(time.time())+100)
    assert not store.claim_plan('bob',cid,'com.example.one','nonce',int(time.time()))
    assert store.claim_plan('alice',cid,'com.example.one','nonce',int(time.time()))
    assert not store.claim_plan('alice',cid,'com.example.one','nonce',int(time.time()))


def test_google_callback_denies_bad_state(configured):
    r=TestClient(app.app).get('/oauth/google/callback?state=invalid&code=whatever')
    assert r.status_code==400


def test_no_google_connection_without_auth0(configured):
    monkey=lambda r: (_ for _ in ()).throw(PermissionError())
    app.authenticate=monkey
    payload={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'play_start_google_connection','arguments':{}}}
    x=TestClient(app.app).post('/api/mcp',json=payload).json()
    assert x['result']['isError'] is True


def test_tool_listing_no_static_packaging_env(configured):
    out=TestClient(app.app).post('/api/mcp',json={'jsonrpc':'2.0','id':1,'method':'tools/list'}).json()
    names=[x['name'] for x in out['result']['tools']]
    for name in ('play_start_google_connection','play_register_app','play_list_apps','play_disconnect_google','play_commit_testing_release'):
        assert name in names
    assert 'production' not in names


def test_register_app_requires_real_google_read(configured,monkeypatch):
    cid=store.put_connection('alice','google-alice','alice@example.com',store.encrypt('refresh'))
    identity={'sub':'alice','scopes':{'play:read'}}
    monkeypatch.setattr(app,'authenticate',lambda _:identity)
    monkeypatch.setattr(app,'token_for',lambda sub,cid:'scoped-access')
    monkeypatch.setattr(app,'list_tracks',lambda pkg: (_ for _ in ()).throw(PermissionError('Google Play refused access')))
    r=TestClient(app.app).post('/api/mcp',json={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'play_register_app','arguments':{'connection_id':cid,'package':'org.example.first'}}})
    assert r.status_code==403
    assert store.apps('alice')==[]
    monkeypatch.setattr(app,'list_tracks',lambda pkg:[{'track':'qa','releases':[]}])
    r=TestClient(app.app).post('/api/mcp',json={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'play_register_app','arguments':{'connection_id':cid,'package':'org.example.first'}}})
    assert r.status_code==200
    assert r.json()['result']['structuredContent']['verified'] is True
    assert len(store.apps('alice'))==1
    app.ACTIVE_GOOGLE_TOKEN.set(None)
    app.ACTIVE_CONNECTION.set(None)


def test_unknown_google_account_cannot_be_used_by_another_subject(configured,monkeypatch):
    cid=store.put_connection('alice','google-alice','alice@example.com',store.encrypt('refresh'))
    monkeypatch.setattr(app,'authenticate',lambda _:{'sub':'bob','scopes':{'play:read','play:write'}})
    response=TestClient(app.app).post('/api/mcp',json={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'play_register_app','arguments':{'connection_id':cid,'package':'org.example.first'}}})
    assert response.status_code==403
    assert store.apps('bob')==[]


def test_disconnect_requires_exact_approval(configured,monkeypatch):
    cid=store.put_connection('alice','google-alice','alice@example.com',store.encrypt('refresh'))
    monkeypatch.setattr(app,'authenticate',lambda _:{'sub':'alice','scopes':{'play:read','play:write'}})
    base={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'play_disconnect_google','arguments':{'connection_id':cid,'confirmation':'no'}}}
    client=TestClient(app.app)
    assert client.post('/api/mcp',json=base).status_code==400
    assert store.connection('alice',cid)
    base['params']['arguments']['confirmation']='DISCONNECT '+cid
    assert client.post('/api/mcp',json=base).json()['result']['structuredContent']['disconnected'] is True
    assert not store.connection('alice',cid)
