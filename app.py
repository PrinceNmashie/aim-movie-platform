"""AIM.movie local website. Run with: python app.py"""
import argparse
import functools
import hashlib
import io
import json
import os
import re
import secrets
import tempfile
import threading
import uuid
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_file, send_from_directory
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.exceptions import HTTPException
import ai_layers
import runway_client
import runway_models
import store
import studio
import video_tools
import video_providers
import wan_client
import background_tasks
import notifications
import usage_ledger

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
def assets_dir():
    path = store.data_dir() / "assets"
    path.mkdir(exist_ok=True)
    return path
app = Flask(__name__)
app.config.update(MAX_CONTENT_LENGTH=260 * 1024 * 1024, AIM_TOKEN=secrets.token_urlsafe(32))
LOCK = threading.RLock()
TEXT_MODELS = ['gpt-5.4-mini', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4.1']
IMAGE_MODELS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1']

def cfg(name):
    return os.getenv(name, '').strip()

def configured(name):
    value = cfg(name)
    return bool(value and not value.startswith(('your_', 'paste_')))

def alibaba_key():
    return cfg('ALIBABA_API_KEY') or cfg('DASHSCOPE_API_KEY')

def alibaba_configured(prefs=None):
    prefs = prefs or preferences()
    try:
        wan_client.endpoint(prefs['wan_workspace'], prefs['wan_region'])
        return bool(alibaba_key() and not alibaba_key().startswith(('your_', 'paste_')))
    except ValueError:
        return False

def preferences():
    saved = store.settings()
    return {'model': saved.get('model') or cfg('OPENAI_MODEL') or TEXT_MODELS[0],
            'image_model': saved.get('image_model') or cfg('OPENAI_IMAGE_MODEL') or IMAGE_MODELS[0],
            'image_quality': saved.get('image_quality', 'medium'), **video_providers.defaults(saved, cfg)}

def fitting_duration(value):
    prefs = preferences()
    if prefs['video_provider'] == 'runway': return runway_models.fit_duration(prefs, value)
    limits = video_providers.limits(prefs)
    try: value = round(float(value))
    except (TypeError, ValueError, OverflowError): value = 5
    return max(limits['min_duration'], min(limits['max_duration'], value))


def body():
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        raise ValueError('Send a valid form object.')
    return value

def mutation(fn):
    @functools.wraps(fn)
    def wrapped(*args, **kwargs):
        if not secrets.compare_digest(request.headers.get('X-AIM-Token', ''), security_token()):
            return jsonify(error='Refresh this page before making changes.'), 403
        origin = request.headers.get('Origin')
        if origin and urlparse(origin).netloc != request.host:
            return jsonify(error='Changes must come from the studio website.'), 403
        with background_tasks.project_lock():
            if request.headers.get('X-Workspace-ID') != studio.workspace_id():
                return jsonify(error='This project changed in another tab. Refresh before editing.'), 409
            return fn(*args, **kwargs)
    return wrapped

def error_message(exc):
    # OpenAI exceptions can contain the caller's invalid key. Never echo it to the browser.
    name = type(exc).__name__
    if not creator_portal.is_admin() and name in ('AuthenticationError', 'RateLimitError'):
        return 'MIA is temporarily unavailable. Please try again later.'
    if name == 'AuthenticationError':
        return 'OpenAI rejected the API key. Check OPENAI_API_KEY in .env and restart.'
    if name == 'RateLimitError':
        return 'OpenAI reached a rate or billing limit. Check your API balance, then retry.'
    if name == 'NotFoundError':
        return 'This model is not available to your API account. Refresh models in Settings or choose another model.'
    if name in ('APIConnectionError', 'APITimeoutError', 'ConnectionError', 'Timeout'):
        return 'The service could not be reached in time. Your saved work is safe. Try again.'
    message = str(exc)
    for key in ('OPENAI_API_KEY', 'RUNPOD_API_KEY', 'RUNWAYML_API_SECRET', 'ALIBABA_API_KEY', 'DASHSCOPE_API_KEY'):
        secret = cfg(key)
        if secret:
            message = message.replace(secret, '[hidden]')
    message = re.sub(r'(?:sk-|rpa_)[A-Za-z0-9_-]{12,}', '[hidden]', message)
    if not creator_portal.is_admin() and re.search(r'\.env|(?:RUNWAYML|OPENAI|ALIBABA|DASHSCOPE|AIM_ALLOW)_|API key|API balance|HTTP \d{3}|workspace ID', message, re.I):
        return 'This service is unavailable. Please contact an administrator.'
    return message[:700] or 'The request failed. Try again.'

@app.errorhandler(Exception)
def handle_error(exc):
    if isinstance(exc, HTTPException):
        if request.path.startswith('/api/'):
            return jsonify(error=exc.description), exc.code
        return exc
    code = 400 if isinstance(exc, (ValueError, KeyError, UnidentifiedImageError)) else 502
    return jsonify(error=error_message(exc)), code

@app.after_request
def response_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'same-origin'
    response.headers['X-Frame-Options'] = 'DENY'
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    return response

def asset_path(value):
    if not value:
        return None
    # Original uploads store relative data/assets paths; generated assets use basenames.
    name = Path(str(value)).name
    candidate = (assets_dir() / name).resolve()
    if candidate.parent != assets_dir().resolve() or not candidate.is_file():
        return None
    return candidate

def asset_url(value):
    path = asset_path(value)
    return '/assets/' + path.name if path else None

def save_image(blob):
    try:
        image = Image.open(io.BytesIO(blob))
        if image.width * image.height > 30_000_000:
            raise ValueError('Use an image with fewer than 30 million pixels.')
        image.load()
        image = ImageOps.exif_transpose(image).convert('RGB')
        image.thumbnail((1536, 1536))
        for _ in range(5):
            output = io.BytesIO()
            image.save(output, format='PNG', optimize=True)
            data = output.getvalue()
            if len(data) <= 3_800_000:
                break
            image.thumbnail((int(image.width * .8), int(image.height * .8)))
        if len(data) > 3_800_000:
            raise ValueError('This image is too large for the video workflow. Try a smaller image.')
    except (OSError, UnidentifiedImageError) as exc:
        raise ValueError('Use a valid PNG, JPEG or WebP image.') from exc
    name = hashlib.sha256(data).hexdigest()[:32] + '.png'
    (assets_dir() / name).write_bytes(data)
    return name

def characters_value():
    return studio.normalize_characters(store.get('characters', {'characters': []}))

def character(cid):
    value = characters_value()
    char = next((c for c in value['characters'] if c['id'] == cid), None)
    if not char:
        raise ValueError('That character could not be found.')
    return value, char

def stage_status(stage, value):
    meta = store.get('workflow_meta', {})
    if meta.get('approved', {}).get(stage):
        return 'approved'
    if stage in meta.get('stale', []):
        return 'review'
    if value and (stage != 'characters' or value.get('characters')):
        return 'draft'
    return 'empty'

def video_url(jid, asset):
    if asset.startswith(('https://', 'http://')):
        if store.get('job_meta', {}).get(jid, {}).get('provider') == 'runway': return None
        return asset
    if asset and (store.data_dir() / Path(asset).name).is_file():
        return '/video/' + jid
    return None

def job_note(value):
    try: summary = json.loads(value or '{}')
    except (ValueError, TypeError): return None
    if not isinstance(summary, dict): return None
    if not creator_portal.is_admin():
        if summary.get('error'): return 'Generation could not finish. Adjust the prompt or try another model.'
        if summary.get('cache_warning'): return 'Your video is ready. Check status to finish saving it.'
        return None
    note = summary.get('error') or summary.get('cache_warning')
    return error_message(ValueError(str(note))) if note else None


def snapshot():
    vision = store.get('vision', {})
    platform_state = creator_portal.studio_state()
    chars = characters_value()
    for char in chars['characters']:
        for variant in char.get('images', []):
            variant['url'] = asset_url(variant.get('path'))
        current = studio.selected_image(char)
        char['image_url'] = current.get('url') if current else None
        char['image_outdated'] = bool(current and current.get('spec_hash') != studio.character_hash(char))
        char['reference_photo_url'] = asset_url(char.get('reference_photo'))
        char['sheet_prompt'] = studio.sheet_prompt(char, vision.get('visual_style', 'cinematic'))
    ensemble = store.get('ensemble', {'images': []})
    for variant in ensemble.get('images', []):
        variant['url'] = asset_url(variant.get('path'))
    current_ensemble = next((v for v in ensemble.get('images', []) if v['id'] == ensemble.get('current_image')), None)
    ensemble['image_url'] = current_ensemble.get('url') if current_ensemble else None
    refs = {slot: {'path': store.get(slot, ''), 'url': asset_url(store.get(slot)), 'binding': store.get('reference_bindings', {}).get(slot, {})}
            for slot in ('ref_a', 'ref_b')}
    script = store.get('script', {})
    director = store.get('director', {})
    statuses = {stage: stage_status(stage, value) for stage, value in [('vision', vision), ('characters', chars), ('script', script), ('director', director)]}
    meta = store.get('job_meta', {})
    jobs = [{'id': jid, 'created': created, 'prompt': prompt, 'status': status,
             'summary': output if creator_portal.is_admin() else '{}', 'status_note': job_note(output),
             'video_url': video_url(jid, asset), 'shot_id': meta.get(jid, {}).get('shot_id', ''),
             'duration_seconds': meta.get(jid, {}).get('video_info', {}).get('duration_seconds') or meta.get(jid, {}).get('duration_seconds'),
             'last_frame_url': asset_url(meta.get(jid, {}).get('last_frame')),
             'continued_from': meta.get(jid, {}).get('continued_from', ''),
             'provider': meta.get(jid, {}).get('provider', 'runpod'),
             'provider_label': 'Alibaba Wan 3.0' if meta.get(jid, {}).get('provider') == 'alibaba' else ('Runway · ' + meta.get(jid, {}).get('runway_model', 'video') if meta.get(jid, {}).get('provider') == 'runway' else 'Legacy backend'),
             'cost_estimate': meta.get(jid, {}).get('cost_estimate') if creator_portal.is_admin() else None,
             'usage': meta.get(jid, {}).get('usage', {}) if creator_portal.is_admin() else {},
             'can_refresh': bool(alibaba_key()) if meta.get(jid, {}).get('provider') == 'alibaba' else (configured('RUNWAYML_API_SECRET') if meta.get(jid, {}).get('provider') == 'runway' else False)}
            for jid, created, prompt, status, output, asset in store.jobs()]
    for job in jobs:
        review = next((r for r in platform_state.get('submissions', []) if r['metadata'].get('source_job') == job['id']), None)
        job['staff_review'] = review['status'] if review else 'not_submitted'
    assemblies = store.get('assemblies', [])
    for item in assemblies:
        item['video_url'] = '/assembly/' + item['id'] if (store.data_dir() / Path(item['path']).name).is_file() else None
    return {'workspace_id': studio.workspace_id(), 'vision': vision, 'conversation_overview':store.get('conversation_overview',{}), 'characters': chars['characters'],
            'tasks': background_tasks.project_tasks(creator_portal.user()['id'], creator_portal.g.project_id) if creator_portal.user() else [],
            'platform': platform_state, 'source': book_source.snapshot(),
            'script': script, 'director': director, 'messages': store.messages(), 'statuses': statuses,
            'settings': preferences(), 'text_models': list(dict.fromkeys([preferences()['model']] + store.settings().get('text_models', TEXT_MODELS))),
            'image_models': list(dict.fromkeys([preferences()['image_model']] + store.settings().get('image_models', IMAGE_MODELS))),
            'configured': {'openai': configured('OPENAI_API_KEY'), 'runway': configured('RUNWAYML_API_SECRET'), 'alibaba': alibaba_configured(), 'video_tools': video_tools.available()},
            'providers': video_providers.catalog(preferences()),
            'voice': {'transcription_model': cfg('OPENAI_TRANSCRIPTION_MODEL') or 'gpt-transcribe', 'max_seconds': 120, 'max_bytes': 10 * 1024 * 1024},
            'references': refs, 'ensemble': ensemble, 'jobs': jobs,
            'render_prompt': store.get('render_prompt', ''), 'selected_shot': store.get('selected_shot', ''),
            'render_duration': fitting_duration(store.get('render_duration', 5)),
            'prompt_needs_refresh': store.get('prompt_needs_refresh', False),
            'limits': video_providers.limits(preferences()),
            'continuation': store.get('continuation', {}),
            'sequence': store.get('sequence', {'name': vision.get('title') or 'Untitled scene', 'clip_ids': []}),
            'assemblies': assemblies,
            'archives': store.archived_project_details(),
            'actions': [{'created': d, 'layer': l, 'description': t} for d, l, t in store.actions()[:100]]}

@app.get('/')
@app.get('/<page>')
def website(page='overview'):
    if page not in ['overview', 'source', 'share', 'idea', 'brief', 'characters', 'script', 'shots', 'render', 'library', 'assembly', 'settings', 'activity']:
        return 'Page not found', 404
    return render_template('index.html', token=security_token())

@app.get('/api/state')
def state():
    return jsonify(snapshot())

@app.get('/assets/<name>')
def serve_asset(name):
    path = asset_path(name)
    if not path or path.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
        return 'Image not found', 404
    return send_from_directory(assets_dir(), path.name, conditional=True)

@app.get('/video/<jid>')
def serve_video(jid):
    job = next((j for j in store.jobs() if j[0] == jid), None)
    if not job:
        return 'Video not found', 404
    file = (store.data_dir() / Path(job[5]).name).resolve()
    if not job[5] or file.parent != store.data_dir() or not file.is_file() or file.suffix.lower() not in ('.mp4', '.webm', '.mov'):
        return 'Video not found', 404
    return send_file(file, conditional=True)

@app.get('/assembly/<aid>')
def serve_assembly(aid):
    item = next((a for a in store.get('assemblies', []) if a['id'] == aid), None)
    if not item:
        return 'Scene not found', 404
    path = (store.data_dir() / Path(item['path']).name).resolve()
    if path.parent != store.data_dir().resolve() or not path.is_file() or path.suffix.lower() != '.mp4':
        return 'Scene not found', 404
    name = re.sub(r'[^\w .-]', '_', item['name']).strip('. ') or 'scene'
    return send_file(path, conditional=True, as_attachment=request.args.get('download') == '1', download_name=name + '.mp4')

@app.post('/api/settings')
@mutation
def update_settings():
    values = body()
    updates = {}
    for field in ('model', 'image_model'):
        if field in values:
            name = str(values[field]).strip()
            if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,120}', name):
                raise ValueError('Enter a valid model ID.')
            if field == 'image_model' and not name.startswith(('gpt-image-', 'chatgpt-image-')):
                raise ValueError('Choose a GPT Image model for character art.')
            updates[field] = name
    if 'image_quality' in values:
        if values['image_quality'] not in ('low', 'medium', 'high'):
            raise ValueError('Choose low, medium or high image quality.')
        updates['image_quality'] = values['image_quality']
    updates.update(video_providers.validate_settings(values))
    previous = preferences()
    store.save_settings(updates)
    if any(field in updates and updates[field] != previous[field] for field in ('video_provider', 'wan_mode', 'wan_start_slot', 'runway_model', 'runway_mode', 'runway_start_slot', 'runway_ratio')):
        store.put('prompt_needs_refresh', True)
    return jsonify(snapshot())

