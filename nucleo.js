const { app, BrowserWindow, session, shell, desktopCapturer, protocol, net, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const URL_DISCORD = 'https://discord.com/app';
const MODS = {
  equicord: { url: 'https://github.com/Equicord/Equicord/releases/download/latest/Equicord.user.js', arquivo: 'Equicord.user.js' },
  vencord: { url: 'https://github.com/Vendicated/Vencord/releases/download/devbuild/Vencord.user.js', arquivo: 'Vencord.user.js' }
};
const modAtual = () => MODS[config.mod] ? config.mod : 'equicord';

// ============================================================
//  Pastas e configuração
// ============================================================

// Onde ficam config.json, temas, sons, perfil e o fundo.
// Definida por quem carrega o núcleo: app separado (pasta do projeto/.exe) ou Discord oficial (%APPDATA%\ZeroCord)
function pastaDoApp() {
  return process.env.MEUDISCORD_DADOS || __dirname;
}
const MODO_INJETADO = process.env.MEUDISCORD_MODO === 'injetado';
const pasta = (...p) => path.join(pastaDoApp(), ...p);

function lerArquivo(nome, padrao = '') {
  for (const base of [pastaDoApp(), __dirname]) {
    try { return fs.readFileSync(path.join(base, nome), 'utf8'); } catch {}
  }
  return padrao;
}

const PADRAO = {
  aceleracaoHardware: true,
  bloquearTelemetria: true,
  semAnimacoes: true,
  corretorOrtografico: false,
  zoom: 1.0,
  economizarEmSegundoPlano: true,
  plugins: true,
  mod: 'equicord',
  botaoPainel: true,
  fundo: true,
  fundoOpacidade: 0.25,
  fundoMistura: 'screen',
  temasOnline: [],
  temasAtivos: {},
  sons: {},
  sonsGeral: { volume: 1, mudo: false },
  perfil: { ativo: false, nomeExibicao: '', usuario: '', avatar: '', badges: [] },
  muteFalso: { habilitado: true, atalho: true }
};

let config;
try { config = Object.assign({}, PADRAO, JSON.parse(lerArquivo('config.json', '{}') || '{}')); }
catch { config = Object.assign({}, PADRAO); }

function salvarConfig() {
  try { fs.writeFileSync(pasta('config.json'), JSON.stringify(config, null, 2)); } catch (e) { console.error('Nao salvou config', e); }
}

function garantirPasta(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }

// Protocolo interno pra servir arquivos locais (fundo, sons, avatar, badges) pro Discord
protocol.registerSchemesAsPrivileged([
  { scheme: 'meufundo', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

const NOMES_FUNDO = ['fundo.mp4', 'fundo.webm', 'fundo.gif', 'fundo.png', 'fundo.jpg', 'fundo.jpeg', 'fundo.webp'];
function acharFundo() {
  for (const nome of NOMES_FUNDO) if (fs.existsSync(pasta(nome))) return nome;
  return null;
}

let janela = null;
let painel = null;

const ehDoDiscord = (url) => {
  try { const h = new URL(url).hostname; return h === 'discord.com' || h.endsWith('.discord.com'); } catch { return false; }
};

// ============================================================
//  Plugins: Equicord (padrão, 300+ plugins) ou Vencord
// ============================================================
const caminhoCacheMod = (mod) => pasta('mods', MODS[mod].arquivo);

function lerVencord() {
  const mod = modAtual();
  for (const p of [caminhoCacheMod(mod), path.join(__dirname, 'vendor', MODS[mod].arquivo)]) {
    try { const t = fs.readFileSync(p, 'utf8'); if (t.includes('==UserScript==')) return t; } catch {}
  }
  return '';
}

// Baixa a versão mais nova em segundo plano; vale a partir da próxima vez que abrir
async function atualizarVencord() {
  const mod = modAtual();
  try {
    const r = await net.fetch(MODS[mod].url);
    if (!r.ok) return;
    const t = await r.text();
    if (!t.includes('==UserScript==') || t.length < 100000) return;
    garantirPasta(path.dirname(caminhoCacheMod(mod)));
    fs.writeFileSync(caminhoCacheMod(mod), t);
  } catch {}
}

ipcMain.on('meu-vencord-codigo', (e) => {
  e.returnValue = config.plugins && ehDoDiscord(e.senderFrame?.url || e.sender.getURL()) ? lerVencord() : '';
});

ipcMain.handle('meu-fetch', async (e, url, opcoes = {}) => {
  if (!ehDoDiscord(e.senderFrame?.url || e.sender.getURL())) throw new Error('origem nao permitida');
  if (!/^https?:\/\//i.test(String(url))) throw new Error('url invalida');
  const r = await net.fetch(String(url), {
    method: String(opcoes.method || 'GET'),
    headers: opcoes.headers || {},
    body: typeof opcoes.body === 'string' ? opcoes.body : undefined
  });
  const cab = [];
  r.headers.forEach((v, k) => cab.push(k + ': ' + v));
  return { status: r.status, headers: cab.join('\r\n'), body: await r.arrayBuffer() };
});

ipcMain.on('meu-abrir-painel', (e) => {
  if (ehDoDiscord(e.senderFrame?.url || e.sender.getURL())) abrirPainel();
});

// ============================================================
//  Sessão: telemetria, CSP, permissões, protocolo
// ============================================================
function configurarSessao() {
  const ses = session.defaultSession;

  protocol.handle('meufundo', (req) => {
    const u = new URL(req.url);
    const nome = path.basename(decodeURIComponent(u.pathname));
    let arquivo = null;
    if (u.hostname === 'arquivo' && NOMES_FUNDO.includes(nome)) arquivo = pasta(nome);
    else if (u.hostname === 'som') arquivo = pasta('sons', nome);
    else if (u.hostname === 'perfil') arquivo = pasta('perfil', nome);
    else if (u.hostname === 'badge') arquivo = path.join(__dirname, 'badges', nome);
    if (!arquivo || !fs.existsSync(arquivo)) return new Response('nao encontrado', { status: 404 });
    return net.fetch(pathToFileURL(arquivo).toString());
  });

  ses.setUserAgent(
    ses.getUserAgent().replace(/\s?Electron\/\S+/, '').replace(/\s?(meu-discord|meudiscord|zerocord)\/\S+/gi, '')
  );

  if (config.bloquearTelemetria) {
    ses.webRequest.onBeforeRequest(
      {
        urls: [
          'https://discord.com/api/v*/science', 'https://discord.com/api/v*/metrics*',
          'https://*.discord.com/api/v*/science', 'https://*.discord.com/api/v*/metrics*',
          'https://*.sentry.io/*', 'https://sentry.io/*'
        ]
      },
      (_d, cb) => cb({ cancel: true })
    );
  }

  // Plugins, temas e sons carregam coisas de fora: remove a CSP só nas páginas do Discord
  ses.webRequest.onHeadersReceived({ urls: ['https://discord.com/*', 'https://*.discord.com/*'] }, (det, cb) => {
    const cab = det.responseHeaders || {};
    for (const k of Object.keys(cab)) if (/^content-security-policy(-report-only)?$/i.test(k)) delete cab[k];
    cb({ responseHeaders: cab });
  });

  ses.setPermissionRequestHandler((wc, permissao, cb) => {
    const ok = ehDoDiscord(wc.getURL());
    cb(ok && ['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'display-capture'].includes(permissao));
  });

  ses.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const fontes = await desktopCapturer.getSources({ types: ['screen'] });
      const r = { video: fontes[0] };
      if (process.platform === 'win32') r.audio = 'loopback';
      cb(r);
    } catch { cb({}); }
  }, { useSystemPicker: true });
}

// ============================================================
//  Temas
// ============================================================
let chavesTemas = [];
let chaveAnimacoes = null;
let chavePersonalizado = null;

function metaTema(css, padraoNome) {
  const nome = (css.match(/@name\s+([^\n*]+)/) || [])[1];
  const desc = (css.match(/@description\s+([^\n*]+)/) || [])[1];
  return { nome: (nome || padraoNome).trim(), descricao: (desc || '').trim() };
}

function listarTemas() {
  const temas = [];
  // Embutidos
  try {
    for (const n of fs.readdirSync(path.join(__dirname, 'temas-embutidos')).filter((x) => x.endsWith('.css')).sort()) {
      const css = fs.readFileSync(path.join(__dirname, 'temas-embutidos', n), 'utf8');
      const id = 'embutido:' + n;
      temas.push({ id, origem: 'Embutido', ...metaTema(css, n), css, ativo: config.temasAtivos[id] === true });
    }
  } catch {}
  // Seus arquivos (ativos por padrão quando você coloca na pasta)
  try {
    garantirPasta(pasta('temas'));
    for (const n of fs.readdirSync(pasta('temas')).filter((x) => x.toLowerCase().endsWith('.css')).sort()) {
      const css = fs.readFileSync(pasta('temas', n), 'utf8');
      const id = 'arquivo:' + n;
      temas.push({ id, origem: 'Arquivo', ...metaTema(css, n.replace(/(\.theme)?\.css$/i, '')), css, ativo: config.temasAtivos[id] !== false });
    }
  } catch {}
  // Links
  for (const link of Array.isArray(config.temasOnline) ? config.temasOnline : []) {
    if (!/^https:\/\//i.test(link)) continue;
    const id = 'link:' + link;
    temas.push({ id, origem: 'Link', nome: link.split('/').pop() || link, descricao: link, css: `@import url("${link.replace(/"/g, '')}");`, ativo: config.temasAtivos[id] !== false });
  }
  return temas;
}

async function removerChaves(wc, chaves) {
  for (const k of chaves) { try { await wc.removeInsertedCSS(k); } catch {} }
}

async function aplicarTemas() {
  if (!janela || janela.isDestroyed()) return;
  const wc = janela.webContents;
  const velhas = chavesTemas;
  chavesTemas = [];
  for (const t of listarTemas().filter((x) => x.ativo)) {
    try { chavesTemas.push(await wc.insertCSS(t.css)); } catch {}
  }
  await removerChaves(wc, velhas);
}

async function aplicarCssBase() {
  if (!janela || janela.isDestroyed()) return;
  const wc = janela.webContents;
  if (chaveAnimacoes) { try { await wc.removeInsertedCSS(chaveAnimacoes); } catch {} chaveAnimacoes = null; }
  if (config.semAnimacoes) chaveAnimacoes = await wc.insertCSS(lerArquivo('estilo.css'));
  if (chavePersonalizado) { try { await wc.removeInsertedCSS(chavePersonalizado); } catch {} chavePersonalizado = null; }
  const css = lerArquivo('personalizado.css');
  if (css.trim()) chavePersonalizado = await wc.insertCSS(css);
}

let previaOcupada = false;
async function gerarPrevia(id) {
  if (!janela || janela.isDestroyed() || previaOcupada) return null;
  const tema = listarTemas().find((t) => t.id === id);
  if (!tema) return null;
  previaOcupada = true;
  const wc = janela.webContents;
  try {
    await removerChaves(wc, chavesTemas);
    chavesTemas = [];
    const k = await wc.insertCSS(tema.css);
    await new Promise((r) => setTimeout(r, tema.origem === 'Link' ? 1500 : 450));
    const img = await wc.capturePage();
    await wc.removeInsertedCSS(k);
    return img.resize({ width: 640 }).toDataURL();
  } finally {
    await aplicarTemas();
    previaOcupada = false;
  }
}

function vigiarTemas() {
  garantirPasta(pasta('temas'));
  let espera;
  try { fs.watch(pasta('temas'), () => { clearTimeout(espera); espera = setTimeout(() => { aplicarTemas(); avisarPainel(); }, 300); }); } catch {}
}

// ============================================================
//  Runtime dentro do Discord (fundo, sons, perfil, plugins)
// ============================================================
function rodarNaPagina(codigo) {
  if (!janela || janela.isDestroyed()) return Promise.resolve(null);
  return janela.webContents.executeJavaScript(codigo, true).catch((e) => { console.error(e); return null; });
}
const chamar = (fn, ...args) => rodarNaPagina(`window.__meuDiscord && window.__meuDiscord.${fn}(...${JSON.stringify(args)})`);

function dadosFundo() {
  const nome = acharFundo();
  let v = 0;
  try { v = Math.floor(fs.statSync(pasta(nome)).mtimeMs); } catch {}
  return {
    ativo: !!config.fundo && !!nome,
    src: nome ? `meufundo://arquivo/${nome}?v=${v}` : '',
    video: !!nome && /\.(mp4|webm)$/i.test(nome),
    opacidade: Number(config.fundoOpacidade) || 0.25,
    mistura: String(config.fundoMistura || 'screen'),
    arquivo: nome
  };
}

const urlLocal = (tipo, arquivo) => {
  if (!arquivo) return '';
  let v = 0;
  try { v = Math.floor(fs.statSync(pasta(tipo === 'som' ? 'sons' : 'perfil', arquivo)).mtimeMs); } catch { return ''; }
  return `meufundo://${tipo}/${encodeURIComponent(arquivo)}?v=${v}`;
};

function dadosSons() {
  const cfg = {};
  for (const [nome, c] of Object.entries(config.sons || {})) {
    cfg[nome] = { volume: c.volume ?? 1, mudo: !!c.mudo, url: urlLocal('som', c.arquivo) };
  }
  return { cfg, geral: config.sonsGeral || { volume: 1, mudo: false } };
}

function dadosPerfil() {
  const p = config.perfil || {};
  return {
    ativo: !!p.ativo,
    nomeExibicao: p.nomeExibicao || '',
    usuario: p.usuario || '',
    avatar: urlLocal('perfil', p.avatar),
    badges: (p.badges || []).map((b) => ({
      nome: b.nome,
      url: b.preset ? `meufundo://badge/${encodeURIComponent(b.preset)}` : urlLocal('perfil', b.arquivo)
    })).filter((b) => b.url)
  };
}

async function aplicarTudoNaPagina() {
  await rodarNaPagina(lerArquivo('runtime.js'));
  await chamar('fundo', dadosFundo());
  await chamar('aplicarSons', dadosSons());
  await chamar('botao', !!config.botaoPainel);
  await chamar('muteFalsoConfig', config.muteFalso || PADRAO.muteFalso);
  chamar('aplicarPerfil', dadosPerfil()); // espera o Discord carregar o usuário: não trava o resto
}

// ============================================================
//  Janela do Discord (a nossa ou a do app oficial)
// ============================================================
function definirJanela(win, { separado = false } = {}) {
  if (separado) janela = win;
  win.webContents.on('did-finish-load', async () => {
    const url = win.webContents.getURL();
    if (!ehDoDiscord(url)) return;
    // No Discord oficial, só a janela principal (não os popouts de chamada etc.)
    if (!separado) {
      if (/\/popout/i.test(new URL(url).pathname)) return;
      janela = win;
    }
    win.webContents.setZoomFactor(Number(config.zoom) || 1);
    chaveAnimacoes = null; chavePersonalizado = null; chavesTemas = [];
    await aplicarCssBase();
    await aplicarTemas();
    await aplicarTudoNaPagina();
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key.toLowerCase();
    if (input.control && input.shift && k === 'm') { abrirPainel(); e.preventDefault(); return; }
    if (!separado) return;
    if (input.control && !input.shift && k === 'r') { win.reload(); e.preventDefault(); }
    if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });

  if (separado) {
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!ehDoDiscord(url)) { e.preventDefault(); shell.openExternal(url); }
    });
  }

  win.on('closed', () => { if (janela === win) janela = null; if (separado && painel && !painel.isDestroyed()) painel.close(); });
}

// ============================================================
//  Painel
// ============================================================
function abrirPainel() {
  if (painel && !painel.isDestroyed()) { painel.show(); painel.focus(); return; }
  painel = new BrowserWindow({
    meuDiscord: true,
    width: 1060, height: 760, minWidth: 820, minHeight: 560,
    title: 'Painel do ZeroCord', backgroundColor: '#111216', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'painel-preload.js') }
  });
  painel.loadFile(path.join(__dirname, 'painel', 'painel.html'));
  painel.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  painel.on('closed', () => { painel = null; });
}

