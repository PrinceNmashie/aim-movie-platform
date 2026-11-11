"""Durable screening for the exact video and public details submitted to Discover."""

import hashlib
import json
import logging
import os
import time
import uuid

from werkzeug.exceptions import TooManyRequests

import moderation_client
import store


ACTOR = 'discover-screening'
PENDING = 'check_pending'
POLL_SECONDS = 12
POLL_LIMIT = 30 * 60
LEASE = 5 * 60
MAX_IN_FLIGHT = 20
LOG = logging.getLogger(__name__)


def portal():
    import creator_portal
    return creator_portal


def mode():
    value = os.getenv('AIM_DISCOVER_REVIEW_MODE', 'manual').strip().lower()
    return value if value in ('pilot', 'auto') else 'manual'


def configured():
    return os.getenv('AIM_ALLOW_PAID_API', '0') == '1' and moderation_client.configured()


def init(c):
    c.executescript('''
CREATE TABLE IF NOT EXISTS discover_checks(
    submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    mode TEXT NOT NULL,
    region TEXT NOT NULL,
    phase TEXT NOT NULL,
    verdict TEXT NOT NULL DEFAULT 'pending',
    reason TEXT NOT NULL DEFAULT '',
    evidence TEXT NOT NULL DEFAULT '[]',
    provider_task TEXT NOT NULL DEFAULT '',
    text_result TEXT NOT NULL DEFAULT '{}',
    due REAL NOT NULL,
    started REAL NOT NULL DEFAULT 0,
    lease_until REAL NOT NULL DEFAULT 0,
    owner TEXT NOT NULL DEFAULT '',
    poll_errors INTEGER NOT NULL DEFAULT 0,
    auto_approved INTEGER NOT NULL DEFAULT 0,
    spot_check INTEGER NOT NULL DEFAULT 0,
    audited_at TEXT
);
CREATE INDEX IF NOT EXISTS discover_check_due ON discover_checks(phase,due);
CREATE INDEX IF NOT EXISTS review_event_submission_action ON review_events(submission_id,action);
CREATE INDEX IF NOT EXISTS submission_media_history ON submissions(user_id,digest,status);
''')


def fingerprint(row):
    public = [row['digest'], row['title'], row['public_caption'], json.loads(row['tags'] or '[]'),
              json.loads(row['policy'])['version']]
    return hashlib.sha256(json.dumps(public, ensure_ascii=False).encode()).hexdigest()


def video_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def enqueue(c, sid, selected_mode):
    """Record the check in the same transaction that creates the submission."""
    if selected_mode == 'manual':
        return False
    row = c.execute('SELECT * FROM submissions WHERE id=?', (sid,)).fetchone()
    reason = ''
    if not configured():
        reason = 'Automatic checks are unavailable. Staff can review this submission.'
    else:
        try:
            portal().paid_gate(connection=c)
        except TooManyRequests:
            reason = 'The daily API action limit was reached. Staff can review this submission.'
    c.execute('''INSERT INTO discover_checks(submission_id,fingerprint,mode,region,phase,verdict,reason,due)
                 VALUES(?,?,?,?,?,?,?,?)''',
              (sid, fingerprint(row), selected_mode, moderation_client.region(),
               'complete' if reason else 'queued', 'unavailable' if reason else 'pending', reason, time.time()))
    if reason:
        portal().event(c, sid, 'check_unavailable', reason, actor_id=ACTOR)
        return False
    c.execute("UPDATE submissions SET status=? WHERE id=?", (PENDING, sid))
    return True


def summary(c, sid, *, staff_details=False):
    row = c.execute('SELECT * FROM discover_checks WHERE submission_id=?', (sid,)).fetchone()
    if row is None:
        return None
    summary = {'verdict': row['verdict'], 'reason': row['reason'], 'automatic': bool(row['auto_approved'])}
    if staff_details:
        summary.update(mode=row['mode'], evidence=json.loads(row['evidence']),
                       spot_check=bool(row['spot_check'] and not row['audited_at']))
    return summary