@app.post('/api/voice/transcribe')
@mutation
def transcribe_voice():
    recording = request.files.get('audio')
    if not recording:
        raise ValueError('Record a voice message first.')
    suffix = Path(recording.filename or '').suffix.lower()
    if suffix not in ('.webm', '.mp4', '.m4a', '.wav', '.mp3', '.mpeg', '.mpga'):
        raise ValueError('Use a supported microphone recording or audio file.')
    audio = recording.read(10 * 1024 * 1024 + 1)
    if not audio or len(audio) > 10 * 1024 * 1024:
        raise ValueError('Use a recording smaller than 10 MB.')
    if not configured('OPENAI_API_KEY'):
        raise ValueError('Add OPENAI_API_KEY to .env, then restart to transcribe voice messages.')
    transcript = ai_layers.transcribe(cfg('OPENAI_API_KEY'), cfg('OPENAI_TRANSCRIPTION_MODEL') or 'gpt-transcribe',
                                     audio, 'voice' + suffix, recording.mimetype or 'application/octet-stream')
    # Nothing enters the conversation until the creator reviews and sends it.
    return jsonify({**snapshot(), 'voice_transcript': transcript})

@app.post('/api/models/refresh')
@mutation
def refresh_models():
    models = ai_layers.available_models(cfg('OPENAI_API_KEY'))
    excluded = ('image', 'audio', 'realtime', 'transcribe', 'tts', 'search', 'codex', 'instruct')
    text_models = [m for m in models if m.startswith(('gpt-', 'chatgpt-')) and not any(x in m for x in excluded)]
    image_models = [m for m in models if m.startswith(('gpt-image-', 'chatgpt-image-'))]
    store.save_settings({'text_models': text_models or TEXT_MODELS, 'image_models': image_models or IMAGE_MODELS})
    return jsonify(snapshot())

