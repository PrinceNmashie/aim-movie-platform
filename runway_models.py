"""Supported text/image video model contracts and list-price estimates.

Contracts snapshot the official Runway Developer OpenAPI on 2026-10-28.
No source videos, draft enhancement, HDR or alternate output formats are sent.
"""
import datetime as dt
import json
import math
import copy
from pathlib import Path

CATALOG = json.loads(Path(__file__).with_suffix('.json').read_text())
MODELS = {m['id']: m for m in CATALOG['models']}
REFERENCE_MODELS = ('wan3','wan3_prime','seedance2','seedance2_fast','seedance2_mini','seedance2_5','kling_4')
# These contracts use /text_to_video with `references`, never a first-frame promptImage.
for mid in REFERENCE_MODELS:
    MODELS[mid]['modes']['reference'] = copy.deepcopy(MODELS[mid]['modes']['text'])
    if mid in ('wan3','wan3_prime','kling_4'):
        MODELS[mid]['modes']['reference']['ratios'] = [r for r in MODELS[mid]['modes']['reference']['ratios'] if not r.startswith('auto_')]


def contract(settings):
    model = MODELS.get(settings.get('runway_model'))
    if not model:
        raise ValueError('Choose a supported video model.')
    mode = settings.get('runway_mode', 'first_frame')
    if mode not in model['modes']:
        raise ValueError(model['name'] + ' needs a starting frame.')
    return model['modes'][mode]


def normalize_settings(settings):
    """Fit previously saved options when changing model; validate new requests separately."""
    result = dict(settings)
    if result.get('runway_model') not in MODELS:
        result['runway_model'] = 'gen4.5'
    model = MODELS[result['runway_model']]
    if result.get('runway_mode') not in model['modes']:
        result['runway_mode'] = 'reference' if 'reference' in model['modes'] else 'first_frame'
    spec = contract(result)
    for field, choices in [('runway_ratio', spec['ratios']), ('runway_resolution', spec['resolutions'])]:
        if result.get(field) not in choices:
            result[field] = next((x for x in ('1280:720', '16:9', 'auto_720p', '720p', '768p') if x in choices), choices[0] if choices else '')
    if not spec['seed']:
        result['runway_seed'] = None
    return result


def fit_duration(settings, value):
    try:
        value = float(value)
        if not math.isfinite(value): value = 5
    except (TypeError, ValueError): value = 5
    choices = contract(settings)['durations']
    return min(choices, key=lambda seconds: (abs(seconds-value), seconds))


def price_settings(settings):
    """Public quote inputs; estimates include the actual chosen shape, sound and start frame."""
    model = settings['runway_model'];spec = contract(settings)
    ratio = settings.get('runway_ratio');resolution = settings.get('runway_resolution')
    image = settings.get('runway_mode') == 'first_frame'
    audio = bool(settings.get('runway_audio', True))
    index = spec['ratios'].index(ratio) if ratio in spec['ratios'] else 0
    rate = None;extra = 0;minimum = 0;discount = 1
    if model in ('gen4.5', 'gen4_turbo'): rate = 12 if model == 'gen4.5' else 5
    elif model in ('veo3.1', 'veo3.1_fast'):
        rate = (40 if audio else 20) if model == 'veo3.1' else (15 if audio else 10)
    elif model == 'kling2.5_turbo_pro': rate = 12
    elif model in ('kling3.0_standard', 'kling3.0_pro'):
        rate = (13 if audio else 9) if model.endswith('standard') else (17 if audio else 12)
    elif model in ('kling3.0_4k', 'klingO3_4k'): rate = 43
    elif model in ('klingO3_standard', 'klingO3_pro'): rate = 13 if model.endswith('standard') else 17
    elif model == 'kling_4':
        high = ratio == 'auto_1080p' or ratio in ['1920:1080','1080:1920','1440:1440','2200:940']
        rate = 23.5 if high else 15.7
        discount = .8 if dt.datetime.now(dt.timezone.utc).date() <= dt.date(2026,11,30) else 1
    elif model in ('wan3', 'wan3_prime'):
        tier = int(ratio.removeprefix('auto_').removesuffix('p')) if ratio and ratio.startswith('auto_') else (480,720,1080)[min(index//5,2)]
        rate = ({480:5,720:10,1080:20} if model=='wan3' else {480:6.8,720:14,1080:28})[tier]
    elif model.startswith('seedance2'):
        tier = min(index//6, 3)
        rates = {'seedance2':[14,30,40,150],'seedance2_fast':[11,24], 'seedance2_mini':[7,15], 'seedance2_5':[20,30,68]}[model]
        rate = rates[min(tier,len(rates)-1)]
        minimum = {'seedance2':56,'seedance2_fast':44,'seedance2_mini':28,'seedance2_5':80}[model]
    elif model == 'hailuo3': rate = 15 if resolution == '2k' else 10;extra = 2 if image else 0
    elif model == 'h3_max': rate = 8 if resolution == '768p' else 5
    elif model == 'happyhorse_1_0': rate = (30 if resolution=='1080p' else 15) if image else (15 if index<5 else 30)
    elif model == 'grok_imagine_1_5': rate = {'480p':10,'720p':16,'1080p':29}.get(resolution,16);extra = 1 if image else 0
    elif model == 'grok_imagine_1_5_lite':
        tier = ['auto_480p','auto_720p','auto_1080p'].index(ratio) if image else min(index//7,2)
        rate = [2,3,14][tier];extra = 1 if image else 0
    elif model == 'gemini_omni_flash': rate = 10;extra = 1 if image else 0
    elif model == 'gemini_omni_flash_1.1': rate = [3.4,10,15,30][min(index//2,3)];extra = 1 if image else 0
    return {'credits_per_second':rate,'input_credits':extra,'minimum_credits':minimum,
            'discount':discount,'round_up':model=='kling_4'}


def quote(settings, seconds):
    p = price_settings(settings)
    raw = max(p['minimum_credits'], seconds*p['credits_per_second']+p['input_credits'])
    credits = math.ceil(math.ceil(raw)*p['discount']) if p['round_up'] else round(raw*p['discount'],6)
    return {**p, 'estimated_credits':credits, 'estimated_cost_usd':round(credits*.01,6),
            'unit_rate_usd':p['credits_per_second']*p['discount']*.01}


def catalog():
    return list(MODELS.values())