def is_auto_approved(c, row):
    check = c.execute("""SELECT fingerprint FROM discover_checks
                         WHERE submission_id=? AND phase='complete' AND auto_approved=1 AND verdict='clear'""",
                      (row['id'],)).fetchone()
    return bool(check and check['fingerprint'] == fingerprint(row))


def cancel(c, sid):
    c.execute("""UPDATE discover_checks SET phase='complete',verdict='withdrawn',owner='',lease_until=0
                 WHERE submission_id=? AND phase!='complete'""", (sid,))


def previously_removed(c, row):
    return bool(c.execute("""SELECT 1 FROM submissions s JOIN review_events e ON e.submission_id=s.id
                             WHERE s.user_id=? AND s.digest=? AND e.action IN ('taken_down','rejected')
                             LIMIT 1""",
                          (row['user_id'], row['digest'])).fetchone())


def reopen_related_clearances(c, row):
    """A new staff decision takes precedence over an earlier automatic clearance."""
    p = portal()
    reason = 'Staff need to review this version because an earlier submission used the same video.'
    pending = c.execute("""SELECT s.* FROM submissions s JOIN discover_checks m ON s.id=m.submission_id
                           WHERE s.user_id=? AND s.digest=? AND s.status='approved' AND m.auto_approved=1""",
                        (row['user_id'], row['digest'])).fetchall()
    for item in pending:
        c.execute("UPDATE submissions SET status='submitted' WHERE id=?", (item['id'],))
        c.execute('UPDATE discover_checks SET auto_approved=0,spot_check=0,reason=? WHERE submission_id=?',
                  (reason, item['id']))
        p.event(c, item['id'], 'staff_review_required', reason, actor_id=ACTOR)
        p.notifications.review_available(c, item['id'], item['user_id'], bool(item['parent_id']))


def claim():
    now = time.time()
    owner = uuid.uuid4().hex
    with portal().db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('''
SELECT s.*, m.fingerprint, m.mode AS check_mode, m.region, m.phase, m.provider_task,
       m.text_result, m.poll_errors, m.started
FROM discover_checks m JOIN submissions s ON s.id=m.submission_id
WHERE s.status=? AND m.phase!='complete' AND m.due<=? AND m.lease_until<=?
  AND (m.phase!='queued' OR (
    SELECT count(*) FROM discover_checks d JOIN submissions ds ON ds.id=d.submission_id
    WHERE ds.status=? AND d.phase IN ('starting','waiting')
  )<?)
ORDER BY m.due,m.rowid LIMIT 1
''', (PENDING, now, now, PENDING, MAX_IN_FLIGHT)).fetchone()
        if not row:
            return None
        c.execute('''UPDATE discover_checks SET owner=?,lease_until=?,
                      started=CASE WHEN phase='queued' THEN ? ELSE started END,
                      phase=CASE WHEN phase='queued' THEN 'starting' ELSE phase END
                      WHERE submission_id=?''', (owner, now + LEASE, now, row['id']))
        return {**dict(row), 'owner': owner}


def wait_for_result(job, *, task=None, text=None, errors=0, delay=POLL_SECONDS):
    with portal().db() as c:
        c.execute('''UPDATE discover_checks
                     SET phase='waiting',provider_task=?,text_result=?,poll_errors=?,due=?,owner='',lease_until=0
                     WHERE submission_id=? AND owner=?''',
                  (task or job['provider_task'], json.dumps(text) if text is not None else job['text_result'],
                   errors, time.time() + delay, job['id'], job['owner']))


