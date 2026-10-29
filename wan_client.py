"""Direct Alibaba Model Studio Wan 3.0 API, with asynchronous tasks."""
import base64
import io
import re
from PIL import Image
import requests
import video_providers

STATUS = {'PENDING': 'IN_QUEUE', 'RUNNING': 'IN_PROGRESS', 'SUCCEEDED': 'COMPLETED',
          'FAILED': 'FAILED', 'CANCELED': 'CANCELLED', 'UNKNOWN': 'UNKNOWN'}


def endpoint(workspace, region):
    if region not in video_providers.REGIONS:
        raise ValueError('Choose the Alibaba region that matches your API key.')
    if not workspace or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,62}', workspace):
        raise ValueError('Add your Alibaba workspace ID in Settings or ALIBABA_WORKSPACE_ID in .env.')
    return f'https://{workspace}.{region}.maas.aliyuncs.com/api/v1'


def image_data(blob):
    image = Image.open(io.BytesIO(blob)).convert('RGB')
    if max(image.size) / min(image.size) > 8:
        raise ValueError('Wan images must have an aspect ratio no wider than 8:1.')
    if min(image.size) < 240:
        scale = 240 / min(image.size)
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    if max(image.size) > 8000:
        raise ValueError('Use a Wan reference with 8000 pixels or fewer per side.')
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    data = stream.getvalue()
    if len(data) > 20 * 1024 * 1024:
        raise ValueError('Use a Wan image smaller than 20 MB.')
    return 'data:image/png;base64,' + base64.b64encode(data).decode('ascii')


def build_request(prompt, settings, images):
    duration = settings['duration']
    if isinstance(duration, bool) or duration != int(duration) or not 2 <= duration <= 30:
        raise ValueError('Wan requires a whole number of seconds, from 2 to 30.')
    if not str(prompt).strip() or len(prompt) > 20000:
        raise ValueError('Use a video prompt between 1 and 20,000 characters for Wan.')
    mode = settings['wan_mode']
    media = []
    if mode == 'first_frame':
        slot = settings['wan_start_slot']
        if not images.get(slot):
            raise ValueError('Choose or upload the starting frame before rendering with Wan.')
        media = [{'type': 'first_frame', 'url': image_data(images[slot])}]
    elif mode == 'reference':
        for slot in ('ref_a', 'ref_b'):
            if images.get(slot):
                media.append({'type': 'reference_image', 'url': image_data(images[slot])})
        if not media:
            raise ValueError('Choose at least one image for Wan reference mode, or select Text only.')
    elif mode != 'text':
        raise ValueError('Choose a valid Wan generation mode.')
    input_value = {'prompt': prompt}
    if media:
        input_value['media'] = media
    return {'model': video_providers.WAN_MODEL, 'input': input_value,
            'parameters': {'resolution': settings['wan_resolution'], 'duration': int(duration),
                           'ratio': 'adaptive', 'audio': settings['wan_audio'],
                           'prompt_extend': settings['wan_prompt_extend'], 'watermark': False}}


def _request(method, base, key, path, payload=None):
    if not key:
        raise ValueError('Add ALIBABA_API_KEY (or DASHSCOPE_API_KEY) to .env, then restart.')
    headers = {'Authorization': 'Bearer ' + key}
    if method == 'POST':
        headers.update({'Content-Type': 'application/json', 'X-DashScope-Async': 'enable'})
    response = requests.request(method, base + path, headers=headers, json=payload, timeout=90)
    try:
        value = response.json()
    except ValueError:
        raise ValueError('Alibaba returned an unreadable response. Check its service status and try again.') from None
    if response.status_code >= 400 or value.get('code'):
        code = value.get('code') or str(response.status_code)
        message = str(value.get('message') or 'Check your model access, region, workspace, and API balance.')
        raise ValueError(('Alibaba ' + str(code) + ': ' + message).replace(key, '[hidden]')[:650])
    return value


def normalize(value):
    output = value.get('output') or {}
    result = {'id': output.get('task_id'), 'status': STATUS.get(output.get('task_status'), 'UNKNOWN'),
              'output': {'video_url': output['video_url']} if output.get('video_url') else {},
              'usage': value.get('usage') or {}}
    if output.get('code') or output.get('message'):
        result['error'] = str(output.get('code') or '') + ': ' + str(output.get('message') or '')
    return result


def submit(workspace, region, key, payload):
    return normalize(_request('POST', endpoint(workspace, region), key,
                              '/services/aigc/video-generation/video-synthesis', payload))


def status(workspace, region, key, task_id):
    if not isinstance(task_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', task_id):
        raise ValueError('Invalid Alibaba task ID.')
    return normalize(_request('GET', endpoint(workspace, region), key, '/tasks/' + task_id))
