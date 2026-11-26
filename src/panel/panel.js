/* global api */
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else if (v !== undefined && v !== null) e[k] = v;
  }
  for (const c of children.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const toggle = (checked, onChange) => {
  const input = el('input', { type: 'checkbox', checked: !!checked, onchange: () => onChange(input.checked) });
  return el('label', { class: 'switch' }, input, el('span'));
};
const pct = (v) => Math.round(v * 100) + '%';

let state = null;
const previews = {};
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

// ---------------- Tabs ----------------
document.querySelectorAll('nav button[data-tab]').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('nav button[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'sounds') loadSounds();
    if (b.dataset.tab === 'plugins') loadPlugins();
    if (b.dataset.tab === 'css') loadCss();
    if (b.dataset.tab === 'mute') loadMute();
  };
});
document.querySelectorAll('[data-folder]').forEach((b) => (b.onclick = () => api.openFolder(b.dataset.folder)));

async function refresh() {
  state = await api.state();
  drawBackground();
  drawThemes();
  drawProfile();
  drawSettings();
}
api.onRefresh(refresh);

// ======================================================
//  THEMES & BACKGROUND
// ======================================================
function drawBackground() {
  const b = state.background;
  $('#bg-enabled').checked = b.enabled;
  $('#bg-file').textContent = b.file ? `File: ${b.file}` : 'No background yet. Click "Change" to pick one.';
  $('#bg-opacity').value = b.opacity;
  $('#bg-opacity-value').textContent = pct(b.opacity);
  $('#bg-blend').value = b.blend;
}
$('#bg-enabled').onchange = async (e) => { state.background = await api.background({ enabled: e.target.checked }); drawBackground(); };
$('#bg-opacity').oninput = (e) => { $('#bg-opacity-value').textContent = pct(e.target.value); api.background({ opacity: e.target.value }); };
$('#bg-blend').onchange = (e) => api.background({ blend: e.target.value });
$('#bg-pick').onclick = async () => { state.background = await api.backgroundPick(); drawBackground(); toast('Background updated'); };

function drawThemes() {
  const list = $('#theme-list');
  list.replaceChildren();
  if (!state.themes.length) list.append(el('p', { class: 'hint' }, 'No themes yet.'));
  for (const t of state.themes) {
    const thumb = el('div', { class: 'thumb', title: 'Click to preview' }, previews[t.id] ? '' : 'Click to generate a preview');
    if (previews[t.id]) thumb.style.backgroundImage = `url("${previews[t.id]}")`;
    thumb.onclick = () => (previews[t.id] ? openModal(t.name, previews[t.id]) : makePreview(t, thumb));

    const buttons = el('div', { class: 'actions' },
      el('button', { class: 'ghost small', onclick: () => makePreview(t, thumb, true) }, previews[t.id] ? 'Refresh preview' : 'Preview'),
      t.source !== 'Built-in' ? el('button', { class: 'danger small', onclick: async () => {
        if (!confirm(`Remove the theme "${t.name}"?`)) return;
        await api.themeRemove(t.id); delete previews[t.id]; refresh();
      } }, 'Remove') : null
    );

    list.append(el('div', { class: 'theme' + (t.active ? ' on' : '') },
      thumb,
      el('div', { class: 'body' },
        el('div', { class: 'row' },
          el('div', {}, el('div', { class: 'tag' }, t.source), el('h2', {}, t.name)),
          toggle(t.active, async (v) => { await api.themeToggle(t.id, v); t.active = v; drawThemes(); toast(v ? 'Theme enabled' : 'Theme disabled'); })
        ),
        el('div', { class: 'desc' }, t.description || ''),
        buttons
      )
    ));
  }
}

async function makePreview(t, thumb, open) {
  thumb.textContent = 'Generating preview…';
  thumb.style.backgroundImage = '';
  const img = await api.themePreview(t.id);
  if (!img) { thumb.textContent = "Couldn't generate it (is Discord open?)"; return; }
  previews[t.id] = img;
  thumb.textContent = '';
  thumb.style.backgroundImage = `url("${img}")`;
  if (open !== false) openModal(t.name, img);
}

function openModal(title, img) {
  $('#modal-title').textContent = 'Preview: ' + title;
  $('#modal-img').src = img;
  $('#modal').classList.remove('hidden');
}
$('#modal-close').onclick = () => $('#modal').classList.add('hidden');
$('#modal').onclick = (e) => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); };

