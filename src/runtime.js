// Runs inside the Discord page. Driven by ZeroCord's core and the panel.
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
  //  Sounds
  // ==========================================================
  const S = (Z._sounds = { cfg: {}, global: { volume: 1, muted: false }, byPath: {}, map: {}, detected: {} });

  // Reads Discord's internal sound table (name -> file) from webpack
  function findSoundMap() {
    const wreq = window.Vencord && window.Vencord.Webpack && window.Vencord.Webpack.wreq;
    if (!wreq || !wreq.m) return null;
    const out = {};
    for (const id of Object.keys(wreq.m)) {
      let src;
      try { src = Function.prototype.toString.call(wreq.m[id]); } catch { continue; }
      if (src.indexOf('.mp3"') === -1) continue;
      const re = /"\.\/([\w.-]+)\.mp3"\s*:\s*"?(\d+)"?/g;
      let m, hits = 0;
      while ((m = re.exec(src))) {
        hits++;
        try {
          let v = wreq(m[2]);
          v = (v && v.default) || v;
          if (typeof v === 'string') out[m[1]] = new URL(v, location.href).href;
        } catch {}
      }
      if (hits > 5 && Object.keys(out).length) break;
    }
    return Object.keys(out).length ? out : null;
  }

  Z.mapSounds = () => {
    const m = findSoundMap();
    if (m) {
      S.map = m;
      for (const [n, u] of Object.entries(m)) S.byPath[pathOf(u)] = n;
    }
    return !!m;
  };

  Z.listSounds = () => {
    if (!Object.keys(S.map).length) Z.mapSounds();
    return { mapped: Object.assign({}, S.map), detected: Object.assign({}, S.detected) };
  };

  Z.setSounds = (d) => {
    S.cfg = (d && d.cfg) || {};
    S.global = (d && d.global) || { volume: 1, muted: false };
    return true;
  };

  const factor = (el) => {
    const n = el.__zcName;
    if (!n) return 1;
    const c = S.cfg[n] || {};
    return Math.max(0, Math.min(1, (c.volume ?? 1) * (S.global.volume ?? 1)));
  };

  // Volume: Discord sets it, we multiply by your setting
  const volumeDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    configurable: true, enumerable: true,
    get() { return this.__zcVolume ?? volumeDesc.get.call(this); },
    set(v) { this.__zcVolume = v; volumeDesc.set.call(this, Math.max(0, Math.min(1, v * factor(this)))); }
  });

  // Every time Discord plays a sound, identify it and swap/mute it if you asked to
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    try {
      if (this.id !== 'zc-background') {
        const current = this.src || this.getAttribute('src') || '';
        const orig = this.__zcSwapped && current === this.__zcSwapped ? this.__zcOrig : current;
        const p = pathOf(orig);
        if (isDiscordSound(p)) {
          if (!S.byPath[p] && !Object.keys(S.map).length) Z.mapSounds();
          let name = S.byPath[p];
          if (!name) {
            name = 'other-' + p.split('/').pop().split('.')[0].slice(0, 10);
            S.byPath[p] = name;
            S.detected[name] = new URL(orig, location.href).href;
          }
          this.__zcName = name;
          this.__zcOrig = orig;
          const c = S.cfg[name] || {};
          if (S.global.muted || c.muted) return Promise.resolve();
          const target = c.url ? new URL(c.url, location.href).href : null;
          if (target) {
            if (current !== target) { this.src = target; this.__zcSwapped = this.src; }
          } else if (this.__zcSwapped && current === this.__zcSwapped) {
            this.src = orig; this.__zcSwapped = null;
          }
          const requested = this.__zcVolume ?? volumeDesc.get.call(this);
          volumeDesc.set.call(this, Math.max(0, Math.min(1, requested * factor(this))));
        }
      }
    } catch (e) { console.warn('[ZeroCord] sounds', e); }
    return originalPlay.apply(this, arguments);
  };

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
  //  Plugins (Equicord / Vencord)
  // ==========================================================
  Z.listPlugins = () => {
    const V = window.Vencord;
    if (!V || !V.Plugins || !V.Plugins.plugins) return null;
    const out = [];
    for (const [name, pl] of Object.entries(V.Plugins.plugins)) {
      if (!pl || pl.hidden) continue;
      out.push({
        name,
        description: String(pl.description || ''),
        tags: Array.isArray(pl.tags) ? pl.tags : [],
        system: !!pl.required || name.endsWith('API'),
        enabled: !!(V.Settings.plugins[name] && V.Settings.plugins[name].enabled) || !!pl.required
      });
    }
    return out.sort((a, b) => (a.system - b.system) || a.name.localeCompare(b.name));
  };

  Z.togglePlugins = (names, on) => {
    const V = window.Vencord;
    if (!V || !V.Settings || !V.Settings.plugins) return null;
    for (const n of names || []) {
      try {
        if (!(V.Plugins && V.Plugins.plugins && V.Plugins.plugins[n])) continue;
        if (!V.Settings.plugins[n]) V.Settings.plugins[n] = {};
        V.Settings.plugins[n].enabled = !!on;
      } catch (e) { console.warn('[ZeroCord] plugin', n, e); }
    }
    return Z.listPlugins();
  };

  // ==========================================================
  //  Fake mute: people in the call see you muted, but you keep talking
  // ==========================================================
  const FM = (Z._fakeMute = { cfg: { enabled: true, hotkey: true }, active: false, socket: null, originalSend: null, last: null, timer: null });
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

  function paintButton() {
    const b = document.getElementById('zc-panel-button');
    if (b) b.style.color = FM.active ? '#ed4245' : 'var(--interactive-normal, #b5bac1)';
  }

  Z.fakeMuteState = () => {
    const selected = findProps('getVoiceChannelId');
    return { active: FM.active, enabled: FM.cfg.enabled, inCall: !!(selected && selected.getVoiceChannelId && selected.getVoiceChannelId()) };
  };

  Z.fakeMuteToggle = (force) => {
    if (!FM.cfg.enabled) return Z.fakeMuteState();
    FM.active = typeof force === 'boolean' ? force : !FM.active;
    wrapSocket();
    const inCall = resendVoiceState();
    paintButton();
    toast(FM.active ? 'Fake mute on: you look muted' : 'Fake mute off', FM.active);
    return Object.assign(Z.fakeMuteState(), { inCall });
  };

  Z.fakeMuteConfig = (cfg) => {
    FM.cfg = Object.assign({ enabled: true, hotkey: true }, cfg || {});
    if (!FM.cfg.enabled && FM.active) Z.fakeMuteToggle(false);
    if (FM.cfg.enabled && !FM.timer) {
      // the gateway connection can be recreated (reconnect): wrap it again when it changes
      FM.timer = setInterval(() => { try { wrapSocket(); } catch {} }, 3000);
    }
    return Z.fakeMuteState();
  };

  document.addEventListener('keydown', (e) => {
    if (FM.cfg.enabled && FM.cfg.hotkey && e.ctrlKey && e.shiftKey && e.code === 'KeyQ') {
      e.preventDefault();
      e.stopPropagation();
      Z.fakeMuteToggle();
    }
  }, true);

  // ==========================================================
  //  Panel button: a Discord-style icon next to Inbox / Help
  // ==========================================================
  const ICON = '<svg aria-hidden="true" role="img" width="24" height="24" viewBox="0 0 24 24" fill="none">' +
    '<path fill="currentColor" d="M12 2a1 1 0 0 1 .97.76l.73 2.9a4 4 0 0 0 2.64 2.64l2.9.73a1 1 0 0 1 0 1.94l-2.9.73a4 4 0 0 0-2.64 2.64l-.73 2.9a1 1 0 0 1-1.94 0l-.73-2.9a4 4 0 0 0-2.64-2.64l-2.9-.73a1 1 0 0 1 0-1.94l2.9-.73A4 4 0 0 0 10.3 5.66l.73-2.9A1 1 0 0 1 12 2Z"/>' +
    '<path fill="currentColor" d="M19 15a.75.75 0 0 1 .73.57l.25 1a1.5 1.5 0 0 0 1.45 1.18l.07.01a.75.75 0 0 1 0 1.48l-.07.01a1.5 1.5 0 0 0-1.45 1.18l-.25 1a.75.75 0 0 1-1.46 0l-.25-1a1.5 1.5 0 0 0-1.45-1.18l-.07-.01a.75.75 0 0 1 0-1.48l.07-.01a1.5 1.5 0 0 0 1.45-1.18l.25-1A.75.75 0 0 1 19 15Z" opacity=".7"/></svg>';

  let buttonOn = false;
  let tip = null;

  function showTip(target) {
    if (!tip) {
      tip = document.createElement('div');
      Object.assign(tip.style, {
        position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', padding: '8px 12px', borderRadius: '8px',
        background: '#111214', color: '#dbdee1', font: '600 14px/18px "gg sans","Noto Sans","Segoe UI",sans-serif',
        boxShadow: '0 8px 16px rgba(0,0,0,.24)', whiteSpace: 'nowrap', transition: 'opacity .1s', opacity: '0'
      });
      document.body.appendChild(tip);
    }
    tip.textContent = FM.active ? 'ZeroCord · fake mute on' : 'ZeroCord';
    const r = target.getBoundingClientRect();
    tip.style.left = Math.round(r.left + r.width / 2) + 'px';
    tip.style.top = Math.round(r.bottom + 8) + 'px';
    tip.style.transform = 'translateX(-50%)';
    tip.style.opacity = '1';
  }
  const hideTip = () => { if (tip) tip.style.opacity = '0'; };

  function makeButton(className) {
    const b = document.createElement('div');
    b.id = 'zc-panel-button';
    b.setAttribute('role', 'button');
    b.setAttribute('tabindex', '0');
    b.setAttribute('aria-label', 'ZeroCord');
    b.innerHTML = ICON;
    if (className) b.className = className;
    Object.assign(b.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      color: FM.active ? '#ed4245' : 'var(--interactive-normal, #b5bac1)', transition: 'color .15s ease'
    });
    b.onmouseenter = () => { if (!FM.active) b.style.color = 'var(--interactive-hover, #dbdee1)'; showTip(b); };
    b.onmouseleave = () => { b.style.color = FM.active ? '#ed4245' : 'var(--interactive-normal, #b5bac1)'; hideTip(); };
    b.onclick = () => { hideTip(); window.ZeroCordNative && window.ZeroCordNative.openPanel(); };
    b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.onclick(); } };
    return b;
  }

  // Finds Discord's Help (or Inbox) icon so ours sits right next to it
  function findNeighbor() {
    const help = document.querySelector('a[href^="https://support.discord.com"]');
    if (help) return help.closest('[class*="clickable"], [role="button"]') || help;
    const inbox = document.querySelector('[aria-label="Inbox"], [aria-label="Caixa de entrada"], [aria-label="Caixa de Entrada"]');
    return inbox ? (inbox.closest('[class*="clickable"], [role="button"]') || inbox) : null;
  }

  function placeButton() {
    if (!buttonOn) return;
    const current = document.getElementById('zc-panel-button');
    const neighbor = findNeighbor();
    if (neighbor && neighbor.parentElement) {
      if (current && current.parentElement === neighbor.parentElement && current.nextSibling === neighbor) return;
      if (current) current.remove();
      neighbor.parentElement.insertBefore(makeButton(neighbor.className), neighbor);
      return;
    }
    // No Discord header (e.g. login screen): a subtle floating icon in the corner
    if (current) return;
    const b = makeButton('');
    Object.assign(b.style, { position: 'fixed', top: '8px', right: '96px', width: '24px', height: '24px', zIndex: '2147483647' });
    document.body.appendChild(b);
  }

  let buttonObserver = null;
  Z.panelButton = (show) => {
    buttonOn = !!show;
    if (!show) {
      const b = document.getElementById('zc-panel-button');
      if (b) b.remove();
      hideTip();
      if (buttonObserver) { buttonObserver.disconnect(); buttonObserver = null; }
      return;
    }
    placeButton();
    if (!buttonObserver) {
      let pending = false;
      buttonObserver = new MutationObserver(() => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; placeButton(); });
      });
      buttonObserver.observe(document.body, { childList: true, subtree: true });
    }
  };
})();
