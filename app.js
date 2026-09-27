const $ = (id) => document.getElementById(id);
const state = { image: null, imageType: 'image/jpeg', cvs: [], lastDraft: null };

// ---------- Settings (kept only on this phone) ----------
function getSettings() {
  try { return JSON.parse(localStorage.getItem('jobMailerSettings')) || {}; } catch { return {}; }
}
function saveSettings(s) {
  try { localStorage.setItem('jobMailerSettings', JSON.stringify(s)); } catch {}
}

// ---------- Screens ----------
function show(screen) {
  ['settings', 'input', 'draft', 'sent'].forEach((id) => { $(id).hidden = id !== screen; });
}
function setStatus(msg, isError = false) {
  $('status').hidden = !msg;
  $('status').textContent = msg || '';
  $('status').classList.toggle('error', isError);
}

// ---------- Backend calls ----------
async function api(payload) {
  const { url, token } = getSettings();
  if (!url || !token) throw new Error('Add your Apps Script URL and access token in Settings.');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids a CORS preflight
    body: JSON.stringify({ ...payload, token }),
  });
  if (!res.ok) throw new Error('Backend error (' + res.status + '). Check the web app URL.');
  return res.json();
}

async function loadCvs() {
  const r = await api({ action: 'config' });
  if (!r.ok) throw new Error(r.error);
  state.cvs = r.cvs;
  $('cv').innerHTML = r.cvs.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
}

// ---------- Images: shrink before upload so requests stay fast ----------
async function compressImage(blob, maxSide = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const out = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  return { base64: await blobToBase64(out), type: 'image/jpeg', previewUrl: URL.createObjectURL(out) };
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Could not read the image.'));
    r.readAsDataURL(blob);
  });
}
async function setImage(blob) {
  const img = await compressImage(blob);
  state.image = img.base64;
  state.imageType = img.type;
  $('preview').src = img.previewUrl;
  $('preview').hidden = false;
}

// ---------- Shared content from LinkedIn / screenshots ----------
async function readShared() {
  const cache = await caches.open('job-mailer-shared');
  const textRes = await cache.match('shared-text');
  const imgRes = await cache.match('shared-image');
  const infoRes = await cache.match('shared-info');
  const text = textRes ? await textRes.text() : '';
  const info = infoRes ? await infoRes.text() : '';
  if (text) $('postText').value = text;
  if (imgRes) await setImage(await imgRes.blob());
  await Promise.all(['shared-text', 'shared-image', 'shared-info'].map((k) => cache.delete(k)));
  history.replaceState(null, '', location.pathname);
  if (textRes && !text && !imgRes) throw new Error('the share arrived empty (' + info + ').');
  return Boolean(text || imgRes);
}

// Shared content waits in the cache until settings exist, so a share made before setup is not lost.
async function handleShared() {
  try {
    if (await readShared()) writeEmail();
  } catch (err) {
    setStatus('Could not load the shared screenshot: ' + err.message, true);
  }
}

// ---------- Draft ----------
async function writeEmail() {
  const text = $('postText').value.trim();
  if (!text && !state.image) { setStatus('Paste the post text or add a screenshot first.', true); return; }
  $('writeBtn').disabled = true; $('rewriteBtn').disabled = true;
  setStatus('Writing email…');
  try {
    if (!state.cvs.length) await loadCvs();
    const r = await api({ action: 'draft', text, image: state.image, imageType: state.imageType, extra: $('extra').value.trim() });
    if (!r.ok) throw new Error(r.error);
    fillDraft(r.draft);
    setStatus('');
    show('draft');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    $('writeBtn').disabled = false; $('rewriteBtn').disabled = false;
  }
}

function fillDraft(d) {
  state.lastDraft = d;
  $('to').value = d.email || '';
  $('subject').value = d.subject || '';
  $('body').value = d.body || '';
  $('company').value = d.company || '';
  $('role').value = d.role || '';
  $('hrName').value = d.hr_name || '';
  if (state.cvs.includes(d.cv_choice)) $('cv').value = d.cv_choice;
  const warnings = d.warnings || [];
  $('warnings').hidden = !warnings.length;
  $('warningList').innerHTML = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
  updateSendButton();
}

function updateSendButton() {
  $('sendBtn').disabled = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('to').value.trim());
}

// ---------- Send ----------
async function sendEmail(force = false) {
  $('sendBtn').disabled = true;
  setStatus('Sending email…');
  try {
    const r = await api({
      action: 'send', force,
      to: $('to').value.trim(), subject: $('subject').value.trim(), body: $('body').value,
      cv: $('cv').value, company: $('company').value.trim(), role: $('role').value.trim(),
      hrName: $('hrName').value.trim(), post: $('postText').value.trim(),
    });
    if (r.duplicate) {
      setStatus('');
      if (confirm(`You already emailed this address on ${r.previous}. Send again?`)) return sendEmail(true);
      updateSendButton();
      return;
    }
    if (!r.ok) throw new Error(r.error);
    setStatus('');
    $('sentTitle').textContent = 'Sent to ' + $('to').value.trim();
    $('sentInfo').textContent = `Logged to your sheet. Emails left today: ${r.remaining}`;
    show('sent');
  } catch (err) {
    setStatus(err.message, true);
    updateSendButton();
  }
}

function resetAll() {
  state.image = null; state.lastDraft = null;
  ['postText', 'extra', 'to', 'subject', 'body', 'company', 'role', 'hrName'].forEach((id) => { $(id).value = ''; });
  $('imageInput').value = '';
  $('preview').hidden = true;
  setStatus('');
  show('input');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Wiring ----------
$('openSettings').onclick = () => {
  const s = getSettings();
  $('scriptUrl').value = s.url || '';
  $('token').value = s.token || '';
  setStatus('');
  show('settings');
};
$('saveSettings').onclick = async () => {
  const url = $('scriptUrl').value.trim(), token = $('token').value.trim();
  if (!url.startsWith('https://script.google.com/')) { setStatus('The URL should start with https://script.google.com/', true); return; }
  if (!token) { setStatus('Enter your access token.', true); return; }
  saveSettings({ url, token });
  setStatus('Checking connection…');
  try { await loadCvs(); setStatus(''); show('input'); await handleShared(); }
  catch (err) { setStatus(err.message, true); }
};
$('imageInput').onchange = async (e) => { if (e.target.files[0]) await setImage(e.target.files[0]); };
$('writeBtn').onclick = writeEmail;
$('rewriteBtn').onclick = writeEmail;
$('sendBtn').onclick = () => sendEmail(false);
$('to').oninput = updateSendButton;
$('startOver').onclick = resetAll;
$('doneBtn').onclick = resetAll;

(async function init() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); } catch {}
  }
  const s = getSettings();
  if (!s.url || !s.token) { $('openSettings').click(); return; }
  show('input');
  await handleShared();
})();
