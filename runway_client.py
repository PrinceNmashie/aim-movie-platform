"""Runway Developer REST API. Submit once, then retrieve the saved task ID."""
import base64
import io
import logging
import math
import re

import requests
from PIL import Image, ImageOps
import runway_models

API_ROOT = 'https://api.dev.runwayml.com/v1'
API_VERSION = '2024-11-06'
logger = logging.getLogger(__name__)
MIN_DURATION = 1
MAX_DURATION = 30
MODELS = tuple(runway_models.MODELS)
RATIOS = tuple(dict.fromkeys(r for m in runway_models.MODELS.values() for s in m['modes'].values() for r in s['ratios']))
RESOLUTIONS = tuple(dict.fromkeys(r for m in runway_models.MODELS.values() for s in m['modes'].values() for r in s['resolutions']))
STATUS = {'PENDING': 'IN_QUEUE', 'THROTTLED': 'IN_QUEUE', 'RUNNING': 'IN_PROGRESS',
          'SUCCEEDED': 'COMPLETED', 'FAILED': 'FAILED', 'CANCELLED': 'CANCELLED'}


def prompt_units(text):
    return len(text.encode('utf-16-le')) // 2


def validate(settings, duration):
    spec = runway_models.contract(settings)
    if spec['ratios'] and settings.get('runway_ratio') not in spec['ratios']:
        raise ValueError('Choose an output shape supported by this model and input mode.')
    if spec['resolutions'] and settings.get('runway_resolution') not in spec['resolutions']:
        raise ValueError('Choose an output quality supported by this model.')
    if isinstance(duration, bool):
        raise ValueError('Choose a supported clip length.')
    try: seconds = float(duration)
    except (ValueError, TypeError): seconds = float('nan')
    if not math.isfinite(seconds) or seconds not in spec['durations']:
        raise ValueError('Choose a supported clip length: ' + ', '.join(str(x) for x in spec['durations']) + ' seconds.')
    seed = settings.get('runway_seed')
    if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 4294967295):
        raise ValueError('Use a Runway seed from 0 to 4294967295, or leave it blank.')
    if seed is not None and not spec['seed']:
        raise ValueError('This model does not support a seed. Leave it blank.')
    if not isinstance(settings.get('runway_audio', True), bool):
        raise ValueError('Use an on/off value for sound.')
    return int(seconds)


def image_data(blob, model='gen4.5'):
    with Image.open(io.BytesIO(blob)) as original:
        if original.width * original.height > 30_000_000:
            raise ValueError('Use a starting frame smaller than 30 million pixels.')
        original.load()
        image = ImageOps.exif_transpose(original).convert('RGB')
    aspect = image.width / image.height
    maximum = 2 if model == 'gen4.5' else 2.358
    if model in ('gen4.5', 'gen4_turbo') and not .5 <= aspect <= maximum:
        raise ValueError('Crop your Runway starting frame: width divided by height must be between 0.5 and ' + str(maximum) + ' for this model.')
    if model == 'grok_imagine_1_5_lite' and not .4 <= aspect <= 2.5:
        raise ValueError('Crop your starting frame to a width/height ratio between 0.4 and 2.5.')
    if model == 'h3_max' and min(image.size) < 256:
        raise ValueError('Use a starting frame at least 256 pixels on each side for MiniMax H3 Max.')
    image.thumbnail((2048, 2048))
    for quality in (92, 85, 75, 60):
        stream = io.BytesIO()
        image.save(stream, format='JPEG', quality=quality)
        uri = 'data:image/jpeg;base64,' + base64.b64encode(stream.getvalue()).decode('ascii')
        if len(uri) <= 5 * 1024 * 1024:
            return uri
    raise ValueError('Resize your starting frame before sending it to Runway.')


def build_request(prompt, settings, images):
    seconds = validate(settings, settings.get('duration'))
    spec = runway_models.contract(settings)
    prompt = str(prompt).strip()
    if not spec['prompt_min'] <= prompt_units(prompt) <= spec['prompt_max']:
        raise ValueError('Use a prompt of ' + str(spec['prompt_min']) + '–' + str(spec['prompt_max']) + ' characters for this model (some emoji count as two).')
    payload = {'model': settings['runway_model'], 'promptText': prompt,
               'duration': seconds}
    if spec['ratios']: payload['ratio'] = settings['runway_ratio']
    if spec['resolutions']: payload['resolution'] = settings['runway_resolution']
    if spec['audio_toggle']: payload['audio'] = settings.get('runway_audio', True)
    if settings.get('runway_seed') is not None:
        payload['seed'] = settings['runway_seed']
    if settings['runway_mode'] == 'first_frame':
        slot = settings.get('runway_start_slot', 'ref_a')
        if slot not in ('ref_a', 'ref_b') or not images.get(slot):
            raise ValueError('Choose or upload the selected starting frame before generating with Runway.')
        payload['promptImage'] = image_data(images[slot], settings['runway_model'])
    elif settings['runway_mode'] == 'reference':
        refs=[image_data(images[s],settings['runway_model']) for s in ('ref_a','ref_b') if images.get(s)]
        if not refs:raise ValueError('Add at least one character reference before generating.')
        payload['references']=[{'uri':uri} for uri in refs]
    return payload


