"""Creative workflow, review boundaries and character identity helpers."""
import copy
import hashlib
import json
import re
import uuid
import store
import runway_models
import math

STAGES = ['vision', 'characters', 'script', 'director']
CHAR_FIELDS = ['name', 'role', 'age', 'appearance', 'wardrobe', 'personality', 'backstory', 'identity_constraints', 'reference_image_prompt']

def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

def planning_policy(vision, durations):
    try:
        target = float(vision.get('duration_seconds') or 30)
    except (TypeError, ValueError, OverflowError):
        target = 30
    if not math.isfinite(target):
        target = 30
    return {'target_seconds': max(min(durations), min(7200, round(target))),
            'maximum_clip_seconds': max(durations)}

def workspace_id():
    current = store.get('workspace_id')
    if not current:
        current = uuid.uuid4().hex
        store.put('workspace_id', current)
    return current

def invalidate(stage):
    meta = store.get('workflow_meta', {'approved': {}, 'stale': []})
    first = STAGES.index(stage)
    for affected in STAGES[first:]:
        meta.setdefault('approved', {})[affected] = False
        if affected != stage and store.get(affected) and affected not in meta.setdefault('stale', []):
            meta['stale'].append(affected)
    store.put('workflow_meta', meta)

def save(stage, value, note='Edited by creator'):
    previous = store.get(stage)
    if previous != value:
        store.put(stage, value)
        invalidate(stage)
        if store.get('render_prompt'):
            store.put('prompt_needs_refresh', True)
        store.record(stage, note)
    meta = store.get('workflow_meta', {'approved': {}, 'stale': []})
    meta['stale'] = [s for s in meta.get('stale', []) if s != stage]
    store.put('workflow_meta', meta)

def approve(stage):
    if stage not in STAGES:
        raise ValueError('Unknown review step.')
    value = store.get(stage, {})
    if not value:
        raise ValueError('Create a draft before continuing.')
    if stage == 'vision' and not value.get('logline', '').strip():
        raise ValueError('Add a premise to your creative brief before continuing.')
    if stage == 'characters':
        for char in value.get('characters', []):
            if not char.get('name', '').strip() or not char.get('appearance', '').strip():
                raise ValueError('Give each character a name and appearance before continuing.')
    if stage == 'script' and not value.get('scenes'):
        raise ValueError('Add at least one scene before continuing.')
    if stage == 'director' and not value.get('shots'):
        raise ValueError('Add at least one shot before continuing.')
    index = STAGES.index(stage)
    meta = store.get('workflow_meta', {'approved': {}, 'stale': []})
    for previous in STAGES[:index]:
        if not meta.get('approved', {}).get(previous):
            raise ValueError('Review and approve the earlier steps before continuing.')
    meta.setdefault('approved', {})[stage] = True
    meta['stale'] = [s for s in meta.get('stale', []) if s != stage]
    store.put('workflow_meta', meta)
    store.record(stage, 'Creator approved this step')

def normalize_characters(value):
    result, used = [], set()
    for item in value.get('characters', []):
        if not isinstance(item, dict):
            continue
        char = copy.deepcopy(item)
        cid = str(char.get('id') or 'C' + uuid.uuid4().hex[:8])
        cid = re.sub(r'[^A-Za-z0-9_-]', '_', cid)[:80] or uuid.uuid4().hex[:8]
        if cid in used:
            cid += '_' + uuid.uuid4().hex[:6]
        used.add(cid)
        char['id'] = cid
        for field in CHAR_FIELDS:
            char[field] = str(char.get(field) or '')
        char.setdefault('images', [])
        char['use_as_reference'] = char.get('use_as_reference', True) is not False
        result.append(char)
    return {'characters': result}

def merge_characters(draft, existing):
    """A refresh preserves manually edited profiles and image history."""
    incoming = normalize_characters(draft)['characters']
    previous = normalize_characters(existing)['characters']
    kept = set()
    for index, char in enumerate(incoming):
        old = next((c for c in previous if c['id'] == char['id'] or c['name'].casefold() == char['name'].casefold()), None)
        if old:
            kept.add(old['id'])
            if old.get('manually_edited'):
                incoming[index] = old
            else:
                incoming[index] = {**old, **{f: char[f] for f in CHAR_FIELDS}, 'id': old['id']}
    incoming.extend(c for c in previous if c['id'] not in kept)
    return {'characters': incoming}

def character_hash(char):
    return fingerprint({f: char.get(f, '') for f in CHAR_FIELDS})

def sheet_prompt(char, style):
    description = '\n'.join(f'{f.replace("_", " ").title()}: {char.get(f, "")}' for f in CHAR_FIELDS if f != 'reference_image_prompt' and char.get(f))
    return ('Create a professional character reference sheet of ONE character. Show front, side and back full-body views and a face close-up, clearly separated. '
            'Use the exact same face, anatomy, proportions, hair and outfit in every view. Neutral background, even lighting, no scene action, no extra characters. '
            'Use any supplied reference photo for this character’s identity.\nVisual style: ' + style + '\n' + description + '\nCreator direction: ' + char.get('reference_image_prompt', ''))

