"""Single-user persistence; compatible with original studio databases."""
import datetime
from contextvars import ContextVar
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

BASE = Path(__file__).resolve().parent
from dotenv import load_dotenv
load_dotenv(BASE / ".env")
DATA = Path(os.environ.get('AIM_DATA_DIR', str(BASE / 'data'))).resolve()
DATA.mkdir(parents=True, exist_ok=True)
_SCOPE = ContextVar("aim_scope", default=None)

def set_scope(path):
    return _SCOPE.set(Path(path).resolve())

def reset_scope(token):
    _SCOPE.reset(token)

def data_dir():
    path = _SCOPE.get() or DATA
    path.mkdir(parents=True, exist_ok=True)
    return path

def db_path():
    return data_dir() / "aim.sqlite" if _SCOPE.get() else DB

def archive_dir():
    path = data_dir() / "project_archives" if _SCOPE.get() else ARCHIVES
    path.mkdir(parents=True, exist_ok=True)
    return path

DB = DATA / 'aim.sqlite'
ARCHIVES = DATA / 'project_archives'
ARCHIVES.mkdir(exist_ok=True)

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')

@contextmanager
def connect():
    c = sqlite3.connect(db_path(), timeout=30)
    try:
        c.execute('CREATE TABLE IF NOT EXISTS project_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        c.execute('CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, content TEXT, created TEXT)')
        c.execute('CREATE TABLE IF NOT EXISTS creative_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT, layer TEXT, description TEXT)')
        c.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, created TEXT, prompt TEXT, status TEXT, output TEXT, asset TEXT)')
        c.execute('CREATE TABLE IF NOT EXISTS studio_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        c.execute('CREATE TABLE IF NOT EXISTS usage_ledger(id TEXT PRIMARY KEY,feature TEXT,provider TEXT,model TEXT,request_id TEXT,started TEXT,finished TEXT,status TEXT,usage TEXT)')
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()

def get(key, default=None):
    with connect() as c:
        row = c.execute('SELECT value FROM project_state WHERE key=?', (key,)).fetchone()
    if row:
        try:
            return json.loads(row[0])
        except json.JSONDecodeError:
            pass
    return default

def put(key, value):
    with connect() as c:
        c.execute('INSERT INTO project_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, json.dumps(value, ensure_ascii=False)))

def settings():
    with connect() as c:
        return {key: json.loads(value) for key, value in c.execute('SELECT key,value FROM studio_settings')}

def save_settings(values):
    with connect() as c:
        for key, value in values.items():
            c.execute('INSERT INTO studio_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, json.dumps(value)))

def messages():
    with connect() as c:
        return [{'id': i, 'role': r, 'content': v} for i, r, v in c.execute('SELECT id,role,content FROM chat_messages ORDER BY id')]

def append_message(role, content):
    with connect() as c:
        c.execute('INSERT INTO chat_messages(role,content,created) VALUES (?,?,?)', (role, content, now()))

def record(layer, description):
    with connect() as c:
        c.execute('INSERT INTO creative_actions(created,layer,description) VALUES (?,?,?)', (now(), layer, description))

def actions():
    with connect() as c:
        return c.execute('SELECT created,layer,description FROM creative_actions ORDER BY id DESC').fetchall()

def save_job(jobid, prompt, stage, output='', asset=''):
    with connect() as c:
        c.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, output=excluded.output, asset=excluded.asset', (jobid, now(), prompt, stage, output, asset))

def jobs():
    with connect() as c:
        return c.execute('SELECT id,created,prompt,status,output,asset FROM jobs ORDER BY created DESC, rowid DESC').fetchall()

def archived_projects():
    return sorted(archive_dir().glob('project_*.sqlite'), key=lambda p: p.stat().st_mtime, reverse=True)

def archive_label(value, allow_blank=False):
    label = str(value or '').strip()
    if not label and not allow_blank:
        raise ValueError('Give this saved version a name.')
    if len(label) > 120:
        raise ValueError('Use a version name with 120 characters or fewer.')
    return label

def archived_project_details():
    labels = settings().get('archive_labels', {})
    result = []
    for path in archived_projects():
        title = 'Untitled movie'
        try:
            with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as c:
                row = c.execute("SELECT value FROM project_state WHERE key='vision'").fetchone()
                title = str(json.loads(row[0]).get('title') or title) if row else title
        except (sqlite3.Error, json.JSONDecodeError, AttributeError):
            pass
        result.append({'id': path.name, 'name': labels.get(path.name) or title, 'title': title,
                       'created': datetime.datetime.fromtimestamp(path.stat().st_mtime, datetime.timezone.utc).isoformat()})
    return result

def rename_archive(archive_name, label):
    if archive_name not in {p.name for p in archived_projects()}:
        raise ValueError('That saved version could not be found.')
    label = archive_label(label)
    labels = settings().get('archive_labels', {})
    labels[archive_name] = label
    save_settings({'archive_labels': labels})

def snapshot(target):
    with connect() as source, sqlite3.connect(target) as dest:
        source.backup(dest)

def archive_project(label=''):
    label = archive_label(label, allow_blank=True) or str(get('vision', {}).get('title') or 'Untitled movie')[:120]
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    backup = archive_dir() / f'project_{stamp}.sqlite'
    snapshot(backup)
    labels = settings().get('archive_labels', {})
    labels[backup.name] = label
    save_settings({'archive_labels': labels})
    return backup

def new_project(archive_name=''):
    backup = archive_project(archive_name)
    with connect() as c:
        for table in ('project_state', 'chat_messages', 'creative_actions', 'jobs', 'usage_ledger'):
            c.execute(f'DELETE FROM {table}')
    return backup

def restore_project(archive_name, current_label=''):
    matches = {p.name: p for p in archived_projects()}
    if archive_name not in matches:
        raise ValueError('That saved project could not be found.')
    backup = new_project(current_label)
    current_settings = settings()
    with sqlite3.connect(matches[archive_name]) as source, connect() as target:
        source.backup(target)
    with connect() as c:
        c.execute('DELETE FROM studio_settings')
    save_settings(current_settings)
    return backup