$('#theme-import').onclick = async () => { if (await api.themeImport()) { toast('Theme imported and enabled'); refresh(); } };
$('#theme-link-add').onclick = async () => {
  const v = $('#theme-link').value.trim();
  if (!(await api.themeLink(v))) return toast('Invalid link: it must start with https://');
  $('#theme-link').value = '';
  toast('Theme link added');
  refresh();
};

// ======================================================
//  SOUNDS
// ======================================================
const SOUND_NAMES = {
  message1: 'New message', message2: 'New message (alt)', message3: 'New message (alt 2)',
  mention1: 'Mention', mention2: 'Mention (2)', mention3: 'Mention (3)',
  deafen: 'Deafen', undeafen: 'Undeafen', mute: 'Mute', unmute: 'Unmute',
  disconnect: 'Leave call', reconnect: 'Reconnect', ptt_start: 'Push to talk (start)', ptt_stop: 'Push to talk (stop)',
  user_join: 'User joined', user_leave: 'User left', user_moved: 'User moved',
  call_calling: 'Calling', call_ringing: 'Incoming call', call_ringing_beat: 'Incoming call (alt)',
  stream_started: 'Stream started', stream_ended: 'Stream ended',
  stream_user_joined: 'Joined stream', stream_user_left: 'Left stream',
  activity_launch: 'Activity started', activity_end: 'Activity ended',
  activity_user_join: 'Joined activity', activity_user_left: 'Left activity',
  stage_waiting: 'Stage waiting', clip_save: 'Clip saved', clip_error: 'Clip error',
  highfive_clap: 'High five (clap)', highfive_whistle: 'High five (whistle)', vibing_wumpus: 'Vibing Wumpus',
  overlayunlock: 'Overlay unlocked', discodo: 'Discodo', human_man: 'Human', robot_man: 'Robot'
};
const SOUND_ORDER = Object.keys(SOUND_NAMES);
let soundList = {};
const player = new Audio();
const changed = (c) => !!(c.file || c.muted || (c.volume ?? 1) !== 1);

async function loadSounds() {
  const g = state.sounds.global;
  $('#sounds-on').checked = !g.muted;
  $('#sounds-volume').value = g.volume;
  $('#sounds-volume-value').textContent = pct(g.volume);
  const r = (await api.soundsList()) || {};
  soundList = Object.assign({}, r.mapped || {}, r.detected || {});
  $('#sounds-note').textContent = Object.keys(r.mapped || {}).length
    ? ''
    : "Couldn't read Discord's full sound list yet. Sounds show up here as they play (send a message, join a call…), then click \"Refresh list\".";
  drawSounds();
}

function drawSounds() {
  const search = $('#sounds-search').value.trim().toLowerCase();
  const cfg = state.sounds.cfg || {};
  const names = Array.from(new Set([...Object.keys(soundList), ...Object.keys(cfg)]));
  names.sort((a, b) => {
    const ia = SOUND_ORDER.indexOf(a), ib = SOUND_ORDER.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
  const list = $('#sound-list');
  list.replaceChildren();
  for (const name of names) {
    const label = SOUND_NAMES[name] || name;
    if (search && !(label + ' ' + name).toLowerCase().includes(search)) continue;
    const c = cfg[name] || { volume: 1, muted: false };
    const vol = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: c.volume ?? 1 });
    const volText = el('b', {}, pct(c.volume ?? 1));
    vol.oninput = () => { volText.textContent = pct(vol.value); };
    vol.onchange = async () => { await api.soundConfig(name, { volume: Number(vol.value) }); (state.sounds.cfg[name] ||= {}).volume = Number(vol.value); };

    list.append(el('div', { class: 'sound' + (changed(c) ? ' changed' : '') },
      el('div', { class: 'name' }, el('b', {}, label), el('small', {}, c.file ? `Replaced: ${c.file}` : name)),
      el('label', {}, el('span', {}, 'Volume ', volText), vol),
      el('label', { style: 'flex-direction:row;align-items:center;gap:8px' },
        toggle(!c.muted, async (v) => { await api.soundConfig(name, { muted: !v }); (state.sounds.cfg[name] ||= {}).muted = !v; drawSounds(); }),
        el('span', {}, c.muted ? 'Muted' : 'On')),
      el('div', { class: 'buttons' },
        soundList[name] ? el('button', { class: 'ghost small', onclick: () => play(soundList[name]) }, '▶ Original') : null,
        c.file ? el('button', { class: 'ghost small', onclick: async () => play(await api.soundUrl(name), c.volume) }, '▶ New') : null,
        el('button', { class: 'small', onclick: async () => { if (await api.soundPick(name)) { await refreshSounds(); toast('Sound replaced'); } } }, 'Replace…'),
        changed(c) ? el('button', { class: 'danger small', onclick: async () => { await api.soundReset(name); await refreshSounds(); } }, 'Reset') : null
      )
    ));
  }
  if (!list.children.length) list.append(el('p', { class: 'hint' }, 'No sounds found.'));
}
async function refreshSounds() { await refresh(); drawSounds(); }

