"""Secure developer-owned Google OAuth linking with mandatory Auth0 browser re-auth.

The MCP Auth0 subject MUST equal the browser's Auth0 ID-token subject. A secure
browser cookie further binds Google's redirect to the browser that completed
identity verification, defeating cross-user OAuth link forwarding.
"""
import base64
import hashlib
import hmac
import os
import secrets
import time
from urllib.parse import urlencode
import httpx
import jwt
from jwt import PyJWKClient
from universal_store import (encrypt, decrypt, save_intent, consume_intent,
   put_connection, connection, save_browser_intent, browser_intent, consume_browser_intent)

SCOPE='https://www.googleapis.com/auth/androidpublisher'
GOOGLE_AUTH='https://accounts.google.com/o/oauth2/v2/auth'
GOOGLE_TOKEN='https://oauth2.googleapis.com/token'
GOOGLE_USERINFO='https://openidconnect.googleapis.com/v1/userinfo'


def ready():
    return all(os.getenv(k) for k in ('GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET',
                                     'AUTH0_WEB_CLIENT_ID','AUTH0_WEB_CLIENT_SECRET','AUTH_ISSUER'))


def site_url():
    base=os.environ.get('MCP_PUBLIC_URL','').rstrip('/')
    if not base.startswith('https://') or '/' in base.removeprefix('https://'):
        raise ValueError('MCP_PUBLIC_URL must be an HTTPS origin')
    return base


def callback_url(): return site_url()+'/oauth/google/callback'
def identity_callback_url(): return site_url()+'/oauth/browser/identity-callback'
def hash_value(s): return hashlib.sha256(s.encode()).hexdigest()
def challenge(value):return base64.urlsafe_b64encode(hashlib.sha256(value.encode()).digest()).decode().rstrip('=')


def connect_link(auth0_subject):
    if not ready():
        raise ValueError('OAuth clients are not configured')
    auth0_verifier=secrets.token_urlsafe(64)
    google_verifier=secrets.token_urlsafe(64)
    state=secrets.token_urlsafe(48)
    nonce=secrets.token_urlsafe(32)
    save_browser_intent(auth0_subject,hash_value(state),encrypt(google_verifier),
                        encrypt(auth0_verifier),nonce,int(time.time())+600)
    return site_url()+'/oauth/browser/start?'+urlencode({'state':state})


def browser_login_url(state):
    if not isinstance(state,str) or len(state)>256:
        raise PermissionError('Invalid account-link state')
    intent=browser_intent(hash_value(state),int(time.time()))
    if not intent: raise PermissionError('Invalid or expired account-link state')
    args={'client_id':os.environ['AUTH0_WEB_CLIENT_ID'],
          'redirect_uri':identity_callback_url(),
          'response_type':'code', 'scope':'openid',
          'state':state,'nonce':intent['oidc_nonce'],
          'code_challenge':challenge(decrypt(intent['auth0_verifier_cipher'])),
          'code_challenge_method':'S256'}
    return os.environ['AUTH_ISSUER'].rstrip('/')+'/authorize?'+urlencode(args)