def save_conversation_reply(result):
    reply=result.get('reply') if isinstance(result,dict) else result
    if not isinstance(reply,str) or not reply.strip():
        raise ValueError('MIA returned an incomplete reply. Please retry.')
    if isinstance(result,dict) and isinstance(result.get('overview'),dict):
        notes=store.get('conversation_overview',{})
        if not isinstance(notes,dict):notes={}
        for key in ('title','premise','genre','setting','main_character','central_conflict','visual_style'):
            if key not in result['overview']:continue
            value=result['overview'][key]
            if value is None:notes[key]=''
            elif isinstance(value,str):notes[key]=value.strip()[:1200 if key=='premise' else 300]
        store.put('conversation_overview',notes)
    store.append_message('assistant',reply.strip())

@app.post('/api/chat')
@mutation
def chat():
    message = str(body().get('message', '')).strip()
    if not message or len(message) > 20000:
        raise ValueError('Enter a movie idea or message under 20,000 characters.')
    store.append_message('user', message)
    studio.invalidate('vision')
    store.record('Idea', 'Creator added to the creative conversation')
    reply = ai_layers.chat(cfg('OPENAI_API_KEY'), preferences()['model'], store.messages(), {**store.get('vision', {}), 'conversation_overview':store.get('conversation_overview',{}), 'source_material': book_source.context()})
    save_conversation_reply(reply)
    return jsonify(snapshot())

@app.post('/api/chat/retry')
@mutation
def retry_chat():
    messages = store.messages()
    if not messages or messages[-1]['role'] != 'user':
        raise ValueError('There is no unanswered message to retry.')
    reply = ai_layers.chat(cfg('OPENAI_API_KEY'), preferences()['model'], messages, {**store.get('vision', {}), 'conversation_overview':store.get('conversation_overview',{}), 'source_material': book_source.context()})
    save_conversation_reply(reply)
    return jsonify(snapshot())

@app.post('/api/chat/clear')
@mutation
def clear_chat():
    options=body()
    if options.get('confirm') is not True:raise ValueError('Confirm that you want to clear this conversation.')
    with store.connect() as c:c.execute('DELETE FROM chat_messages')
    store.put('conversation_overview',{})
    sessions=store.get('live_voice_sessions',{})
    for entry in sessions.values():entry['cleared']=True;entry['closed']=True
    store.put('live_voice_sessions',sessions)
    store.record('Idea','Creator cleared the conversation. Existing drafts and media were kept.')
    return jsonify(snapshot())

def require_approved(stage):
    if not store.get('workflow_meta', {}).get('approved', {}).get(stage):
        labels = {'vision': 'creative brief', 'characters': 'characters', 'script': 'script', 'director': 'shots'}
        raise ValueError('Review and approve your ' + labels[stage] + ' first.')

def validate_draft(stage, value):
    if stage == 'vision':
        if not isinstance(value.get('logline'), str) or not value['logline'].strip():
            raise ValueError('The brief has no premise. Try drafting it again.')
        for field in ('title', 'genre', 'visual_style', 'tone', 'setting'):
            value[field] = str(value.get(field) or '')
        for field in ('themes', 'characters', 'creative_decisions', 'open_questions'):
            if not isinstance(value.get(field, []), list):
                raise ValueError('The model returned an invalid brief. Try again.')
    else:
        field = {'characters': 'characters', 'script': 'scenes', 'director': 'shots'}[stage]
        if not isinstance(value.get(field), list) or any(not isinstance(x, dict) for x in value[field]):
            raise ValueError('The model returned an invalid draft. Try again.')
        if stage in ('script', 'director') and not value[field]:
            raise ValueError('The model returned an empty draft. Try again.')
        ids = set()
        for index, item in enumerate(value[field]):
            item['id'] = str(item.get('id') or ('S' if stage == 'script' else 'SH') + str(index + 1))
            if item['id'] in ids:
                item['id'] += '_' + str(index + 1)
            ids.add(item['id'])
            if stage == 'director':
                try:
                    item['duration_seconds'] = video_providers.validate_duration(max(1, min(30, float(item.get('duration_seconds', 5)))))
                except (TypeError, ValueError):
                    item['duration_seconds'] = 5
    return value

