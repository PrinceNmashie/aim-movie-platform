"""Local administration. No preset accounts or passwords."""
import argparse
from getpass import getpass
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import uuid
from werkzeug.security import generate_password_hash
import creator_portal as portal
import store
import video_tools


def main():
    p=argparse.ArgumentParser(description='AIM.movie Creator Platform administration')
    sub=p.add_subparsers(dest='action',required=True)
    role=sub.add_parser('set-role');role.add_argument('--email',required=True);role.add_argument('--role',choices=['admin','reviewer','creator'],required=True)
    reset=sub.add_parser('reset-password');reset.add_argument('--email',required=True)
    imp=sub.add_parser('import-legacy');imp.add_argument('--email',required=True);imp.add_argument('--source',required=True);imp.add_argument('--name',default='Imported studio')
    sub.add_parser('seed-demo')
    args=p.parse_args();portal.init()
    if args.action in ('set-role','reset-password','import-legacy'):
        with portal.db() as c:r=c.execute('SELECT * FROM users WHERE email=?',(args.email.strip().casefold(),)).fetchone()
        if not r:raise SystemExit('Register that account in the website first.')
        if args.action=='set-role':
            with portal.db() as c:c.execute('UPDATE users SET role=? WHERE id=?',(args.role,r['id']))
            print('Account role updated.');return
        if args.action=='reset-password':
            password=getpass('New password (10–200 characters): ')
            if not 10<=len(password)<=200:raise SystemExit('Password length is invalid.')
            if password!=getpass('Repeat password: '):raise SystemExit('Passwords did not match.')
            with portal.db() as c:
                c.execute('UPDATE users SET password=? WHERE id=?',(generate_password_hash(password, method='pbkdf2:sha256:1000000'),r['id']))
                c.execute('DELETE FROM sessions WHERE user_id=?',(r['id'],))
            print('Password changed; existing sessions revoked.');return
        src=Path(args.source).expanduser().resolve()
        if not (src/'aim.sqlite').is_file():raise SystemExit('Select the old data directory containing aim.sqlite.')
        if (src/'platform.sqlite').exists():raise SystemExit('This is already a multi-user data directory. Back up and reuse it directly instead.')
        pid=portal.create_project(r['id'],args.name);dest=portal.project_dir(pid,r['id'])
        import sqlite3
        # SQLite backup captures a consistent database, including WAL changes.
        with sqlite3.connect((src/'aim.sqlite').as_uri()+'?mode=ro',uri=True) as source,sqlite3.connect(dest/'aim.sqlite') as target:source.backup(target)
        for item in src.iterdir():
            if item.name.startswith('aim.sqlite') or item.is_symlink():continue
            if item.is_dir():shutil.copytree(item,dest/item.name,dirs_exist_ok=True,symlinks=False)
            elif item.suffix.lower() in ('.mp4','.mov','.webm','.png','.jpg','.jpeg','.json'):shutil.copy2(item,dest/item.name)
        print('Imported as a new private project. Select it from your account page. Original data was not changed.');return
    seed_demo()


def seed_demo():
    with portal.db() as c:
        if c.execute("SELECT 1 FROM submissions WHERE title LIKE 'Demo · %' LIMIT 1").fetchone():print('Demo posts already exist.');return
        uid=uuid.uuid4().hex
        c.execute('INSERT INTO users(id,email,name,password,role,created) VALUES(?,?,?,?,?,?)',(uid,'demo-'+uid+'@example.invalid','AIM Demo',generate_password_hash(secrets.token_urlsafe(40), method='pbkdf2:sha256:1000000'),'demo',store.now()))
    pid=portal.create_project(uid,'Community demo fixtures')
    for title,color,tags in [('BLUE HOUR','#15253e',['cinematic','demo']),('FIRST CONTACT','#193b33',['sci-fi','demo']),('AFTER THE RAIN','#40232e',['mystery','demo'])]:
        sid=uuid.uuid4().hex;path=portal.MEDIA/(sid+'.mp4')
        # Deliberate motion-graphic placeholders, never represented as AI-generated films.
        vf="drawbox=x='40+15*t':y=70:w=110:h=110:color=white@0.12:t=fill"
        video_tools.run(['-f','lavfi','-i',f'color=c={color}:s=640x360:r=24:d=4','-vf',vf,'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',path])
        info=video_tools.probe(path);info['technical_precheck']='Bundled motion-graphic test fixture; not an AI-generated film.';info['context']=[]
        with portal.db() as c:
            c.execute('INSERT INTO submissions(id,user_id,project_id,title,description,tags,kind,status,path,digest,metadata,created,reviewer_id,policy,decision_note,checks,parent_id,publish,public_caption,published_at,published_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(sid,uid,pid,'Demo · '+title,'A motion-graphic placeholder for testing playback, reactions and the community feed. Upload your own creation to test the real review workflow.',json.dumps(tags),'clip','published',path.name,hashlib.sha256(path.read_bytes()).hexdigest(),json.dumps(info),store.now(),'demo',json.dumps(portal.policy()),'Demo fixture, not a staff quality evaluation.',json.dumps({x['id']:True for x in portal.POLICY['criteria']}),None,1,'A motion-graphic placeholder for testing playback, reactions and creator profiles. Not an AI-generated film.',store.now(),uid))
    print('Created three clearly labeled demo posts. No API requests or preset login credentials.')

if __name__=='__main__':main()
