/* global installer */
const $ = (s) => document.querySelector(s);

// ---------- Background scenes (cross-fade) ----------
const SCENES = ['media/scene1.webm', 'media/scene2.webm', 'media/scene3.webm', 'media/scene4.webm'];
let sceneIndex = 0;
let useA = true;
function nextScene() {
  const incoming = useA ? $('#sceneA') : $('#sceneB');
  const outgoing = useA ? $('#sceneB') : $('#sceneA');
  incoming.src = SCENES[sceneIndex % SCENES.length];
  incoming.play().catch(() => {});
  incoming.classList.add('visible');
  outgoing.classList.remove('visible');
  sceneIndex++;
  useA = !useA;
}
nextScene();
setInterval(nextScene, 9000);

// ---------- Zero Two (changes with the state) ----------
const POSES = { idle: 'media/zero-two-smile.webp', working: 'media/zero-two-dance.webp', done: 'media/zero-two-point.webp' };
function setState(name, line) {
  document.body.className = 'state-' + name;
  const img = $('#zero-two');
  if (!img.src.endsWith(POSES[name])) {
    img.classList.add('swapping');
    setTimeout(() => { img.src = POSES[name]; img.classList.remove('swapping'); }, 300);
  }
  if (line) say(line);
}
function say(text) {
  const b = $('#bubble');
  b.textContent = text;
  b.classList.add('replay');
  void b.offsetWidth;
  b.classList.remove('replay');
}

// ---------- Log ----------
function log(msg) {
  const line = document.createElement('div');
  line.textContent = '> ' + msg;
  if (/^✓/.test(msg)) line.className = 'ok';
  else if (/^⚠/.test(msg)) line.className = 'warn';
  else if (/^✗/.test(msg)) line.className = 'err';
  $('#log').append(line);
  $('#log').scrollTop = $('#log').scrollHeight;
}
installer.onLog(log);

// ---------- Discord clients ----------
const DISCORD_ICON = '<svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M19.73 4.87a18.2 18.2 0 0 0-4.6-1.44c-.21.4-.4.8-.58 1.21-1.69-.25-3.4-.25-5.1 0-.18-.41-.37-.82-.59-1.2-1.6.27-3.14.75-4.6 1.43A19.04 19.04 0 0 0 .96 17.7a18.43 18.43 0 0 0 5.63 2.87c.46-.62.86-1.28 1.2-1.98-.65-.25-1.29-.55-1.9-.92.17-.12.32-.24.47-.37 3.58 1.7 7.7 1.7 11.28 0l.46.37c-.6.36-1.25.67-1.9.92.35.7.75 1.35 1.2 1.98 2.03-.63 3.94-1.6 5.64-2.87.47-4.87-.78-9.09-3.3-12.83ZM8.3 15.12c-1.1 0-2-1.02-2-2.27 0-1.24.88-2.26 2-2.26s2.02 1.02 2 2.26c0 1.25-.89 2.27-2 2.27Zm7.4 0c-1.1 0-2-1.02-2-2.27 0-1.24.88-2.26 2-2.26s2.02 1.02 2 2.26c0 1.25-.88 2.27-2 2.27Z"/></svg>';
const STATE_LABEL = { installed: 'Installed', clean: 'Not installed' };
const stateLabel = (c) => STATE_LABEL[c.state] || (c.mod ? `${c.mod} installed` : 'Other mod');
let clients = [];
const selected = new Set();
let firstLoad = true;

async function load() {
  clients = await installer.list();
  if (firstLoad) {
    clients.forEach((c) => selected.add(c.id));
    firstLoad = false;
  }
  draw();
}