@app.post('/api/generate/<stage>')
@mutation
def generate(stage):
    if stage not in studio.STAGES:
        raise ValueError('Unknown creative step.')
    instructions = str(body().get('instructions', ''))[:12000]
    messages = store.messages()
    vision = store.get('vision', {})
    chars = characters_value()
    source_material = book_source.context()
    if stage == 'vision' and not messages and not source_material:
        raise ValueError('Describe a movie idea, select story excerpts, or write a brief manually.')
    if stage != 'vision':
        require_approved(studio.STAGES[studio.STAGES.index(stage) - 1])
    material = {'conversation': messages, 'vision': vision, 'characters': chars,
                'screenplay': store.get('script', {}), 'existing_draft': store.get(stage, {}),
                'creator_revision_instructions': instructions, 'source_material': source_material}
    tasks = {'vision': ('Vision Manager', ai_layers.VISION_SCHEMA), 'characters': ('Character Art Director', ai_layers.CHARACTER_SCHEMA),
             'script': ('Screenwriter', ai_layers.SCRIPT_SCHEMA), 'director': ('Film Director', ai_layers.DIRECTOR_SCHEMA)}
    task, schema = tasks[stage]
    if stage == 'director':
        material['supported_clip_seconds'] = video_providers.limits(preferences())['durations']
        material['continuity_plan'] = studio.planning_policy(vision, store.get('script', {}), material['supported_clip_seconds'])
    result = validate_draft(stage, ai_layers.structured(cfg('OPENAI_API_KEY'), preferences()['model'], task, material, schema))
    if stage == 'characters':
        result = studio.merge_characters(result, chars)
    if stage == 'director':
        result = studio.consolidate_shots(result, video_providers.limits(preferences())['durations'])
    # Keep draft revisions for recovery, including human-edited prior drafts.
    revisions = store.get('draft_revisions', [])
    old = store.get(stage)
    if old:
        revisions.append({'id': uuid.uuid4().hex, 'stage': stage, 'created': store.now(), 'value': old})
        store.put('draft_revisions', revisions[-40:])
    studio.save(stage, result, 'Creator requested a draft using ' + preferences()['model'])
    return jsonify(snapshot())

@app.post('/api/save/<stage>')
@mutation
def save_draft(stage):
    if stage not in ('vision', 'script', 'director'):
        raise ValueError('Use the character editor for cast changes.')
    value = validate_draft(stage, body())
    studio.save(stage, value)
    return jsonify(snapshot())

@app.post('/api/approve/<stage>')
@mutation
def approve(stage):
    if stage=='director':
        current=store.get('director',{})
        packed=studio.consolidate_shots(current,video_providers.limits(preferences())['durations'])
        if packed!=current:studio.save('director',packed,'Packed connected action into continuous takes')
    studio.approve(stage)
    return jsonify(snapshot())

@app.post('/api/characters')
@mutation
def add_character():
    value = characters_value()
    char = studio.normalize_characters({'characters': [{**body(), 'id': 'C' + uuid.uuid4().hex[:8], 'manually_edited': True}]})['characters'][0]
    value['characters'].append(char)
    studio.save('characters', value, 'Creator added a character')
    return jsonify(snapshot())

@app.post('/api/characters/skip')
@mutation
def skip_characters():
    require_approved('vision')
    if characters_value()['characters']:
        raise ValueError('Remove the existing cast before choosing a film without characters.')
    studio.save('characters', {'characters': []}, 'Creator chose a film without characters')
    studio.approve('characters')
    return jsonify(snapshot())

@app.post('/api/characters/<cid>')
@mutation
def edit_character(cid):
    value, char = character(cid)
    updated = body()
    if 'use_as_reference' in updated and not isinstance(updated['use_as_reference'], bool):
        raise ValueError('Choose whether this image should be used as a character reference.')
    reference_changed = 'use_as_reference' in updated and updated['use_as_reference'] != char.get('use_as_reference', True)
    before = {field: char.get(field, '') for field in studio.CHAR_FIELDS}
    for field in studio.CHAR_FIELDS:
        if field in updated:
            char[field] = str(updated[field])[:20000]
    if 'use_as_reference' in updated:
        char['use_as_reference'] = updated['use_as_reference']
    if before != {field: char.get(field, '') for field in studio.CHAR_FIELDS}:
        char['manually_edited'] = True
        studio.save('characters', value, 'Creator edited ' + char['name'])
    elif reference_changed:
        store.put('characters', value)
    if reference_changed:
        clear_excluded_references()
        store.put('prompt_needs_refresh', True)
        store.record('References', 'Creator chose ' + ('reference use' if char['use_as_reference'] else 'save only') + ' for ' + char['name'])
    return jsonify(snapshot())

@app.post('/api/characters/<cid>/delete')
@mutation
def delete_character(cid):
    value, char = character(cid)
    value['characters'] = [c for c in value['characters'] if c['id'] != cid]
    studio.save('characters', value, 'Creator removed ' + char['name'])
    bindings = store.get('reference_bindings', {})
    for slot, binding in list(bindings.items()):
        if binding.get('character_id') == cid:
            store.put(slot, '')
            bindings.pop(slot)
    store.put('reference_bindings', bindings)
    return jsonify(snapshot())

def new_variant(path, prompt, spec_hash, source):
    return {'id': uuid.uuid4().hex, 'path': path, 'created': store.now(), 'prompt': prompt, 'spec_hash': spec_hash, 'source': source}

@app.post('/api/characters/<cid>/image')
@mutation
def character_image(cid):
    value, char = character(cid)
    options = body()
    mode = options.get('mode', 'generate')
    if mode not in ('generate', 'edit'):
        raise ValueError('Choose generate or edit.')
    prompt = studio.sheet_prompt(char, store.get('vision', {}).get('visual_style', 'cinematic'))
    refs = []
    photo = asset_path(char.get('reference_photo'))
    if mode == 'edit':
        current = studio.selected_image(char)
        previous = asset_path(current.get('path')) if current else None
        if not previous:
            raise ValueError('Generate or upload a sheet before editing it.')
        instruction = str(options.get('instructions', '')).strip()
        if not instruction:
            raise ValueError('Describe what you want to change in the image.')
        prompt += '\nEdit the supplied sheet. Preserve identity and every feature except these requested changes: ' + instruction
        refs.append(previous)
    if photo:
        refs.append(photo)
    prefs = preferences()
    path = save_image(ai_layers.image(cfg('OPENAI_API_KEY'), prefs['image_model'], prompt, prefs['image_quality'], refs))
    variant = new_variant(path, prompt, studio.character_hash(char), prefs['image_model'])
    char['images'].append(variant)
    char['current_image'] = variant['id']
    store.put('characters', value)
    studio.invalidate('characters')
    store.record('Character art', 'Creator ' + ('edited' if mode == 'edit' else 'generated') + ' a sheet for ' + char['name'])
    return jsonify(snapshot())

