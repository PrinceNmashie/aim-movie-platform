"""Durable private inbox and opt-in, verified SMTP delivery. No browser permission needed."""
import datetime as dt
import hashlib
import json
import os
import secrets
import smtplib
import ssl
import time
import uuid
from email.message import EmailMessage
from urllib.parse import urlparse
from flask import abort, jsonify, redirect, request
import store

EVENTS = {'clip_ready'}
STAFF_EVENTS = {'review_available', 'review_assigned', 'review_reminder'}

def portal():
    import creator_portal
    return creator_portal

def init(c):
    c.executescript('''
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,link TEXT NOT NULL,subject TEXT NOT NULL,created TEXT NOT NULL,read_at TEXT,dedupe TEXT NOT NULL,UNIQUE(user_id,dedupe));
CREATE INDEX IF NOT EXISTS inbox_user ON notifications(user_id,created);
CREATE TABLE IF NOT EXISTS notification_preferences(user_id TEXT PRIMARY KEY,events TEXT NOT NULL,email_enabled INTEGER NOT NULL DEFAULT 0,frequency TEXT NOT NULL DEFAULT 'instant',verified INTEGER NOT NULL DEFAULT 0,verify_hash TEXT,verify_expires REAL);
CREATE TABLE IF NOT EXISTS notification_email(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,notification_id TEXT,verification_link TEXT,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_attempt REAL NOT NULL,lease_until REAL,last_error TEXT);
''')

def settings(uid, c=None):
    if c is None:
        with portal().db() as c:return settings(uid,c)
    row=c.execute('SELECT * FROM notification_preferences WHERE user_id=?',(uid,)).fetchone()
    previous = json.loads(row['events']) if row else ['clip_ready']
    events = ['clip_ready'] if 'clip_ready' in previous or 'creation_ready' in previous else []
    return {'events':events,
            'email_enabled':bool(row and row['email_enabled']), 'frequency':row['frequency'] if row else 'instant',
            'verified':bool(row and row['verified']), 'email_available':email_available()}

def email_available():
    base=os.getenv('AIM_PUBLIC_URL','').rstrip('/')
    return bool(os.getenv('AIM_SMTP_HOST') and os.getenv('AIM_EMAIL_FROM') and urlparse(base).scheme=='https' and urlparse(base).netloc)

def add(c,uid,kind,title,link,subject='',dedupe=None):
    if kind != 'clip_ready':return
    prefs=settings(uid,c)
    if kind not in prefs['events']:return
    account=c.execute('SELECT role FROM users WHERE id=?',(uid,)).fetchone()
    if not account or (kind in STAFF_EVENTS and account['role'] not in ('admin','reviewer')):return
    nid=uuid.uuid4().hex
    changed=c.execute('INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,?,?,NULL,?)',
              (nid,uid,kind,title,link,subject,store.now(),dedupe or kind+':'+subject)).rowcount
    if changed and prefs['email_enabled'] and prefs['verified']:
        when=time.time() if prefs['frequency']=='instant' else (int(time.time()//86400)+1)*86400
        c.execute('INSERT INTO notification_email(id,user_id,notification_id,next_attempt) VALUES(?,?,?,?)',(uuid.uuid4().hex,uid,nid,when))

def review_available(c,sid,owner,revised=False):
    revision=c.execute('SELECT COALESCE(max(id),0) FROM review_events WHERE submission_id=?',(sid,)).fetchone()[0]
    for r in c.execute("SELECT id FROM users WHERE role IN ('admin','reviewer') AND id!=?",(owner,)).fetchall():
        add(c,r['id'],'review_available','A revised creation is ready for review.' if revised else 'A new creation is ready for review.', '/review?submission='+sid,sid,'available:'+sid+':'+str(revision))

def clear_review(c,sid):
    c.execute("UPDATE notifications SET read_at=? WHERE subject=? AND kind IN ('review_available','review_assigned','review_reminder') AND read_at IS NULL",(store.now(),sid))
    c.execute("DELETE FROM notification_email WHERE notification_id IN (SELECT id FROM notifications WHERE subject=? AND kind IN ('review_available','review_assigned','review_reminder')) AND status='queued'",(sid,))

def task_event(uid,tid,title,link,failed=False):
    with portal().db() as c:add(c,uid,'creation_failed' if failed else 'creation_ready',title,link,tid,'task:'+tid)

def valid_notice(c,n):
    if n['kind'] != 'clip_ready':return False
    account=c.execute('SELECT role FROM users WHERE id=?',(n['user_id'],)).fetchone()
    if not account:return False
    if n['kind'] not in STAFF_EVENTS:return True
    if account['role'] not in ('admin','reviewer'):return False
    s=c.execute('SELECT user_id,status,reviewer_id FROM submissions WHERE id=?',(n['subject'],)).fetchone()
    if not s or s['user_id']==n['user_id']:return False
    return s['status']=='submitted' if n['kind']=='review_available' else s['status']=='in_review' and s['reviewer_id']==n['user_id']

def reminders():
    cutoff=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=24)).isoformat(timespec='seconds')
    with portal().db() as c:
        rows=c.execute("SELECT id,user_id,reviewer_id FROM submissions s WHERE status='in_review' AND COALESCE((SELECT max(created) FROM review_events e WHERE e.submission_id=s.id AND e.action='claimed'),s.created)<?",(cutoff,)).fetchall()
        for r in rows:
            if r['reviewer_id'] and r['reviewer_id']!=r['user_id']:
                add(c,r['reviewer_id'],'review_reminder','Your claimed review is awaiting a decision.','/review?submission='+r['id'],r['id'],'reminder:'+r['id']+':'+store.now()[:10])