function avisarPainel() {
  if (painel && !painel.isDestroyed()) painel.webContents.send('painel:atualizar');
}

const doPainel = (e) => painel && !painel.isDestroyed() && e.sender === painel.webContents;
function handle(canal, fn) {
  ipcMain.handle(canal, async (e, ...args) => {
    if (!doPainel(e)) throw new Error('nao permitido');
    return fn(...args);
  });
}

async function escolherArquivo(titulo, extensoes) {
  const r = await dialog.showOpenDialog(painel, { title: titulo, properties: ['openFile'], filters: [{ name: 'Arquivos', extensions: extensoes }] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

const seguro = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 80);

function estadoPainel() {
  return {
    config: {
      aceleracaoHardware: config.aceleracaoHardware, bloquearTelemetria: config.bloquearTelemetria,
      semAnimacoes: config.semAnimacoes, corretorOrtografico: config.corretorOrtografico,
      zoom: config.zoom, economizarEmSegundoPlano: config.economizarEmSegundoPlano,
      plugins: config.plugins, botaoPainel: config.botaoPainel, mod: modAtual(), injetado: MODO_INJETADO
    },
    temas: listarTemas().map(({ css, ...t }) => t),
    fundo: dadosFundo(),
    sons: { cfg: config.sons || {}, geral: config.sonsGeral || { volume: 1, mudo: false } },
    perfil: config.perfil || PADRAO.perfil,
    muteFalso: Object.assign({}, PADRAO.muteFalso, config.muteFalso),
    perfilUrls: dadosPerfil(),
    badgesPresets: listarBadgesPresets(),
    pasta: pastaDoApp()
  };
}

function listarBadgesPresets() {
  const nomes = {
    'nitro.svg': 'Nitro', 'hypesquad_bravery.svg': 'HypeSquad Bravery', 'hypesquad_brilliance.svg': 'HypeSquad Brilliance',
    'hypesquad_balance.svg': 'HypeSquad Balance', 'hypesquad_events.svg': 'HypeSquad Events', 'early_supporter.svg': 'Apoiador Inicial',
    'active_developer.svg': 'Desenvolvedor Ativo', 'early_verified_developer.svg': 'Dev. de Bot Verificado Pioneiro',
    'bug_hunter_level_1.svg': 'Caçador de Bugs', 'bug_hunter_level_2.svg': 'Caçador de Bugs (ouro)',
    'partnered_server_owner.svg': 'Dono de Servidor Parceiro', 'boosting_1_months.svg': 'Impulso 1 mês',
    'boosting_2_months.svg': 'Impulso 2 meses', 'boosting_3_months.svg': 'Impulso 3 meses', 'boosting_6_months.svg': 'Impulso 6 meses',
    'boosting_9_months.svg': 'Impulso 9 meses', 'boosting_12_months.svg': 'Impulso 1 ano', 'boosting_15_months.svg': 'Impulso 15 meses',
    'boosting_18_months.svg': 'Impulso 18 meses', 'boosting_24_months.svg': 'Impulso 2 anos'
  };
  try {
    return fs.readdirSync(path.join(__dirname, 'badges')).filter((n) => n.endsWith('.svg')).sort()
      .map((n) => ({ id: n, nome: nomes[n] || n.replace('.svg', ''), url: `meufundo://badge/${n}` }));
  } catch { return []; }
}

function registrarPainel() {
  handle('painel:estado', async () => estadoPainel());

  // ---- Temas ----
  handle('painel:tema-ativar', async (id, ativo) => {
    config.temasAtivos[id] = !!ativo; salvarConfig(); await aplicarTemas(); return true;
  });
  handle('painel:tema-previa', async (id) => gerarPrevia(id));
  handle('painel:tema-importar', async () => {
    const f = await escolherArquivo('Escolha um tema (.css)', ['css']);
    if (!f) return false;
    garantirPasta(pasta('temas'));
    fs.copyFileSync(f, pasta('temas', seguro(path.basename(f))));
    await aplicarTemas(); return true;
  });
  handle('painel:tema-link', async (link) => {
    link = String(link || '').trim();
    if (!/^https:\/\/\S+$/i.test(link)) return false;
    config.temasOnline = Array.from(new Set([...(config.temasOnline || []), link]));
    salvarConfig(); await aplicarTemas(); return true;
  });
  handle('painel:tema-remover', async (id) => {
    if (id.startsWith('link:')) config.temasOnline = (config.temasOnline || []).filter((l) => 'link:' + l !== id);
    else if (id.startsWith('arquivo:')) { try { fs.unlinkSync(pasta('temas', path.basename(id.slice(8)))); } catch {} }
    delete config.temasAtivos[id];
    salvarConfig(); await aplicarTemas(); return true;
  });
  handle('painel:abrir-pasta', async (qual) => {
    const p = { temas: pasta('temas'), sons: pasta('sons'), app: pastaDoApp() }[qual] || pastaDoApp();
    garantirPasta(p); shell.openPath(p); return true;
  });

  // ---- Fundo ----
  handle('painel:fundo', async (parcial) => {
    if ('ativo' in parcial) config.fundo = !!parcial.ativo;
    if ('opacidade' in parcial) config.fundoOpacidade = Math.max(0.02, Math.min(1, Number(parcial.opacidade) || 0.25));
    if ('mistura' in parcial) config.fundoMistura = String(parcial.mistura);
    salvarConfig(); await chamar('fundo', dadosFundo()); return dadosFundo();
  });
  handle('painel:fundo-trocar', async () => {
    const f = await escolherArquivo('Escolha um vídeo, GIF ou imagem', ['mp4', 'webm', 'gif', 'png', 'jpg', 'jpeg', 'webp']);
    if (!f) return dadosFundo();
    for (const n of NOMES_FUNDO) { try { fs.unlinkSync(pasta(n)); } catch {} }
    const ext = path.extname(f).toLowerCase().replace('.jpeg', '.jpg');
    fs.copyFileSync(f, pasta('fundo' + ext));
    config.fundo = true; salvarConfig();
    await chamar('fundo', dadosFundo()); return dadosFundo();
  });

  // ---- Sons ----
  handle('painel:sons-listar', async () => (await chamar('listarSons')) || {});
  handle('painel:som-escolher', async (nome) => {
    const f = await escolherArquivo('Escolha um som', ['mp3', 'ogg', 'wav', 'm4a', 'webm', 'flac']);
    if (!f) return false;
    garantirPasta(pasta('sons'));
    const antigo = config.sons[nome]?.arquivo;
    if (antigo) { try { fs.unlinkSync(pasta('sons', antigo)); } catch {} }
    const arq = seguro(nome) + path.extname(f).toLowerCase();
    fs.copyFileSync(f, pasta('sons', arq));
    config.sons[nome] = Object.assign({ volume: 1, mudo: false }, config.sons[nome], { arquivo: arq });
    salvarConfig(); await chamar('aplicarSons', dadosSons()); return true;
  });
  handle('painel:som-config', async (nome, parcial) => {
    config.sons[nome] = Object.assign({ volume: 1, mudo: false }, config.sons[nome], {
      ...('volume' in parcial ? { volume: Math.max(0, Math.min(1, Number(parcial.volume))) } : {}),
      ...('mudo' in parcial ? { mudo: !!parcial.mudo } : {})
    });
    salvarConfig(); await chamar('aplicarSons', dadosSons()); return true;
  });
  handle('painel:som-restaurar', async (nome) => {
    const arq = config.sons[nome]?.arquivo;
    if (arq) { try { fs.unlinkSync(pasta('sons', arq)); } catch {} }
    delete config.sons[nome];
    salvarConfig(); await chamar('aplicarSons', dadosSons()); return true;
  });
  handle('painel:sons-geral', async (parcial) => {
    config.sonsGeral = Object.assign({ volume: 1, mudo: false }, config.sonsGeral, parcial);
    config.sonsGeral.volume = Math.max(0, Math.min(1, Number(config.sonsGeral.volume)));
    salvarConfig(); await chamar('aplicarSons', dadosSons()); return true;
  });
  handle('painel:som-url', async (nome) => urlLocal('som', config.sons[nome]?.arquivo));

  // ---- Perfil local ----
  handle('painel:perfil', async (parcial) => {
    const p = config.perfil = Object.assign({}, PADRAO.perfil, config.perfil);
    for (const k of ['ativo', 'nomeExibicao', 'usuario']) if (k in parcial) p[k] = k === 'ativo' ? !!parcial[k] : String(parcial[k]).slice(0, 64);
    if ('badges' in parcial && Array.isArray(parcial.badges)) p.badges = parcial.badges;
    salvarConfig(); await chamar('aplicarPerfil', dadosPerfil()); return estadoPainel();
  });
  handle('painel:perfil-avatar', async (remover) => {
    const p = config.perfil = Object.assign({}, PADRAO.perfil, config.perfil);
    if (p.avatar) { try { fs.unlinkSync(pasta('perfil', p.avatar)); } catch {} p.avatar = ''; }
    if (!remover) {
      const f = await escolherArquivo('Escolha uma imagem ou GIF', ['png', 'jpg', 'jpeg', 'gif', 'webp']);
      if (f) { garantirPasta(pasta('perfil')); p.avatar = 'avatar-' + Date.now() + path.extname(f).toLowerCase(); fs.copyFileSync(f, pasta('perfil', p.avatar)); }
    }
    salvarConfig(); await chamar('aplicarPerfil', dadosPerfil()); return estadoPainel();
  });
  handle('painel:badge-custom', async (nome) => {
    const f = await escolherArquivo('Escolha a imagem da badge', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
    if (!f) return estadoPainel();
    garantirPasta(pasta('perfil'));
    const arq = 'badge-' + Date.now() + path.extname(f).toLowerCase();
    fs.copyFileSync(f, pasta('perfil', arq));
    const p = config.perfil = Object.assign({}, PADRAO.perfil, config.perfil);
    p.badges = [...(p.badges || []), { nome: String(nome || 'Minha badge').slice(0, 60), arquivo: arq }];
    salvarConfig(); await chamar('aplicarPerfil', dadosPerfil()); return estadoPainel();
  });

  // ---- Plugins / Nitro ----
  handle('painel:plugins-status', async (nomes) => (await chamar('statusPlugins', nomes)) || null);
  handle('painel:plugins-listar', async () => (await chamar('listarPlugins')) || null);
  handle('painel:plugins-ativar', async (nomes, ativo) => (await chamar('ativarPlugins', nomes, ativo)) || null);
  handle('painel:mute-falso-config', async (parcial) => {
    config.muteFalso = Object.assign({}, PADRAO.muteFalso, config.muteFalso);
    for (const k of ['habilitado', 'atalho']) if (k in parcial) config.muteFalso[k] = !!parcial[k];
    salvarConfig();
    return (await chamar('muteFalsoConfig', config.muteFalso)) || { ativo: false, habilitado: config.muteFalso.habilitado, emCall: false };
  });
  handle('painel:mute-falso-alternar', async () => (await chamar('muteFalsoAlternar')) || null);
  handle('painel:mute-falso-estado', async () => (await chamar('muteFalsoEstado')) || null);
  handle('painel:recarregar', async () => { if (janela) janela.reload(); return true; });

  // ---- CSS ----
  handle('painel:css-ler', async () => lerArquivo('personalizado.css'));
  handle('painel:css-salvar', async (texto) => {
    fs.writeFileSync(pasta('personalizado.css'), String(texto)); await aplicarCssBase(); return true;
  });

  // ---- Ajustes ----
  handle('painel:config', async (parcial) => {
    const permitidos = ['aceleracaoHardware', 'bloquearTelemetria', 'semAnimacoes', 'corretorOrtografico', 'zoom', 'economizarEmSegundoPlano', 'plugins', 'botaoPainel'];
    for (const k of permitidos) if (k in parcial) config[k] = k === 'zoom' ? Math.max(0.5, Math.min(2, Number(parcial[k]) || 1)) : !!parcial[k];
    if ('mod' in parcial && MODS[parcial.mod]) config.mod = parcial.mod;
    salvarConfig();
    if (janela) {
      if ('zoom' in parcial) janela.webContents.setZoomFactor(config.zoom);
      if ('semAnimacoes' in parcial) await aplicarCssBase();
      if ('botaoPainel' in parcial) await chamar('botao', config.botaoPainel);
    }
    return true;
  });
  handle('painel:reiniciar', async () => { app.relaunch(); app.exit(0); });
}

// ============================================================
//  Preload original do Discord (modo injetado)
// ============================================================
const preloadsOriginais = new Map();
ipcMain.on('meu-preload-original', (e) => { e.returnValue = preloadsOriginais.get(e.sender.id) || ''; });

let iniciado = false;
function iniciarAposPronto() {
  if (iniciado) return;
  iniciado = true;
  configurarSessao();
  registrarPainel();
  vigiarTemas();
  if (config.plugins) atualizarVencord();
}

module.exports = { config, definirJanela, iniciarAposPronto, preloadsOriginais, abrirPainel, URL_DISCORD };
