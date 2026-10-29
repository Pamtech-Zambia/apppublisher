"""Google Play access functions; backend credentials never leave the server."""
import json, os, re, hashlib
from urllib.parse import quote
import httpx

PKG = re.compile(r'^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$')
ROOT = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'

def package_id(value):
    if not isinstance(value,str) or len(value)>200 or not PKG.fullmatch(value):
        raise ValueError('Invalid package ID')
    return value

def allowed(subject, scopes, package=None, write=False):
    data=json.loads(os.environ['PLAY_SUBJECT_PACKAGES_JSON'])
    apps=data.get(subject)
    if not isinstance(apps,list) or (package is not None and package not in apps):
        raise PermissionError('App access denied')
    if ('play:write' if write else 'play:read') not in scopes:
        raise PermissionError('Required scope absent')
    return apps

def api(method,path,body=None):
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request as GRequest
    info=json.loads(os.environ['GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'])
    if info.get('type')!='service_account':
        raise RuntimeError('Google credential is not a service account')
    creds=service_account.Credentials.from_service_account_info(
        info,scopes=['https://www.googleapis.com/auth/androidpublisher'])
    creds.refresh(GRequest())
    with httpx.Client(timeout=45) as client:
        r=client.request(method,ROOT+path,json=body,headers={
            'Authorization':'Bearer '+creds.token,'Accept':'application/json'})
    if r.status_code>=400:
        raise RuntimeError('Google Play API request failed ('+str(r.status_code)+')')
    return r.json() if r.content else {}

def path(package,edit_id):
    return '/'+quote(package,safe='')+'/edits/'+quote(str(edit_id),safe='')

def new_edit(package):
    result=api('POST','/'+quote(package,safe='')+'/edits',{})
    if not result.get('id'): raise RuntimeError('No edit ID returned')
    return result['id']

def discard(package,edit_id):
    try: api('DELETE',path(package,edit_id))
    except Exception: pass

def read_tracks(package):
    edit=new_edit(package)
    try:
        return api('GET',path(package,edit)+'/tracks').get('tracks',[])
    finally:
        discard(package,edit)

def checksum(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