def deliver_once():
    """Claim a bounded batch. Delivery failure never rolls back a review or generation."""
    if not email_available():return
    now=time.time();owner=uuid.uuid4().hex
    with portal().db() as c:
        c.execute('BEGIN IMMEDIATE')
        c.execute("UPDATE notification_email SET status='queued' WHERE status='sending' AND lease_until<?",(now,))
        first=c.execute("SELECT user_id FROM notification_email WHERE status='queued' AND next_attempt<=? ORDER BY next_attempt LIMIT 1",(now,)).fetchone()
        if not first:return
        uid=first['user_id'];account=c.execute('SELECT email FROM users WHERE id=?',(uid,)).fetchone()
        if not account:
            c.execute('DELETE FROM notification_email WHERE user_id=?',(uid,));return
        rows=c.execute("SELECT * FROM notification_email WHERE user_id=? AND status='queued' AND next_attempt<=? LIMIT 30",(uid,now)).fetchall()
        usable=[]
        for r in rows:
            n=c.execute('SELECT * FROM notifications WHERE id=?',(r['notification_id'],)).fetchone() if r['notification_id'] else None
            prefs=settings(uid,c)
            if not r['verification_link'] and (not n or not valid_notice(c,n) or not prefs['email_enabled'] or not prefs['verified'] or n['kind'] not in prefs['events']):
                c.execute('DELETE FROM notification_email WHERE id=?',(r['id'],));continue
            c.execute("UPDATE notification_email SET status='sending',lease_until=? WHERE id=?",(now+120,r['id']))
            usable.append((dict(r),dict(n) if n else None))
        address=account['email']
    if not usable:return
    msg=EmailMessage();msg['From']=os.environ['AIM_EMAIL_FROM'];msg['To']=address
    verification=next((r['verification_link'] for r,n in usable if r['verification_link']),None)
    msg['Subject']='Confirm AIM.movie email notifications' if verification else 'You have updates on AIM.movie'
    # No private titles, prompts, media, or review notes leave the authenticated site.
    msg.set_content(('Confirm that you want email notifications:\n'+verification+'\nThis link expires in one hour.') if verification else
                    '\n'.join(n['title'] for r,n in usable if n)+'\n\nView your updates after signing in:\n'+os.environ['AIM_PUBLIC_URL'].rstrip('/')+'/account/notifications')
    try:
        port=int(os.getenv('AIM_SMTP_PORT','587'));mode=os.getenv('AIM_SMTP_SECURITY','starttls')
        if mode not in ('starttls','ssl'):raise ValueError('Configure encrypted SMTP.')
        factory=smtplib.SMTP_SSL if mode=='ssl' else smtplib.SMTP
        kwargs={'context':ssl.create_default_context()} if mode=='ssl' else {}
        with factory(os.environ['AIM_SMTP_HOST'],port,timeout=15,**kwargs) as smtp:
            if mode=='starttls':smtp.starttls(context=ssl.create_default_context())
            if os.getenv('AIM_SMTP_USERNAME'):smtp.login(os.environ['AIM_SMTP_USERNAME'],os.getenv('AIM_SMTP_PASSWORD',''))
            smtp.send_message(msg)
    except Exception:
        with portal().db() as c:
            for r,n in usable:
                attempts=r['attempts']+1
                c.execute("UPDATE notification_email SET status=?,attempts=?,next_attempt=?,last_error='Email delivery unavailable',verification_link=CASE WHEN ?>=5 THEN NULL ELSE verification_link END WHERE id=?",
                          ('failed' if attempts>=5 else 'queued',attempts,now+min(3600,60*2**attempts),attempts,r['id']))
    else:
        with portal().db() as c:
            for r,n in usable:c.execute('DELETE FROM notification_email WHERE id=?',(r['id'],))

