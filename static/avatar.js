'use strict';

const AIMAvatar = (() => {
  function panel(user) {
    return `<div class="avatar-editor">
      ${avatarMarkup(user.avatar_url,user.name,true)}
      <div>
        <div class="row wrap">
          <label class="button secondary small upload-label">
            ${user.avatar_url?'Change photo':'Choose photo'}
            <input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,.heic,.heif" aria-label="Choose a profile photo">
          </label>
          ${user.avatar_url?'<button type="button" class="button ghost small" data-act="avatar-remove">Remove picture</button>':''}
        </div>
        <p class="portal-muted avatar-file-hint">JPG, PNG, WebP, AVIF, HEIC or HEIF up to 20 MB. Your saved picture is public.</p>
      </div>
    </div>
    <dialog id="avatar-crop" aria-labelledby="avatar-crop-title">
      <h2 id="avatar-crop-title">Frame your profile picture</h2>
      <p id="avatar-crop-status" role="status">Preparing your photo…</p>
      <div id="avatar-crop-controls" hidden>
        <canvas id="avatar-canvas" width="512" height="512" tabindex="0" aria-label="Photo crop. Drag or use the arrow keys to position the photo."></canvas>
        <label class="avatar-zoom">Zoom<input id="avatar-zoom" type="range" min="1" max="4" step="0.01" value="1"></label>
      </div>
      <div class="row wrap avatar-crop-actions">
        <button type="button" class="button secondary" id="avatar-cancel">Cancel</button>
        <button type="button" class="button primary" id="avatar-save" disabled>Save profile picture</button>
      </div>
    </dialog>`;
  }

  function bind() {
    const picker = document.querySelector('#avatar-file');
    const dialog = document.querySelector('#avatar-crop');
    const canvas = dialog.querySelector('#avatar-canvas');
    const context = canvas.getContext('2d', {alpha:false});
    const zoom = dialog.querySelector('#avatar-zoom');
    const controls = dialog.querySelector('#avatar-crop-controls');
    const status = dialog.querySelector('#avatar-crop-status');
    const cancel = dialog.querySelector('#avatar-cancel');
    const save = dialog.querySelector('#avatar-save');
    const size = canvas.width;
    let image, pointer, version = 0, x = 0, y = 0, scale = 1, saving = false;

    function paint() {
      if (!image) return;
      const magnification = scale * size / Math.min(image.naturalWidth,image.naturalHeight);
      const width = image.naturalWidth * magnification;
      const height = image.naturalHeight * magnification;
      const horizontal = (width - size) / 2;
      const vertical = (height - size) / 2;
      x = Math.max(-horizontal,Math.min(horizontal,x));
      y = Math.max(-vertical,Math.min(vertical,y));
      context.drawImage(image,x-horizontal,y-vertical,width,height);
    }

    picker.addEventListener('change', async () => {
      const file = picker.files[0];
      picker.value = '';
      if (!file) return;
      const requestVersion = ++version;
      image = pointer = null;
      x = y = 0;
      scale = 1;
      zoom.value = '1';
      controls.hidden = save.disabled = true;
      status.textContent = 'Preparing your photo…';
      dialog.showModal();
      let url;
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo up to 20 MB.');
        const data = new FormData();
        data.append('file',file);
        const preview = await req('account/avatar/preview',data);
        if (requestVersion !== version || !dialog.open) return;
        url = URL.createObjectURL(preview);
        const decoded = new Image();
        decoded.src = url;
        await decoded.decode();
        if (requestVersion !== version || !dialog.open) return;
        image = decoded;
        paint();
        controls.hidden = save.disabled = false;
        status.textContent = 'Drag to position your photo and use Zoom to frame it.';
      } catch (error) {
        if (requestVersion === version && dialog.open) status.textContent = error.message;
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    });

    zoom.addEventListener('input', () => {
      const next = Number(zoom.value);
      x *= next / scale;
      y *= next / scale;
      scale = next;
      paint();
    });
    canvas.addEventListener('pointerdown', event => {
      if (saving || pointer || event.button !== 0) return;
      pointer = {id:event.pointerId,x:event.clientX,y:event.clientY};
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (pointer?.id !== event.pointerId) return;
      const ratio = size / canvas.getBoundingClientRect().width;
      x += (event.clientX-pointer.x)*ratio;
      y += (event.clientY-pointer.y)*ratio;
      pointer = {id:event.pointerId,x:event.clientX,y:event.clientY};
      paint();
    });
    canvas.addEventListener('lostpointercapture', () => {pointer = null;});
    canvas.addEventListener('keydown', event => {
      const movement = {ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[event.key];
      if (!movement || saving) return;
      event.preventDefault();
      x += movement[0];
      y += movement[1];
      paint();
    });
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => {if (saving) event.preventDefault();});
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      version++;
      image = pointer = null;
    });

    save.addEventListener('click', async () => {
      if (!image || saving) return;
      saving = save.disabled = cancel.disabled = zoom.disabled = true;
      pointer = null;
      status.textContent = 'Saving your profile picture…';
      try {
        const crop = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',0.92));
        if (!crop) throw new Error('The crop could not be saved. Choose the photo again.');
        const data = new FormData();
        data.append('file',crop,'profile.jpg');
        await req('account/avatar',data);
        dialog.close();
        await settings();
        say('Profile picture updated.');
      } catch (error) {
        if (dialog.open) status.textContent = error.message;
        else say('Picture saved. Refresh to see your updated profile.');
      } finally {
        saving = save.disabled = cancel.disabled = zoom.disabled = false;
      }
    });
  }

  return {panel,bind};
})();