function draw() {
  const box = $('#clients');
  box.replaceChildren();
  if (!clients.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.innerHTML = 'No Discord installation was found on this computer.<br>Get it at <a href="https://discord.com/download" target="_blank">discord.com/download</a> and open this installer again.';
    box.append(d);
  }
  for (const c of clients) {
    const card = document.createElement('div');
    card.className = `client ${c.id}` + (selected.has(c.id) ? ' selected' : '');
    card.innerHTML = `<span class="check"></span><div class="logo">${DISCORD_ICON}</div>
      <div class="info"><b></b><small></small></div><span class="chip ${c.state}"></span>`;
    card.querySelector('b').textContent = c.name;
    card.querySelector('small').textContent = 'version ' + c.version;
    card.querySelector('.chip').textContent = stateLabel(c);
    if (c.otherMod) card.title = `${c.mod} is installed here. ZeroCord can replace it (it already includes Equicord).`;
    card.onclick = () => { selected.has(c.id) ? selected.delete(c.id) : selected.add(c.id); draw(); };
    box.append(card);
  }
  $('#install').disabled = ![...selected].some((id) => clients.find((c) => c.id === id));
  $('#uninstall').disabled = !clients.some((c) => c.installed && selected.has(c.id));
  $('#install span').textContent = clients.some((c) => c.installed && selected.has(c.id)) ? 'Reinstall' : 'Install';
}

const chosen = () => clients.filter((c) => selected.has(c.id)).map((c) => c.id);

async function closeIfRunning(ids) {
  const running = await installer.running(ids);
  if (!running.length) return true;
  const names = clients.filter((c) => running.includes(c.id)).map((c) => c.name).join(', ');
  const r = await installer.confirm('Discord is running', `${names} needs to be closed to continue. Close it now?`, ['Close and continue', 'Cancel']);
  if (r !== 0) return false;
  log('Closing ' + names + '…');
  await installer.closeClients(running);
  return true;
}

function lock(on) {
  for (const b of document.querySelectorAll('.buttons button')) b.disabled = on;
  document.querySelectorAll('.client').forEach((c) => (c.style.pointerEvents = on ? 'none' : ''));
}
const settle = () => new Promise((ok) => setTimeout(ok, 150)); // let the last log lines arrive

$('#install').onclick = async () => {
  const ids = chosen();
  if (!ids.length) return;
  let replaceOtherMods = false;
  const others = clients.filter((c) => ids.includes(c.id) && c.otherMod);
  if (others.length) {
    const list = others.map((c) => `${c.name} (${c.mod})`).join(', ');
    const r = await installer.confirm('Replace the existing mod?', `${list} already has a client mod. ZeroCord includes Equicord, so it can replace it. You'll need to turn your plugins back on in the ZeroCord panel.`, ['Replace and install', 'Skip those', 'Cancel']);
    if (r === 2) return;
    replaceOtherMods = r === 0;
  }
  if (!(await closeIfRunning(ids))) return;
  lock(true);
  $('#log').replaceChildren();
  setState('working', 'Hang on, darling… setting everything up for you.');
  const r = await installer.install(ids, { zeroTwoIcon: $('#opt-icon').checked, replaceOtherMods });
  await settle();
  clients = r.list;
  lock(false);
  draw();
  const done = ids.filter((id) => clients.find((c) => c.id === id && c.installed));
  if (r.ok && done.length) {
    setState('done', 'All done! Your Discord now has plugins, themes and the ✦ panel.');
    log('✓ Finished. Open Discord and look for the ✦ icon at the top.');
    if ($('#opt-launch').checked) installer.launch(done);
  } else {
    setState('idle', 'Hmm… something went wrong. Check the log below.');
  }
};

$('#uninstall').onclick = async () => {
  const ids = chosen().filter((id) => clients.find((c) => c.id === id && c.installed));
  if (!ids.length) return;
  const r = await installer.confirm('Uninstall ZeroCord?', 'Discord goes back to normal, with its original icon.', ['Uninstall and keep my settings', 'Uninstall and delete everything', 'Cancel']);
  if (r === 2) return;
  if (!(await closeIfRunning(ids))) return;
  lock(true);
  $('#log').replaceChildren();
  setState('working', 'Alright… removing everything carefully.');
  const res = await installer.uninstall(ids, { deleteData: r === 1 });
  await settle();
  clients = res.list;
  lock(false);
  draw();
  setState('idle', res.ok ? "Done, it's back to normal. Come back anytime." : 'Something went wrong. Check the log below.');
};

$('#data').onclick = () => installer.openData();
document.querySelectorAll('.wb').forEach((b) => (b.onclick = () => installer.window(b.dataset.action)));

load();
