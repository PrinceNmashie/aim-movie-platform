"""Local multi-user prototype: private workspaces, immutable review copies and a public feed."""
import datetime as dt
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import time
import uuid
from contextlib import contextmanager
from flask import abort, g, jsonify, redirect, render_template, request, send_file, session, has_request_context
from werkzeug.security import generate_password_hash, check_password_hash
import store
import video_tools
import notifications
import background_tasks
from PIL import Image, ImageOps, UnidentifiedImageError

ROOT = store.DATA
DB = ROOT / 'platform.sqlite'
MEDIA = ROOT / 'community_media'
POLICY = {'version':'draft-1', 'label':'Provisional review checklist · AIM policy not yet defined', 'criteria':[
 {'id':'identity','label':'Character and visual identity remain consistent'},
 {'id':'continuity','label':'Action, positions, props and scene transitions connect'},
 {'id':'quality','label':'Video, audio and pacing are usable'},
 {'id':'guidelines','label':'Content and rights reviewed against the declared draft rules'}],
 'rules':'Draft only. Review content suitability, private information, use of likenesses, source adaptation permission, music and other third-party material. Escalate uncertainty. Replace this draft with approved AIM.movie policy before public launch.'}

@contextmanager
def db():
    ROOT.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(DB,timeout=30); c.row_factory=sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    try:
        yield c; c.commit()
    except Exception:
        c.rollback(); raise
    finally: c.close()

def init():
    MEDIA.mkdir(parents=True,exist_ok=True)
    with db() as c:
        c.executescript('''
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,project_id TEXT NOT NULL,title TEXT NOT NULL,description TEXT,tags TEXT,kind TEXT,status TEXT NOT NULL,path TEXT NOT NULL,digest TEXT NOT NULL,metadata TEXT NOT NULL,created TEXT NOT NULL,reviewer_id TEXT,policy TEXT NOT NULL,decision_note TEXT,checks TEXT,parent_id TEXT,publish INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS review_events(id INTEGER PRIMARY KEY,submission_id TEXT,actor_id TEXT,action TEXT,note TEXT,created TEXT,details TEXT);
CREATE TABLE IF NOT EXISTS reactions(user_id TEXT,submission_id TEXT,PRIMARY KEY(user_id,submission_id));
CREATE TABLE IF NOT EXISTS views(user_id TEXT,submission_id TEXT,PRIMARY KEY(user_id,submission_id));
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY,user_id TEXT,submission_id TEXT,reason TEXT,status TEXT DEFAULT 'open',created TEXT,UNIQUE(user_id,submission_id));
CREATE TABLE IF NOT EXISTS attempts(bucket TEXT,created REAL);
CREATE TABLE IF NOT EXISTS paid_actions(user_id TEXT,created TEXT,path TEXT);
CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS account_events(id INTEGER PRIMARY KEY,actor_id TEXT,target_id TEXT,action TEXT,details TEXT,created TEXT);
CREATE TABLE IF NOT EXISTS account_cleanup(user_id TEXT PRIMARY KEY,media TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookmarks(user_id TEXT,submission_id TEXT,created TEXT,PRIMARY KEY(user_id,submission_id));
CREATE TABLE IF NOT EXISTS follows(user_id TEXT,creator_id TEXT,PRIMARY KEY(user_id,creator_id));
''')
        notifications.init(c)
        background_tasks.init(c)
        migrate_creator_publication(c)
        if 'avatar' not in {r[1] for r in c.execute('PRAGMA table_info(users)')}:
            c.execute("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''")
    cleanup_deleted_accounts()

def migrate_creator_publication(c):
    """One-time, additive upgrade; legacy public posts retain their original creator."""
    if c.execute("SELECT 1 FROM config WHERE key='creator_publish_v2'").fetchone():return
    # Back up an existing installation before altering its platform records.
    backup=ROOT/'platform_before_creator_publish_v2.sqlite'
    if c.execute('SELECT count(*) FROM users').fetchone()[0] and not backup.exists():
        with sqlite3.connect(backup) as target:c.backup(target)
    c.execute('BEGIN IMMEDIATE')
    columns={r[1] for r in c.execute('PRAGMA table_info(submissions)')}
    for name,kind in [('review_notes',"TEXT NOT NULL DEFAULT ''"),('public_caption',"TEXT NOT NULL DEFAULT ''"),('published_at','TEXT'),('published_by','TEXT')]:
        if name not in columns:c.execute(f'ALTER TABLE submissions ADD COLUMN {name} {kind}')
    if 'bio' not in {r[1] for r in c.execute('PRAGMA table_info(users)')}:
        c.execute("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''")
    c.execute("UPDATE submissions SET review_notes=COALESCE(description,'')")
    c.execute("UPDATE submissions SET public_caption=COALESCE(description,''),published_at=COALESCE((SELECT MAX(created) FROM review_events e WHERE e.submission_id=submissions.id AND action='approved'),created),status='published' WHERE status='approved' AND publish=1")
    c.execute("UPDATE submissions SET publish=0 WHERE status!='published'")
    c.execute("INSERT INTO config VALUES('creator_publish_v2','1')")


def user(): return getattr(g,'user',None)
def is_admin(): return bool(has_request_context() and user() and user()['role']=='admin')
def staff(): return bool(user() and user()['role'] in ('admin','reviewer'))
def csrf():
    if 'csrf' not in session: session['csrf']=secrets.token_urlsafe(32)
    return session['csrf']

def avatar_url(account):
    name = dict(account).get('avatar', '') if account else ''
    return '/profile-images/' + account['id'] + '/' + name if re.fullmatch(r'[a-f0-9]{32}\.jpg', name) else None

def avatar_directory(uid):
    if not re.fullmatch('[a-f0-9]{32}', uid):abort(404)
    return ROOT / 'users' / uid / 'profile'
def payload():
    value=request.get_json(silent=True)
    if not isinstance(value,dict): abort(400,'Send a JSON object.')
    return value

def submission_fields():
    """Browser forms may contain a saved-source ID without uploading any file."""
    if request.is_json:return payload()
    if request.mimetype in ('multipart/form-data','application/x-www-form-urlencoded'):return request.form
    abort(415,'Use the review form or send a JSON object with the selected video.')


def required_staff():
    if not staff(): abort(403,'Staff access is required.')

def project_dir(pid, uid=None):
    uid=uid or user()['id']
    if not re.fullmatch('[a-f0-9]{32}',pid) or not re.fullmatch('[a-f0-9]{32}',uid): abort(404)
    return ROOT / 'users' / uid / 'projects' / pid

def create_project(uid,name='Untitled movie'):
    name=str(name).strip()[:120] or 'Untitled movie';pid=uuid.uuid4().hex
    with db() as c: c.execute('INSERT INTO projects VALUES(?,?,?,?)',(pid,uid,name,store.now()))
    project_dir(pid,uid).mkdir(parents=True,exist_ok=True)
    return pid

