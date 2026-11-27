// Runs inside the Discord page. Driven by ZeroCord's core.
// ZeroCord's settings live in Discord's own settings, as plugins on Equicord's Plugins page.
(() => {
  if (window.__zerocord) return;
  const Z = (window.__zerocord = {});

  const waitFor = (fn, tries = 120) => new Promise((resolve) => {
    let n = 0;
    const t = setInterval(() => {
      let v; try { v = fn(); } catch {}
      if (v || ++n > tries) { clearInterval(t); resolve(v); }
    }, 500);
  });
  const pathOf = (u) => { try { return new URL(u, location.href).pathname; } catch { return String(u || ''); } };
  const isDiscordSound = (p) => /\/assets\/.+\.(mp3|ogg|wav)$/i.test(p);
  const V = () => window.Vencord;
  const React = () => V() && V().Webpack && V().Webpack.Common && V().Webpack.Common.React;
  const h = (...a) => React().createElement(...a);
  const findProps = (...props) => {
    try { return window.Vencord && window.Vencord.Webpack && window.Vencord.Webpack.findByProps(...props); } catch { return null; }
  };

  // ==========================================================
  //  Animated background
  // ==========================================================
  Z.background = (c) => {
    let el = document.getElementById('zc-background');
    if (!c || !c.enabled || !c.src) { if (el) el.remove(); return; }
    const tag = c.video ? 'VIDEO' : 'IMG';
    if (el && (el.tagName !== tag || el.dataset.src !== c.src)) { el.remove(); el = null; }
    if (!el) {
      el = document.createElement(tag.toLowerCase());
      el.id = 'zc-background';
      el.dataset.src = c.src;
      if (c.video) { el.autoplay = true; el.loop = true; el.muted = true; el.playsInline = true; }
      el.src = c.src;
      Object.assign(el.style, {
        position: 'fixed', inset: '0', width: '100vw', height: '100vh', objectFit: 'cover',
        pointerEvents: 'none', zIndex: '2147483646'
      });
      document.body.appendChild(el);
    }
    el.style.opacity = String(c.opacity);
    el.style.mixBlendMode = c.blend;
  };
  document.addEventListener('visibilitychange', () => {
    const el = document.getElementById('zc-background');
    if (el && el.tagName === 'VIDEO') document.hidden ? el.pause() : el.play().catch(() => {});
  });

  // ==========================================================
  //  Local profile (only you see it)
  // ==========================================================
  const P = (Z._profile = { cfg: null, orig: null, badges: [], observer: null, timer: null });
  const userStore = () => window.Vencord && window.Vencord.Webpack && window.Vencord.Webpack.Common && window.Vencord.Webpack.Common.UserStore;

  function applyNames() {
    const US = userStore();
    const u = US && US.getCurrentUser && US.getCurrentUser();
    if (!u) return;
    if (!P.orig || P.orig.id !== u.id) P.orig = { id: u.id };
    if (!u.__zcSaved) {
      u.__zcSaved = true;
      u.__zcOrigNames = { globalName: u.globalName, username: u.username };
    }
    const c = P.cfg || {};
    const on = !!c.enabled;
    const gn = on && c.displayName ? c.displayName : u.__zcOrigNames.globalName;
    const un = on && c.username ? c.username : u.__zcOrigNames.username;
    let changed = false;
    try { if (u.globalName !== gn) { u.globalName = gn; changed = true; } } catch {}
    try { if (u.username !== un) { u.username = un; changed = true; } } catch {}
    try {
      if (on && c.avatar) {
        if (u.__zcAvatar !== c.avatar) {
          if (!u.__zcAvatar) u.__zcAvatarOrig = u.getAvatarURL;
          u.getAvatarURL = () => c.avatar;
          u.__zcAvatar = c.avatar;
          changed = true;
        }
      } else if (u.__zcAvatar) {
        u.getAvatarURL = u.__zcAvatarOrig; delete u.__zcAvatar; changed = true;
      }
    } catch {}
    if (changed) { try { US.emitChange(); } catch {} }
  }

  function handleImg(img) {
    if (!img || img.tagName !== 'IMG' || !P.orig) return;
    const c = P.cfg || {};
    const use = c.enabled && c.avatar;
    const s = img.getAttribute('src') || '';
    if (use) {
      if (s === c.avatar) return;
      if (s.includes('/avatars/' + P.orig.id + '/') || img.__zcAvatar) {
        if (!img.__zcAvatar) img.__zcAvatarOrig = s;
        img.__zcAvatar = true;
        img.setAttribute('src', c.avatar);
        img.removeAttribute('srcset');
      }
    } else if (img.__zcAvatar) {
      img.__zcAvatar = false;
      img.setAttribute('src', img.__zcAvatarOrig);
    }
  }

  function scanImgs(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.tagName === 'IMG') handleImg(root);
    root.querySelectorAll('img').forEach(handleImg);
  }

  function applyBadges() {
    const api = window.Vencord && window.Vencord.Api && window.Vencord.Api.Badges;
    if (!api) return;
    for (const b of P.badges) { try { api.removeProfileBadge(b); } catch {} }
    P.badges = [];
    const c = P.cfg || {};
    if (!c.enabled || !P.orig) return;
    const myId = P.orig.id;
    (c.badges || []).slice().reverse().forEach((b, i) => {
      const badge = { id: 'zerocord-' + i, description: b.name, iconSrc: b.url, position: 0, shouldShow: (info) => info && info.userId === myId };
      try { api.addProfileBadge(badge); P.badges.push(badge); } catch {}
    });
  }

  Z.setProfile = async (cfg) => {
    P.cfg = cfg;
    const ready = await waitFor(() => { const US = userStore(); return US && US.getCurrentUser && US.getCurrentUser(); });
    if (!ready) return 'no-plugin-engine';
    applyNames();
    applyBadges();
    scanImgs(document.body);
    if (!P.observer) {
      P.observer = new MutationObserver((muts) => {
        if (!P.cfg) return;
        for (const m of muts) {
          if (m.type === 'attributes') handleImg(m.target);
          else m.addedNodes.forEach(scanImgs);
        }
      });
      P.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }
    if (!P.timer) P.timer = setInterval(() => { try { applyNames(); } catch {} }, 2000);
    return 'ok';
  };

  // ==========================================================
  //  Fake mute: people in the call see you muted, but you keep talking
  // ==========================================================
  const FM = (Z._fakeMute = { cfg: { enabled: false }, active: false, socket: null, originalSend: null, last: null, timer: null });
  const getSocket = () => { const ws = findProps('getSocket'); try { return ws && ws.getSocket(); } catch { return null; } };

  // Intercepts the "voice state" update (op 4) sent to Discord's gateway
  function wrapSocket() {
    const s = getSocket();
    if (!s) return false;
    if (s === FM.socket) return true;
    if (FM.socket && FM.originalSend) { try { FM.socket.send = FM.originalSend; } catch {} }
    const original = s.send;
    FM.socket = s;
    FM.originalSend = original;
    s.send = function (op, payload, ...rest) {
      if (op === 4 && payload && typeof payload === 'object') {
        FM.last = Object.assign({}, payload);
        if (FM.active) payload = Object.assign({}, payload, { self_mute: true });
      }
      return original.call(this, op, payload, ...rest);
    };
    return true;
  }

  // Re-sends the current voice state (keeps your camera and deafen as they are)
  function resendVoiceState() {
    const s = getSocket();
    const selected = findProps('getVoiceChannelId');
    const channelId = selected && selected.getVoiceChannelId && selected.getVoiceChannelId();
    if (!s || !channelId) return false;
    const media = findProps('isDeaf', 'isMute');
    const channels = (window.Vencord && window.Vencord.Webpack && window.Vencord.Webpack.Common && window.Vencord.Webpack.Common.ChannelStore) || findProps('getChannel', 'getDMFromUserId');
    const channel = channels && channels.getChannel && channels.getChannel(channelId);
    const base = FM.last && FM.last.channel_id === channelId ? FM.last : {
      guild_id: (channel && channel.guild_id) || null, channel_id: channelId,
      self_deaf: !!(media && media.isDeaf && media.isDeaf()), self_video: false, flags: 0
    };
    const reallyMuted = !!(media && media.isMute && media.isMute());
    s.send(4, Object.assign({}, base, { self_mute: FM.active ? true : reallyMuted }));
    return true;
  }

  function toast(text, red) {
    let t = document.getElementById('zc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'zc-toast';
      Object.assign(t.style, {
        position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: '2147483647', pointerEvents: 'none',
        padding: '10px 16px', borderRadius: '8px', font: '600 14px/18px "gg sans","Noto Sans","Segoe UI",sans-serif',
        background: '#111214', color: '#dbdee1', boxShadow: '0 8px 16px rgba(0,0,0,.24)', transition: 'opacity .2s', opacity: '0'
      });
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.style.borderLeft = '4px solid ' + (red ? '#ed4245' : '#23a55a');
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.style.opacity = '0'), 2200);
  }

  Z.fakeMuteState = () => {
    const selected = findProps('getVoiceChannelId');
    return { active: FM.active, enabled: FM.cfg.enabled, inCall: !!(selected && selected.getVoiceChannelId && selected.getVoiceChannelId()) };
  };

  Z.fakeMuteToggle = (force) => {
    if (!FM.cfg.enabled && force !== false) return Z.fakeMuteState();
    FM.active = typeof force === 'boolean' ? force : !FM.active;
    wrapSocket();
    const inCall = resendVoiceState();
    notify();
    toast(FM.active ? 'Fake Mute on: you look muted' : 'Fake Mute off', FM.active);
    return Object.assign(Z.fakeMuteState(), { inCall });
  };

  // Button next to mic / headphones (Equicord UserArea API, Discord's own button component)
  const FAKE_MUTE_ID = 'zerocord-fake-mute';
  FM.listeners = new Set();
  const notify = () => FM.listeners.forEach((fn) => { try { fn(); } catch {} });

  function FakeMuteIcon(props) {
    return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', className: props && props.className },
      h('path', { fill: 'currentColor', d: 'M12 2a4 4 0 0 0-4 4v5a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Z' }),
      h('path', { fill: 'currentColor', d: 'M6 10a1 1 0 0 0-2 0 8 8 0 0 0 7 7.94V21H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.06A8 8 0 0 0 20 10a1 1 0 1 0-2 0 6 6 0 0 1-12 0Z' }),
      h('path', { stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeDasharray: '2.5 3', d: 'M3 3l18 18' }));
  }

  function FakeMuteButton(props) {
    const R = React();
    const [, rerender] = R.useReducer((x) => x + 1, 0);
    R.useEffect(() => { FM.listeners.add(rerender); return () => FM.listeners.delete(rerender); }, []);
    const Button = V().Api.UserArea.UserAreaButton;
    return h(Button, {
      tooltipText: FM.active ? 'Turn off Fake Mute' : 'Turn on Fake Mute',
      icon: FakeMuteIcon,
      role: 'switch',
      'aria-checked': FM.active,
      ariaChecked: FM.active,
      redGlow: FM.active,
      plated: props && props.nameplate != null,
      onClick: () => Z.fakeMuteToggle()
    });
  }

  function setFakeMuteButton(show) {
    const api = V() && V().Api && V().Api.UserArea;
    if (!api || !api.addUserAreaButton) return false;
    try {
      if (show) api.addUserAreaButton(FAKE_MUTE_ID, FakeMuteButton, 50);
      else api.removeUserAreaButton(FAKE_MUTE_ID);
    } catch (e) { console.warn('[ZeroCord] fake mute button', e); return false; }
    return true;
  }

  Z.fakeMuteConfig = (cfg) => {
    FM.cfg = Object.assign({ enabled: false }, cfg || {});
    if (!FM.cfg.enabled && FM.active) Z.fakeMuteToggle(false);
    setFakeMuteButton(FM.cfg.enabled);
    syncPlugin('FakeMute', FM.cfg.enabled);
    if (FM.cfg.enabled && !FM.timer) {
      // while active, the gateway connection can be recreated (reconnect): wrap it again when it changes
      FM.timer = setInterval(() => { if (FM.active) { try { wrapSocket(); } catch {} } }, 3000);
    }
    return Z.fakeMuteState();
  };

  // ==========================================================
  //  ZeroCord inside Discord's settings
  //  Every ZeroCord feature is a plugin on Equicord's Plugins page, with its options under the cog.
  // ==========================================================
  const native = () => window.ZeroCordNative;
  const OPT = { STRING: 0, NUMBER: 1, BOOLEAN: 3, SELECT: 4, SLIDER: 5, COMPONENT: 6 };
  const ICON_URL = 'zerocord://icon/installer.png';
  let state = null;
  const stateListeners = new Set();
  const setState = (s) => { if (s) { state = s; stateListeners.forEach((fn) => { try { fn(); } catch {} }); } return s; };
  const save = (partial) => native().set(partial).then(setState);
  const act = (name, arg) => native().action(name, arg).then(setState);

  // --- small UI kit (Discord look, plain elements) ---
  const css = {
    row: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' },
    btn: { background: '#5865f2', color: '#fff', border: 0, borderRadius: '4px', padding: '0 14px', height: '32px', fontWeight: 500, fontSize: '14px', cursor: 'pointer' },
    btnGrey: { background: '#4e5058' },
    btnDanger: { background: 'transparent', border: '1px solid #da373c', color: 'var(--text-default, #dbdee1)' },
    small: { height: '24px', padding: '0 10px', fontSize: '12px' },
    input: { flex: 1, minWidth: '180px', background: 'var(--input-background, #1e1f22)', color: 'var(--text-default, #dbdee1)', border: 0, borderRadius: '4px', padding: '0 10px', height: '32px', fontSize: '14px' },
    text: { color: 'var(--text-muted, #949ba4)', fontSize: '13px' },
    item: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '6px', background: 'var(--background-secondary, #2b2d31)', marginBottom: '6px' },
    chip: { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 9px', borderRadius: '4px', background: 'var(--background-tertiary, #1e1f22)', border: '1px solid transparent', cursor: 'pointer', fontSize: '13px', color: 'var(--text-default, #dbdee1)' },
    chipOn: { borderColor: '#5865f2', background: 'rgba(88,101,242,.15)' }
  };
  const Btn = (label, onClick, variant, small) =>
    h('button', { style: Object.assign({}, css.btn, variant === 'grey' && css.btnGrey, variant === 'danger' && css.btnDanger, small && css.small), onClick }, label);

  function useZcState() {
    const R = React();
    const [, rerender] = R.useReducer((x) => x + 1, 0);
    R.useEffect(() => { stateListeners.add(rerender); return () => stateListeners.delete(rerender); }, []);
    return state;
  }

  // --- AnimatedBackground: file picker ---
  function BackgroundFile() {
    const st = useZcState();
    return h('div', null,
      h('div', { style: css.text }, st && st.backgroundFile ? 'Current file: ' + st.backgroundFile : 'No background chosen yet.'),
      h('div', { style: css.row }, Btn('Choose video, GIF or image…', () => act('pickBackground'))));
  }

  // --- ZeroCordThemes: theme manager ---
  function ThemeManager() {
    const R = React();
    const st = useZcState();
    const [link, setLink] = R.useState('');
    const themes = (st && st.themes) || [];
    return h('div', null,
      h('div', { style: css.row },
        Btn('Import theme (.css)…', () => act('importTheme')),
        Btn('Open themes folder', () => act('openFolder', 'themes'), 'grey')),
      h('div', { style: css.row },
        h('input', { style: css.input, placeholder: 'Theme link (https://…css)', value: link, onChange: (e) => setLink(e.target.value) }),
        Btn('Add link', () => { act('addThemeLink', link); setLink(''); }, 'grey')),
      themes.length ? themes.map((t) =>
        h('label', { key: t.id, style: css.item },
          h('input', { type: 'checkbox', checked: !!t.active, onChange: (e) => act('toggleTheme', { id: t.id, on: e.target.checked }), style: { width: '18px', height: '18px', accentColor: '#5865f2' } }),
          h('div', { style: { flex: 1 } },
            h('div', { style: { fontWeight: 600, color: 'var(--header-primary, #f2f3f5)' } }, t.name, h('span', { style: Object.assign({}, css.text, { marginLeft: '8px', fontSize: '11px', textTransform: 'uppercase' }) }, t.source)),
            t.description ? h('div', { style: css.text }, t.description) : null),
          t.source !== 'Built-in' ? Btn('Remove', (e) => { e.preventDefault(); act('removeTheme', t.id); }, 'danger', true) : null))
        : h('div', { style: css.text }, 'No themes yet.'),
      h('div', { style: Object.assign({}, css.text, { marginTop: '8px' }) }, 'Any .css file you drop in the themes folder shows up here. More themes: betterdiscord.app/themes'));
  }

  // --- LocalProfile: avatar and badges ---
  function AvatarPicker() {
    const st = useZcState();
    const url = st && st.profileUrls && st.profileUrls.avatar;
    return h('div', { style: css.row },
      url ? h('img', { src: url, width: 56, height: 56, style: { borderRadius: '50%', objectFit: 'cover' } }) : null,
      Btn('Choose image or GIF…', () => act('pickAvatar')),
      Btn('Use my original', () => act('resetAvatar'), 'grey'));
  }

  function BadgePicker() {
    const R = React();
    const st = useZcState();
    const [name, setName] = R.useState('');
    if (!st) return null;
    const mine = (st.config.profile && st.config.profile.badges) || [];
    const setBadges = (badges) => save({ profile: { badges } });
    const customUrls = {};
    ((st.profileUrls && st.profileUrls.badges) || []).forEach((b) => (customUrls[b.name] = b.url));
    return h('div', null,
      h('div', { style: Object.assign({}, css.row, { gap: '6px' }) }, st.badgePresets.map((b) => {
        const on = mine.some((x) => x.preset === b.id);
        return h('div', {
          key: b.id, style: Object.assign({}, css.chip, on && css.chipOn),
          onClick: () => setBadges(on ? mine.filter((x) => x.preset !== b.id) : [...mine, { name: b.name, preset: b.id }])
        }, h('img', { src: b.url, width: 20, height: 20 }), b.name);
      })),
      mine.filter((b) => !b.preset).length ? h('div', { style: Object.assign({}, css.row, { gap: '6px' }) }, mine.map((b, i) => b.preset ? null :
        h('div', { key: 'c' + i, style: Object.assign({}, css.chip, css.chipOn), title: 'Click to remove', onClick: () => setBadges(mine.filter((_, j) => j !== i)) },
          customUrls[b.name] ? h('img', { src: customUrls[b.name], width: 20, height: 20 }) : null, b.name, ' ✕'))) : null,
      h('div', { style: css.row },
        h('input', { style: css.input, placeholder: 'Custom badge name', value: name, onChange: (e) => setName(e.target.value) }),
        Btn('Add badge with my own image…', () => { act('addCustomBadge', name || 'My badge'); setName(''); }, 'grey')));
  }

  // --- Plugin definitions ---
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const saveProfileText = debounce((k, v) => save({ profile: { [k]: v } }), 400);

  const PLUGINS = {
    FakeMute: {
      description: 'Appear muted to others in a call while your microphone keeps working. Adds a button next to your mic and headphones.',
      tags: ['Voice', 'Utility'],
      dependencies: ['UserAreaAPI'],
      enabled: (c) => c.fakeMute,
      setEnabled: (on) => { Z.fakeMuteConfig({ enabled: on }); save({ fakeMute: on }); }
    },
    AnimatedBackground: {
      description: 'Use any video, GIF or image as your Discord background.',
      tags: ['Appearance', 'Customisation'],
      enabled: (c) => c.background,
      setEnabled: (on) => save({ background: on }),
      settings: (c) => ({
        file: { type: OPT.COMPONENT, description: 'Background file', component: BackgroundFile },
        intensity: { type: OPT.SLIDER, description: 'Intensity (%)', markers: [5, 25, 50, 75, 100], default: Math.round((c.backgroundOpacity || 0.25) * 100), stickToMarkers: false, onChange: (v) => save({ backgroundOpacity: v / 100 }) },
        blend: {
          type: OPT.SELECT, description: 'Blend mode', onChange: (v) => save({ backgroundBlend: v }),
          options: [
            { label: 'Screen (keeps text readable)', value: 'screen', default: c.backgroundBlend === 'screen' },
            { label: 'Normal (transparent overlay)', value: 'normal', default: c.backgroundBlend === 'normal' },
            { label: 'Overlay (more contrast)', value: 'overlay', default: c.backgroundBlend === 'overlay' },
            { label: 'Soft light', value: 'soft-light', default: c.backgroundBlend === 'soft-light' },
            { label: 'Lighten', value: 'lighten', default: c.backgroundBlend === 'lighten' }
          ]
        }
      })
    },
    ZeroCordThemes: {
      description: 'Built-in themes plus any .css theme file or link, toggled individually.',
      tags: ['Appearance', 'Customisation'],
      enabled: (c) => c.themesEnabled,
      setEnabled: (on) => save({ themesEnabled: on }),
      settings: () => ({ manager: { type: OPT.COMPONENT, description: 'Themes', component: ThemeManager } })
    },
    LocalProfile: {
      description: 'Change your display name, username, avatar and badges. Only you can see these changes.',
      tags: ['Appearance', 'Fun'],
      dependencies: ['BadgeAPI'],
      enabled: (c) => c.profile.enabled,
      setEnabled: (on) => save({ profile: { enabled: on } }),
      settings: (c) => ({
        displayName: { type: OPT.STRING, description: 'Display name (empty keeps yours)', default: c.profile.displayName || '', onChange: (v) => saveProfileText('displayName', v) },
        username: { type: OPT.STRING, description: 'Username (empty keeps yours)', default: c.profile.username || '', onChange: (v) => saveProfileText('username', v) },
        avatar: { type: OPT.COMPONENT, description: 'Avatar', component: AvatarPicker },
        badges: { type: OPT.COMPONENT, description: 'Badges', component: BadgePicker }
      })
    },
    Performance: {
      description: 'Snappier Discord: fewer animations, blocked telemetry and interface zoom.',
      tags: ['Utility'],
      enabled: (c) => c.noAnimations || c.blockTelemetry || Number(c.zoom) !== 1,
      setEnabled: (on) => {
        const s = V().Settings.plugins.Performance || {};
        save(on
          ? { noAnimations: s.noAnimations !== false, blockTelemetry: s.blockTelemetry !== false, zoom: (s.zoom || 100) / 100 }
          : { noAnimations: false, blockTelemetry: false, zoom: 1 });
      },
      settings: (c) => ({
        noAnimations: { type: OPT.BOOLEAN, description: 'Reduce animations', default: c.noAnimations !== false, onChange: (v) => save({ noAnimations: v }) },
        blockTelemetry: { type: OPT.BOOLEAN, description: 'Block telemetry (applies after restarting Discord)', default: c.blockTelemetry !== false, onChange: (v) => save({ blockTelemetry: v }) },
        zoom: { type: OPT.SLIDER, description: 'Interface zoom (%)', markers: [60, 80, 100, 120, 150], default: Math.round((Number(c.zoom) || 1) * 100), stickToMarkers: false, onChange: (v) => save({ zoom: v / 100 }) }
      })
    }
  };

  let registered = false;
  function registerPlugins() {
    const v = V();
    if (registered) return true;
    if (!window.__zcMetaPatched || !state || !v || !v.Plugins || !v.Plugins.plugins || !v.Settings || !v.Api || !v.Api.Settings) return false;
    const api = v.Api.Settings;
    for (const [name, def] of Object.entries(PLUGINS)) {
      if (v.Plugins.plugins[name]) continue;
      const on = !!def.enabled(state.config);
      const plugin = {
        name,
        description: def.description,
        authors: [{ name: 'ZeroCord', id: 0n }],
        tags: def.tags,
        dependencies: def.dependencies,
        patches: [],
        started: on,
        start() { def.setEnabled(true); },
        stop() { def.setEnabled(false); }
      };
      // Settings shown under the cog, stored by Equicord; changes are forwarded to ZeroCord
      if (def.settings) {
        const settingsDef = def.settings(state.config);
        const settings = api.definePluginSettings(settingsDef);
        settings.pluginName = name;
        plugin.settings = settings;
        const store = v.Settings.plugins[name] || (v.Settings.plugins[name] = {});
        for (const [key, opt] of Object.entries(settingsDef)) {
          if (opt.type === OPT.COMPONENT) continue;
          const value = opt.type === OPT.SELECT ? (opt.options.find((o) => o.default) || opt.options[0]).value : opt.default;
          if (store[key] !== value) store[key] = value;
          if (opt.onChange && api.SettingsStore && api.SettingsStore.addChangeListener) {
            api.SettingsStore.addChangeListener(`plugins.${name}.${key}`, (val) => opt.onChange(val));
          }
        }
      }
      v.Plugins.plugins[name] = plugin;
      const store = v.Settings.plugins[name] || (v.Settings.plugins[name] = {});
      if (!!store.enabled !== on) store.enabled = on;
    }
    registered = true;
    return true;
  }

  function syncPlugin(name, on) {
    const v = V();
    if (!registered || !v || !v.Plugins.plugins[name]) return;
    try {
      if (!!v.Settings.plugins[name].enabled !== !!on) v.Settings.plugins[name].enabled = !!on;
      v.Plugins.plugins[name].started = !!on;
    } catch (e) { console.warn('[ZeroCord] plugin sync', e); }
  }

  // --- Branding: "ZeroCord Settings", ZeroCord icon, no Cloud / Backup & Restore ---
  function SmallIcon(props) {
    return h('img', { src: ICON_URL, width: (props && props.width) || 20, height: (props && props.height) || 20, style: { borderRadius: '6px' }, alt: '' });
  }
  const HIDDEN_ENTRIES = new Set(['equicord_cloud', 'equicord_backup_restore', 'vencord_cloud', 'vencord_backup_restore']);
  function brandSettings() {
    const v = V();
    const settings = v && v.Plugins && v.Plugins.plugins && v.Plugins.plugins.Settings;
    if (!settings || settings.__zerocord) return;
    settings.__zerocord = true;
    const buildEntry = settings.buildEntry;
    const buildLayout = settings.buildLayout;
    if (typeof buildEntry === 'function') {
      settings.buildEntry = function (entry) {
        if (!entry) return entry;
        if (HIDDEN_ENTRIES.has(entry.key)) return null;
        if (entry.key === 'equicord_main' || entry.key === 'vencord_main') {
          entry = Object.assign({}, entry, { title: 'ZeroCord', panelTitle: 'ZeroCord Settings', Icon: SmallIcon });
        }
        return buildEntry.call(this, entry);
      };
    }
    if (typeof buildLayout === 'function') {
      settings.buildLayout = function (...args) {
        const out = buildLayout.apply(this, args);
        if (Array.isArray(out)) {
          for (const item of out) {
            if (item && (item.key === 'equicord_section' || item.key === 'vencord_section')) item.useTitle = () => 'ZeroCord Settings';
          }
        }
        return out;
      };
    }
  }

  // Plugin cards show a "User Plugin" badge for ZeroCord plugins: use ZeroCord's icon instead
  function swapBadges(node) {
    if (!node || node.nodeType !== 1) return;
    const imgs = node.matches && node.matches('img') ? [node] : node.querySelectorAll('img');
    imgs.forEach((img) => {
      if (!/icons\/misc\/userplugin\.png/.test(img.getAttribute('src') || '')) return;
      img.setAttribute('src', ICON_URL);
      img.alt = 'ZeroCord';
      img.title = 'ZeroCord Plugin';
      img.style.borderRadius = '4px';
    });
  }
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') swapBadges(m.target);
      else m.addedNodes.forEach(swapBadges);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  // Equicord's user-area button API must be on for FakeMute's button; returns true if a reload is needed
  Z.ensureApis = () => {
    const v = V();
    if (!v || !v.Settings || !v.Settings.plugins || !v.Plugins || !v.Plugins.plugins) return false;
    let changed = false;
    for (const name of ['UserAreaAPI', 'BadgeAPI']) {
      if (!v.Plugins.plugins[name]) continue;
      if (!v.Settings.plugins[name]) v.Settings.plugins[name] = {};
      if (!v.Settings.plugins[name].enabled) { v.Settings.plugins[name].enabled = true; changed = true; }
    }
    return changed;
  };

  Z.setupEngine = (initialState) => {
    setState(initialState);
    brandSettings();
    return registerPlugins();
  };
})();
