"""SQLite-backed work queue, independent of the browser and safe against request retries.

Queued work survives restart. An expired in-flight operation is never replayed: a provider
may already have billed it. Saved video task IDs are polled without submitting them again.
"""
from contextvars import ContextVar
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
import uuid
from flask import abort, g, jsonify, request, session
from werkzeug.exceptions import HTTPException
import store
import studio
import notifications

_TASK = ContextVar('aim_background_task', default=None)
_WORKERS = {}
_GUARD = threading.Lock()
_PROJECT_LOCKS = {}
LEASE = 120
ACTIVE = ('queued', 'running', 'waiting')
LONG_PATHS = re.compile(r'^/api/(?:chat(?:/retry)?|generate/(?:vision|characters|script|director)|characters/[^/]+/image|ensemble|render/(?:submit|first-frame)|jobs/[^/]+/(?:last-frame|continue)|sequence/combine|source/(?:upload|analyze-next|analyze-all|synthesize)|community/submit)$')

def project_lock():
    with _GUARD:return _PROJECT_LOCKS.setdefault(str(store.db_path()),threading.RLock())

def portal():
    import creator_portal
    return creator_portal

def init(c):
    c.executescript('''
CREATE TABLE IF NOT EXISTS background_tasks(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,project_id TEXT NOT NULL,workspace_id TEXT NOT NULL,endpoint TEXT NOT NULL,path TEXT NOT NULL,arguments TEXT NOT NULL,input_path TEXT NOT NULL,content_type TEXT NOT NULL,fingerprint TEXT NOT NULL,idempotency_key TEXT NOT NULL,status TEXT NOT NULL,kind TEXT NOT NULL,label TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,started TEXT,finished TEXT,error TEXT NOT NULL DEFAULT '',result TEXT NOT NULL DEFAULT '{}',progress INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL DEFAULT 0,cancel_requested INTEGER NOT NULL DEFAULT 0,owner TEXT,lease_until REAL,next_run REAL NOT NULL DEFAULT 0,UNIQUE(user_id,idempotency_key));
CREATE INDEX IF NOT EXISTS task_queue ON background_tasks(status,next_run);
CREATE INDEX IF NOT EXISTS task_project ON background_tasks(user_id,project_id,status);
''')

def wants_async():
    return request.method=='POST' and request.headers.get('X-AIM-Async')=='1' and bool(LONG_PATHS.fullmatch(request.path))

def is_paid(path):
    return (path in ('/api/chat','/api/chat/retry','/api/render/submit','/api/render/first-frame','/api/ensemble','/api/voice/transcribe','/api/voice/session','/api/source/analyze-next','/api/source/analyze-all','/api/source/synthesize')
            or path.startswith('/api/generate/') or bool(re.fullmatch(r'/api/characters/[^/]+/image',path)))

def label(path):
    if '/generate/' in path:return {'vision':'Creative brief','characters':'Character profiles','script':'Script','director':'Shot plan'}.get(path.rsplit('/',1)[-1],'Creative draft')
    if '/chat' in path:return 'MIA conversation'
    if '/characters/' in path:return 'Character image'
    if path.endswith('/ensemble'):return 'Cast image'
    if '/render/submit' in path:return 'Video submission'
    if '/render/first-frame' in path:return 'Starting frame'
    if '/sequence/' in path:return 'Scene assembly'
    if '/community/' in path:return 'Review submission'
    if '/source/upload' in path:return 'Book import'
    if '/source/synthesize' in path:return 'Story bible'
    if '/source/' in path:return 'Book analysis'
    return 'Clip preparation'

def destination(t):
    path=t['path']
    if '/generate/' in path:page={'vision':'brief','characters':'characters','script':'script','director':'shots'}.get(path.rsplit('/',1)[-1],'')
    elif '/chat' in path:page='idea'
    elif '/characters/' in path or path.endswith('/ensemble'):page='characters'
    elif '/sequence/' in path:page='assembly'
    elif '/source/' in path:page='source'
    elif '/community/' in path:page='share'
    elif '/render/submit' in path or t['kind']=='watch':page='library'
    else:page='render'
    return '/'+page+'?project='+t['project_id']

