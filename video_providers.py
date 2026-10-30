"""Video options and clearly labeled price estimates, separate from credentials."""
import math
import re
import runway_client
import runway_models

PRICING_DATE = '2026-10-28'
WAN_MODEL = 'wan3.0-video'
WAN_PRICING_URL = 'https://www.alibabacloud.com/help/en/model-studio/wan3-0-video'
RUNWAY_PRICING_URL = 'https://docs.dev.runwayml.com/guides/pricing/'
RUNWAY_PRICING_DATE = '2026-10-28'
RUNWAY_CREDIT_USD = .01
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
    provider = saved.get('video_provider') or cfg('VIDEO_PROVIDER') or 'runway'
    if provider == 'runpod': provider = 'runway'  # Migrate selection, never relabel historical jobs.
    if provider not in ('runway', 'alibaba'): provider = 'runway'
    model = saved.get('runway_model') or cfg('RUNWAY_MODEL') or 'gen4.5'
    if model not in runway_client.MODELS: model = 'gen4.5'
    return runway_models.normalize_settings({
        'video_provider': provider,
        'runway_model': model,
        'runway_mode': saved.get('runway_mode', 'first_frame'),
        'runway_start_slot': saved.get('runway_start_slot', 'ref_a'),
        'runway_ratio': saved.get('runway_ratio', '1280:720'),
        'runway_resolution': saved.get('runway_resolution', '720p'),
        'runway_audio': saved.get('runway_audio', True),
        'runway_seed': saved.get('runway_seed'),
        'wan_region': saved.get('wan_region') or cfg('ALIBABA_REGION') or 'ap-southeast-1',
        'wan_workspace': saved.get('wan_workspace') or cfg('ALIBABA_WORKSPACE_ID') or cfg('DASHSCOPE_WORKSPACE_ID'),
        'wan_resolution': saved.get('wan_resolution', '720P'),
        'wan_mode': saved.get('wan_mode', 'reference'),
        'wan_start_slot': saved.get('wan_start_slot', 'ref_a'),
        'wan_audio': saved.get('wan_audio', True),
        'wan_prompt_extend': saved.get('wan_prompt_extend', False),
        'speak_replies': saved.get('speak_replies', False),
    })


def validate_settings(values):
    result = {}
    enums = {'video_provider': ('runway', 'alibaba'), 'wan_region': tuple(REGIONS),
            'runway_model': runway_client.MODELS, 'runway_mode': ('first_frame', 'text', 'reference'),
             'runway_start_slot': ('ref_a', 'ref_b'), 'runway_ratio': ('',) + runway_client.RATIOS,
             'runway_resolution': ('',) + runway_client.RESOLUTIONS,
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
    for field in ('wan_audio', 'wan_prompt_extend', 'speak_replies', 'runway_audio'):
        if field in values:
            if not isinstance(values[field], bool):
                raise ValueError('Use an on/off value for ' + field.replace('_', ' ') + '.')
            result[field] = values[field]
    if 'runway_seed' in values:
        seed = values['runway_seed']
        if seed in ('', None): result['runway_seed'] = None
        else:
            n = number(seed, 'Runway seed', 4294967295, allow_blank=False)
            if n != int(n): raise ValueError('Use a whole-number Runway seed.')
            result['runway_seed'] = int(n)
    return result


def limits(prefs):
    choices = runway_models.contract(prefs)['durations'] if prefs['video_provider'] == 'runway' else list(range(2,31))
    return {'min_duration': min(choices), 'max_duration': max(choices), 'durations': choices}


def validate_duration(value):
    try: duration = float(value)
    except (ValueError, TypeError): duration = float('nan')
    if isinstance(value, bool) or not math.isfinite(duration) or not 1 <= duration <= 30:
        raise ValueError('Choose a supported duration from 1 to 30 seconds.')
    return duration


def options(values, prefs):
    settings = {**prefs, **validate_settings(values)}
    duration = validate_duration(values.get('duration', 5))
    if settings['video_provider'] == 'runway':
        duration = runway_client.validate(settings, values.get('duration', 5))
    elif settings['video_provider'] == 'alibaba':
        if duration != int(duration) or duration < 2:
            raise ValueError('Wan requires a whole number of seconds, from 2 to 30.')
    else: raise ValueError('Choose Runway Developer or Alibaba Wan 3.0.')
    return {**settings, 'duration': duration}


def catalog(prefs):
    return {'wan_model': WAN_MODEL, 'pricing_checked': PRICING_DATE,
            'regions': [{'id': key, 'name': name} for key, name in REGIONS.items()],
            'rates_by_region': {key: SG_RATES if key == 'ap-southeast-1' else GLOBAL_RATES for key in REGIONS},
            'wan_pricing_url': WAN_PRICING_URL, 'runway_pricing_url': RUNWAY_PRICING_URL,
            'runway_pricing_checked': RUNWAY_PRICING_DATE, 'runway_credit_usd': RUNWAY_CREDIT_USD,
            'runway_models': runway_models.catalog(), 'runway_price': runway_models.price_settings(prefs),
            'runway_ratios': list(runway_client.RATIOS)}


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
    estimate = runway_models.quote(settings, duration)
    return {'provider': provider, 'basis': 'generated_video_second', 'currency': 'USD',
            **estimate, 'duration_seconds': duration,
            'model': settings.get('runway_model'), 'pricing_checked': RUNWAY_PRICING_DATE,
            'source_url': RUNWAY_PRICING_URL, 'price_type': 'published_list_price'}