@app.post('/api/characters/<cid>/upload')
@mutation
def upload_character(cid):
    value, char = character(cid)
    file = request.files.get('file')
    if not file:
        raise ValueError('Choose an image to upload.')
    path = save_image(file.read())
    kind = request.form.get('kind', 'sheet')
    if kind == 'photo':
        char['reference_photo'] = path
    elif kind == 'sheet':
        variant = new_variant(path, 'Uploaded by creator', studio.character_hash(char), 'upload')
        char['images'].append(variant)
        char['current_image'] = variant['id']
    else:
        raise ValueError('Choose a reference photo or sheet upload.')
    store.put('characters', value)
    studio.invalidate('characters')
    store.record('Character art', 'Creator uploaded a ' + kind + ' for ' + char['name'])
    return jsonify(snapshot())

@app.post('/api/characters/<cid>/select-image')
@mutation
def select_image(cid):
    value, char = character(cid)
    selected = body().get('image_id')
    if not any(v['id'] == selected for v in char['images']):
        raise ValueError('That image version was not found.')
    char['current_image'] = selected
    store.put('characters', value)
    studio.invalidate('characters')
    return jsonify(snapshot())

@app.post('/api/ensemble')
@mutation
def ensemble_image():
    options = body()
    chars = characters_value()['characters']
    if not chars:
        raise ValueError('Add characters before creating a cast sheet.')
    if len(chars) > 8:
        raise ValueError('For a readable combined sheet, use eight or fewer characters.')
    specs = [{f: c.get(f, '') for f in studio.CHAR_FIELDS} for c in chars]
    prompt = ('Create a single ensemble character reference sheet with a distinct labeled column for each character. '
              'Show one full-body front view and one face close-up per character, with no duplicate people or identity mixing. '
              'Neutral background and even lighting. Preserve each supplied reference image’s identity.\nVisual style: '
              + store.get('vision', {}).get('visual_style', 'cinematic') + '\nCast: ' + json.dumps(specs, ensure_ascii=False))
    prompt += '\nCreator direction: ' + str(options.get('instructions', ''))[:8000]
    ensemble = store.get('ensemble', {'images': []})
    references = []
    if options.get('mode') == 'edit':
        current = next((v for v in ensemble.get('images', []) if v['id'] == ensemble.get('current_image')), None)
        previous = asset_path(current.get('path')) if current else None
        if not previous or not str(options.get('instructions', '')).strip():
            raise ValueError('Choose a cast sheet and describe the image correction first.')
        references.append(previous)
        prompt += '\nEdit the first supplied ensemble sheet, preserving the layout and all details except the requested changes above.'
    for char in chars:
        current = studio.selected_image(char)
        path = asset_path(current.get('path')) if current else asset_path(char.get('reference_photo'))
        if path:
            references.append(path)
    prefs = preferences()
    path = save_image(ai_layers.image(cfg('OPENAI_API_KEY'), prefs['image_model'], prompt, prefs['image_quality'], references))
    variant = new_variant(path, prompt, studio.fingerprint(specs), prefs['image_model'])
    ensemble['images'].append(variant)
    ensemble['current_image'] = variant['id']
    store.put('ensemble', ensemble)
    studio.invalidate('characters')
    store.record('Character art', 'Creator generated a combined cast sheet')
    return jsonify(snapshot())

@app.post('/api/ensemble/select-image')
@mutation
def select_ensemble_image():
    ensemble = store.get('ensemble', {'images': []})
    selected = body().get('image_id')
    if not any(v['id'] == selected for v in ensemble['images']):
        raise ValueError('That cast-sheet version could not be found.')
    ensemble['current_image'] = selected
    store.put('ensemble', ensemble)
    return jsonify(snapshot())

@app.post('/api/references/<slot>')
@mutation
def reference(slot):
    if slot not in ('ref_a', 'ref_b'):
        raise ValueError('Choose Picture 1 or Picture 2.')
    options = body()
    bindings = store.get('reference_bindings', {})
    if options.get('clear'):
        store.put(slot, '')
        bindings.pop(slot, None)
    else:
        cid = options.get('character_id')
        if cid:
            _, char = character(cid)
            if not char.get('use_as_reference', True):
                raise ValueError('This character image is set to Save only. Choose Use as character reference first.')
            current = studio.selected_image(char)
            path = current.get('path') if current else None
            binding = {'kind': 'character', 'character_id': cid, 'image_id': current['id']} if current else {}
        else:
            if any(not c.get('use_as_reference', True) for c in characters_value()['characters']):
                raise ValueError('The combined cast image includes a character set to Save only. Use individual character references instead.')
            ensemble = store.get('ensemble', {})
            current = next((v for v in ensemble.get('images', []) if v['id'] == ensemble.get('current_image')), None)
            path = current.get('path') if current else None
            binding = {'kind': 'ensemble', 'image_id': current['id']} if current else {}
        if not asset_path(path):
            raise ValueError('Choose a generated or uploaded sheet first.')
        store.put(slot, path)
        bindings[slot] = binding
    store.put('reference_bindings', bindings)
    if store.get('continuation', {}).get('slot') == slot:
        store.put('continuation', {})
    store.put('prompt_needs_refresh', True)
    store.record('References', 'Creator changed ' + ('Picture 1' if slot == 'ref_a' else 'Picture 2'))
    return jsonify(snapshot())

@app.post('/api/references/<slot>/upload')
@mutation
def upload_reference(slot):
    if slot not in ('ref_a', 'ref_b') or not request.files.get('file'):
        raise ValueError('Choose a valid reference slot and image.')
    path = save_image(request.files['file'].read())
    store.put(slot, path)
    bindings = store.get('reference_bindings', {})
    bindings[slot] = {'kind': 'upload'}
    store.put('reference_bindings', bindings)
    if store.get('continuation', {}).get('slot') == slot:
        store.put('continuation', {})
    store.put('prompt_needs_refresh', True)
    return jsonify(snapshot())

@app.post('/api/render/compile')
@mutation
def compile_prompt():
    sid = body().get('shot_id')
    shot = next((s for s in store.get('director', {}).get('shots', []) if s.get('id') == sid), None)
    if not shot:
        raise ValueError('Choose a shot first.')
    attach_references(shot)
    store.put('render_prompt', studio.compile_shot(shot, store.get('vision', {}), characters_value(), preferences()))
    store.put('selected_shot', sid)
    store.put('render_duration', fitting_duration(shot.get('duration_seconds', 5)))
    store.put('prompt_needs_refresh', False)
    return jsonify(snapshot())

def excluded_reference_paths():
    chars = characters_value()['characters']
    excluded = {v.get('path') for c in chars if not c.get('use_as_reference', True) for v in c.get('images', [])}
    if any(not c.get('use_as_reference', True) for c in chars):
        excluded.update(v.get('path') for v in store.get('ensemble', {}).get('images', []))
    return {path for path in excluded if path}

def clear_excluded_references():
    """Remove only reference bindings excluded by an explicit Save only choice."""
    excluded = excluded_reference_paths()
    disabled = {c['id'] for c in characters_value()['characters'] if not c.get('use_as_reference', True)}
    bindings = store.get('reference_bindings', {})
    for slot in ('ref_a', 'ref_b'):
        binding = bindings.get(slot, {})
        if (binding.get('character_id') in disabled or
            binding.get('kind') != 'upload' and store.get(slot) in excluded or
            binding.get('kind') == 'ensemble' and disabled):
            store.put(slot, '')
            bindings.pop(slot, None)
    store.put('reference_bindings', bindings)