function play(url, volume = 1) {
  if (!url) return;
  player.pause();
  player.src = url;
  player.volume = Math.max(0, Math.min(1, volume * (state.sounds.global.volume ?? 1)));
  player.play().catch(() => toast("Couldn't play this sound"));
}

$('#sounds-search').oninput = drawSounds;
$('#sounds-refresh').onclick = loadSounds;
$('#sounds-on').onchange = async (e) => { await api.soundsGlobal({ muted: !e.target.checked }); state.sounds.global.muted = !e.target.checked; };
$('#sounds-volume').oninput = (e) => { $('#sounds-volume-value').textContent = pct(e.target.value); };
$('#sounds-volume').onchange = async (e) => { await api.soundsGlobal({ volume: Number(e.target.value) }); state.sounds.global.volume = Number(e.target.value); };

// ======================================================
//  PROFILE
// ======================================================
function drawProfile() {
  const p = state.profile;
  $('#profile-enabled').checked = !!p.enabled;
  if (document.activeElement !== $('#profile-name')) $('#profile-name').value = p.displayName || '';
  if (document.activeElement !== $('#profile-username')) $('#profile-username').value = p.username || '';
  const img = $('#profile-avatar-img');
  if (state.profileUrls.avatar) img.src = state.profileUrls.avatar;
  else img.removeAttribute('src');

  const mine = p.badges || [];
  const presets = $('#badge-presets');
  presets.replaceChildren();
  for (const b of state.badgePresets) {
    const on = mine.some((x) => x.preset === b.id);
    presets.append(el('div', {
      class: 'badge' + (on ? ' on' : ''),
      onclick: () => saveBadges(on ? mine.filter((x) => x.preset !== b.id) : [...mine, { name: b.name, preset: b.id }])
    }, el('img', { src: b.url, alt: '' }), b.name));
  }

  const box = $('#badge-mine');
  box.replaceChildren();
  const urls = {};
  (state.profileUrls.badges || []).forEach((b) => (urls[b.name] = b.url));
  mine.forEach((b, i) => {
    const src = b.preset ? `zerocord://badge/${encodeURIComponent(b.preset)}` : urls[b.name];
    box.append(el('div', { class: 'badge on', title: 'Click to remove', onclick: () => saveBadges(mine.filter((_, j) => j !== i)) },
      src ? el('img', { src, alt: '' }) : null, b.name, el('span', { class: 'x' }, '✕')));
  });
  if (!mine.length) box.append(el('span', { class: 'sub' }, 'No badges selected.'));
}

async function saveBadges(badges) {
  state = await api.profile({ badges });
  drawProfile();
  toast('Badges updated: open your profile to see them');
}

let profileTimer;
const saveProfileText = () => {
  clearTimeout(profileTimer);
  profileTimer = setTimeout(async () => {
    state = await api.profile({ displayName: $('#profile-name').value, username: $('#profile-username').value });
    toast('Profile updated');
  }, 500);
};
$('#profile-name').oninput = saveProfileText;
$('#profile-username').oninput = saveProfileText;
$('#profile-enabled').onchange = async (e) => { state = await api.profile({ enabled: e.target.checked }); drawProfile(); };
$('#profile-avatar-pick').onclick = async () => { state = await api.profileAvatar(false); drawProfile(); };
$('#profile-avatar-reset').onclick = async () => { state = await api.profileAvatar(true); drawProfile(); };
$('#badge-add').onclick = async () => {
  state = await api.badgeCustom($('#badge-name').value.trim() || 'My badge');
  $('#badge-name').value = '';
  drawProfile();
};