def projects():
    with db() as c: return [dict(r) for r in c.execute('SELECT * FROM projects WHERE user_id=? ORDER BY created DESC,rowid DESC',(user()['id'],))]

def policy():
    with db() as c:r=c.execute("SELECT value FROM config WHERE key='policy'").fetchone()
    return json.loads(r[0]) if r else POLICY

def event(c,sid,action,note='',details=None):
    c.execute('INSERT INTO review_events(submission_id,actor_id,action,note,created,details) VALUES(?,?,?,?,?,?)',
              (sid,user()['id'] if user() else 'demo',action,note,store.now(),json.dumps(details or {})))

def submission(sid):
    with db() as c:r=c.execute('SELECT * FROM submissions WHERE id=?',(sid,)).fetchone()
    if not r:abort(404,'Creation not found.')
    return dict(r)

def visible(row): return row['status']=='published' and row['publish']==1

def private_access(row):return bool(user() and (row['user_id']==user()['id'] or staff()))

def serialize(row,private=False):
    with db() as c:
        author=c.execute('SELECT id,name,avatar FROM users WHERE id=?',(row['user_id'],)).fetchone()
        project=c.execute('SELECT name FROM projects WHERE id=? AND user_id=?',(row['project_id'],row['user_id'])).fetchone()
        likes=c.execute('SELECT count(*) FROM reactions WHERE submission_id=?',(row['id'],)).fetchone()[0]
        seen=c.execute('SELECT count(*) FROM views WHERE submission_id=?',(row['id'],)).fetchone()[0]
        liked=bool(user() and c.execute('SELECT 1 FROM reactions WHERE submission_id=? AND user_id=?',(row['id'],user()['id'])).fetchone())
        saved=bool(user() and c.execute('SELECT 1 FROM bookmarks WHERE submission_id=? AND user_id=?',(row['id'],user()['id'])).fetchone())
    r={k:row[k] for k in ('id','title','kind','status','created','parent_id','publish','public_caption','published_at')}
    metadata=json.loads(row['metadata'])
    if not private:metadata={k:v for k,v in metadata.items() if k in ('width','height','duration_seconds','fps','has_audio')}
    r.update(author=author['name'] if author else 'Creator',author_avatar_url=avatar_url(author),creator_id=row['user_id'],creator_url='/creators/'+row['user_id'],
             tags=json.loads(row['tags']),likes=likes,views=seen,liked=liked,saved=saved,
             share_url='/watch/'+row['id'] if visible(row) else None,
             video_url='/community/media/'+row['id'],metadata=metadata)
    if private:
        with db() as c:
            reviewer=c.execute('SELECT name FROM users WHERE id=?',(row['reviewer_id'],)).fetchone()
            r['history']=[dict(x) for x in c.execute('SELECT e.action,e.note,e.created,e.details,e.actor_id,u.name AS actor_name FROM review_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.submission_id=? ORDER BY e.id',(row['id'],))]
        r.update(reviewer_name=reviewer[0] if reviewer else None,project_id=row['project_id'],project_name=project[0] if project else row['title'],
                 user_id=row['user_id'],is_owner=bool(user() and user()['id']==row['user_id']),reviewer_id=row['reviewer_id'],policy=json.loads(row['policy']),
                 review_notes=row['review_notes'],decision_note=row['decision_note'],checks=json.loads(row['checks'] or '{}'),published_by=row['published_by'])
    return r

def studio_state():
    if not user():return {}
    with db() as c:rows=c.execute('SELECT * FROM submissions WHERE user_id=? AND project_id=? ORDER BY created DESC,rowid DESC',(user()['id'],g.project_id)).fetchall()
    return {'user':{k:user()[k] for k in ('id','name','role')},'project_id':g.project_id,'projects':projects(),
            'submissions':[serialize(dict(r),True) for r in rows], 'policy':policy(),
            'paid_enabled':os.getenv('AIM_ALLOW_PAID_API','0')=='1', 'voice_model':os.getenv('OPENAI_REALTIME_MODEL','gpt-realtime-2.1-mini')}

def throttle(bucket,limit,seconds=900):
    now=time.time()
    with db() as c:
        c.execute('BEGIN IMMEDIATE');c.execute('DELETE FROM attempts WHERE created<?',(now-seconds,))
        n=c.execute('SELECT count(*) FROM attempts WHERE bucket=?',(bucket,)).fetchone()[0]
        if n>=limit:abort(429,'Too many attempts. Please try again later.')
        c.execute('INSERT INTO attempts VALUES(?,?)',(bucket,now))

def paid_gate(connection=None):
    if os.getenv('AIM_ALLOW_PAID_API','0')!='1':abort(403,'Paid API calls are off. Set AIM_ALLOW_PAID_API=1 in .env and restart when ready.' if is_admin() else 'Creation is temporarily unavailable. Please try again later.')
    day=store.now()[:10];cap=max(1,int(os.getenv('AIM_DAILY_PAID_ACTIONS','250')))
    def reserve(c):
        n=c.execute('SELECT count(*) FROM paid_actions WHERE user_id=? AND created LIKE ?',(user()['id'],day+'%')).fetchone()[0]
        if n>=cap:abort(429,'Your daily API action limit has been reached.')
        c.execute('INSERT INTO paid_actions VALUES(?,?,?)',(user()['id'],store.now(),request.path))
    if connection is not None:reserve(connection)
    else:
        with db() as c:
            c.execute('BEGIN IMMEDIATE');reserve(c)

def cleanup_deleted_accounts():
    """Retry committed deletion work after a restart or a temporary disk error."""
    with db() as c:pending=c.execute('SELECT * FROM account_cleanup').fetchall()
    for item in pending:
        uid=item['user_id']
        if not re.fullmatch('[a-f0-9]{32}',uid):continue
        try:
            directory=ROOT/'users'/uid
            if directory.exists():shutil.rmtree(directory)
            for name in json.loads(item['media']):
                if Path(name).name!=name:continue
                (MEDIA/name).unlink(missing_ok=True)
            with db() as c:c.execute('DELETE FROM account_cleanup WHERE user_id=?',(uid,))
        except OSError:
            # Access is already revoked. Keep the durable cleanup record for retry.
            continue