def selected_image(char):
    return next((v for v in char.get('images', []) if v['id'] == char.get('current_image')), None)

def compile_shot(shot, vision, characters, video_settings=None):
    wanted = {str(x).casefold() for x in shot.get('characters', [])}
    cast = [c for c in characters.get('characters', []) if not wanted or c['id'].casefold() in wanted or c['name'].casefold() in wanted]
    identities = '\n'.join(f'{c["name"]}: {c.get("appearance", "")}. Wardrobe: {c.get("wardrobe", "")}. Identity constraints: {c.get("identity_constraints", "")}' for c in cast)
    if (video_settings or {}).get('video_provider') == 'runway':
        # Fit the selected model's prompt budget.
        limit = runway_models.contract(video_settings)['prompt_max']
        def brief(value, length):
            return str(value or '').encode('utf-16-le')[:length*2].decode('utf-16-le', errors='ignore').strip()
        start = ('Begin from the supplied first frame; preserve its visible cast and setting.' if video_settings.get('runway_mode') == 'first_frame' else
                 'Use the supplied images as character identity references only. Stage one cinematic shot; never show the reference sheet, labels or multiple views.' if video_settings.get('runway_mode') == 'reference' else 'One continuous cinematic shot.')
        lines = [start, 'Action: ' + brief(shot.get('on_screen_action'), 300),
                 'Camera: ' + brief(shot.get('camera'), 100),
                 'Continuity: ' + brief(shot.get('continuity'), 140),
                 'Style: ' + brief(vision.get('visual_style'), 80),
                 'Cast: ' + brief('; '.join(c['name']+': '+brief(c.get('appearance'),35)+', '+brief(c.get('wardrobe'),20) for c in cast), 110),
                 'Direction: ' + brief(shot.get('prompt'), 80),
                 'No identity swaps, morphing or unexpected cuts.']
        return brief('\n'.join(lines), limit)
    bindings = store.get('reference_bindings', {})
    reference_lines = []
    settings = video_settings or {}
    wan = settings.get('video_provider') == 'alibaba'
    mode = settings.get('wan_mode', 'reference') if wan else 'reference'
    slots = [('ref_a', 'Picture 1'), ('ref_b', 'Picture 2')]
    if wan and mode == 'text':
        slots = []
    elif wan and mode == 'first_frame':
        slots = [(settings.get('wan_start_slot', 'ref_a'), 'Starting frame')]
    elif wan:
        available = [slot for slot, _ in slots if store.get(slot)]
        slots = [(slot, 'Image ' + str(index + 1)) for index, slot in enumerate(available)]
    for slot, label in slots:
        binding = bindings.get(slot, {})
        if wan and mode == 'first_frame':
            reference_lines.append('Use the supplied image as the first frame. Begin from its visible poses, camera, lighting and setting, then advance the action.')
            continue
        character = next((c for c in characters.get('characters', []) if c['id'] == binding.get('character_id')), None)
        if character:
            reference_lines.append(f'<{label}> is the visual identity reference for {character["name"]}.')
        elif binding.get('kind') == 'ensemble':
            reference_lines.append(f'<{label}> is the ensemble reference showing the cast’s distinct identities.')
        elif binding.get('kind') == 'last_frame':
            reference_lines.append(f'<{label}> is the final frame of the previous clip. Use it as a continuity reference: preserve the visible poses, positions, camera, lighting, and setting, then continue into the new action.')
        else:
            reference_lines.append(f'<{label}> is a visual identity reference supplied by the creator.')
    reference_note = 'Character sheets show multiple views of each identity. A last-frame reference shows one moment in the continuing scene.\n' if mode == 'reference' else ''
    return (f'Visual direction: {vision.get("visual_style", "cinematic")}\n' + '\n'.join(reference_lines) + '\n' + reference_note +
            f'Character identities:\n{identities}\nCamera: {shot.get("camera", "")}\nAction: {shot.get("on_screen_action", "")}\n'
            f'Continuity: {shot.get("continuity", "")}\nSound direction: {shot.get("sound", "")}\n'
            f'Additional direction: {shot.get("prompt", "")}\nOne coherent shot. No identity swapping, morphing, unexpected cuts or looping.')

def compile_continuation(action, vision, characters, video_settings=None):
    action = str(action or '').strip()
    if not action:
        raise ValueError('Describe what happens next before building the continuation prompt.')
    shot = {'characters': [], 'on_screen_action': action,
            'camera': 'Continue the camera angle and framing shown in the final-frame reference.',
            'continuity': 'Continue immediately after the supplied moment. Preserve cast identities, screen positions, clothing, lighting and weather. Advance the action without replaying the previous segment.',
            'prompt': ''}
    prompt = compile_shot(shot, vision, characters, video_settings)
    return prompt if (video_settings or {}).get('video_provider') == 'runway' else prompt + '\nContinue into the next moment. The new action is:\n' + action