// ======================================================
//  PLUGINS
// ======================================================
const PACKS = [
  {
    name: 'Nitro perks', desc: 'Emojis and stickers from any server, Nitro client themes, high-quality streaming and no Nitro upsells. People without a client mod see emojis and stickers as links.',
    plugins: {
      FakeNitro: 'Emojis, stickers, themes and stream quality',
      NoNitroUpsell: 'Removes Nitro upsells',
      LimitlessScreenshare: 'Pick your own stream resolution and FPS'
    }
  },
  {
    name: 'Profile & effects', desc: 'Profile colors, decorations, banners, animated avatars and badges from other mods. Others only see them if they use the same mod or plugin.',
    plugins: {
      FakeProfileThemes: 'Nitro profile colors (visible to Vencord/Equicord users)',
      Decor: 'Custom avatar decorations (visible to Decor users)',
      USRBG: 'Free profile banner (visible to USRBG users)',
      UserPFP: 'Animated local avatar (visible to UserPFP users)',
      GlobalBadges: 'Shows badges from other client mods',
      AlwaysExpandProfiles: 'Always open the full profile',
      BannersEverywhere: 'Banners in the member list',
      FriendshipRanks: 'Badge for how long you have been friends',
      Streaks: 'Daily DM streaks',
      ProfileSets: 'Save and switch profile presets'
    }
  },
  {
    name: 'Clean interface', desc: 'Strip out the clutter and make the UI yours.',
    plugins: {
      Declutter: 'Removes shop, effects, boosts and other clutter',
      Questify: 'Hide or improve Quests',
      CollapsibleUI: 'Collapse channels, members and bars',
      HideChatButtons: 'Hide message box buttons',
      HideServers: 'Hide servers from the list',
      FontLoader: 'Any Google Font',
      CustomTimestamps: 'Custom timestamp format',
      CustomUserColors: 'Custom color for anyone'
    }
  },
  {
    name: 'Essentials', desc: 'What almost everyone uses.',
    plugins: {
      MessageLogger: 'Shows deleted and edited messages', ShowHiddenChannels: 'Shows hidden channels exist',
      ViewIcons: 'Open avatars and icons full size', PlatformIndicators: 'Desktop, mobile or web',
      ImageZoom: 'Magnifier on images', WhoReacted: 'See who reacted at a glance', PermissionsViewer: 'Inspect role permissions',
      ReverseImageSearch: 'Reverse image search', Translate: 'Translate messages', MessageTranslate: 'Auto-translate',
      CallTimer: 'Call timer', BetterFolders: 'Better server folders', BetterGifPicker: 'Better GIF picker',
      MemberCount: 'Member count', ShowMeYourName: 'Show username next to nickname', ServerInfo: 'Server info',
      CopyUserURLs: 'Copy user link', BetterSettings: 'Faster settings', ClickableRoles: 'Click a role to see its members',
      BetterInvites: 'Preview a server before joining'
    }
  },
  {
    name: 'Chat upgrades', desc: 'More power in conversations.',
    plugins: {
      ChannelTabs: 'Browser-style channel tabs', CommandPalette: 'Raycast-style command palette',
      MessageLinkTooltip: 'Preview message links on hover', MessagePeek: 'Last message in the DM list',
      ShowRolesInChat: 'Role next to names in chat', MarkdownTables: 'Tables in messages', PinIcon: 'Icon on pinned messages',
      ReactionTimestamps: 'When each reaction was added', DownloadAllAttachments: 'Download all attachments at once',
      FavoriteAnything: 'Favorite images, videos and files', GifCollections: 'GIF collections', ExportMessages: 'Export messages',
      BetterActivities: 'Activity icons in the member list', ToastNotifications: 'Pop-up notifications', StatusPresets: 'Saved statuses'
    }
  },
  {
    name: 'Voice & music', desc: 'For people who live in calls.',
    plugins: {
      SpotifyControls: 'Spotify controls', MusicControls: 'Music controls and lyrics (many services)',
      VolumeBooster: 'Volume above 200%', UserVoiceShow: 'See which call someone is in', GameActivityToggle: 'Hide the game you are playing',
      VCPanelSettings: 'Voice settings in the call panel', VoiceButtons: 'Quick mute/DM in calls', VoiceChannelLog: 'Who joined and left',
      FollowVoiceUser: 'Follow a friend between calls', WhosWatching: "See who's watching your stream", VoiceJoinMessages: 'Alert when a friend joins a call',
      MicLoopbackTester: 'Test your own microphone', VoiceStats: 'Time spent in calls with each person'
    }
  },
  {
    name: 'Privacy & control', desc: 'Less tracking, more control over what you see.',
    plugins: {
      NoTrack: 'Blocks Discord tracking', ClearURLs: 'Strips trackers from links', SilentTyping: 'Hides your typing indicator',
      NoTypingAnimation: 'No typing animation', ClientSideBlock: 'Hide everything from someone (only for you)',
      BlockKeywords: 'Hide messages with keywords', IRememberYou: 'Remembers people you talked to, in case you lose your account'
    }
  },
  {
    name: 'Sounds', desc: 'On top of the Sounds page in this panel.',
    plugins: { CustomSounds: 'Replace sounds through Equicord', KeyboardSounds: 'Keyboard sounds (OperaGX / osu!)', Animalese: 'Animal Crossing voices for messages' }
  },
  {
    name: 'Fun', desc: 'Just for laughs.',
    plugins: {
      petpet: 'Head-pat GIFs with /petpet', PetPet: 'Head-pat GIFs with /petpet', CursorBuddy: 'A buddy that follows your cursor',
      Snowfall: 'Snow on Discord', PartyMode: 'Party mode', WigglyText: 'Wiggly text', Quoter: 'Turn a message into a quote image',
      GifMaker: 'Make captioned GIFs', MoreCommands: 'Lots of fun commands', Ghosted: 'A ghost appears when you get left on read'
    }
  }
];

