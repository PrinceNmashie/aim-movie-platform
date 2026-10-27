import base64, copy, json, math, os, re
from pathlib import Path
import requests

API_ROOT='https://api.runpod.ai/v2'
MIN_DURATION=3
MAX_DURATION=15

def validate_duration(value):
    try:
        duration=float(value)
    except (TypeError, ValueError):
        raise ValueError('Choose a duration from 3 to 15 seconds.') from None
    if not math.isfinite(duration) or not MIN_DURATION <= duration <= MAX_DURATION:
        raise ValueError('Choose a duration from 3 to 15 seconds.')
    return duration

def unwrap_workflow(value):
    if 'input' in value and 'workflow' in value['input']:
        return copy.deepcopy(value['input']['workflow'])
    if 'workflow' in value and isinstance(value['workflow'], dict):
        return copy.deepcopy(value['workflow'])
    return copy.deepcopy(value)

def build_request(template, image_a, image_b, prompt, duration=5, turbo=False):
    duration=validate_duration(duration)
    workflow=unwrap_workflow(template)
    expected={'137':'LoadImage','139':'LoadImage','138':'PrimitiveStringMultiline','132':'PrimitiveFloat','146':'PrimitiveBoolean'}
    for node, kind in expected.items():
        if node not in workflow or workflow[node].get('class_type')!=kind:
            raise ValueError(f'Expected {kind} at node {node}; load the MiniMax H3 R2V API workflow.')
    workflow['137']['inputs']['image']='fighter_a.png'
    workflow['139']['inputs']['image']='fighter_b.png'
    workflow['138']['inputs']['value']=prompt
    workflow['132']['inputs']['value']=float(duration)
    workflow['146']['inputs']['value']=bool(turbo)
    def data_uri(blob):
        return 'data:image/png;base64,'+base64.b64encode(blob).decode('ascii')
    return {'input':{'workflow':workflow,'images':[{'name':'fighter_a.png','image':data_uri(image_a)}, {'name':'fighter_b.png','image':data_uri(image_b)}]}}

def _request(method, endpoint, api_key, suffix, **kw):
    resp=requests.request(method, f'{API_ROOT}/{endpoint}/{suffix}',headers={'Authorization':f'Bearer {api_key}'},timeout=90,**kw)
    try: resp.raise_for_status()
    except requests.HTTPError as exc:
        raise RuntimeError(f'Runpod HTTP {resp.status_code}: {resp.text[:800]}') from exc
    return resp.json()

def submit(endpoint, api_key, payload):
    if len(json.dumps(payload).encode('utf-8'))>9_000_000:
        raise ValueError('Request larger than 9 MB. Resize/compress your reference images.')
    return _request('POST',endpoint,api_key,'run',json=payload)

def status(endpoint, api_key, job_id):
    if not re.fullmatch(r'[A-Za-z0-9_-]+',job_id):
        raise ValueError('Invalid job ID')
    return _request('GET',endpoint,api_key,f'status/{job_id}')

def find_video(output):
    """Return ('url', url) or ('bytes', bytes), else (None,None). Limited to video hints."""
    def scan(obj, path=''):
        if isinstance(obj,dict):
            for k,v in obj.items():
                p=(path+'.'+k).lower()
                if isinstance(v,str):
                    if v.startswith(('https://','http://')) and (re.search(r'\.(mp4|webm|mov)(\?|$)',v,re.I) or any(t in p for t in ('video','url','output','file'))):
                        return ('url',v)
                    if ('video' in p or v.startswith('data:video/') or (p.endswith('.data') and obj.get('type')=='base64' and str(obj.get('filename','')).lower().endswith(('.mp4','.mov','.webm')))) and len(v)>100:
                        if v.startswith('data:video/') and ';base64,' in v:
                            try:return ('bytes',base64.b64decode(v.split(',',1)[1],validate=True))
                            except Exception:pass
                        if re.fullmatch(r'[A-Za-z0-9+/=\r\n]+',v):
                            try:
                                raw=base64.b64decode(v,validate=True)
                                if b'ftyp' in raw[:32] or raw[:4]==b'\x1aE\xdf\xa3':return ('bytes',raw)
                            except Exception:pass
                found=scan(v,p)
                if found[0]:return found
        elif isinstance(obj,list):
            for el in obj:
                found=scan(el,path)
                if found[0]:return found
        return (None,None)
    return scan(output)
