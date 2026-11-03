"""Review checks for planned videos and explicit opening-image confirmation."""
import store
import studio

STAGE_NAMES = {'vision': 'creative brief', 'characters': 'characters',
               'script': 'script', 'director': 'shot plan'}


def workflow_issues():
    selected = store.get('selected_shot')
    if not selected:
        return []  # A standalone prompt or continuation has no selected plan.
    shot = next((s for s in store.get('director', {}).get('shots', []) if s.get('id') == selected), None)
    if not shot:
        return [{'stage': 'director', 'message': 'The selected scene changed. Choose it again before generating.'}]
    meta = store.get('workflow_meta', {})
    issues = [{'stage': stage, 'message': 'Review and approve your ' + STAGE_NAMES[stage] + ' before generating this scene.'}
              for stage in studio.STAGES if not meta.get('approved', {}).get(stage) or stage in meta.get('stale', [])]
    if store.get('prompt_needs_refresh'):
        issues.append({'stage': 'prompt', 'message': 'Update the video instructions to include your latest changes before generating.'})
    return issues


def opening_frame(settings, resolve_asset):
    provider = settings['video_provider']
    prefix = 'wan' if provider == 'alibaba' else 'runway'
    if settings[prefix + '_mode'] != 'first_frame':
        return {'required': False, 'approved': False, 'exists': False, 'is_sheet': False, 'wrong_shot': False}
    slot = settings[prefix + '_start_slot']
    path = resolve_asset(store.get(slot))
    binding = store.get('reference_bindings', {}).get(slot, {})
    sheets = [resolve_asset(image.get('path')) for char in store.get('characters', {}).get('characters', [])
              for image in char.get('images', [])]
    sheets += [resolve_asset(image.get('path')) for image in store.get('ensemble', {}).get('images', [])]
    is_sheet = binding.get('kind') in ('character', 'ensemble') or bool(path and path in sheets)
    selected = store.get('selected_shot', '')
    wrong_shot = bool(selected and binding.get('kind') == 'scene_frame' and binding.get('shot_id') != selected)
    stamp = path.stat() if path else None
    key = studio.fingerprint({'provider': provider, 'model': settings.get('runway_model') if provider == 'runway' else 'wan',
                              'slot': slot, 'path': str(path) if path else '', 'size': stamp.st_size if stamp else 0,
                              'modified': stamp.st_mtime_ns if stamp else 0, 'shot': selected})
    return {'required': True, 'slot': slot, 'exists': bool(path), 'is_sheet': is_sheet, 'wrong_shot': wrong_shot,
            'approved': bool(path and not is_sheet and not wrong_shot and store.get('approved_opening_frame') == key),
            '_key': key}


def opening_snapshot(settings, resolve_asset):
    return {k: v for k, v in opening_frame(settings, resolve_asset).items() if not k.startswith('_')}