let subTab = 'packs';
document.querySelectorAll('.subtabs button').forEach((b) => {
  b.onclick = () => {
    subTab = b.dataset.sub;
    document.querySelectorAll('.subtabs button').forEach((x) => x.classList.toggle('active', x === b));
    $('#packs').classList.toggle('hidden', subTab !== 'packs');
    $('#all').classList.toggle('hidden', subTab !== 'all');
    loadPlugins();
  };
});

let allPlugins = [];
async function loadPlugins() {
  const list = await api.pluginsList();
  if (!list) {
    $('#plugins-note').textContent = "Plugins haven't loaded yet (or they're disabled in Settings). Wait for Discord to open and click this tab again.";
    $('#packs').replaceChildren(); $('#plugin-list').replaceChildren();
    return;
  }
  allPlugins = list;
  const engine = state.config.mod === 'vencord' ? 'Vencord' : 'Equicord';
  $('#plugins-total').textContent = `(${list.length})`;
  $('#plugins-note').textContent = `Running ${engine}. Client mods are against Discord's Terms of Service: bans are rare, but avoid plugins that send messages on your behalf.`;
  if (subTab === 'packs') drawPacks(); else drawAll();
}

const markChanged = () => toast('Click "Apply" for changes to take effect');

function drawPacks() {
  const st = Object.fromEntries(allPlugins.map((p) => [p.name, p.enabled]));
  const box = $('#packs');
  box.replaceChildren();
  for (const p of PACKS) {
    const names = Object.keys(p.plugins).filter((n) => n in st);
    if (!names.length) continue;
    const allOn = names.every((n) => st[n]);
    box.append(el('div', { class: 'card pack' },
      el('div', { class: 'row' },
        el('div', {}, el('h2', {}, p.name), el('p', { class: 'sub' }, p.desc)),
        el('button', { class: allOn ? 'ghost' : '', onclick: async () => { await api.pluginsToggle(names, !allOn); await loadPlugins(); markChanged(); } },
          allOn ? 'Disable pack' : 'Enable pack')
      ),
      el('div', { class: 'plugins' }, names.map((n) =>
        el('div', { class: 'plugin' },
          el('div', {}, el('b', {}, n), el('small', {}, p.plugins[n])),
          toggle(st[n], async (v) => { await api.pluginsToggle([n], v); const x = allPlugins.find((q) => q.name === n); if (x) x.enabled = v; markChanged(); })
        )))
    ));
  }
}

function drawAll() {
  const search = $('#plugins-search').value.trim().toLowerCase();
  const filter = $('#plugins-filter').value;
  const box = $('#plugin-list');
  box.replaceChildren();
  let n = 0;
  for (const p of allPlugins) {
    if (search && !(p.name + ' ' + p.description + ' ' + p.tags.join(' ')).toLowerCase().includes(search)) continue;
    if (filter === 'on' && !p.enabled) continue;
    if (filter === 'off' && p.enabled) continue;
    if (++n > 500) break;
    box.append(el('div', { class: 'plugin' },
      el('div', {}, el('b', {}, p.name, p.system ? el('span', { class: 'tag-system' }, 'system') : null), el('small', { title: p.description }, p.description)),
      p.system ? null : toggle(p.enabled, async (v) => { await api.pluginsToggle([p.name], v); p.enabled = v; markChanged(); })
    ));
  }
  if (!n) box.append(el('p', { class: 'hint' }, 'No plugins found.'));
}
$('#plugins-search').oninput = () => drawAll();
$('#plugins-filter').onchange = () => drawAll();
$('#plugins-apply').onclick = async () => { await api.reload(); toast('Reloading Discord…'); };