def public(t):
    return {**{k:t[k] for k in ('id','project_id','status','kind','label','created','updated','started','finished','error','progress','total','cancel_requested')},'url':destination(t)}

def project_tasks(uid,pid):
    with portal().db() as c:
        rows=c.execute('SELECT * FROM background_tasks WHERE user_id=? AND project_id=? ORDER BY created DESC,rowid DESC LIMIT 20',(uid,pid)).fetchall()
    return [public(dict(t)) for t in rows]

def busy_project(uid,pid):
    with portal().db() as c:return bool(c.execute("SELECT 1 FROM background_tasks WHERE user_id=? AND project_id=? AND kind='operation' AND status IN ('queued','running') LIMIT 1",(uid,pid)).fetchone())

def enqueue():
    uid=portal().user()['id'];pid=g.project_id;workspace=studio.workspace_id()
    if request.headers.get('X-Workspace-ID')!=workspace:abort(409,'This project changed. Refresh before continuing.')
    key=request.headers.get('X-AIM-Key','')
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,100}',key):abort(400,'A request identifier is required. Refresh and try again.')
    raw=request.get_data(cache=True)
    if request.is_json:
        value=request.get_json(silent=True)
        if not isinstance(value,dict):abort(400,'Send a valid form object.')
        digest_bytes=json.dumps(value,sort_keys=True,separators=(',',':')).encode()
    else:digest_bytes=raw
    if request.mimetype=='multipart/form-data':
        # Browser retries can choose a different multipart boundary for the same files.
        fields=sorted((k,list(request.form.getlist(k))) for k in request.form)
        files=[]
        for key in sorted(request.files):
            for upload in request.files.getlist(key):
                blob=upload.read();upload.stream.seek(0)
                files.append((key,upload.filename,upload.content_type,hashlib.sha256(blob).hexdigest()))
        digest_bytes=json.dumps([fields,files],sort_keys=True).encode()
    fingerprint=hashlib.sha256(request.path.encode()+workspace.encode()+digest_bytes).hexdigest()
    tid=uuid.uuid4().hex;input_dir=portal().project_dir(pid,uid)/'task_inputs';input_dir.mkdir(parents=True,exist_ok=True)
    path=input_dir/(tid+'.body')
    with portal().db() as c:
        c.execute('BEGIN IMMEDIATE')
        existing=c.execute('SELECT * FROM background_tasks WHERE user_id=? AND idempotency_key=?',(uid,key)).fetchone()
        if existing:
            if existing['fingerprint']!=fingerprint:abort(409,'This request identifier already belongs to a different action.')
            return jsonify(accepted=True,task=public(dict(existing)),recovered=True),202
        existing=c.execute("SELECT * FROM background_tasks WHERE user_id=? AND project_id=? AND kind='operation' AND status IN ('queued','running')",(uid,pid)).fetchone()
        if existing:
            if existing['fingerprint']==fingerprint:return jsonify(accepted=True,task=public(dict(existing)),recovered=True),202
            abort(409,'A task is already working on this project. You can browse another page while it finishes.')
        if is_paid(request.path):portal().paid_gate(connection=c)
        with path.open('xb') as f:
            os.chmod(path,0o600);f.write(raw)
        try:
            c.execute('INSERT INTO background_tasks(id,user_id,project_id,workspace_id,endpoint,path,arguments,input_path,content_type,fingerprint,idempotency_key,status,kind,label,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                      (tid,uid,pid,workspace,request.endpoint,request.path,json.dumps(request.view_args or {}),path.name,request.content_type or 'application/json',fingerprint,key,'queued','operation',label(request.path),store.now(),store.now()))
        except Exception:path.unlink(missing_ok=True);raise
    return jsonify(accepted=True,task=public({'id':tid,'project_id':pid,'path':request.path,'status':'queued','kind':'operation','label':label(request.path),'created':store.now(),'updated':store.now(),'started':None,'finished':None,'error':'','progress':0,'total':0,'cancel_requested':0})),202

def progress(done,total):
    tid=_TASK.get()
    if tid:
        with portal().db() as c:c.execute('UPDATE background_tasks SET progress=?,total=?,updated=? WHERE id=?',(done,total,store.now(),tid))

def should_pause():
    tid=_TASK.get()
    if not tid:return False
    with portal().db() as c:
        r=c.execute('SELECT cancel_requested FROM background_tasks WHERE id=?',(tid,)).fetchone()
    return not r or bool(r[0])

def schedule_watch(uid,pid,workspace,jid):
    path='/api/jobs/'+jid+'/refresh';now=store.now()
    with portal().db() as c:
        c.execute('INSERT OR IGNORE INTO background_tasks(id,user_id,project_id,workspace_id,endpoint,path,arguments,input_path,content_type,fingerprint,idempotency_key,status,kind,label,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                  (uuid.uuid4().hex,uid,pid,workspace,'refresh_job',path,json.dumps({'jid':jid}),'','application/json',jid,'watch:'+pid+':'+jid,'waiting','watch','Video generation',now,now))

def recover_video_jobs():
    with portal().db() as c:rows=c.execute('SELECT p.* FROM projects p JOIN users u ON u.id=p.user_id').fetchall()
    for p in rows:
        directory=portal().project_dir(p['id'],p['user_id'])
        if not (directory/'aim.sqlite').exists():continue
        token=store.set_scope(directory)
        try:
            workspace=studio.workspace_id();meta=store.get('job_meta',{})
            for j in store.jobs():
                if meta.get(j[0],{}).get('provider') not in ('runway','alibaba'):continue
                if j[3] in ('FAILED','CANCELLED','CANCELED','TIMED_OUT'):continue
                if j[3]=='COMPLETED' and j[5] and not j[5].startswith(('http://','https://')) and (directory/Path(j[5]).name).is_file():continue
                schedule_watch(p['user_id'],p['id'],workspace,j[0])
        finally:store.reset_scope(token)

def recover_expired():
    with portal().db() as c:
        c.execute('BEGIN IMMEDIATE')
        stale=c.execute("SELECT * FROM background_tasks WHERE status='running' AND lease_until<?",(time.time(),)).fetchall()
        for t in stale:
            if t['kind']=='watch':
                c.execute("UPDATE background_tasks SET status='waiting',owner=NULL,lease_until=NULL,next_run=0 WHERE id=?",(t['id'],))
            else:
                message='The server restarted during this task. Review your saved results before trying again.'
                c.execute("UPDATE background_tasks SET status='interrupted',error=?,updated=?,finished=?,owner=NULL,lease_until=NULL WHERE id=?",(message,store.now(),store.now(),t['id']))
                notifications.add(c,t['user_id'],'creation_failed',t['label']+' was interrupted.',destination(t),t['id'],'task:'+t['id'])

def claim():
    recover_expired()
    owner=uuid.uuid4().hex
    with portal().db() as c:
        c.execute('BEGIN IMMEDIATE')
        t=c.execute("""SELECT t.* FROM background_tasks t JOIN users u ON u.id=t.user_id JOIN projects p ON p.id=t.project_id AND p.user_id=t.user_id
WHERE t.status IN ('queued','waiting') AND t.next_run<=? AND NOT EXISTS(SELECT 1 FROM background_tasks r WHERE r.user_id=t.user_id AND r.project_id=t.project_id AND r.status='running')
ORDER BY CASE t.kind WHEN 'operation' THEN 0 ELSE 1 END,t.created,t.rowid LIMIT 1""",(time.time(),)).fetchone()
        if not t:return None
        c.execute("UPDATE background_tasks SET status='running',owner=?,lease_until=?,started=COALESCE(started,?),updated=? WHERE id=?",(owner,time.time()+LEASE,store.now(),store.now(),t['id']))
    return {**dict(t),'owner':owner}

def finish(t,status,error='',result=None):
    with portal().db() as c:
        changed=c.execute('UPDATE background_tasks SET status=?,error=?,result=?,updated=?,finished=?,owner=NULL,lease_until=NULL WHERE id=? AND owner=?',
                         (status,error,json.dumps(result or {}),store.now(),store.now(),t['id'],t['owner'])).rowcount
        if not changed:return
        # Submission events already notify reviewers; video submission is not a ready video.
        if t['path'] not in ('/api/render/submit','/api/community/submit') or status!='succeeded':
            failed=status in ('failed','interrupted')
            title=t['label']+(' could not finish.' if failed else ' paused.' if status=='paused' else ' is ready.')
            notifications.add(c,t['user_id'],'creation_failed' if failed else 'creation_ready',title,destination(t),t['id'],'task:'+t['id'])

def run_once(app,api):
    t=claim()
    if not t:return False
    stop=threading.Event()
    def heartbeat():
        while not stop.wait(15):
            with portal().db() as c:c.execute("UPDATE background_tasks SET lease_until=? WHERE id=? AND owner=? AND status='running'",(time.time()+LEASE,t['id'],t['owner']))
    pulse=threading.Thread(target=heartbeat,daemon=True);pulse.start()
    directory=portal().project_dir(t['project_id'],t['user_id']);scope=store.set_scope(directory);ctx=_TASK.set(t['id'])
    try:
        with portal().db() as c:account=c.execute('SELECT * FROM users WHERE id=?',(t['user_id'],)).fetchone()
        if not account:return True
        if studio.workspace_id()!=t['workspace_id']:raise ValueError('This project changed. The earlier task was stopped to protect your current work.')
        if t['kind']=='operation' and t['cancel_requested']:
            finish(t,'paused');return True
        path=directory/'task_inputs'/Path(t['input_path']).name if t['input_path'] else None
        data=path.read_bytes() if path else b'{}';csrf=secrets.token_urlsafe(32)
        with app.test_request_context(t['path'],method='POST',data=data,content_type=t['content_type'],headers={'X-AIM-Token':csrf,'X-Workspace-ID':t['workspace_id']}):
            session['csrf']=csrf;g.user=dict(account);g.project_id=t['project_id'];g.background_task=t['id']
            try:
                if is_paid(t['path']) and os.getenv('AIM_ALLOW_PAID_API','0')!='1':raise ValueError('Creation is temporarily unavailable. Your saved work is safe.')
                response=app.make_response(app.view_functions[t['endpoint']](**json.loads(t['arguments'])))
                result=response.get_json(silent=True) or {}
                if response.status_code>=400:raise ValueError(result.get('error','This task could not finish.'))
            except Exception as exc:
                if t['kind']=='watch' and time.time()-__import__('datetime').datetime.fromisoformat(t['created']).timestamp()<86400:
                    with portal().db() as c:c.execute("UPDATE background_tasks SET status='waiting',next_run=?,owner=NULL,lease_until=NULL,updated=? WHERE id=? AND owner=?",(time.time()+30,store.now(),t['id'],t['owner']))
                    return True
                message=exc.description if isinstance(exc,HTTPException) else api['error_message'](exc)
                finish(t,'failed',message);return True
        if t['kind']=='watch':
            jid=json.loads(t['arguments'])['jid'];job=api['render_job'](jid)
            ready=job[3]=='COMPLETED' and job[5] and not job[5].startswith(('http://','https://')) and (directory/Path(job[5]).name).is_file()
            if ready:finish(t,'succeeded')
            elif job[3] in ('FAILED','CANCELLED','CANCELED','TIMED_OUT'):finish(t,'failed','Video generation could not finish. Review the clip status before trying again.')
            elif time.time()-__import__('datetime').datetime.fromisoformat(t['created']).timestamp()>86400:finish(t,'failed','This video still needs a status check. Open the video library before starting another generation.')
            else:
                with portal().db() as c:c.execute("UPDATE background_tasks SET status='waiting',next_run=?,owner=NULL,lease_until=NULL,updated=? WHERE id=? AND owner=?",(time.time()+10,store.now(),t['id'],t['owner']))
        else:
            finish(t,'paused' if t['path'].endswith('/analyze-all') and should_pause() else 'succeeded',result={'item_id':result.get('item',{}).get('id')})
            if path:path.unlink(missing_ok=True)
            if t['path']=='/api/render/submit':
                for job in store.jobs():
                    if job[3] not in ('COMPLETED','FAILED','CANCELLED','CANCELED','TIMED_OUT'):schedule_watch(t['user_id'],t['project_id'],t['workspace_id'],job[0])
    except Exception as exc:
        # No automatic retry of an operation that may have reached a paid provider.
        finish(t,'failed',str(exc)[:400] if isinstance(exc,ValueError) else 'This task could not finish. Your saved work is safe.')
    finally:
        stop.set();pulse.join(timeout=1);_TASK.reset(ctx);store.reset_scope(scope)
    return True

def ensure_worker(app,api):
    if app.testing or os.getenv('AIM_EMBEDDED_WORKER','1')!='1':return
    with _GUARD:
        threads=_WORKERS.get(id(app),[])
        if threads and all(t.is_alive() for t in threads):return
        def maintenance():
            last_scan=0
            while True:
                try:
                    if time.time()-last_scan>60:
                        recover_video_jobs();notifications.reminders();last_scan=time.time()
                    notifications.deliver_once()
                except Exception:
                    app.logger.exception('Background task maintenance encountered an error')
                time.sleep(5)
        def loop():
            while True:
                try:worked=run_once(app,api)
                except Exception:
                    app.logger.exception('Background task worker encountered an error');worked=False
                time.sleep(.25 if worked else 1)
        threads=[threading.Thread(target=loop,name='aim-background-worker-'+str(i),daemon=True) for i in range(2)]
        threads.append(threading.Thread(target=maintenance,name='aim-background-maintenance',daemon=True))
        _WORKERS[id(app)]=threads
        for thread in threads:thread.start()

def install(app,api):
    @app.before_request
    def dispatch_background():
        if not portal().user():return
        ensure_worker(app,api)
        if wants_async():return enqueue()
        # Protect the saved inputs/results while a long operation owns this project.
        if request.method=='POST' and request.path.startswith('/api/') and not request.path.startswith(('/api/account/','/api/auth/','/api/platform/','/api/review/','/api/community/','/api/voice/')) and busy_project(portal().user()['id'],g.project_id):
            abort(409,'A task is working on this project. You can browse while it finishes.')

    @app.get('/api/account/tasks')
    def task_list():
        uid=portal().user()['id'];key=request.args.get('key')
        with portal().db() as c:
            if key:rows=c.execute('SELECT * FROM background_tasks WHERE user_id=? AND idempotency_key=?',(uid,key)).fetchall()
            else:rows=c.execute('SELECT * FROM background_tasks WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT 50',(uid,)).fetchall()
        return jsonify(items=[public(dict(r)) for r in rows])

    @app.post('/api/account/tasks/<tid>/pause')
    def pause_task(tid):
        with portal().db() as c:
            t=c.execute('SELECT * FROM background_tasks WHERE id=? AND user_id=?',(tid,portal().user()['id'])).fetchone()
            if not t:abort(404)
            if not t['path'].endswith('/analyze-all'):abort(409,'Only book analysis can be paused. Other tasks finish independently.')
            c.execute('UPDATE background_tasks SET cancel_requested=1 WHERE id=?',(tid,))
        return jsonify(ok=True)
