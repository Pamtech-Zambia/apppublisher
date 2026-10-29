"""Approval-gated Google Play testing releases. Production is never writable."""
import json, os, time
import jwt
from urllib.parse import quote
from play_service import allowed, package_id, api, path, new_edit, discard, read_tracks, checksum

def plan(subject,scopes,package,track,version_code,notes):
    package=package_id(package)
    allowed(subject,scopes,package)
    if track not in ('qa','beta') or type(version_code)!=int or version_code<1:
        raise ValueError('Only qa/beta and positive version codes are supported')
    if not isinstance(notes,str) or not 1<=len(notes)<=500:
        raise ValueError('Release notes must be 1-500 characters')
    current=next((t for t in read_tracks(package) if t.get('track')==track),
                 {'track':track,'releases':[]})
    for release in current.get('releases',[]):
        if release.get('status') in ('halted','inProgress'):
            raise ValueError('An existing staged/halted release requires manual review')
        if str(version_code) in [str(v) for v in release.get('versionCodes',[])]:
            raise ValueError('Version already on track')
    key=os.environ['PLAY_APPROVAL_SIGNING_KEY']
    if len(key)<32: raise ValueError('Approval key too short')
    timestamp=int(time.time())
    body={'iss':'private-play-publisher','aud':'play-approval','sub':subject,'package':package,
          'track':track,'code':version_code,'notes':notes,'before':checksum(current),
          'iat':timestamp,'exp':timestamp+600}
    return {'applied':False,'package':package,'track':track,'version_code':version_code,
            'release_notes':notes,'confirmation':f'PUBLISH {package}:{track}:{version_code}',
            'approval_token':jwt.encode(body,key,algorithm='HS256'),'expires_in_seconds':600,
            'note':'This assigns an already uploaded versionCode; it does not upload an AAB'}

def commit(subject,scopes,approval_token,confirmation):
    if os.environ.get('PLAY_ENABLE_TEST_WRITES')!='YES':
        raise PermissionError('Testing writes disabled')
    body=jwt.decode(approval_token,os.environ['PLAY_APPROVAL_SIGNING_KEY'],
                    algorithms=['HS256'],audience='play-approval',issuer='private-play-publisher')
    if body['sub']!=subject: raise PermissionError('Approval subject differs')
    package=package_id(body['package'])
    allowed(subject,scopes,package,write=True)
    track,code=body['track'],body['code']
    if track not in ('qa','beta') or type(code)!=int:
        raise PermissionError('Production writes prohibited')
    if confirmation!=f'PUBLISH {package}:{track}:{code}':
        raise ValueError('Exact confirmation mismatch')
    eid=new_edit(package)
    try:
        current=api('GET',path(package,eid)+'/tracks/'+quote(track,safe=''))
        if checksum(current)!=body['before']:
            raise ValueError('Track changed since plan; prepare a new release')
        for release in current.get('releases',[]):
            if str(code) in [str(v) for v in release.get('versionCodes',[])]:
                raise ValueError('Version already released to track')
        release={'status':'completed','versionCodes':[str(code)],
                 'releaseNotes':[{'language':'en-US','text':body['notes']}]}
        api('PUT',path(package,eid)+'/tracks/'+quote(track,safe=''),
            {'track':track,'releases':[release]})
        api('POST',path(package,eid)+':validate',{})
        receipt=api('POST',path(package,eid)+':commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW',{})
        return {'committed':True,'package':package,'track':track,'version_code':code,
                'edit_id':receipt.get('id'),
                'note':'Google Play review and tester availability require separate verification'}
    finally:
        discard(package,eid)