// ======================================================
//  FAKE MUTE
// ======================================================
function drawMute(st) {
  const cfg = state.fakeMute || { enabled: true, hotkey: true };
  $('#mute-enabled').checked = !!cfg.enabled;
  $('#mute-hotkey').checked = !!cfg.hotkey;
  const on = !!(st && st.active);
  $('#mute-dot').classList.toggle('on', on);
  $('#mute-title').textContent = on ? 'On' : 'Off';
  $('#mute-sub').textContent = !st
    ? 'Open Discord to use it.'
    : on
      ? (st.inCall ? 'Others in the call see you muted, but they can hear you.' : 'Takes effect as soon as you join a call.')
      : 'Your real state is shown.';
  const b = $('#mute-toggle');
  b.textContent = on ? 'Turn off' : 'Turn on';
  b.classList.toggle('on', on);
  b.disabled = !cfg.enabled || !st;
}
async function loadMute() { drawMute(await api.fakeMuteState()); }
$('#mute-toggle').onclick = async () => drawMute(await api.fakeMuteToggle());
$('#mute-enabled').onchange = async (e) => {
  state.fakeMute = Object.assign({}, state.fakeMute, { enabled: e.target.checked });
  drawMute(await api.fakeMuteConfig({ enabled: e.target.checked }));
};
$('#mute-hotkey').onchange = async (e) => {
  state.fakeMute = Object.assign({}, state.fakeMute, { hotkey: e.target.checked });
  drawMute(await api.fakeMuteConfig({ hotkey: e.target.checked }));
};

// ======================================================
//  CUSTOM CSS
// ======================================================
async function loadCss() { $('#css-text').value = await api.cssRead(); }
async function saveCss() {
  await api.cssSave($('#css-text').value);
  $('#css-status').textContent = 'Saved at ' + new Date().toLocaleTimeString();
  toast('CSS applied');
}
$('#css-save').onclick = saveCss;
$('#css-text').addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveCss(); }
  if (e.key === 'Tab') {
    e.preventDefault();
    const t = e.target, i = t.selectionStart;
    t.setRangeText('  ', i, t.selectionEnd, 'end');
  }
});

// ======================================================
//  SETTINGS
// ======================================================
const SETTINGS = [
  ['plugins', 'Plugins', 'Turns the whole plugin engine on or off', true],
  ['panelButton', '✦ button in Discord', 'Shortcut to this panel in the top bar', false],
  ['noAnimations', 'Reduce animations', 'Snappier, lighter interface', false],
  ['blockTelemetry', 'Block telemetry', 'Less tracking and fewer background requests', true],
  ['hardwareAcceleration', 'Hardware acceleration', 'Turn off if you get a black screen or freezes', true],
  ['backgroundThrottling', 'Save resources in background', 'Less CPU while minimized', true],
  ['spellcheck', 'Spellcheck', 'Off is lighter', true]
];
function drawSettings() {
  const c = state.config;
  const box = $('#settings');
  box.replaceChildren();
  for (const [k, title, desc, restart] of SETTINGS) {
    if (c.injected && ['hardwareAcceleration', 'spellcheck'].includes(k)) continue; // Discord handles these itself
    box.append(el('div', { class: 'row' },
      el('div', {}, el('b', {}, title + (restart ? ' ↻' : '')), el('p', { class: 'sub' }, desc)),
      toggle(c[k], async (v) => { await api.config({ [k]: v }); c[k] = v; if (restart) toast('Restart to apply'); })
    ));
  }
  $('#mod').value = c.mod || 'equicord';
  $('#zoom').value = c.zoom;
  $('#zoom-value').textContent = pct(c.zoom);
}
$('#zoom').oninput = (e) => { $('#zoom-value').textContent = pct(e.target.value); };
$('#zoom').onchange = (e) => api.config({ zoom: Number(e.target.value) });
$('#mod').onchange = async (e) => {
  await api.config({ mod: e.target.value });
  state.config.mod = e.target.value;
  if (confirm('Switching the plugin engine requires a restart. Restart now?')) api.restart();
};
$('#restart').onclick = () => api.restart();

$('#close').onclick = () => window.close();
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modal').classList.contains('hidden')) $('#modal').classList.add('hidden');
  else window.close();
});

refresh();