def _safe_detail(value, key, payload=None):
    text = str(value)
    if key: text = text.replace(key, '[hidden]')
    prompt = (payload or {}).get('promptText')
    if isinstance(prompt, str) and prompt: text = text.replace(prompt, '[prompt omitted]')
    text = re.sub(r'data:[^;\s,]+;base64,[A-Za-z0-9+/_=-]+', '[image omitted]', text, flags=re.I)
    text = re.sub(r'(?:key_|sk-|rpa_)[A-Za-z0-9_-]{12,}', '[hidden]', text)
    text = re.sub(r'Bearer\s+[^\s,;]+', 'Bearer [hidden]', text, flags=re.I)
    text = re.sub(r'https?://[^\s<>"\']+', '[link omitted]', text)
    return ' '.join(text.split())


def _rejection(response, key, payload=None):
    """Keep useful provider validation errors; never echo credentials or media."""
    hints = {401: 'Check your Runway Developer API key.', 403: 'Check your Runway project access.',
             402: 'Check your Runway Developer credit balance.', 429: 'Runway is limiting requests. Check the existing task before retrying.'}
    try: body = response.json()
    except (ValueError, TypeError): body = None
    notes = []

    def add(value, field=''):
        if not isinstance(value, str) or not value.strip(): return
        note = _safe_detail(((field + ': ') if field else '') + value, key, payload)
        note = note[:220]
        if note not in notes: notes.append(note)

    def visit(value, depth=0):
        if depth > 5 or len(notes) >= 8: return
        if isinstance(value, list):
            for item in value[:12]: visit(item, depth+1)
        elif isinstance(value, dict):
            path = value.get('path', [])
            field = '.'.join(str(p) for p in path[:8] if isinstance(p, (str, int))) if isinstance(path, list) else ''
            add(value.get('message'), field)
            if isinstance(value.get('error'), str): add(value['error'])
            for name in ('error', 'issues', 'errors', 'details', 'unionErrors'):
                nested = value.get(name)
                if isinstance(nested, (dict, list)): visit(nested, depth+1)
                elif name in ('details', 'errors'): add(nested)
    if isinstance(body, (dict, list)): visit(body)
    reason = '; '.join(notes)[:430] if notes else hints.get(response.status_code, 'No validation details were returned. Open Runway Developer → Manage → Request History for the rejected request.')
    settings = []
    for field in ('model', 'duration', 'ratio', 'resolution'):
        if field in (payload or {}): settings.append(field + '=' + _safe_detail(payload[field], key)[:60])
    if payload: settings.append('input=' + ('first frame' if 'promptImage' in payload else 'text'))
    headers = getattr(response, 'headers', {}) or {}
    request_id = headers.get('x-request-id') or headers.get('X-Request-ID')
    request_id = _safe_detail(request_id, key) if request_id else ''
    if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', request_id): request_id = ''
    prefix = 'Runway HTTP ' + str(response.status_code) + '. '
    if request_id: prefix += 'Request ID: ' + request_id + '. '
    context = ' Settings: ' + ', '.join(settings) + '.' if settings else ''
    return (prefix + reason + context)[:690]


def _request(method, path, key, payload=None):
    if not key:
        raise ValueError('Set RUNWAYML_API_SECRET in your server environment and restart.')
    try:
        response = requests.request(method, API_ROOT + path,
            headers={'Authorization': 'Bearer ' + key, 'X-Runway-Version': API_VERSION,
                     'Content-Type': 'application/json'}, json=payload, timeout=(10, 60))
    except requests.RequestException:
        raise ValueError('Runway could not be reached. If you were submitting, check your Runway task history before trying again to avoid a duplicate charge.') from None
    if response.status_code >= 400:
        message = _rejection(response, key, payload)
        logger.warning('%s %s rejected: %s', method, path, message)
        raise ValueError(message)
    try: value = response.json()
    except ValueError: raise ValueError('Runway returned an unreadable response. Check task history before resubmitting.') from None
    if not isinstance(value, dict):
        raise ValueError('Runway returned an invalid task response.')
    return value


def normalize(value):
    urls = value.get('output')
    url = next((u for u in urls if isinstance(u, str) and u.startswith('https://')), None) if isinstance(urls, list) else None
    result = {'id': value.get('id'), 'status': STATUS.get(value.get('status'), 'UNKNOWN'),
              'output': {'video_url': url} if url else {}, 'usage': {}}
    for field, target in (('cost', 'credits'), ('estimatedCost', 'estimated_credits')):
        amount = value.get(field, {})
        amount = amount.get('credits') if isinstance(amount, dict) else None
        if isinstance(amount, (int, float)) and not isinstance(amount, bool) and math.isfinite(amount) and amount >= 0:
            result['usage'][target] = amount
    if value.get('status') == 'FAILED':
        result['error'] = 'Runway generation failed. ' + str(value.get('failureCode') or value.get('failure') or 'Check the task in Runway Developer.')[:300]
    return result


def submit(key, payload):
    path = '/image_to_video' if 'promptImage' in payload else '/text_to_video'
    value = _request('POST', path, key, payload)
    task_id = value.get('id')
    if not valid_task_id(task_id):
        raise ValueError('Runway did not return a valid task ID. Check task history before resubmitting.')
    return {'id': task_id, 'status': 'IN_QUEUE'}


def valid_task_id(value):
    return isinstance(value, str) and bool(re.fullmatch(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}', value))


def status(key, task_id):
    if not valid_task_id(task_id):
        raise ValueError('Invalid Runway task ID.')
    return normalize(_request('GET', '/tasks/' + task_id, key))
