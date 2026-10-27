"""Local video processing. No generation API calls or shell interpolation."""
import math
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import requests

MAX_VIDEO_BYTES = 256 * 1024 * 1024


def executable():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        binary = shutil.which('ffmpeg')
        if binary:
            return binary
    raise ValueError('Install the updated requirements.txt, then restart to enable video tools.')


def available():
    try:
        executable()
        return True
    except ValueError:
        return False


def run(args, timeout=120):
    try:
        result = subprocess.run(
            [executable(), '-hide_banner', '-nostdin', '-y', '-threads', '2',
             '-filter_threads', '1', '-filter_complex_threads', '1', *map(str, args)],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError('Video processing took too long. Try fewer or smaller clips.') from exc
    if result.returncode:
        raise ValueError('This video could not be processed. Use a complete, playable MP4, MOV, or WebM clip.')
    return result


def probe(path):
    """Read metadata with the bundled ffmpeg; ffprobe is not required."""
    try:
        result = subprocess.run(
            [executable(), '-hide_banner', '-nostdin', '-i', str(path)],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=30,
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError('The video could not be read in time.') from exc
    text = result.stderr.decode('utf-8', errors='replace')
    video = next((line for line in text.splitlines() if 'Video:' in line and 'attached pic' not in line), '')
    size = re.search(r'(?<![A-Za-z0-9])(\d{2,5})x(\d{2,5})(?![A-Za-z0-9])', video)
    duration = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', text)
    fps = re.search(r'([\d.]+) fps', video)
    if not size or not duration:
        raise ValueError('The clip has no readable video or duration. Download a complete video and try again.')
    seconds = int(duration[1]) * 3600 + int(duration[2]) * 60 + float(duration[3])
    if not math.isfinite(seconds) or not 0 < seconds <= 3600:
        raise ValueError('Use a video between zero and 60 minutes long.')
    return {'width': int(size[1]), 'height': int(size[2]), 'duration_seconds': seconds,
            'fps': float(fps[1]) if fps else 24, 'has_audio': bool(re.search(r'Stream[^\n]+Audio:', text))}


def download(url, destination):
    """Cache a returned video URL so expiring links can be processed locally."""
    if not isinstance(url, str) or not url.startswith(('https://', 'http://')):
        raise ValueError('The render did not return a downloadable video URL.')
    destination = Path(destination)
    temp = destination.with_suffix('.download')
    try:
        with requests.get(url, stream=True, timeout=(15, 90)) as response:
            response.raise_for_status()
            total = 0
            with temp.open('wb') as out:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    total += len(chunk)
                    if total > MAX_VIDEO_BYTES:
                        raise ValueError('This clip exceeds the 256 MB video limit.')
                    out.write(chunk)
        metadata = probe(temp)
        temp.replace(destination)
        return metadata
    except requests.RequestException as exc:
        raise ValueError('The clip could not be downloaded. Refresh the job or check its output storage, then retry.') from exc
    finally:
        temp.unlink(missing_ok=True)


def last_frame(path):
    """Decode through the end, keeping the final frame rather than a near-end seek."""
    metadata = probe(path)
    with tempfile.TemporaryDirectory(prefix='aim-frame-') as folder:
        output = Path(folder) / 'last.png'
        run(['-loglevel', 'error', '-i', path, '-map', '0:v:0', '-an', '-sn',
             '-fps_mode', 'passthrough', '-c:v', 'png', '-update', '1', output])
        if not output.is_file():
            raise ValueError('No frame could be extracted from this video.')
        return output.read_bytes(), metadata


def combine(paths, destination):
    """Normalize clips, preserve/fill audio, and concatenate in the chosen order."""
    if not 2 <= len(paths) <= 40:
        raise ValueError('Choose between 2 and 40 clips to combine.')
    metadata = [probe(path) for path in paths]
    width, height = metadata[0]['width'], metadata[0]['height']
    width += width % 2
    height += height % 2
    if width > 4096 or height > 4096:
        raise ValueError('Use clips with a resolution up to 4096 pixels per side.')
    destination = Path(destination)
    pending = destination.with_name(destination.stem + '.pending.mp4')
    try:
        with tempfile.TemporaryDirectory(prefix='aim-scene-') as folder:
            folder = Path(folder)
            for index, (path, info) in enumerate(zip(paths, metadata)):
                args = ['-loglevel', 'error', '-i', path]
                if not info['has_audio']:
                    args += ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']
                audio = '0:a:0' if info['has_audio'] else '1:a:0'
                args += ['-map', '0:v:0', '-map', audio,
                         '-vf', f'scale={width}:{height}:force_original_aspect_ratio=decrease,'
                                f'pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,setpts=PTS-STARTPTS',
                         '-af', 'aresample=48000,asetpts=PTS-STARTPTS,apad',
                         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
                         '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
                         '-video_track_timescale', '24000', '-shortest', '-t', str(info['duration_seconds']),
                         folder / f'clip_{index:03d}.mp4']
                run(args, timeout=600)
            manifest = folder / 'clips.txt'
            manifest.write_text(''.join(f"file 'clip_{index:03d}.mp4'\n" for index in range(len(paths))))
            run(['-loglevel', 'error', '-f', 'concat', '-safe', '1', '-i', manifest,
                 '-c', 'copy', '-movflags', '+faststart', pending], timeout=120)
        output_metadata = probe(pending)
        pending.replace(destination)
        return output_metadata
    finally:
        pending.unlink(missing_ok=True)
