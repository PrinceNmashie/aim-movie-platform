"""Alibaba Cloud moderation for an immutable Discover submission."""

import json
import math
import os
import re
from urllib.parse import urlsplit

import oss2
from alibabacloud_green20220302 import models
from alibabacloud_green20220302.client import Client
from alibabacloud_tea_openapi.models import Config
from alibabacloud_tea_util.models import RuntimeOptions


REGIONS = {'ap-southeast-1', 'us-east-1'}
VIDEO_SERVICE = 'videoDetection_global'
TEXT_SERVICE = 'text_multilingual_pro_global'
RISKS = ('none', 'low', 'medium', 'high')
MAX_FINDINGS = 8


class ModerationError(Exception):
    """A provider response did not establish a complete moderation result."""


def region():
    return os.getenv('AIM_DISCOVER_REVIEW_REGION', 'ap-southeast-1').strip()


def configured():
    return region() in REGIONS and all(
        os.getenv(key, '').strip()
        for key in ('ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET')
    )


def client_for(location):
    if location not in REGIONS:
        raise ModerationError('Invalid moderation region.')
    return Client(Config(
        region_id=location,
        endpoint=f'green-cip.{location}.aliyuncs.com',
        access_key_id=os.environ['ALIBABA_CLOUD_ACCESS_KEY_ID'].strip(),
        access_key_secret=os.environ['ALIBABA_CLOUD_ACCESS_KEY_SECRET'].strip(),
        connect_timeout=5000,
        read_timeout=15000,
    ))


def body_map(response):
    if response.status_code != 200 or response.body is None:
        raise ModerationError('The moderation request did not succeed.')
    return response.body.to_map()


def checked_data(body):
    code = str(body.get('Code'))
    data = body.get('Data')
    if code != '200' and re.fullmatch(r'[0-9]{3}', code):
        raise ModerationError(f'The moderation provider returned code {code}.')
    if code != '200' or not isinstance(data, dict):
        raise ModerationError('The moderation provider did not return a complete result.')
    return data


def label_names(items):
    return ', '.join(dict.fromkeys(
        str(item['Label'])[:64] for item in (items or []) if item.get('Label')
    ))[:240]


def check_text(client, runtime, sid, text):
    risk = 'none'
    findings = []
    # TextModerationPlus accepts 600 characters. Overlap consecutive pieces
    # so splitting a long caption preserves some context at each boundary.
    for index, start in enumerate(range(0, len(text), 500)):
        piece = text[max(0, start - 80):start + 500].strip()
        if not piece:
            continue
        data_id = f'{sid}-text-{index}'
        request = models.TextModerationPlusRequest(
            service=TEXT_SERVICE,
            service_parameters=json.dumps({'content': piece, 'dataId': data_id}),
        )
        result = checked_data(body_map(client.text_moderation_plus_with_options(request, runtime)))
        level = result.get('RiskLevel')
        if result.get('DataId') != data_id or level not in RISKS:
            raise ModerationError('The public text check is incomplete.')
        risk = max(risk, level, key=RISKS.index)
        if level != 'none':
            findings.append({'source': 'Public text', 'seconds': None,
                             'label': label_names(result.get('Result')) or 'Review public text'})
    return {'risk': risk, 'findings': findings[:MAX_FINDINGS]}


def start(path, sid, public_text, location):
    """Stage the file in the provider's temporary upload bucket and submit once."""
    client = client_for(location)
    runtime = RuntimeOptions(autoretry=False)
    text = check_text(client, runtime, sid, public_text)
    token = checked_data(body_map(client.describe_upload_token_with_options(runtime)))
    endpoint = token['OssInternetEndPoint']
    host = urlsplit(endpoint if '://' in endpoint else 'https://' + endpoint).hostname or ''
    if not re.fullmatch(r'oss-[a-z0-9-]+\.aliyuncs\.com', host):
        raise ModerationError('Unexpected moderation upload endpoint.')
    auth = oss2.StsAuth(token['AccessKeyId'], token['AccessKeySecret'], token['SecurityToken'])
    bucket = oss2.Bucket(auth, 'https://' + host, token['BucketName'], connect_timeout=60)
    object_name = token['FileNamePrefix'] + sid + '.mp4'
    bucket.put_object_from_file(object_name, str(path))
    request = models.VideoModerationRequest(
        service=VIDEO_SERVICE,
        service_parameters=json.dumps({'dataId': sid, 'ossBucketName': token['BucketName'],
                                       'ossObjectName': object_name}),
    )
    result = checked_data(body_map(client.video_moderation_with_options(request, runtime)))
    task_id = result.get('TaskId')
    if result.get('DataId') != sid or not isinstance(task_id, str) or not task_id:
        raise ModerationError('The video check did not return a matching task.')
    return task_id, text


def evidence(source, offset, label, duration):
    seconds = float(offset) if isinstance(offset, (int, float)) else None
    if seconds is not None and (not math.isfinite(seconds) or not 0 <= seconds <= duration):
        seconds = None
    return {'source': source, 'seconds': seconds, 'label': label or 'Review this segment'}


def interpret_video(data, sid, task_id, *, has_audio, duration):
    if data.get('DataId') != sid or data.get('TaskId') != task_id:
        raise ModerationError('The result does not match the submitted video.')
    frames = data.get('FrameResult') or {}
    audio = data.get('AudioResult') or {}
    levels = [data.get('RiskLevel'), frames.get('RiskLevel')]
    if has_audio or audio:
        levels.append(audio.get('RiskLevel'))
    if not isinstance(frames.get('FrameNum'), int) or frames['FrameNum'] < 1 or any(
        level not in RISKS for level in levels
    ):
        raise ModerationError('The video or audio check is incomplete.')

    findings = []
    for frame in frames.get('Frames') or []:
        label = label_names([hit for group in (frame.get('Results') or []) for hit in (group.get('Result') or [])])
        if frame.get('RiskLevel') in RISKS[1:] or (label and frames['RiskLevel'] != 'none'):
            findings.append(evidence('Video', frame.get('Offset'), label, duration))
    for segment in audio.get('SliceDetails') or []:
        label = label_names(segment.get('Result')) or str(segment.get('Labels') or '')[:240]
        if segment.get('RiskLevel') in RISKS[1:] or (label and audio.get('RiskLevel') != 'none'):
            findings.append(evidence('Audio', segment.get('StartTime'), label, duration))
    risk = max(levels, key=RISKS.index)
    if risk == 'none' and findings:
        raise ModerationError('The video check returned conflicting results.')
    if risk != 'none' and not findings:
        label = label_names(frames.get('FrameSummarys')) or label_names(audio.get('AudioSummarys'))
        findings.append(evidence('Video and audio', None, label, duration))
    findings.sort(key=lambda item: item['seconds'] if item['seconds'] is not None else float('inf'))
    return {'risk': risk, 'findings': findings[:MAX_FINDINGS]}


def result(task_id, sid, location, *, has_audio, duration):
    client = client_for(location)
    request = models.VideoModerationResultRequest(
        service=VIDEO_SERVICE, service_parameters=json.dumps({'taskId': task_id}),
    )
    body = body_map(client.video_moderation_result_with_options(request, RuntimeOptions(autoretry=False)))
    if str(body.get('Code')) in ('280', '288'):
        return None
    return interpret_video(checked_data(body), sid, task_id, has_audio=has_audio, duration=duration)
