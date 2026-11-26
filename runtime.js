// Roda dentro da página do Discord. Controlado pelo ZeroCord (main.js) e pelo Painel.
(() => {
  if (window.__meuDiscord) return;
  const M = (window.__meuDiscord = {});

  const esperar = (fn, tentativas = 120) => new Promise((res) => {
    let n = 0;
    const t = setInterval(() => {
      let v; try { v = fn(); } catch {}
      if (v || ++n > tentativas) { clearInterval(t); res(v); }
    }, 500);
  });
  const caminho = (u) => { try { return new URL(u, location.href).pathname; } catch { return String(u || ''); } };
  const ehSomDoDiscord = (p) => /\/assets\/.+\.(mp3|ogg|wav)$/i.test(p);

  // ==========================================================
  //  Fundo animado
  // ==========================================================
  M.fundo = (c) => {
    let el = document.getElementById('meu-fundo');
    if (!c || !c.ativo || !c.src) { if (el) el.remove(); return; }
    const tag = c.video ? 'VIDEO' : 'IMG';
    if (el && (el.tagName !== tag || el.dataset.src !== c.src)) { el.remove(); el = null; }
    if (!el) {
      el = document.createElement(tag.toLowerCase());
      el.id = 'meu-fundo';
      el.dataset.src = c.src;
      if (c.video) { el.autoplay = true; el.loop = true; el.muted = true; el.playsInline = true; }
      el.src = c.src;
      Object.assign(el.style, {
        position: 'fixed', inset: '0', width: '100vw', height: '100vh', objectFit: 'cover',
        pointerEvents: 'none', zIndex: '2147483646'
      });
      document.body.appendChild(el);
    }
    el.style.opacity = String(c.opacidade);
    el.style.mixBlendMode = c.mistura;
  };
  document.addEventListener('visibilitychange', () => {
    const el = document.getElementById('meu-fundo');
    if (el && el.tagName === 'VIDEO') document.hidden ? el.pause() : el.play().catch(() => {});
  });

  // ==========================================================
  //  Sons
  // ==========================================================
  const S = (M._sons = { cfg: {}, geral: { volume: 1, mudo: false }, porCaminho: {}, mapa: {}, detectados: {} });

  // Lê a tabela interna de sons do Discord (nome -> arquivo) pelo webpack
  function acharMapa() {
    const wreq = window.Vencord && window.Vencord.Webpack && window.Vencord.Webpack.wreq;
    if (!wreq || !wreq.m) return null;
    const out = {};
    for (const id of Object.keys(wreq.m)) {
      let src;
      try { src = Function.prototype.toString.call(wreq.m[id]); } catch { continue; }
      if (src.indexOf('.mp3"') === -1) continue;
      const re = /"\.\/([\w.-]+)\.mp3"\s*:\s*"?(\d+)"?/g;
      let m, achou = 0;
      while ((m = re.exec(src))) {
        achou++;
        try {
          let v = wreq(m[2]);
          v = (v && v.default) || v;
          if (typeof v === 'string') out[m[1]] = new URL(v, location.href).href;
        } catch {}
      }
      if (achou > 5 && Object.keys(out).length) break;
    }
    return Object.keys(out).length ? out : null;
  }

  M.mapearSons = () => {
    const m = acharMapa();
    if (m) {
      S.mapa = m;
      for (const [n, u] of Object.entries(m)) S.porCaminho[caminho(u)] = n;
    }
    return !!m;
  };

  M.listarSons = () => {
    if (!Object.keys(S.mapa).length) M.mapearSons();
    return { mapeados: Object.assign({}, S.mapa), detectados: Object.assign({}, S.detectados) };
  };

  M.aplicarSons = (d) => {
    S.cfg = (d && d.cfg) || {};
    S.geral = (d && d.geral) || { volume: 1, mudo: false };
    return true;
  };

  const fator = (el) => {
    const n = el.__meuNome;
    if (!n) return 1;
    const c = S.cfg[n] || {};
    return Math.max(0, Math.min(1, (c.volume ?? 1) * (S.geral.volume ?? 1)));
  };

  // Volume: o Discord define o volume, a gente multiplica pelo seu ajuste
  const descVol = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    configurable: true, enumerable: true,
    get() { return this.__meuVolPedido ?? descVol.get.call(this); },
    set(v) { this.__meuVolPedido = v; descVol.set.call(this, Math.max(0, Math.min(1, v * fator(this)))); }
  });

  // Toda vez que o Discord toca um som, a gente identifica qual é e troca/silencia se você mandou
  const tocarOriginal = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    try {
      if (this.id !== 'meu-fundo') {
        const srcAtual = this.src || this.getAttribute('src') || '';
        const orig = this.__meuTrocado && srcAtual === this.__meuTrocado ? this.__meuOrig : srcAtual;
        const p = caminho(orig);
        if (ehSomDoDiscord(p)) {
          if (!S.porCaminho[p] && !Object.keys(S.mapa).length) M.mapearSons();
          let nome = S.porCaminho[p];
          if (!nome) {
            nome = 'outro-' + p.split('/').pop().split('.')[0].slice(0, 10);
            S.porCaminho[p] = nome;
            S.detectados[nome] = new URL(orig, location.href).href;
          }
          this.__meuNome = nome;
          this.__meuOrig = orig;
          const c = S.cfg[nome] || {};
          if (S.geral.mudo || c.mudo) return Promise.resolve();
          const alvo = c.url ? new URL(c.url, location.href).href : null;
          if (alvo) {
            if (srcAtual !== alvo) { this.src = alvo; this.__meuTrocado = this.src; }
          } else if (this.__meuTrocado && srcAtual === this.__meuTrocado) {
            this.src = orig; this.__meuTrocado = null;
          }
          const pedido = this.__meuVolPedido ?? descVol.get.call(this);
          descVol.set.call(this, Math.max(0, Math.min(1, pedido * fator(this))));
        }
      }
    } catch (e) { console.warn('[ZeroCord] sons', e); }
    return tocarOriginal.apply(this, arguments);
  };

  // ==========================================================
  //  Perfil local (só você vê)
  // ==========================================================
  const P = (M._perfil = { cfg: null, orig: null, badges: [], obs: null, timer: null });
  const userStore = () => window.Vencord && window.Vencord.Webpack && window.Vencord.Webpack.Common && window.Vencord.Webpack.Common.UserStore;

  function aplicarNomes() {
    const US = userStore();
    const u = US && US.getCurrentUser && US.getCurrentUser();
    if (!u) return;
    if (!P.orig || P.orig.id !== u.id) P.orig = { id: u.id, globalName: u.globalName, username: u.username, getAvatarURL: u.getAvatarURL };
    if (!u.__meuGuardado) {
      u.__meuGuardado = true;
      u.__meuOrigNomes = { globalName: u.globalName, username: u.username };
    }
    const c = P.cfg || {};
    const on = !!c.ativo;
    const gn = on && c.nomeExibicao ? c.nomeExibicao : u.__meuOrigNomes.globalName;
    const un = on && c.usuario ? c.usuario : u.__meuOrigNomes.username;
    let mudou = false;
    try { if (u.globalName !== gn) { u.globalName = gn; mudou = true; } } catch {}
    try { if (u.username !== un) { u.username = un; mudou = true; } } catch {}
    try {
      if (on && c.avatar) {
        if (!u.__meuAvatar) { u.__meuAvatarOrig = u.getAvatarURL; u.getAvatarURL = () => c.avatar; u.__meuAvatar = c.avatar; mudou = true; }
        else if (u.__meuAvatar !== c.avatar) { u.getAvatarURL = () => c.avatar; u.__meuAvatar = c.avatar; mudou = true; }
      } else if (u.__meuAvatar) {
        u.getAvatarURL = u.__meuAvatarOrig; delete u.__meuAvatar; mudou = true;
      }
    } catch {}
    if (mudou) { try { US.emitChange(); } catch {} }
  }

  function tratarImg(img) {
    if (!img || img.tagName !== 'IMG' || !P.orig) return;
    const c = P.cfg || {};
    const usar = c.ativo && c.avatar;
    const s = img.getAttribute('src') || '';
    if (usar) {
      if (s === c.avatar) return;
      if (s.includes('/avatars/' + P.orig.id + '/') || img.__meuAvatar) {
        if (!img.__meuAvatar) img.__meuAvatarOrig = s;
        img.__meuAvatar = true;
        img.setAttribute('src', c.avatar);
        img.removeAttribute('srcset');
      }
    } else if (img.__meuAvatar) {
      img.__meuAvatar = false;
      img.setAttribute('src', img.__meuAvatarOrig);
    }
  }

  function varrerImgs(raiz) {
    if (!raiz || !raiz.querySelectorAll) return;
    if (raiz.tagName === 'IMG') tratarImg(raiz);
    raiz.querySelectorAll('img').forEach(tratarImg);
  }

  function aplicarBadges() {
    const api = window.Vencord && window.Vencord.Api && window.Vencord.Api.Badges;
    if (!api) return;
    for (const b of P.badges) { try { api.removeProfileBadge(b); } catch {} }
    P.badges = [];
    const c = P.cfg || {};
    if (!c.ativo || !P.orig) return;
    const meuId = P.orig.id;
    const lista = (c.badges || []).slice().reverse();
    lista.forEach((b, i) => {
      const obj = {
        id: 'zerocord-' + i,
        description: b.nome,
        iconSrc: b.url,
        position: 0,
        shouldShow: (info) => info && info.userId === meuId
      };
      try { api.addProfileBadge(obj); P.badges.push(obj); } catch {}
    });
  }

  M.aplicarPerfil = async (cfg) => {
    P.cfg = cfg;
    const pronto = await esperar(() => { const US = userStore(); return US && US.getCurrentUser && US.getCurrentUser(); });
    if (!pronto) return 'sem-vencord';
    aplicarNomes();
    aplicarBadges();
    varrerImgs(document.body);
    if (!P.obs) {
      P.obs = new MutationObserver((muts) => {
        if (!P.cfg || (!P.cfg.ativo && !document.querySelector('img'))) return;
        for (const m of muts) {
          if (m.type === 'attributes') tratarImg(m.target);
          else m.addedNodes.forEach(varrerImgs);
        }
      });
      P.obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }
    if (!P.timer) P.timer = setInterval(() => { try { aplicarNomes(); } catch {} }, 2000);
    return 'ok';
  };

  // ==========================================================
  //  Plugins do Vencord
  // ==========================================================
  M.statusPlugins = (nomes) => {
    const V = window.Vencord;
    if (!V || !V.Settings || !V.Settings.plugins) return { vencord: false, plugins: {} };
    const out = {};
    for (const n of nomes || []) {
      const existe = !!(V.Plugins && V.Plugins.plugins && V.Plugins.plugins[n]);
      out[n] = existe ? !!(V.Settings.plugins[n] && V.Settings.plugins[n].enabled) : null;
    }
    return { vencord: true, plugins: out };
  };

  M.listarPlugins = () => {
    const V = window.Vencord;
    if (!V || !V.Plugins || !V.Plugins.plugins) return null;
    const out = [];
    for (const [nome, pl] of Object.entries(V.Plugins.plugins)) {
      if (!pl || pl.hidden) continue;
      out.push({
        nome,
        descricao: String(pl.description || ''),
        tags: Array.isArray(pl.tags) ? pl.tags : [],
        obrigatorio: !!pl.required || nome.endsWith('API'),
        ativo: !!(V.Settings.plugins[nome] && V.Settings.plugins[nome].enabled) || !!pl.required
      });
    }
    return out.sort((a, b) => (a.obrigatorio - b.obrigatorio) || a.nome.localeCompare(b.nome));
  };

  M.ativarPlugins = (nomes, ativo) => {
    const V = window.Vencord;
    if (!V || !V.Settings || !V.Settings.plugins) return { vencord: false, plugins: {} };
    for (const n of nomes || []) {
      try {
        if (!(V.Plugins && V.Plugins.plugins && V.Plugins.plugins[n])) continue;
        if (!V.Settings.plugins[n]) V.Settings.plugins[n] = {};
        V.Settings.plugins[n].enabled = !!ativo;
      } catch (e) { console.warn('[ZeroCord] plugin', n, e); }
    }
    return M.statusPlugins(nomes);
  };

  // ==========================================================
  //  Mute falso: pra quem está na call você aparece mutado, mas continua falando
  // ==========================================================
  const MF = (M._muteFalso = { cfg: { habilitado: true, atalho: true }, ativo: false, socket: null, envioOriginal: null, ultimo: null, timer: null });
  const acharProps = (...props) => {
    try { return window.Vencord && window.Vencord.Webpack && window.Vencord.Webpack.findByProps(...props); } catch { return null; }
  };
  const pegarSocket = () => { const ws = acharProps('getSocket'); try { return ws && ws.getSocket(); } catch { return null; } };

  // Intercepta o envio do "estado de voz" (op 4) pro servidor do Discord
  function embrulharSocket() {
    const s = pegarSocket();
    if (!s) return false;
    if (s === MF.socket) return true;
    if (MF.socket && MF.envioOriginal) { try { MF.socket.send = MF.envioOriginal; } catch {} }
    const original = s.send;
    MF.socket = s;
    MF.envioOriginal = original;
    s.send = function (op, dados, ...resto) {
      if (op === 4 && dados && typeof dados === 'object') {
        MF.ultimo = Object.assign({}, dados);
        if (MF.ativo) dados = Object.assign({}, dados, { self_mute: true });
      }
      return original.call(this, op, dados, ...resto);
    };
    return true;
  }

  // Reenvia o estado de voz atual (sem mexer na câmera nem no "surdo")
  function reenviarEstado() {
    const s = pegarSocket();
    const sel = acharProps('getVoiceChannelId');
    const canalId = sel && sel.getVoiceChannelId && sel.getVoiceChannelId();
    if (!s || !canalId) return false;
    const midia = acharProps('isDeaf', 'isMute');
    const canais = (window.Vencord && window.Vencord.Webpack && window.Vencord.Webpack.Common && window.Vencord.Webpack.Common.ChannelStore) || acharProps('getChannel', 'getDMFromUserId');
    const canal = canais && canais.getChannel && canais.getChannel(canalId);
    const base = MF.ultimo && MF.ultimo.channel_id === canalId ? MF.ultimo : {
      guild_id: (canal && canal.guild_id) || null, channel_id: canalId,
      self_deaf: !!(midia && midia.isDeaf && midia.isDeaf()), self_video: false, flags: 0
    };
    const mutadoDeVerdade = !!(midia && midia.isMute && midia.isMute());
    s.send(4, Object.assign({}, base, { self_mute: MF.ativo ? true : mutadoDeVerdade }));
    return true;
  }

  function avisoNaTela(texto, vermelho) {
    let t = document.getElementById('meu-aviso');
    if (!t) {
      t = document.createElement('div');
      t.id = 'meu-aviso';
      Object.assign(t.style, {
        position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: '2147483647', pointerEvents: 'none',
        padding: '10px 16px', borderRadius: '8px', font: '600 14px/18px "gg sans","Noto Sans","Segoe UI",sans-serif',
        background: '#111214', color: '#dbdee1', boxShadow: '0 8px 16px rgba(0,0,0,.24)', transition: 'opacity .2s', opacity: '0'
      });
      document.body.appendChild(t);
    }
    t.textContent = texto;
    t.style.borderLeft = '4px solid ' + (vermelho ? '#ed4245' : '#23a55a');
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.style.opacity = '0'), 2200);
  }

  function pintarBotao() {
    const b = document.getElementById('meu-botao-painel');
    if (!b) return;
    b.style.color = MF.ativo ? '#ed4245' : 'var(--interactive-normal, #b5bac1)';
  }

  M.muteFalsoAlternar = (forcar) => {
    if (!MF.cfg.habilitado) return M.muteFalsoEstado();
    MF.ativo = typeof forcar === 'boolean' ? forcar : !MF.ativo;
    embrulharSocket();
    const emCall = reenviarEstado();
    pintarBotao();
    avisoNaTela(MF.ativo ? 'Mute falso ligado: você aparece mutado' : 'Mute falso desligado', MF.ativo);
    return Object.assign(M.muteFalsoEstado(), { emCall });
  };

  M.muteFalsoEstado = () => {
    const sel = acharProps('getVoiceChannelId');
    return { ativo: MF.ativo, habilitado: MF.cfg.habilitado, emCall: !!(sel && sel.getVoiceChannelId && sel.getVoiceChannelId()) };
  };

  M.muteFalsoConfig = (cfg) => {
    MF.cfg = Object.assign({ habilitado: true, atalho: true }, cfg || {});
    if (!MF.cfg.habilitado && MF.ativo) M.muteFalsoAlternar(false);
    if (MF.cfg.habilitado && !MF.timer) {
      // a conexão com o Discord pode ser recriada (reconexão): embrulha de novo quando mudar
      MF.timer = setInterval(() => { try { embrulharSocket(); } catch {} }, 3000);
    }
    return M.muteFalsoEstado();
  };

  document.addEventListener('keydown', (e) => {
    if (MF.cfg.habilitado && MF.cfg.atalho && e.ctrlKey && e.shiftKey && e.code === 'KeyQ') {
      e.preventDefault();
      e.stopPropagation();
      M.muteFalsoAlternar();
    }
  }, true);

  // ==========================================================
  //  Botão do painel: ícone igual aos do Discord, ao lado de Caixa de entrada / Ajuda
  // ==========================================================
  const ICONE = '<svg aria-hidden="true" role="img" width="24" height="24" viewBox="0 0 24 24" fill="none">' +
    '<path fill="currentColor" d="M12 2a1 1 0 0 1 .97.76l.73 2.9a4 4 0 0 0 2.64 2.64l2.9.73a1 1 0 0 1 0 1.94l-2.9.73a4 4 0 0 0-2.64 2.64l-.73 2.9a1 1 0 0 1-1.94 0l-.73-2.9a4 4 0 0 0-2.64-2.64l-2.9-.73a1 1 0 0 1 0-1.94l2.9-.73A4 4 0 0 0 10.3 5.66l.73-2.9A1 1 0 0 1 12 2Z"/>' +
    '<path fill="currentColor" d="M19 15a.75.75 0 0 1 .73.57l.25 1a1.5 1.5 0 0 0 1.45 1.18l.07.01a.75.75 0 0 1 0 1.48l-.07.01a1.5 1.5 0 0 0-1.45 1.18l-.25 1a.75.75 0 0 1-1.46 0l-.25-1a1.5 1.5 0 0 0-1.45-1.18l-.07-.01a.75.75 0 0 1 0-1.48l.07-.01a1.5 1.5 0 0 0 1.45-1.18l.25-1A.75.75 0 0 1 19 15Z" opacity=".7"/></svg>';

  let botaoLigado = false;
  let dica = null;

  function mostrarDica(alvo) {
    if (!dica) {
      dica = document.createElement('div');
      dica.textContent = 'ZeroCord';
      dica.dataset.base = 'ZeroCord';
      Object.assign(dica.style, {
        position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', padding: '8px 12px', borderRadius: '8px',
        background: '#111214', color: '#dbdee1', font: '600 14px/18px "gg sans","Noto Sans","Segoe UI",sans-serif',
        boxShadow: '0 8px 16px rgba(0,0,0,.24)', whiteSpace: 'nowrap', transition: 'opacity .1s', opacity: '0'
      });
      document.body.appendChild(dica);
    }
    dica.textContent = M._muteFalso && M._muteFalso.ativo ? 'ZeroCord · mute falso ligado' : 'ZeroCord';
    const r = alvo.getBoundingClientRect();
    dica.style.left = Math.round(r.left + r.width / 2) + 'px';
    dica.style.top = Math.round(r.bottom + 8) + 'px';
    dica.style.transform = 'translateX(-50%)';
    dica.style.opacity = '1';
  }
  const esconderDica = () => { if (dica) dica.style.opacity = '0'; };

  function criarBotao(classe) {
    const b = document.createElement('div');
    b.id = 'meu-botao-painel';
    b.setAttribute('role', 'button');
    b.setAttribute('tabindex', '0');
    b.setAttribute('aria-label', 'ZeroCord');
    b.innerHTML = ICONE;
    if (classe) b.className = classe;
    Object.assign(b.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      color: 'var(--interactive-normal, #b5bac1)', transition: 'color .15s ease'
    });
    if (M._muteFalso && M._muteFalso.ativo) b.style.color = '#ed4245';
    b.onmouseenter = () => { if (!M._muteFalso.ativo) b.style.color = 'var(--interactive-hover, #dbdee1)'; mostrarDica(b); };
    b.onmouseleave = () => { b.style.color = M._muteFalso.ativo ? '#ed4245' : 'var(--interactive-normal, #b5bac1)'; esconderDica(); };
    b.onclick = () => { esconderDica(); window.MeuDiscordNative && window.MeuDiscordNative.abrirPainel(); };
    b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.onclick(); } };
    return b;
  }

  // Acha o ícone de Ajuda (ou de Caixa de entrada) do Discord pra colocar o nosso do lado
  function acharVizinho() {
    const ajuda = document.querySelector('a[href^="https://support.discord.com"]');
    if (ajuda) return ajuda.closest('[class*="clickable"], [role="button"]') || ajuda;
    const caixa = document.querySelector('[aria-label="Inbox"], [aria-label="Caixa de entrada"], [aria-label="Caixa de Entrada"]');
    return caixa ? (caixa.closest('[class*="clickable"], [role="button"]') || caixa) : null;
  }

  function encaixarBotao() {
    if (!botaoLigado) return;
    const atual = document.getElementById('meu-botao-painel');
    const viz = acharVizinho();
    if (viz && viz.parentElement) {
      if (atual && atual.parentElement === viz.parentElement && atual.nextSibling === viz) return;
      if (atual) atual.remove();
      viz.parentElement.insertBefore(criarBotao(viz.className), viz);
      return;
    }
    // Sem a barra do Discord (tela de login, por exemplo): ícone discreto flutuando no canto
    if (atual) return;
    const b = criarBotao('');
    Object.assign(b.style, { position: 'fixed', top: '8px', right: '96px', width: '24px', height: '24px', zIndex: '2147483647' });
    document.body.appendChild(b);
  }

  let obsBotao = null;
  M.botao = (mostrar) => {
    botaoLigado = !!mostrar;
    if (!mostrar) {
      const b = document.getElementById('meu-botao-painel');
      if (b) b.remove();
      esconderDica();
      if (obsBotao) { obsBotao.disconnect(); obsBotao = null; }
      return;
    }
    encaixarBotao();
    if (!obsBotao) {
      let pendente = false;
      obsBotao = new MutationObserver(() => {
        if (pendente) return;
        pendente = true;
        requestAnimationFrame(() => { pendente = false; encaixarBotao(); });
      });
      obsBotao.observe(document.body, { childList: true, subtree: true });
    }
  };
})();
