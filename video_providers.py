"""Video options and clearly labeled price estimates, separate from credentials."""
import math
import re
import runpod_client

PRICING_DATE = '2026-10-14'
WAN_MODEL = 'wan3.0-video'
WAN_PRICING_URL = 'https://www.alibabacloud.com/help/en/model-studio/wan3-0-video'
RUNPOD_PRICING_URL = 'https://docs.runpod.io/serverless/pricing'
REGIONS = {
    'ap-southeast-1': 'Singapore', 'us-east-1': 'US (Virginia)',
    'ap-northeast-1': 'Japan (Tokyo)', 'eu-central-1': 'Germany (Frankfurt)',
    'cn-hongkong': 'China (Hong Kong)', 'cn-beijing': 'China (Beijing)',
}
RESOLUTIONS = ('480P', '720P', '1080P')
SG_RATES = {'480P': .05, '720P': .10, '1080P': .20}
GLOBAL_RATES = {'480P': .041256, '720P': .082513, '1080P': .165025}
MODES = ('reference', 'first_frame', 'text')


def number(value, field, maximum, allow_blank=True):
    if isinstance(value, bool):
        raise ValueError('Enter a valid number for ' + field + '.')
    if value is None or value == '':
        if allow_blank:
            return None
        raise ValueError('Enter ' + field + '.')
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError('Enter a valid number for ' + field + '.') from None
    if not math.isfinite(result) or not 0 <= result <= maximum:
        raise ValueError('Enter a valid non-negative value for ' + field + '.')
    return result


def defaults(saved, cfg):
    def estimate(field, env, maximum):
        try:
            return number(saved.get(field, cfg(env)), field.replace('_', ' '), maximum)
        except ValueError:
            return None
    return {
        'video_provider': saved.get('video_provider') or cfg('VIDEO_PROVIDER') or 'runpod',
        'wan_region': saved.get('wan_region') or cfg('ALIBABA_REGION') or 'ap-southeast-1',
        'wan_workspace': saved.get('wan_workspace') or cfg('ALIBABA_WORKSPACE_ID') or cfg('DASHSCOPE_WORKSPACE_ID'),
        'wan_resolution': saved.get('wan_resolution', '720P'),
        'wan_mode': saved.get('wan_mode', 'reference'),
        'wan_start_slot': saved.get('wan_start_slot', 'ref_a'),
        'wan_audio': saved.get('wan_audio', True),
        'wan_prompt_extend': saved.get('wan_prompt_extend', False),
        'runpod_gpu_rate': estimate('runpod_gpu_rate', 'RUNPOD_GPU_USD_PER_SECOND', 100),
        'runpod_seconds_for_15s': estimate('runpod_seconds_for_15s', 'RUNPOD_SECONDS_FOR_15S', 100000),
        'speak_replies': saved.get('speak_replies', False),
    }


def validate_settings(values):
    result = {}
    enums = {'video_provider': ('runpod', 'alibaba'), 'wan_region': tuple(REGIONS),
             'wan_resolution': RESOLUTIONS, 'wan_mode': MODES, 'wan_start_slot': ('ref_a', 'ref_b')}
    for field, choices in enums.items():
        if field in values:
            if values[field] not in choices:
                raise ValueError('Choose a valid ' + field.replace('_', ' ') + '.')
            result[field] = values[field]
    if 'wan_workspace' in values:
        workspace = str(values['wan_workspace'] or '').strip()
        if workspace and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,62}', workspace):
            raise ValueError('Enter the workspace ID from Alibaba Model Studio, using letters, numbers, or hyphens.')
        result['wan_workspace'] = workspace
    for field in ('wan_audio', 'wan_prompt_extend', 'speak_replies'):
        if field in values:
            if not isinstance(values[field], bool):
                raise ValueError('Use an on/off value for ' + field.replace('_', ' ') + '.')
            result[field] = values[field]
    for field, maximum in [('runpod_gpu_rate', 100), ('runpod_seconds_for_15s', 100000)]:
        if field in values:
            result[field] = number(values[field], field.replace('_', ' '), maximum)
    return result


def options(values, prefs):
    settings = {**prefs, **validate_settings(values)}
    duration = runpod_client.validate_duration(values.get('duration', 5))
    if settings['video_provider'] == 'alibaba' and duration != int(duration):
        raise ValueError('Wan requires a whole number of seconds, from 3 to 15.')
    if settings['video_provider'] not in ('runpod', 'alibaba'):
        raise ValueError('Choose Runpod or Alibaba Wan 3.0.')
    if settings['video_provider'] == 'alibaba':
        validate_settings({key: settings[key] for key in ('wan_region', 'wan_resolution', 'wan_mode', 'wan_start_slot')})
    return {**settings, 'duration': duration}


def catalog(prefs):
    return {'wan_model': WAN_MODEL, 'pricing_checked': PRICING_DATE,
            'regions': [{'id': key, 'name': name} for key, name in REGIONS.items()],
            'rates_by_region': {key: SG_RATES if key == 'ap-southeast-1' else GLOBAL_RATES for key in REGIONS},
            'wan_pricing_url': WAN_PRICING_URL, 'runpod_pricing_url': RUNPOD_PRICING_URL,
            'runpod_gpu_rate': prefs['runpod_gpu_rate'], 'runpod_seconds_for_15s': prefs['runpod_seconds_for_15s']}


def quote(settings, duration):
    provider = settings['video_provider']
    if provider == 'alibaba':
        region = settings['wan_region']
        if region not in REGIONS or settings['wan_resolution'] not in RESOLUTIONS:
            return {'provider': provider, 'estimated_cost_usd': None, 'basis': 'generated_video_second'}
        rate = (SG_RATES if region == 'ap-southeast-1' else GLOBAL_RATES)[settings['wan_resolution']]
        return {'provider': provider, 'basis': 'generated_video_second', 'currency': 'USD',
                'unit_rate_usd': rate, 'duration_seconds': duration, 'estimated_cost_usd': round(rate * duration, 6),
                'region': region, 'resolution': settings['wan_resolution'], 'model': WAN_MODEL,
                'pricing_checked': PRICING_DATE, 'source_url': WAN_PRICING_URL, 'price_type': 'published_list_price'}
    rate, benchmark = settings['runpod_gpu_rate'], settings['runpod_seconds_for_15s']
    compute = None if benchmark is None else benchmark * duration / 15
    amount = None if rate is None or compute is None else round(rate * compute, 6)
    return {'provider': provider, 'basis': 'gpu_worker_second', 'currency': 'USD', 'unit_rate_usd': rate,
            'duration_seconds': duration, 'estimated_compute_seconds': compute, 'estimated_cost_usd': amount,
            'source_url': RUNPOD_PRICING_URL, 'price_type': 'user_configured_compute_estimate'}