def identity_confirm(state,code):
    if not isinstance(state,str) or len(state)>256 or not isinstance(code,str) or len(code)>2048:
        raise PermissionError('Invalid identity response')
    # Claim state before calling the remote provider: replay is not possible.
    intent=consume_browser_intent(hash_value(state),int(time.time()))
    if not intent:raise PermissionError('Account-link state expired or already used')
    with httpx.Client(timeout=25) as client:
        r=client.post(os.environ['AUTH_ISSUER'].rstrip('/')+'/oauth/token',data={
            'grant_type':'authorization_code','client_id':os.environ['AUTH0_WEB_CLIENT_ID'],
            'client_secret':os.environ['AUTH0_WEB_CLIENT_SECRET'],
            'code':code,'redirect_uri':identity_callback_url(),
            'code_verifier':decrypt(intent['auth0_verifier_cipher'])})
        if r.status_code!=200: raise PermissionError('Browser identity verification failed')
        id_token=r.json().get('id_token')
    if not id_token:raise PermissionError('Missing Auth0 ID token')
    issuer=os.environ['AUTH_ISSUER']
    key=PyJWKClient(issuer.rstrip('/')+'/.well-known/jwks.json').get_signing_key_from_jwt(id_token).key
    identity=jwt.decode(id_token,key,algorithms=['RS256'],issuer=issuer,
                        audience=os.environ['AUTH0_WEB_CLIENT_ID'],
                        options={'require':['iss','aud','sub','exp','iat']},leeway=20)
    if not hmac.compare_digest(str(identity.get('sub','')),intent['subject']):
        raise PermissionError('Browser Auth0 identity differs from the ChatGPT user')
    if not hmac.compare_digest(str(identity.get('nonce','')),intent['oidc_nonce']):
        raise PermissionError('Auth0 nonce mismatch')
    google_state=secrets.token_urlsafe(48)
    cookie=secrets.token_urlsafe(48)
    save_intent(intent['subject'],hash_value(google_state),intent['google_verifier_cipher'],
                int(time.time())+600,hash_value(cookie))
    args={'client_id':os.environ['GOOGLE_OAUTH_CLIENT_ID'],
          'redirect_uri':callback_url(),'response_type':'code',
          'scope':f'openid email {SCOPE}','access_type':'offline','prompt':'consent',
          'state':google_state,
          'code_challenge':challenge(decrypt(intent['google_verifier_cipher'])),
          'code_challenge_method':'S256'}
    return GOOGLE_AUTH+'?'+urlencode(args),cookie


def complete(state,code,browser_cookie):
    if not isinstance(state,str) or len(state)>256 or not isinstance(code,str) or len(code)>2048:
        raise PermissionError('Invalid OAuth callback')
    if not browser_cookie or len(browser_cookie)>256:
        raise PermissionError('Missing browser session binding')
    intent=consume_intent(hash_value(state),int(time.time()),hash_value(browser_cookie))
    if not intent: raise PermissionError('Expired state or different browser session')
    data={'grant_type':'authorization_code','code':code,'redirect_uri':callback_url(),
          'client_id':os.environ['GOOGLE_OAUTH_CLIENT_ID'],
          'client_secret':os.environ['GOOGLE_OAUTH_CLIENT_SECRET'],
          'code_verifier':decrypt(intent['verifier_cipher'])}
    with httpx.Client(timeout=25) as client:
        response=client.post(GOOGLE_TOKEN,data=data)
        if response.status_code!=200:
            raise PermissionError('Google OAuth code exchange failed')
        token=response.json()
        if SCOPE not in str(token.get('scope','')).split() or not token.get('refresh_token') or not token.get('access_token'):
            raise PermissionError('Google did not grant offline Android Publisher access')
        user=client.get(GOOGLE_USERINFO,headers={'Authorization':'Bearer '+token['access_token']})
        if user.status_code!=200:
            raise PermissionError('Google account identity could not be verified')
        profile=user.json()
    if not profile.get('sub') or not profile.get('email') or profile.get('email_verified') is not True:
        raise PermissionError('Google did not return a verified account identity')
    cid=put_connection(intent['subject'],str(profile['sub']),str(profile['email']),encrypt(token['refresh_token']))
    return {'connection_id':cid,'google_email':profile['email']}


def token_for(auth0_subject,connection_id):
    record=connection(auth0_subject,connection_id)
    if not record:
        raise PermissionError('No Google connection owned by this user')
    with httpx.Client(timeout=25) as client:
        response=client.post(GOOGLE_TOKEN,data={
            'grant_type':'refresh_token','refresh_token':decrypt(record['refresh_cipher']),
            'client_id':os.environ['GOOGLE_OAUTH_CLIENT_ID'],
            'client_secret':os.environ['GOOGLE_OAUTH_CLIENT_SECRET']})
    if response.status_code!=200:
        raise PermissionError('Google authorization expired or revoked; reconnect')
    data=response.json()
    if not data.get('access_token'):
        raise PermissionError('Google did not issue an access token')
    return data['access_token']