def change_role(uid,role,actor_id=None):
    if role not in ('creator','reviewer','admin'):abort(400,'Choose member, reviewer or administrator.')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        if actor_id is not None:
            actor=c.execute('SELECT role FROM users WHERE id=?',(actor_id,)).fetchone()
            if not actor or actor['role']!='admin':abort(403,'Administrator access is required.')
        target=c.execute('SELECT role FROM users WHERE id=?',(uid,)).fetchone()
        if not target or target['role']=='demo':abort(404,'Account not found.')
        if target['role']=='admin' and role!='admin' and c.execute("SELECT count(*) FROM users WHERE role='admin'").fetchone()[0]<=1:
            abort(409,'Keep at least one administrator. Promote another account first.')
        if target['role']==role:return
        c.execute('UPDATE users SET role=? WHERE id=?',(role,uid))
        c.execute('DELETE FROM sessions WHERE user_id=?',(uid,))
        if role=='creator':
            released=c.execute("SELECT id,user_id FROM submissions WHERE reviewer_id=? AND status='in_review'",(uid,)).fetchall()
            c.execute("UPDATE submissions SET status='submitted',reviewer_id=NULL WHERE reviewer_id=? AND status='in_review'",(uid,))
            for item in released:
                c.execute('INSERT INTO review_events(submission_id,actor_id,action,note,created,details) VALUES(?,?,?,?,?,?)',(item['id'],actor_id or 'server-cli','review_released','Reviewer role changed.',store.now(),'{}'))
                notifications.clear_review(c,item['id']);notifications.review_available(c,item['id'],item['user_id'])
            c.execute("UPDATE notifications SET read_at=? WHERE user_id=? AND kind IN ('review_available','review_assigned','review_reminder')",(store.now(),uid))
            c.execute('DELETE FROM notification_email WHERE user_id=?',(uid,))
        c.execute('INSERT INTO account_events(actor_id,target_id,action,details,created) VALUES(?,?,?,?,?)',
                  (actor_id or 'server-cli',uid,'role_changed',json.dumps({'from':target['role'],'to':role}),store.now()))

