"""Read saved movie summaries without opening or modifying their workspaces."""
import datetime as dt
from contextlib import closing
import json
from pathlib import Path
import sqlite3
from urllib.parse import quote


def movie_summary(project, directory, shared=False):
    directory = Path(directory)
    database = directory / 'aim.sqlite'
    state, jobs, has_messages = {}, [], False
    updated = project['created']
    if database.is_file():
        try:
            with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=5)) as connection:
                tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if 'project_state' in tables:
                    keys = ('vision', 'workflow_meta', 'characters', 'ensemble', 'job_meta', 'assemblies')
                    for key, raw in connection.execute('SELECT key,value FROM project_state WHERE key IN (?,?,?,?,?,?)', keys):
                        try:
                            state[key] = json.loads(raw)
                        except (TypeError, ValueError):
                            pass
                if 'chat_messages' in tables:
                    has_messages = bool(connection.execute('SELECT 1 FROM chat_messages LIMIT 1').fetchone())
                if 'jobs' in tables:
                    jobs = connection.execute('SELECT id,status,asset FROM jobs ORDER BY created DESC,rowid DESC').fetchall()
            updated = dt.datetime.fromtimestamp(database.stat().st_mtime, dt.timezone.utc).isoformat()
        except (sqlite3.Error, OSError):
            # One unavailable database must not hide the user's other movies.
            pass

    vision = state.get('vision') if isinstance(state.get('vision'), dict) else {}
    workflow = state.get('workflow_meta') if isinstance(state.get('workflow_meta'), dict) else {}
    approved = workflow.get('approved') or {}
    stale = workflow.get('stale') or []
    ready = lambda stage: isinstance(approved, dict) and bool(approved.get(stage)) and stage not in stale
    stage, page, next_step, action = 'Develop', 'idea', 'Tell MIA your movie idea', 'Start your movie'
    if has_messages or vision.get('logline'):
        page, next_step, action = 'brief', 'Complete your creative brief', 'Continue creative brief'
    if ready('vision'):
        stage, page, next_step, action = 'Plan', 'characters', 'Shape your cast', 'Continue your characters'
        if ready('characters'):
            page, next_step, action = 'script', 'Review your script', 'Continue your script'
        if ready('characters') and ready('script'):
            page, next_step, action = 'shots', 'Review your shot plan', 'Continue shot planning'
        if all(ready(key) for key in ('characters', 'script', 'director')):
            stage, page, next_step, action = 'Produce', 'render', 'Bring your next shot to life', 'Continue rendering'
    saved_clips = [row for row in jobs if row[1] == 'COMPLETED' and row[2]]
    if stage == 'Produce' and saved_clips:
        page, next_step, action = 'library', 'Review your clips and build a scene', 'Open your clips'
    if shared or state.get('assemblies'):
        stage, page, next_step, action = 'Share', 'share', 'Review your movie for publication', 'Continue to sharing'

    covers = []
    job_meta = state.get('job_meta') if isinstance(state.get('job_meta'), dict) else {}
    for job_id, _, _ in jobs:
        details = job_meta.get(job_id) or {}
        if isinstance(details, dict):
            covers.append(details.get('last_frame'))
    ensemble = state.get('ensemble') if isinstance(state.get('ensemble'), dict) else {}
    characters = state.get('characters') or {}
    characters = characters.get('characters', []) if isinstance(characters, dict) else characters
    for source in [ensemble, *(characters if isinstance(characters, list) else [])]:
        if not isinstance(source, dict):
            continue
        variants = source.get('images') or []
        covers.extend(image.get('path') for image in variants
                      if isinstance(image, dict) and image.get('id') == source.get('current_image'))
    cover_url = None
    assets = (directory / 'assets').resolve()
    for value in covers:
        if not isinstance(value, str) or not value:
            continue
        path = (assets / Path(value).name).resolve()
        if path.parent == assets and path.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'} and path.is_file():
            cover_url = f"/api/platform/projects/{project['id']}/cover/{quote(path.name, safe='')}?v={path.stat().st_mtime_ns}"
            break
    return {
        'id': project['id'], 'title': str(vision.get('title') or project['name']),
        'description': str(vision.get('logline') or 'A new story, ready for your direction.'),
        'created': project['created'], 'updated': updated, 'stage': stage,
        'next_page': page, 'next_step': next_step, 'action': action,
        'url': f"/{page}?project={project['id']}", 'cover_url': cover_url,
    }