def install(app):
    @app.get('/api/account/notifications')
    def inbox():
        uid=portal().user()['id']
        try:offset=max(0,int(request.args.get('offset',0)))
        except ValueError:abort(400,'Invalid page.')
        with portal().db() as c:
            for n in c.execute("SELECT * FROM notifications WHERE user_id=? AND kind IN ('review_available','review_assigned','review_reminder') AND read_at IS NULL",(uid,)).fetchall():
                if not valid_notice(c,n):c.execute('UPDATE notifications SET read_at=? WHERE id=?',(store.now(),n['id']))
            rows=c.execute("SELECT id,kind,title,link,created,read_at FROM notifications WHERE user_id=? AND kind='clip_ready' ORDER BY created DESC,rowid DESC LIMIT 20 OFFSET ?",(uid,offset)).fetchall()
            total=c.execute("SELECT count(*) FROM notifications WHERE user_id=? AND kind='clip_ready'",(uid,)).fetchone()[0]
            unread=c.execute("SELECT count(*) FROM notifications WHERE user_id=? AND kind='clip_ready' AND read_at IS NULL",(uid,)).fetchone()[0]
        return jsonify(items=[dict(r) for r in rows],unread=unread,next_offset=offset+20 if offset+20<total else None)

    @app.post('/api/account/notifications/read')
    def mark_read():
        value=portal().payload();nid=value.get('id');uid=portal().user()['id']
        with portal().db() as c:
            if nid:c.execute('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?',(store.now(),str(nid),uid))
            else:c.execute('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL',(store.now(),uid))
        return jsonify(ok=True)

    @app.route('/api/account/notification-preferences',methods=['GET','POST'])
    def preferences():
        uid=portal().user()['id']
        if request.method=='GET':return jsonify(settings(uid))
        v=portal().payload();events=v.get('events');frequency=v.get('frequency','instant');enabled=v.get('email_enabled',False)
        if not isinstance(events,list) or any(not isinstance(x,str) or x not in EVENTS for x in events) or frequency not in ('instant','daily') or not isinstance(enabled,bool):abort(400,'Choose valid notification preferences.')
        current=settings(uid)
        if enabled and not current['verified']:abort(409,'Confirm your email before enabling email notifications.')
        if enabled and not email_available():abort(409,'Email notifications are not available yet.')
        with portal().db() as c:
            c.execute('INSERT INTO notification_preferences(user_id,events,email_enabled,frequency) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET events=excluded.events,email_enabled=excluded.email_enabled,frequency=excluded.frequency',
                      (uid,json.dumps(sorted(set(events))),int(enabled),frequency))
            if not enabled:c.execute('DELETE FROM notification_email WHERE user_id=? AND notification_id IS NOT NULL',(uid,))
        return jsonify(ok=True)

    @app.post('/api/account/notification-email/verify')
    def send_verification():
        uid=portal().user()['id'];portal().throttle('notification-verify:'+uid,3,3600)
        if not email_available():abort(409,'Email notifications are not available yet.')
        secret=secrets.token_urlsafe(32);digest=hashlib.sha256(secret.encode()).hexdigest()
        with portal().db() as c:
            c.execute('INSERT INTO notification_preferences(user_id,events,verify_hash,verify_expires) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET verify_hash=excluded.verify_hash,verify_expires=excluded.verify_expires',
                      (uid,json.dumps(sorted(EVENTS)),digest,time.time()+3600))
            c.execute('DELETE FROM notification_email WHERE user_id=? AND verification_link IS NOT NULL',(uid,))
            c.execute('INSERT INTO notification_email(id,user_id,verification_link,next_attempt) VALUES(?,?,?,?)',(uuid.uuid4().hex,uid,os.environ['AIM_PUBLIC_URL'].rstrip('/')+'/account/notifications/verify?token='+secret,time.time()))
        return jsonify(ok=True)

    @app.get('/account/notifications/verify')
    def confirm_email():
        digest=hashlib.sha256(str(request.args.get('token','')).encode()).hexdigest()
        with portal().db() as c:
            changed=c.execute('UPDATE notification_preferences SET verified=1,email_enabled=1,verify_hash=NULL,verify_expires=NULL WHERE verify_hash=? AND verify_expires>?',(digest,time.time())).rowcount
        if not changed:abort(400,'This confirmation link expired or was already used. Request another from Account settings.')
        return redirect('/account/settings?email=verified')