def attach_references(shot):
    """Refresh automatically selected identities; preserve intentional uploads and frames."""
    prefs=preferences()
    mode=prefs['wan_mode'] if prefs['video_provider']=='alibaba' else prefs['runway_mode']
    clear_excluded_references()
    if mode!='reference':return
    wanted={str(x).casefold() for x in shot.get('characters',[])}
    all_cast=characters_value()['characters']
    cast=[c for c in all_cast if c.get('use_as_reference', True) and (not wanted or c['id'].casefold() in wanted or c['name'].casefold() in wanted)]
    ensemble=store.get('ensemble',{});combined=next((v for v in ensemble.get('images',[]) if v['id']==ensemble.get('current_image')),None)
    candidates=[(combined['path'],{'kind':'ensemble','image_id':combined['id']})] if len(cast)>1 and all(c.get('use_as_reference', True) for c in all_cast) and combined and asset_path(combined.get('path')) else []
    for c in cast:
        image=studio.selected_image(c)
        if image and asset_path(image.get('path')):candidates.append((image['path'],{'kind':'character','character_id':c['id'],'image_id':image['id']}))
    bindings=store.get('reference_bindings',{})
    for slot in ('ref_a','ref_b'):
        if bindings.get(slot,{}).get('automatic'):
            store.put(slot,'');bindings.pop(slot,None)
    used={store.get(s) for s in ('ref_a','ref_b') if store.get(s)}
    for slot in ('ref_a','ref_b'):
        if store.get(slot):continue
        item=next(((path,binding) for path,binding in candidates if path not in used),None)
        if item:
            path,binding=item;store.put(slot,path);bindings[slot]={**binding,'automatic':True};used.add(path)
    store.put('reference_bindings',bindings)

def render_preflight(options):
    errors=[];warnings=[]
    try:
        clear_excluded_references()
        settings=video_providers.options(options,preferences());prompt=str(options.get('prompt','')).strip()
        if not prompt:raise ValueError('Add a video prompt first.')
        images={slot:asset_path(store.get(slot)) for slot in ('ref_a','ref_b')}
        blobs={slot:p.read_bytes() if p else None for slot,p in images.items()}
        if settings['video_provider']=='alibaba':wan_client.build_request(prompt,settings,blobs)
        else:runway_client.build_request(prompt,settings,blobs)
        selected=store.get('selected_shot');shots=store.get('director',{}).get('shots',[]);shot=next((s for s in shots if s['id']==selected),None)
        if selected and not shot:errors.append('The selected shot changed. Choose a shot and build its prompt again.')
        if shot:
            if store.get('prompt_needs_refresh'):warnings.append('Earlier creative choices changed. Rebuild the prompt to include them.')
            if not store.get('workflow_meta',{}).get('approved',{}).get('director'):warnings.append('Review and approve the latest shot plan before generating your final version.')
            if settings['duration']!=float(shot.get('duration_seconds',5)):warnings.append('This generation uses a different duration from the selected shot.')
            cast={c['id'].casefold() for c in characters_value()['characters']}|{c['name'].casefold() for c in characters_value()['characters']}
            if any(str(x).casefold() not in cast for x in shot.get('characters',[])):warnings.append('This shot names a character missing from your current cast.')
        plan=studio.planning_policy(store.get('vision',{}),store.get('script',{}),video_providers.limits(settings)['durations'])
        planned=sum(float(s.get('duration_seconds',0)) for s in shots)
        if shots and abs(planned-plan['target_seconds'])>max(2,plan['target_seconds']*.1):warnings.append('Your planned clips total '+str(round(planned,1))+' seconds; your movie target is '+str(plan['target_seconds'])+' seconds.')
        mode=settings['runway_mode'] if settings['video_provider']=='runway' else settings['wan_mode']
        if mode=='first_frame':
            slot=settings['runway_start_slot'] if settings['video_provider']=='runway' else settings['wan_start_slot']
            binding=store.get('reference_bindings',{}).get(slot,{})
            if binding.get('kind') in ('character','ensemble'):errors.append('This image is a character reference sheet, not an opening frame. Choose Image references with a supported model, or create a scene opening frame.')
            if binding.get('kind')=='scene_frame' and shot and binding.get('shot_id')!=shot['id']:warnings.append('Your starting frame belongs to another shot. Check the composition before continuing.')
        elif mode=='text' and any(c.get('use_as_reference', True) and studio.selected_image(c) for c in characters_value()['characters']):warnings.append('Text-only generation does not send your selected character references. Choose Image references to use them.')
        if store.get('continuation',{}).get('source_job_id') and mode=='text':warnings.append('This continuation uses text only. Select starting-frame mode to carry forward the previous clip’s last frame.')
        return {'errors':errors,'warnings':warnings,'estimate':video_providers.quote(settings,settings['duration'])}
    except ValueError as exc:return {'errors':[str(exc)],'warnings':warnings,'estimate':None}

@app.post('/api/render/preflight')
@mutation
def check_render():
    return jsonify(render_preflight(body()))

@app.post('/api/render/first-frame')
@mutation
def create_scene_frame():
    shot=next((s for s in store.get('director',{}).get('shots',[]) if s['id']==store.get('selected_shot')),None)
    if not shot:raise ValueError('Choose a shot and build its prompt first.')
    chars=characters_value();refs=[asset_path(studio.selected_image(c).get('path')) for c in chars['characters'] if c.get('use_as_reference', True) and studio.selected_image(c)]
    refs=[p for p in refs if p][:8];prefs=preferences()
    prompt='Create ONE cinematic starting frame for an upcoming continuous shot, before its main action begins. Match the supplied character references, distinct faces, wardrobes and setting. Show a single camera view, never a sheet, montage or multiple panels. No text. Preserve screen positions.\n'+studio.compile_shot(shot,store.get('vision',{}),chars,{'video_provider':'alibaba','wan_mode':'text'})
    path=save_image(ai_layers.image(cfg('OPENAI_API_KEY'),prefs['image_model'],prompt,prefs['image_quality'],refs))
    slot=prefs['runway_start_slot'] if prefs['video_provider']=='runway' else prefs['wan_start_slot']
    store.put(slot,path);bindings=store.get('reference_bindings',{});bindings[slot]={'kind':'scene_frame','shot_id':shot['id']};store.put('reference_bindings',bindings)
    store.put('prompt_needs_refresh',True);store.record('Starting frame','Created a scene frame using saved character references')
    return jsonify(snapshot())

def save_render_options(options):
    prompt = str(options.get('prompt', '')).strip()
    settings = video_providers.options(options, preferences())
    duration = settings['duration']
    store.save_settings(video_providers.validate_settings(options))
    store.put('render_prompt', prompt)
    store.put('render_duration', duration)
    store.put('prompt_needs_refresh', False)
    return prompt, duration

@app.post('/api/render/save')
@mutation
def save_render():
    save_render_options(body())
    store.record('Production', 'Creator edited the render prompt')
    return jsonify(snapshot())