def finish(job, verdict, reason, findings=()):
    p = portal()
    sid = job['id']
    with p.db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('''SELECT s.* FROM submissions s JOIN discover_checks m ON m.submission_id=s.id
                           WHERE s.id=? AND s.status=? AND m.owner=?''', (sid, PENDING, job['owner'])).fetchone()
        if not row:
            return
        if fingerprint(row) != job['fingerprint']:
            verdict = 'file_problem'
            reason = 'The submitted details changed. Submit a new version to check it.'
            findings = ()
        automatic = verdict == 'clear' and job['check_mode'] == mode() == 'auto' and configured()
        if automatic and previously_removed(c, row):
            automatic = False
            reason = 'Staff need to review this version because an earlier submission used the same video.'
        status = 'approved' if automatic else 'changes_requested' if verdict == 'file_problem' else 'submitted'
        if automatic:
            reason = 'Checks complete. Preview your creation and publish when you are ready.'
        c.execute('''UPDATE discover_checks SET phase='complete',verdict=?,reason=?,evidence=?,
                     auto_approved=?,owner='',lease_until=0 WHERE submission_id=?''',
                  (verdict, reason, json.dumps(list(findings)[:12]), int(automatic), sid))
        c.execute('UPDATE submissions SET status=?,decision_note=? WHERE id=?',
                  (status, reason if verdict == 'file_problem' else '', sid))
        p.event(c, sid, 'automatic_clearance' if automatic else 'check_' + verdict, reason,
                {'mode': job['check_mode'], 'policy_version': json.loads(row['policy'])['version']},
                actor_id=ACTOR)
        if status == 'submitted':
            p.notifications.review_available(c, sid, row['user_id'], bool(row['parent_id']))


def run_once():
    job = claim()
    if not job:
        return False
    fallback = 'The automatic check could not finish. Staff can review this submission.'
    if mode() == 'manual' or not configured() or job['region'] != moderation_client.region():
        finish(job, 'unavailable', fallback)
    elif job['phase'] == 'queued':
        start(job, fallback)
    elif job['phase'] == 'starting' or time.time() - job['started'] >= POLL_LIMIT:
        # A lost submission response may have been billed. Only poll known task IDs.
        finish(job, 'unavailable', fallback)
    else:
        poll(job, fallback)
    return True


def start(job, fallback):
    path = portal().MEDIA / job['path']
    try:
        matches = video_digest(path) == job['digest']
    except OSError:
        matches = False
    if not matches:
        finish(job, 'file_problem', 'The submitted video is missing or changed. Choose the video again and resubmit.')
        return
    with portal().db() as c:
        active = c.execute('SELECT 1 FROM discover_checks WHERE submission_id=? AND owner=?',
                           (job['id'], job['owner'])).fetchone()
    if not active:
        return
    text = '\n'.join([job['title'], job['public_caption'], ' '.join(json.loads(job['tags'] or '[]'))]).strip()
    try:
        task, text_result = moderation_client.start(path, job['id'], text, job['region'])
    except Exception as exc:
        log_problem(job, 'start', exc)
        finish(job, 'unavailable', fallback)
        return
    wait_for_result(job, task=task, text=text_result)


def poll(job, fallback):
    meta = json.loads(job['metadata'])
    try:
        video = moderation_client.result(job['provider_task'], job['id'], job['region'],
                                         has_audio=meta['has_audio'], duration=meta['duration_seconds'])
    except Exception as exc:
        errors = job['poll_errors'] + 1
        if errors >= 4:
            log_problem(job, 'poll', exc)
            finish(job, 'unavailable', fallback)
        else:
            wait_for_result(job, errors=errors, delay=POLL_SECONDS * (2 ** errors))
        return
    if video is None:
        wait_for_result(job)
        return
    text = json.loads(job['text_result'])
    clear = video['risk'] == text['risk'] == 'none'
    reason = ('The automated check found no flags. A staff decision is required for this submission.' if clear
              else 'A policy flag needs a staff decision.')
    finish(job, 'clear' if clear else 'flagged', reason, video['findings'] + text['findings'])


def log_problem(job, step, exc):
    # SDK errors can contain URLs, content, or credentials. Use fixed messages and types.
    detail = str(exc) if isinstance(exc, moderation_client.ModerationError) else type(exc).__name__
    LOG.warning('Discover check %s could not %s: %s', job['id'], step, detail)