def install(app,api):
    init()
    key=os.getenv('AIM_SECRET_KEY','').strip()
    if not key:
        p=ROOT/'session_secret'
        try:
            with p.open('x') as f:os.chmod(p,0o600);f.write(secrets.token_hex(32))
        except FileExistsError:pass
        key=p.read_text().strip()
    app.secret_key=key
    app.config.update(SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SAMESITE='Lax',SESSION_COOKIE_SECURE=os.getenv('AIM_COOKIE_SECURE')=='1',PERMANENT_SESSION_LIFETIME=dt.timedelta(hours=12))

    @app.before_request
    def auth_and_scope():
        csrf();g.user=None
        with db() as c:
            r=c.execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.id=? AND s.expires>?',
                        (session.get('sid',''),time.time())).fetchone()
            if r:g.user=dict(r)
        if request.path == '/' and not user():
            return redirect('/discover')
        public=(request.path.startswith('/static/') or request.path in ('/login','/discover','/api/auth/state','/api/auth/login','/api/auth/register','/api/community/feed','/account/notifications/verify') or request.path.startswith(('/watch/','/api/community/posts/','/community/media/','/creators/','/api/creators/','/profile-images/')))
        if not public and not user():
            if request.path.startswith('/api/'):return jsonify(error='Sign in to continue.'),401
            return redirect('/login')
        if request.method in ('POST','PUT','PATCH','DELETE'):
            if not secrets.compare_digest(request.headers.get('X-AIM-Token',''),csrf()):abort(403,'Refresh the page and try again.')
            origin=request.headers.get('Origin')
            if origin and origin.rstrip('/')!=request.host_url.rstrip('/'):abort(403,'Unexpected request origin.')
        if user():
            ps=projects();pid=session.get('project_id')
            requested_project=request.args.get('project')
            if requested_project:
                if requested_project not in {p['id'] for p in ps}:abort(404,'Project not found.')
                pid=requested_project
            studio_pages={'overview','source','share','idea','brief','characters','script','shots','render','library','assembly','settings','activity'}
            needs_project=(request.path=='/' or request.path.lstrip('/') in studio_pages or request.path in ('/api/state','/api/community/submit')
                           or request.path.startswith(('/assets/','/video/','/assembly/'))
                           or request.path.startswith('/api/') and not request.path.startswith(('/api/auth/','/api/account/','/api/platform/','/api/community/','/api/review/','/api/creators/')))
            if request.path=='/api/community/submit':
                # Preserve multipart bytes for the durable task before form parsing consumes them.
                if background_tasks.wants_async():request.get_data(cache=True)
                fields=submission_fields()
                requested=fields.get('project_id')
                if requested:
                    if requested not in {p['id'] for p in ps}:abort(404,'Project not found.')
                    pid=requested
            if pid not in {p['id'] for p in ps}:pid=ps[0]['id'] if ps else create_project(user()['id']) if needs_project else None
            g.project_id=pid
            if pid:
                session['project_id']=pid;g.scope_token=store.set_scope(project_dir(pid))
            else:session.pop('project_id',None)
        if request.method=='POST' and user():
            path=request.path
            if background_tasks.is_paid(path) and not background_tasks.wants_async():
                paid_gate()

    @app.teardown_request
    def clear_scope(error):
        if hasattr(g,'scope_token'):store.reset_scope(g.scope_token)

    @app.after_request
    def private_cache(response):
        if not request.path.startswith('/static/'):response.headers['Cache-Control']='no-store'
        response.headers['Permissions-Policy']='microphone=(self), camera=()'
        return response

    @app.get('/login')
    @app.get('/discover')
    @app.get('/account')
    @app.get('/account/settings')
    @app.get('/account/likes')
    @app.get('/account/saved')
    @app.get('/account/notifications')
    @app.get('/account/tasks')
    @app.get('/review')
    @app.get('/creators/<creator_id>')
    @app.get('/watch/<sid>')
    def portal_page(creator_id=None,sid=None):
        if request.path=='/review':required_staff()
        return render_template('portal.html',token=csrf())

    @app.get('/api/auth/state')
    def auth_state():
        return jsonify(user={**{k:user()[k] for k in ('id','name','email','role','bio')},'avatar_url':avatar_url(user())} if user() else None,csrf=csrf(),projects=projects() if user() else [],first_account=not any_users(),paid_enabled=os.getenv('AIM_ALLOW_PAID_API')=='1')

    @app.post('/api/auth/register')
    def register():
        throttle('register:'+request.remote_addr,10,3600);v=payload()
        email=str(v.get('email','')).strip().casefold();name=str(v.get('name','')).strip();password=str(v.get('password',''))
        if not re.fullmatch(r'[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,30}',email):abort(400,'Enter a valid email address.')
        if not 2<=len(name)<=60 or not 10<=len(password)<=200:abort(400,'Use a name of 2–60 characters and a password of 10–200 characters.')
        uid=uuid.uuid4().hex;hashed=generate_password_hash(password, method='pbkdf2:sha256:1000000')
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            role='admin' if c.execute("SELECT count(*) FROM users WHERE role!='demo'").fetchone()[0]==0 else 'creator'
            try:c.execute('INSERT INTO users(id,email,name,password,role,created) VALUES(?,?,?,?,?,?)',(uid,email,name,hashed,role,store.now()))
            except sqlite3.IntegrityError:abort(409,'That email is already registered. Sign in instead.')
        sign_in(uid);return jsonify(ok=True,redirect='/discover')

    @app.post('/api/auth/login')
    def login():
        v=payload();email=str(v.get('email','')).strip().casefold()
        throttle('login:'+hashlib.sha256((request.remote_addr+email).encode()).hexdigest(),8)
        throttle('login-ip:'+request.remote_addr,40)
        with db() as c:r=c.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone()
        if not r or not check_password_hash(r['password'],str(v.get('password',''))):abort(401,'Email or password is incorrect.')
        sign_in(r['id']);return jsonify(ok=True,redirect='/discover')

    @app.post('/api/auth/logout')
    def logout():
        with db() as c:c.execute('DELETE FROM sessions WHERE id=?',(session.get('sid',''),))
        session.clear();return jsonify(ok=True)

    @app.post('/api/account/password')
    def password_change():
        v=payload()
        if not check_password_hash(user()['password'],str(v.get('current_password',''))):abort(403,'Current password is incorrect.')
        p=str(v.get('password',''))
        if not 10<=len(p)<=200:abort(400,'Use a password of 10–200 characters.')
        with db() as c:
            c.execute('UPDATE users SET password=? WHERE id=?',(generate_password_hash(p, method='pbkdf2:sha256:1000000'),user()['id']))
            c.execute('DELETE FROM sessions WHERE user_id=?',(user()['id'],))
        sign_in(user()['id']);return jsonify(ok=True)

    @app.post('/api/account/profile')
    def edit_profile():
        v=payload();name=str(v.get('name','')).strip();bio=str(v.get('bio','')).strip()
        if not 2<=len(name)<=60 or len(bio)>500:abort(400,'Use a display name of 2–60 characters and a bio up to 500 characters.')
        with db() as c:c.execute('UPDATE users SET name=?,bio=? WHERE id=?',(name,bio,user()['id']))
        return jsonify(ok=True)

    @app.post('/api/account/avatar')
    def upload_avatar():
        upload=request.files.get('file')
        if not upload:abort(400,'Choose a JPG, PNG or WebP profile picture.')
        blob=upload.read(5*1024*1024+1)
        if not blob or len(blob)>5*1024*1024:abort(400,'Use a profile picture under 5 MB.')
        try:
            with Image.open(io.BytesIO(blob)) as source:
                if source.format not in ('JPEG','PNG','WEBP') or getattr(source,'is_animated',False):
                    abort(400,'Use a still JPG, PNG or WebP image.')
                if source.width*source.height>16_000_000:abort(400,'Use an image no larger than 16 million pixels.')
                source.load()
                image=ImageOps.fit(ImageOps.exif_transpose(source).convert('RGB'),(512,512),method=Image.Resampling.LANCZOS)
            output=io.BytesIO();image.save(output,format='JPEG',quality=88)
        except (UnidentifiedImageError,OSError,ValueError,Image.DecompressionBombError):
            abort(400,'That image could not be read. Use a still JPG, PNG or WebP image.')
        uid=user()['id'];filename=uuid.uuid4().hex+'.jpg'
        with api['LOCK']:
            with db() as c:
                current=c.execute('SELECT avatar FROM users WHERE id=?',(uid,)).fetchone()
                if not current:abort(401,'Sign in again.')
                directory=avatar_directory(uid);directory.mkdir(parents=True,exist_ok=True)
                path=directory/filename;path.write_bytes(output.getvalue())
                try:c.execute('UPDATE users SET avatar=? WHERE id=?',(filename,uid))
                except Exception:path.unlink(missing_ok=True);raise
            if current['avatar']:
                try:(directory/Path(current['avatar']).name).unlink(missing_ok=True)
                except OSError:pass  # Superseded filenames are never served by the route below.
        return jsonify(ok=True,avatar_url='/profile-images/'+uid+'/'+filename)

    @app.post('/api/account/avatar/remove')
    def remove_avatar():
        uid=user()['id']
        with api['LOCK']:
            with db() as c:
                row=c.execute('SELECT avatar FROM users WHERE id=?',(uid,)).fetchone()
                if not row:abort(401,'Sign in again.')
                c.execute("UPDATE users SET avatar='' WHERE id=?",(uid,))
            if row['avatar']:
                try:(avatar_directory(uid)/Path(row['avatar']).name).unlink(missing_ok=True)
                except OSError:pass
        return jsonify(ok=True)

    @app.get('/profile-images/<uid>/<filename>')
    def profile_image(uid,filename):
        if not re.fullmatch(r'[a-f0-9]{32}\.jpg',filename):abort(404)
        directory=avatar_directory(uid)
        with db() as c:row=c.execute('SELECT avatar FROM users WHERE id=?',(uid,)).fetchone()
        if not row or row['avatar']!=filename or not (directory/filename).is_file():abort(404)
        return send_file(directory/filename,mimetype='image/jpeg',conditional=True)

    @app.get('/api/account/likes')
    def liked_creations():
        try:offset=max(0,int(request.args.get('offset',0)))
        except ValueError:abort(400,'Invalid page.')
        where="FROM reactions l JOIN submissions s ON s.id=l.submission_id WHERE l.user_id=? AND s.status='published' AND s.publish=1"
        with db() as c:
            total=c.execute('SELECT count(*) '+where,(user()['id'],)).fetchone()[0]
            rows=c.execute('SELECT s.* '+where+' ORDER BY l.rowid DESC LIMIT 12 OFFSET ?',(user()['id'],offset)).fetchall()
        return jsonify(items=[serialize(dict(r)) for r in rows],total=total,next_offset=offset+12 if offset+12<total else None)

    @app.get('/api/account/admin/users')
    def list_accounts():
        if user()['role']!='admin':abort(403,'Administrator access is required.')
        q=str(request.args.get('q','')).strip()[:100]
        try:offset=max(0,int(request.args.get('offset',0)))
        except ValueError:abort(400,'Invalid page.')
        where="role!='demo' AND (instr(lower(name),lower(?))>0 OR instr(lower(email),lower(?))>0)"
        with db() as c:
            total=c.execute('SELECT count(*) FROM users WHERE '+where,(q,q)).fetchone()[0]
            rows=c.execute('SELECT id,name,email,role,created FROM users WHERE '+where+' ORDER BY created,id LIMIT 25 OFFSET ?',(q,q,offset)).fetchall()
        return jsonify(items=[dict(r) for r in rows],total=total,next_offset=offset+25 if offset+25<total else None)

    @app.post('/api/account/admin/role')
    def account_role():
        if user()['role']!='admin':abort(403,'Administrator access is required.')
        throttle('admin-role:'+user()['id'],15)
        v=payload()
        if not check_password_hash(user()['password'],str(v.get('current_password',''))):abort(403,'Your current password is incorrect.')
        change_role(str(v.get('user_id','')),str(v.get('role','')),user()['id'])
        return jsonify(ok=True,reauthenticate=v.get('user_id')==user()['id'])

    @app.post('/api/account/delete')
    def delete_account():
        v=payload();uid=user()['id']
        throttle('delete-account:'+uid,5)
        if not check_password_hash(user()['password'],str(v.get('current_password',''))):abort(403,'Current password is incorrect.')
        if v.get('confirmation')!='DELETE':abort(400,'Type DELETE to confirm account deletion.')
        with db() as c:
            if c.execute("SELECT 1 FROM background_tasks WHERE user_id=? AND status IN ('queued','running','waiting') LIMIT 1",(uid,)).fetchone():
                abort(409,'Let your active tasks finish before deleting your account. Book analysis can be paused from Tasks.')
        with api['LOCK'],db() as c:
            c.execute('BEGIN IMMEDIATE')
            current=c.execute('SELECT role FROM users WHERE id=?',(uid,)).fetchone()
            if not current:abort(401,'Sign in again.')
            if current['role']=='admin' and c.execute("SELECT count(*) FROM users WHERE role='admin'").fetchone()[0]<=1:
                abort(409,'Promote another administrator before deleting your account.')
            rows=c.execute('SELECT id,path,metadata FROM submissions WHERE user_id=?',(uid,)).fetchall()
            names=set()
            for row in rows:
                names.add(row['path']);names.add(row['id']+'.source')
                names.update(x['file'] for x in json.loads(row['metadata']).get('context',[]) if x.get('file'))
                notifications.clear_review(c,row['id'])
                for table in ('reactions','views','reports','review_events','bookmarks'):
                    c.execute('DELETE FROM '+table+' WHERE submission_id=?',(row['id'],))
            c.execute('DELETE FROM submissions WHERE user_id=?',(uid,))
            released=c.execute("SELECT id,user_id FROM submissions WHERE reviewer_id=? AND status='in_review'",(uid,)).fetchall()
            c.execute("UPDATE submissions SET status='submitted',reviewer_id=NULL WHERE reviewer_id=? AND status='in_review'",(uid,))
            for item in released:
                c.execute('INSERT INTO review_events(submission_id,actor_id,action,note,created,details) VALUES(?,?,?,?,?,?)',(item['id'],uid,'review_released','Reviewer account deleted.',store.now(),'{}'))
                notifications.clear_review(c,item['id']);notifications.review_available(c,item['id'],item['user_id'])
            for table in ('sessions','projects','paid_actions','reactions','views','reports'):
                c.execute('DELETE FROM '+table+' WHERE user_id=?',(uid,))
            for table in ('bookmarks','follows','notifications','notification_preferences','notification_email','background_tasks'):
                c.execute('DELETE FROM '+table+' WHERE user_id=?',(uid,))
            c.execute('DELETE FROM follows WHERE creator_id=?',(uid,))
            c.execute('DELETE FROM users WHERE id=?',(uid,))
            c.execute('INSERT INTO account_cleanup VALUES(?,?)',(uid,json.dumps(sorted(names))))
            c.execute('INSERT INTO account_events(actor_id,target_id,action,details,created) VALUES(?,?,?,?,?)',(uid,uid,'account_deleted','{}',store.now()))
        session.clear();cleanup_deleted_accounts()
        with db() as c:pending=bool(c.execute('SELECT 1 FROM account_cleanup WHERE user_id=?',(uid,)).fetchone())
        return jsonify(ok=True,cleanup_pending=pending)

    @app.get('/api/creators/<creator_id>')
    def creator_profile(creator_id):
        if not re.fullmatch('[a-f0-9]{32}',creator_id):abort(404,'Profile not found.')
        offset=max(0,min(int(request.args.get('offset',0)),10000))
        with db() as c:
            u=c.execute('SELECT id,name,bio,avatar FROM users WHERE id=?',(creator_id,)).fetchone()
            if not u:abort(404,'Profile not found.')
            total=c.execute("SELECT count(*) FROM submissions WHERE user_id=? AND status='published' AND publish=1",(creator_id,)).fetchone()[0]
            likes=c.execute("SELECT count(*) FROM reactions r JOIN submissions s ON s.id=r.submission_id WHERE s.user_id=? AND s.status='published' AND s.publish=1",(creator_id,)).fetchone()[0]
            rows=c.execute("SELECT * FROM submissions WHERE user_id=? AND status='published' AND publish=1 ORDER BY published_at DESC,rowid DESC LIMIT 12 OFFSET ?",(creator_id,offset)).fetchall()
            following=bool(user() and c.execute('SELECT 1 FROM follows WHERE user_id=? AND creator_id=?',(user()['id'],creator_id)).fetchone())
            followers=c.execute('SELECT count(*) FROM follows WHERE creator_id=?',(creator_id,)).fetchone()[0]
            following_count=c.execute('SELECT count(*) FROM follows WHERE user_id=?',(creator_id,)).fetchone()[0]
        return jsonify(profile={**{k:u[k] for k in ('id','name','bio')},'avatar_url':avatar_url(u),'url':'/creators/'+creator_id,'published_count':total,'likes':likes,'followers':followers,'following_count':following_count,'following':following,'is_owner':bool(user() and user()['id']==creator_id)},
                       items=[serialize(dict(r)) for r in rows],next_offset=offset+12 if offset+12<total else None)

    @app.post('/api/platform/projects')
    def portal_new_project():
        session['project_id']=create_project(user()['id'],payload().get('name','Untitled movie'));return jsonify(ok=True)

    @app.post('/api/platform/projects/select')
    def select_project():
        pid=payload().get('id')
        if pid not in {p['id'] for p in projects()}:abort(404)
        session['project_id']=pid;return jsonify(ok=True)

    @app.get('/api/community/feed')
    def feed():
        try:offset=max(0,int(request.args.get('offset',0)))
        except ValueError:abort(400,'Invalid page.')
        mode=request.args.get('mode','foryou');q=str(request.args.get('q','')).strip()[:120]
        kind=request.args.get('kind','');audio=request.args.get('audio','')
        if mode not in ('foryou','latest','following') or kind not in ('','clip','scene','movie') or audio not in ('','yes','no'):abort(400,'Choose valid search filters.')
        clauses=["s.status='published'","s.publish=1"];params=[]
        if q:
            clauses.append("(instr(lower(s.title||' '||s.public_caption||' '||s.tags||' '||COALESCE(u.name,'')),lower(?))>0)");params.append(q)
        if kind:clauses.append('s.kind=?');params.append(kind)
        if audio:clauses.append("COALESCE(json_extract(s.metadata,'$.has_audio'),0)=?");params.append(int(audio=='yes'))
        if mode=='following':
            if not user():return jsonify(items=[],next_offset=None)
            clauses.append('s.user_id IN (SELECT creator_id FROM follows WHERE user_id=?)');params.append(user()['id'])
        with db() as c:
            fav=set()
            if user():
                for r in c.execute('SELECT s.tags FROM submissions s JOIN reactions l ON l.submission_id=s.id WHERE l.user_id=?',(user()['id'],)):fav.update(json.loads(r[0]))
            order='s.published_at DESC,s.rowid DESC';rank_params=[]
            if mode=='foryou':
                rank="(SELECT count(*) FROM reactions r WHERE r.submission_id=s.id)*0.1 + 2/(1+MAX(0,julianday('now')-julianday(COALESCE(s.published_at,s.created))))"
                for tag in sorted(fav)[:40]:rank+=' + CASE WHEN instr(s.tags,?)>0 THEN 3 ELSE 0 END';rank_params.append(json.dumps(tag))
                if user():rank+=' - CASE WHEN EXISTS(SELECT 1 FROM views v WHERE v.submission_id=s.id AND v.user_id=?) THEN 2 ELSE 0 END';rank_params.append(user()['id'])
                order='('+rank+') DESC,'+order
            rows=c.execute('SELECT s.* FROM submissions s LEFT JOIN users u ON u.id=s.user_id WHERE '+' AND '.join(clauses)+' ORDER BY '+order+' LIMIT 9 OFFSET ?',(*params,*rank_params,offset)).fetchall()
        return jsonify(items=[serialize(dict(r)) for r in rows[:8]],next_offset=offset+8 if len(rows)>8 else None)

    @app.get('/api/community/posts/<sid>')
    def public_creation(sid):
        row=submission(sid)
        if not visible(row):abort(404,'This creation is unavailable. It may have been unpublished or removed.')
        return jsonify(item=serialize(row))

    @app.get('/api/account/saved')
    def saved_creations():
        try:offset=max(0,int(request.args.get('offset',0)))
        except ValueError:abort(400,'Invalid page.')
        with db() as c:
            rows=c.execute('SELECT s.* FROM bookmarks b JOIN submissions s ON s.id=b.submission_id WHERE b.user_id=? ORDER BY b.rowid DESC LIMIT 13 OFFSET ?',(user()['id'],offset)).fetchall()
        items=[serialize(dict(r)) if visible(r) else {'id':r['id'],'unavailable':True} for r in rows[:12]]
        return jsonify(items=items,next_offset=offset+12 if len(rows)>12 else None)

    @app.post('/api/community/<sid>/save')
    def save_creation(sid):
        value=payload().get('saved')
        if not isinstance(value,bool):abort(400,'Choose Save or Remove saved.')
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            if value:
                row=c.execute('SELECT * FROM submissions WHERE id=?',(sid,)).fetchone()
                if not row or not visible(row):abort(404,'This creation is unavailable.')
                c.execute('INSERT OR IGNORE INTO bookmarks VALUES(?,?,?)',(user()['id'],sid,store.now()))
            else:c.execute('DELETE FROM bookmarks WHERE user_id=? AND submission_id=?',(user()['id'],sid))
        return jsonify(ok=True,saved=value)

    @app.post('/api/creators/<creator_id>/follow')
    def follow_creator(creator_id):
        value=payload().get('following')
        if not isinstance(value,bool):abort(400,'Choose Follow or Unfollow.')
        if creator_id==user()['id']:abort(400,'You cannot follow yourself.')
        with db() as c:
            if not c.execute('SELECT 1 FROM users WHERE id=?',(creator_id,)).fetchone():abort(404,'Profile not found.')
            if value:c.execute('INSERT OR IGNORE INTO follows VALUES(?,?)',(user()['id'],creator_id))
            else:c.execute('DELETE FROM follows WHERE user_id=? AND creator_id=?',(user()['id'],creator_id))
        return jsonify(ok=True,following=value)

    @app.get('/api/community/mine')
    def mine():
        with db() as c:rows=c.execute('SELECT * FROM submissions WHERE user_id=? ORDER BY created DESC,rowid DESC',(user()['id'],)).fetchall()
        return jsonify(items=[serialize(dict(r),True) for r in rows],policy=policy())

    @app.get('/community/media/<sid>')
    def media(sid):
        row=submission(sid)
        if not visible(row) and not private_access(row):abort(404)
        path=MEDIA/row['path']
        if not path.is_file():abort(404)
        return send_file(path,conditional=True,mimetype='video/mp4')

    @app.post('/api/community/submit')
    def submit():
        v=submission_fields()
        title=str(v.get('title','')).strip();notes=str(v.get('review_notes',v.get('description',''))).strip();caption=str(v.get('public_caption','')).strip()
        if not 1<=len(title)<=120 or len(notes)>2000 or len(caption)>2000:abort(400,'Use a title up to 120 characters, private review notes up to 2,000, and a public caption up to 2,000.')
        if v.get('workspace_id') and v.get('workspace_id')!=api['studio'].workspace_id():abort(409,'This project changed. Refresh before submitting.')
        if str(v.get('rights_confirmed','')).lower() not in ('true','1'):abort(400,'Confirm that you can share this creation.')
        upload=request.files.get('file')
        has_upload=bool(upload and upload.filename)
        if sum((has_upload,bool(v.get('job_id')),bool(v.get('assembly_id'))))!=1:abort(400,'Choose one saved clip, one assembled scene, or one uploaded video.')
        tags=[x.strip().lower().lstrip('#')[:30] for x in str(v.get('tags','')).split(',') if x.strip()][:5]
        kind=str(v.get('kind','clip'))
        if kind not in ('clip','scene','movie'):abort(400,'Choose clip, scene or movie.')
        parent=v.get('parent_id') or None
        if parent and submission(parent)['user_id']!=user()['id']:abort(403)
        sid=uuid.uuid4().hex;path=MEDIA/(sid+'.mp4');context=[]
        try:
            if has_upload:
                f=upload
                if Path(f.filename or '').suffix.lower() not in ('.mp4','.mov','.webm'):abort(400,'Upload MP4, MOV or WebM.')
                blob=f.read(256*1024*1024+1)
                if len(blob)>256*1024*1024:abort(400,'Use a video under 256 MB.')
                path.write_bytes(blob)
            elif v.get('job_id'):
                src=api['local_clip'](str(v['job_id']));shutil.copyfile(src,path)
            elif v.get('assembly_id'):
                a=next((a for a in store.get('assemblies',[]) if a['id']==v['assembly_id']),None)
                if not a:abort(404,'Assembly not found.')
                src=store.data_dir()/Path(a['path']).name
                if not src.is_file():abort(400,'Assembly file missing.')
                shutil.copyfile(src,path)
                # Immutable adjacent-shot copies for reviewer context.
                for i,jid in enumerate(a.get('clip_ids',[])[:40]):
                    src=api['local_clip'](jid);name=sid+f'_context_{i}.mp4';shutil.copyfile(src,MEDIA/name);context.append({'index':i,'job_id':jid,'file':name})
            else:abort(400,'Upload a video or choose a completed clip or assembly.')
            info=video_tools.probe(path)
            # Normalize non-MP4 uploads without changing the source file.
            if has_upload:
                raw=path.with_suffix('.source');path.replace(raw)
                try:video_tools.run(['-i',raw,'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',path],timeout=180)
                finally:raw.unlink(missing_ok=True)
                info=video_tools.probe(path)
            digest=hashlib.sha256(path.read_bytes()).hexdigest()
            meta={**info,'source_job':v.get('job_id'),'source_assembly':v.get('assembly_id'),'context':context,'technical_precheck':'Playable video and duration checked. Content moderation requires staff review.'}
            with db() as c:
                c.execute('INSERT INTO submissions(id,user_id,project_id,title,description,tags,kind,status,path,digest,metadata,created,reviewer_id,policy,decision_note,checks,parent_id,publish,review_notes,public_caption) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    (sid,user()['id'],g.project_id,title,'',json.dumps(tags),kind,'submitted',path.name,digest,json.dumps(meta),store.now(),None,json.dumps(policy()),'',None,parent,0,notes,caption))
                c.execute("UPDATE projects SET name=? WHERE id=? AND user_id=? AND name='Untitled movie'",(title,g.project_id,user()['id']))
                event(c,sid,'submitted','Creator requested review and confirmed sharing permission.',{'project_id':g.project_id})
                notifications.review_available(c,sid,user()['id'],bool(parent))
        except Exception:
            path.unlink(missing_ok=True)
            for item in context:(MEDIA/item['file']).unlink(missing_ok=True)
            raise
        return jsonify(item=serialize(submission(sid),True))

    @app.post('/api/community/<sid>/like')
    def like(sid):
        if not visible(submission(sid)):abort(404)
        with db() as c:
            if c.execute('SELECT 1 FROM reactions WHERE user_id=? AND submission_id=?',(user()['id'],sid)).fetchone():c.execute('DELETE FROM reactions WHERE user_id=? AND submission_id=?',(user()['id'],sid))
            else:c.execute('INSERT INTO reactions VALUES(?,?)',(user()['id'],sid))
        return jsonify(item=serialize(submission(sid)))

    @app.post('/api/community/<sid>/view')
    def view(sid):
        if not visible(submission(sid)):abort(404)
        with db() as c:c.execute('INSERT OR IGNORE INTO views VALUES(?,?)',(user()['id'],sid))
        return jsonify(ok=True)

    @app.post('/api/community/<sid>/report')
    def report(sid):
        if not visible(submission(sid)):abort(404)
        reason=str(payload().get('reason','')).strip()
        if not 5<=len(reason)<=1000:abort(400,'Describe the concern in 5–1,000 characters.')
        with db() as c:c.execute('INSERT INTO reports(user_id,submission_id,reason,created) VALUES(?,?,?,?) ON CONFLICT(user_id,submission_id) DO UPDATE SET reason=excluded.reason,status=\'open\'',(user()['id'],sid,reason,store.now()))
        return jsonify(ok=True)

    @app.post('/api/community/<sid>/publish')
    def publish_creation(sid):
        with db() as c:
            c.execute('BEGIN IMMEDIATE');found=c.execute('SELECT * FROM submissions WHERE id=?',(sid,)).fetchone()
            if not found:abort(404,'Creation not found.')
            row=dict(found)
            if row['user_id']!=user()['id']:abort(403,'Only the creator can publish this creation. Staff approval returns it to the creator.')
            if visible(row):return jsonify(ok=True,item=serialize(row,True))
            if row['status']!='approved':abort(409,'This version needs staff approval before you can publish it.')
            checks=json.loads(row['checks'] or '{}')
            if any(checks.get(x['id']) is not True for x in json.loads(row['policy'])['criteria']):abort(409,'The approval checklist is incomplete.')
            path=MEDIA/row['path']
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=row['digest']:abort(409,'The approved video changed. Submit a new version for review.')
            values=request.get_json(silent=True) or {}
            if 'public_caption' in values and values['public_caption']!=row['public_caption']:abort(409,'Caption changes need a new submission so staff can review the public details.')
            c.execute("UPDATE submissions SET status='published',publish=1,published_at=?,published_by=? WHERE id=?",(store.now(),user()['id'],sid))
            # Retire earlier published versions only when their creator publishes the replacement.
            parent=row['parent_id'];visited=set()
            while parent and parent not in visited:
                visited.add(parent);ancestor=c.execute('SELECT user_id,parent_id FROM submissions WHERE id=?',(parent,)).fetchone()
                if not ancestor or ancestor['user_id']!=user()['id']:break
                c.execute("UPDATE submissions SET status='superseded',publish=0 WHERE id=? AND status='published'",(parent,));parent=ancestor['parent_id']
            event(c,sid,'published','Creator published their approved creation.',{'creator_id':user()['id'],'project_id':row['project_id']})
        return jsonify(ok=True,item=serialize(submission(sid),True))

    @app.post('/api/community/<sid>/revise-caption')
    def revise_public_caption(sid):
        v=payload();caption=str(v.get('public_caption','')).strip()
        if len(caption)>2000:abort(400,'Use a public caption up to 2,000 characters.')
        with db() as c:
            c.execute('BEGIN IMMEDIATE');found=c.execute('SELECT * FROM submissions WHERE id=?',(sid,)).fetchone()
            if not found:abort(404)
            row=dict(found)
            if row['user_id']!=user()['id']:abort(403,'Only the creator can revise the public details.')
            if row['status'] not in ('approved','published','changes_requested','rejected'):abort(409,'Open an approved or published creation to revise its caption.')
            if caption==row['public_caption']:abort(400,'Change the caption before requesting a new review.')
            path=MEDIA/row['path']
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=row['digest']:abort(409,'The video changed. Submit a new video for review.')
            pending=c.execute("SELECT id FROM submissions WHERE user_id=? AND parent_id=? AND public_caption=? AND status IN ('submitted','in_review')",(user()['id'],sid,caption)).fetchone()
            if pending:new_id=pending['id']
            else:
                new_id=uuid.uuid4().hex
                # The media is immutable; caption revisions reuse it and retain the original post until publication.
                c.execute('INSERT INTO submissions(id,user_id,project_id,title,description,tags,kind,status,path,digest,metadata,created,reviewer_id,policy,decision_note,checks,parent_id,publish,review_notes,public_caption) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                          (new_id,row['user_id'],row['project_id'],row['title'],'',row['tags'],row['kind'],'submitted',row['path'],row['digest'],row['metadata'],store.now(),None,json.dumps(policy()),'',None,sid,0,row['review_notes'],caption))
                event(c,new_id,'submitted','Creator revised the public caption and requested review.',{'parent_id':sid,'project_id':row['project_id']})
                notifications.review_available(c,new_id,user()['id'],True)
        return jsonify(ok=True,item=serialize(submission(new_id),True))

    @app.post('/api/community/<sid>/unpublish')
    def unpublish_creation(sid):
        with db() as c:
            c.execute('BEGIN IMMEDIATE');row=c.execute('SELECT * FROM submissions WHERE id=?',(sid,)).fetchone()
            if not row:abort(404)
            if row['user_id']!=user()['id']:abort(403,'Only the creator can unpublish their creation.')
            if row['status']!='published':abort(409,'This creation is not published.')
            c.execute("UPDATE submissions SET status='approved',publish=0 WHERE id=?",(sid,));event(c,sid,'unpublished','Creator returned the post to their approved, private creations.')
        return jsonify(ok=True)

    @app.post('/api/community/<sid>/withdraw')
    def withdraw(sid):
        row=submission(sid)
        if row['user_id']!=user()['id']:abort(403)
        with db() as c:
            c.execute("UPDATE submissions SET publish=0,status='withdrawn' WHERE id=?",(sid,));event(c,sid,'withdrawn')
            notifications.clear_review(c,sid)
        return jsonify(ok=True)

    @app.get('/api/review/queue')
    def queue():
        required_staff()
        with db() as c:
            rows=c.execute("SELECT * FROM submissions ORDER BY created DESC,rowid DESC LIMIT 200").fetchall()
            selected=request.args.get('selected','')
            if selected and selected not in {r['id'] for r in rows}:
                item=c.execute('SELECT * FROM submissions WHERE id=?',(selected,)).fetchone()
                if item:rows.append(item)
            reports=[dict(r) for r in c.execute("SELECT * FROM reports WHERE status='open'")]
        return jsonify(items=[serialize(dict(r),True) for r in rows],reports=reports,policy=policy(),user_id=user()['id'])

    @app.get('/api/review/<sid>/context/<int:index>')
    def context_video(sid,index):
        required_staff();row=submission(sid);items=json.loads(row['metadata']).get('context',[])
        item=next((i for i in items if i['index']==index),None)
        if not item:abort(404)
        return send_file(MEDIA/item['file'],conditional=True,mimetype='video/mp4')

    @app.post('/api/review/<sid>/claim')
    def claim(sid):
        required_staff()
        with db() as c:
            c.execute('BEGIN IMMEDIATE');r=c.execute('SELECT * FROM submissions WHERE id=?',(sid,)).fetchone()
            if not r:abort(404)
            if r['user_id']==user()['id']:abort(403,'Another reviewer must review your own creation.')
            if r['status'] not in ('submitted','in_review'):abort(409,'This item is no longer awaiting review.')
            if r['reviewer_id'] and r['reviewer_id']!=user()['id']:abort(409,'Another reviewer has claimed this item.')
            c.execute("UPDATE submissions SET status='in_review',reviewer_id=? WHERE id=?",(user()['id'],sid));event(c,sid,'claimed')
            notifications.clear_review(c,sid)
            notifications.add(c,user()['id'],'review_assigned','You claimed a creation for review.','/review?submission='+sid,sid)
        return jsonify(ok=True)

    @app.post('/api/review/<sid>/decision')
    def decision(sid):
        required_staff();v=payload();action=v.get('decision');note=str(v.get('note','')).strip()[:3000]
        if action not in ('approved','changes_requested','rejected','taken_down'):abort(400,'Choose a review decision.')
        with db() as c:
            c.execute('BEGIN IMMEDIATE');row=c.execute('SELECT * FROM submissions WHERE id=?',(sid,)).fetchone()
            if not row:abort(404)
            row=dict(row)
            if row['user_id']==user()['id']:abort(403,'Another reviewer must review your own creation.')
            if action=='taken_down':
                if row['status'] not in ('approved','published') or not note:abort(400,'An approved creation and a reason are required for removal.')
            elif row['status']!='in_review' or row['reviewer_id']!=user()['id']:abort(409,'Claim this item before deciding.')
            checks=v.get('checks',{})
            if action=='approved':
                p=json.loads(row['policy'])
                if not isinstance(checks,dict) or any(checks.get(x['id']) is not True for x in p['criteria']):abort(400,'Complete all review checks before approval.')
                if hashlib.sha256((MEDIA/row['path']).read_bytes()).hexdigest()!=row['digest']:abort(409,'The review file changed. Submit a new version.')
                if v.get('acknowledge_draft') is not True:abort(400,'Acknowledge that these are provisional rules.')
            elif not note:abort(400,'Explain the decision so the creator knows what to change.')
            c.execute('UPDATE submissions SET status=?,publish=0,decision_note=?,checks=? WHERE id=?',(action,note,json.dumps(checks),sid))
            if action=='taken_down':c.execute("UPDATE reports SET status='resolved' WHERE submission_id=?",(sid,))
            event(c,sid,action,note or ('Approved and returned to creator; awaiting their Publish action.' if action=='approved' else ''),{'checks':checks,'policy_version':json.loads(row['policy'])['version'],'creator_id':row['user_id']})
            notifications.clear_review(c,sid)
            titles={'approved':'Approved — your creation is ready to publish.','changes_requested':'Your creation has feedback to review.','rejected':'A review decision is available.','taken_down':'Your creation was removed from publication.'}
            notifications.add(c,row['user_id'],'review_decision',titles[action],'/share?project='+row['project_id'],sid,'decision:'+sid+':'+str(c.execute('SELECT max(id) FROM review_events').fetchone()[0]))
        return jsonify(ok=True)

    @app.post('/api/review/policy')
    def change_policy():
        if user()['role']!='admin':abort(403)
        rules=str(payload().get('rules','')).strip()
        if not 20<=len(rules)<=12000:abort(400,'Draft rules must contain 20–12,000 characters.')
        p={**policy(),'version':'draft-'+uuid.uuid4().hex[:8],'rules':rules}
        with db() as c:c.execute("INSERT INTO config VALUES('policy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps(p),))
        return jsonify(ok=True)

    return csrf

def any_users():
    with db() as c:return bool(c.execute("SELECT 1 FROM users WHERE role!='demo' LIMIT 1").fetchone())

def sign_in(uid):
    session.clear();session.permanent=True;session['sid']=secrets.token_urlsafe(32);session['csrf']=secrets.token_urlsafe(32)
    with db() as c:
        c.execute('DELETE FROM sessions WHERE expires<?',(time.time(),))
        c.execute('INSERT INTO sessions VALUES(?,?,?)',(session['sid'],uid,time.time()+12*3600))