@app.post('/api/render/submit')
@mutation
def submit_render():
    options = body()
    preflight=render_preflight(options)
    if preflight['errors']:raise ValueError(preflight['errors'][0])
    prompt, duration = save_render_options(options)
    if not prompt:
        raise ValueError('Add a video prompt first.')
    settings = video_providers.options(options, preferences())
    provider = settings['video_provider']
    images = [asset_path(store.get(slot)) for slot in ('ref_a', 'ref_b')]
    details = {'provider': provider, 'cost_estimate': video_providers.quote(settings, duration)}
    if provider == 'alibaba':
        if not alibaba_configured(settings):
            raise ValueError('Add your Alibaba key to .env and set the matching region and workspace in Settings.')
        payload = wan_client.build_request(prompt, settings, {slot: image.read_bytes() if image else None for slot, image in zip(('ref_a', 'ref_b'), images)})
        result = usage_ledger.call('video_submit',video_providers.WAN_MODEL,lambda: wan_client.submit(settings['wan_workspace'], settings['wan_region'], alibaba_key(), payload),'alibaba')
        task_id = result.get('id')
        details.update({'task_id': task_id, 'wan_region': settings['wan_region'], 'wan_workspace': settings['wan_workspace'],
                        'wan_mode': settings['wan_mode'], 'wan_resolution': settings['wan_resolution']})
        jid = 'wan_' + task_id if isinstance(task_id, str) else ''
    else:
        if not configured('RUNWAYML_API_SECRET'):
            raise ValueError('Set RUNWAYML_API_SECRET in the server environment and restart.')
        payload = runway_client.build_request(prompt, settings, {slot: image.read_bytes() if image else None for slot, image in zip(('ref_a', 'ref_b'), images)})
        result = usage_ledger.call('video_submit',settings['runway_model'],lambda: runway_client.submit(cfg('RUNWAYML_API_SECRET'), payload),'runway')
        task_id = result['id']; jid = 'rw_' + task_id
        details.update({'task_id': task_id, 'runway_model': settings['runway_model'],
                        'runway_mode': settings['runway_mode'], 'runway_start_slot': settings['runway_start_slot'],
                        'runway_ratio': settings['runway_ratio'], 'runway_resolution': settings['runway_resolution'],
                        'runway_audio': settings['runway_audio'], 'runway_seed': settings['runway_seed']})
    if not isinstance(jid, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', jid):
        raise ValueError('The video provider did not return a valid job ID. Check its endpoint response.')
    store.save_job(jid, prompt, result.get('status', 'IN_QUEUE'))
    meta = store.get('job_meta', {})
    meta[jid] = {**details, 'shot_id': store.get('selected_shot', ''),
                 'duration_seconds': duration, 'continued_from': store.get('continuation', {}).get('source_job_id', ''),
                 'references': {slot: {'path': store.get(slot, ''), 'binding': store.get('reference_bindings', {}).get(slot, {})}
                                for slot in ('ref_a', 'ref_b')}}
    store.put('job_meta', meta)
    store.record('Render', 'Creator chose ' + provider + ' and submitted shot ' + store.get('selected_shot', 'manual') + ' as job ' + jid)
    return jsonify(snapshot())

@app.post('/api/jobs/<jid>/refresh')
@mutation
def refresh_job(jid):
    job = next((j for j in store.jobs() if j[0] == jid), None)
    if not job:
        raise ValueError('That render job was not found.')
    meta = store.get('job_meta', {})
    details = meta.get(jid, {})
    provider = details.get('provider', 'runpod')
    if provider == 'alibaba':
        if job[3] == 'COMPLETED' and job[5] and not job[5].startswith(('http://', 'https://')) and (store.data_dir() / Path(job[5]).name).is_file():
            return jsonify(snapshot())
        info = wan_client.status(details['wan_workspace'], details['wan_region'], alibaba_key(), details['task_id'])
        details['usage'] = info.get('usage', {})
        seconds = details['usage'].get('output_video_duration')
        try:
            seconds = video_providers.number(seconds, 'reported video duration', 30)
        except ValueError:
            seconds = None
        if seconds:
            details['duration_seconds'] = seconds
        meta[jid] = details
        store.put('job_meta', meta)
    elif provider == 'runway':
        if job[3] == 'COMPLETED' and job[5] and not job[5].startswith(('http://', 'https://')) and (store.data_dir() / Path(job[5]).name).is_file():
            return jsonify(snapshot())
        info = runway_client.status(cfg('RUNWAYML_API_SECRET'), details['task_id'])
        details['usage'] = info.get('usage', {})
        meta[jid] = details; store.put('job_meta', meta)
    else:
        raise ValueError('This render belongs to the retired backend. Saved video files remain usable; import an externally completed video through Share.')
    output = info.get('output')
    kind, value = video_tools.find_video(output)
    asset = job[5]
    if kind == 'bytes':
        extension = '.webm' if value[:4] == b'\x1aE\xdf\xa3' else '.mp4'
        asset = jid + extension
        (store.data_dir() / asset).write_bytes(value)
    elif kind == 'url':
        if not asset or asset.startswith(('https://', 'http://')) or not (store.data_dir() / Path(asset).name).is_file():
            asset = value
    summary = {'status': info.get('status', 'UNKNOWN'), 'error': error_message(ValueError(info['error'])) if info.get('error') else None,
               'output_type': type(output).__name__, 'output_keys': list(output.keys()) if isinstance(output, dict) else None}
    store.save_job(jid, job[2], summary['status'], json.dumps(summary), asset)
    if summary['status'] in ('COMPLETED','FAILED','CANCELLED','CANCELED','TIMED_OUT'):
        meta=store.get('job_meta',{});meta.setdefault(jid,{})['completed_utc']=meta.get(jid,{}).get('completed_utc') or store.now();store.put('job_meta',meta)
    if provider in ('alibaba', 'runway') and summary['status'] == 'COMPLETED' and asset:
        try:
            local_clip(jid)
        except ValueError as exc:
            summary['cache_warning'] = error_message(exc)
            store.save_job(jid, job[2], summary['status'], json.dumps(summary), asset)
    return jsonify(snapshot())

def render_job(jid):
    job = next((j for j in store.jobs() if j[0] == jid), None)
    if not job:
        raise ValueError('That clip could not be found in this movie.')
    if job[3] != 'COMPLETED':
        raise ValueError('Wait for the clip to finish before using its video.')
    return job

def local_clip(jid):
    job = render_job(jid)
    asset = job[5] or ''
    if asset.startswith(('https://', 'http://')):
        suffix = Path(urlparse(asset).path).suffix.lower()
        suffix = suffix if suffix in ('.mp4', '.webm', '.mov') else '.mp4'
        name = 'cached_' + hashlib.sha256(jid.encode()).hexdigest()[:24] + suffix
        path = store.data_dir() / name
        info = video_tools.download(asset, path)
        meta = store.get('job_meta', {})
        meta.setdefault(jid, {}).update({'source_url': asset, 'video_info': info})
        store.put('job_meta', meta)
        store.save_job(jid, job[2], job[3], job[4], name)
        return path
    path = (store.data_dir() / Path(asset).name).resolve()
    if not asset or path.parent != store.data_dir().resolve() or not path.is_file() or path.suffix.lower() not in ('.mp4', '.webm', '.mov'):
        raise ValueError('This clip has no playable file. Refresh its status and check the worker’s output storage.')
    return path

def capture_last_frame(jid):
    render_job(jid)
    meta = store.get('job_meta', {})
    path = meta.get(jid, {}).get('last_frame')
    if asset_path(path):
        return path
    blob, info = video_tools.last_frame(local_clip(jid))
    path = save_image(blob)
    # A download can update metadata, so reload it before adding the frame.
    meta = store.get('job_meta', {})
    meta.setdefault(jid, {}).update({'last_frame': path, 'video_info': info})
    store.put('job_meta', meta)
    store.record('Continuity', 'Creator captured the final frame of clip ' + jid)
    return path

@app.post('/api/jobs/<jid>/last-frame')
@mutation
def extract_last_frame(jid):
    capture_last_frame(jid)
    return jsonify(snapshot())

@app.post('/api/jobs/<jid>/continue')
@mutation
def continue_clip(jid):
    options = body()
    slot = options.get('slot', 'ref_a')
    if slot not in ('ref_a', 'ref_b'):
        raise ValueError('Choose Picture 1 or Picture 2 for the last frame.')
    path = capture_last_frame(jid)
    bindings = store.get('reference_bindings', {})
    store.put(slot, path)
    bindings[slot] = {'kind': 'last_frame', 'source_job_id': jid}
    other = 'ref_b' if slot == 'ref_a' else 'ref_a'
    if not asset_path(store.get(other)):
        original = store.get('job_meta', {}).get(jid, {}).get('references', {}).get(other, {})
        if asset_path(original.get('path')):
            store.put(other, original['path'])
            bindings[other] = original.get('binding', {})
    store.put('reference_bindings', bindings)
    store.put('continuation', {'source_job_id': jid, 'slot': slot, 'frame_path': path, 'next_action': ''})
    if preferences()['video_provider'] == 'alibaba':
        store.save_settings({'wan_mode': 'first_frame', 'wan_start_slot': slot})
    if preferences()['video_provider'] == 'runway':
        store.save_settings({'runway_mode': 'first_frame', 'runway_start_slot': slot})
    store.put('selected_shot', '')
    store.put('render_prompt', '')
    duration = round(store.get('job_meta', {}).get(jid, {}).get('duration_seconds', 5))
    duration = max(1, min(30, duration))
    store.put('render_duration', fitting_duration(duration))
    store.put('prompt_needs_refresh', False)
    store.record('Continuity', 'Creator selected clip ' + jid + ' as the previous segment')
    return jsonify(snapshot())

@app.post('/api/render/continuation')
@mutation
def build_continuation():
    continuation = store.get('continuation', {})
    if not continuation:
        raise ValueError('Choose a clip’s last frame from the video library first.')
    slot = continuation['slot']
    if store.get('reference_bindings', {}).get(slot, {}).get('source_job_id') != continuation['source_job_id']:
        raise ValueError('The continuity reference changed. Select the previous clip again.')
    action = str(body().get('next_action', '')).strip()[:12000]
    render_job(continuation['source_job_id'])
    prompt = studio.compile_continuation(action, store.get('vision', {}), characters_value(), preferences())
    continuation['next_action'] = action
    store.put('continuation', continuation)
    store.put('render_prompt', prompt)
    store.put('prompt_needs_refresh', False)
    return jsonify(snapshot())

def save_sequence(options):
    name = store.archive_label(options.get('name') or 'Untitled scene')
    ids = options.get('clip_ids', [])
    if not isinstance(ids, list) or len(ids) > 40 or any(not isinstance(jid, str) for jid in ids) or len(ids) != len(set(ids)):
        raise ValueError('Choose up to 40 distinct clips for this scene.')
    for jid in ids:
        job = render_job(jid)
        if not video_url(jid, job[5]):
            raise ValueError('A selected clip has no playable video yet.')
    value = {'name': name, 'clip_ids': ids}
    store.put('sequence', value)
    return value

@app.post('/api/sequence')
@mutation
def update_sequence():
    save_sequence(body())
    return jsonify(snapshot())

@app.post('/api/sequence/add')
@mutation
def add_to_sequence():
    jid = str(body().get('job_id', ''))
    sequence = store.get('sequence', {'name': store.get('vision', {}).get('title') or 'Untitled scene', 'clip_ids': []})
    if jid not in sequence['clip_ids']:
        sequence['clip_ids'].append(jid)
    save_sequence(sequence)
    return jsonify(snapshot())

@app.post('/api/sequence/combine')
@mutation
def combine_scene():
    sequence = save_sequence(body())
    if len(sequence['clip_ids']) < 2:
        raise ValueError('Add at least two clips to combine a scene.')
    paths = [local_clip(jid) for jid in sequence['clip_ids']]
    aid = uuid.uuid4().hex
    output = store.data_dir() / ('scene_' + aid + '.mp4')
    info = video_tools.combine(paths, output)
    item = {'id': aid, 'name': sequence['name'], 'path': output.name,
            'clip_ids': sequence['clip_ids'], 'created': store.now(), **info}
    assemblies = store.get('assemblies', [])
    assemblies.append(item)
    store.put('assemblies', assemblies)
    store.record('Scene builder', 'Creator combined ' + str(len(paths)) + ' clips into ' + sequence['name'])
    return jsonify(snapshot())

@app.post('/api/projects/new')
@mutation
def new_project():
    store.new_project(body().get('archive_label', ''))
    studio.workspace_id()
    return jsonify(snapshot())

@app.post('/api/projects/restore')
@mutation
def restore_project():
    options = body()
    store.restore_project(str(options.get('archive', '')), options.get('archive_label', ''))
    store.put('workspace_id', uuid.uuid4().hex)
    return jsonify(snapshot())

@app.post('/api/projects/archive')
@mutation
def archive_project():
    store.archive_project(body().get('name', ''))
    return jsonify(snapshot())

@app.post('/api/projects/rename')
@mutation
def rename_archive():
    options = body()
    store.rename_archive(str(options.get('archive', '')), options.get('name'))
    return jsonify(snapshot())

@app.get('/api/projects/export')
def export_project():
    with LOCK:
        with tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False) as temp:
            path = Path(temp.name)
        try:
            store.snapshot(path)
            result = io.BytesIO(path.read_bytes())
        finally:
            path.unlink(missing_ok=True)
    return send_file(result, mimetype='application/vnd.sqlite3', as_attachment=True, download_name='aim_movie_project.sqlite')

@app.post('/api/activity')
@mutation
def activity():
    note = str(body().get('note', '')).strip()
    if not note:
        raise ValueError('Describe your creative change first.')
    store.record('Human decision', note[:12000])
    return jsonify(snapshot())

import creator_portal
import book_source
import live_voice
security_token = creator_portal.install(app, globals())
book_source.install(app, globals())
live_voice.install(app, globals())
notifications.install(app)
usage_ledger.install(app)
background_tasks.install(app,globals())

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Run AIM.movie Studio locally.')
    parser.add_argument('--port', type=int, default=int(cfg('AIM_PORT') or 8501))
    args = parser.parse_args()
    print(f'\nAIM.movie Studio: http://127.0.0.1:{args.port}\nPress Ctrl+C to stop.\n')
    app.run(host='127.0.0.1', port=args.port, debug=False, threaded=True)
