/* global api */
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...filhos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else if (v !== undefined && v !== null) e[k] = v;
  }
  for (const f of filhos.flat()) if (f != null) e.append(f.nodeType ? f : document.createTextNode(String(f)));
  return e;
};
const chave = (marcado, aoMudar) => {
  const inp = el('input', { type: 'checkbox', checked: !!marcado, onchange: () => aoMudar(inp.checked) });
  return el('label', { class: 'chave' }, inp, el('span'));
};

let estado = null;
const previas = {};
let avisoTimer;
function avisar(msg) {
  const a = $('#aviso');
  a.textContent = msg;
  a.classList.remove('escondido');
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => a.classList.add('escondido'), 2600);
}

// ---------------- Abas ----------------
document.querySelectorAll('nav button[data-aba]').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('nav button[data-aba]').forEach((x) => x.classList.toggle('ativo', x === b));
    document.querySelectorAll('.aba').forEach((x) => x.classList.toggle('ativo', x.id === 'aba-' + b.dataset.aba));
    if (b.dataset.aba === 'sons') carregarSons();
    if (b.dataset.aba === 'nitro') carregarPacotes();
    if (b.dataset.aba === 'css') carregarCss();
    if (b.dataset.aba === 'mute') carregarMute();
  };
});
document.querySelectorAll('[data-pasta]').forEach((b) => (b.onclick = () => api.abrirPasta(b.dataset.pasta)));

async function recarregarEstado() {
  estado = await api.estado();
  desenharFundo();
  desenharTemas();
  desenharPerfil();
  desenharAjustes();
}
api.aoAtualizar(recarregarEstado);

// ======================================================
//  TEMAS + FUNDO
// ======================================================
function desenharFundo() {
  const f = estado.fundo;
  $('#fundo-ativo').checked = f.ativo;
  $('#fundo-arquivo').textContent = f.arquivo ? `Arquivo: ${f.arquivo}` : 'Nenhum arquivo de fundo. Clique em "Trocar" pra escolher um.';
  $('#fundo-opacidade').value = f.opacidade;
  $('#fundo-op-valor').textContent = Math.round(f.opacidade * 100) + '%';
  $('#fundo-mistura').value = f.mistura;
}
$('#fundo-ativo').onchange = async (e) => { estado.fundo = await api.fundo({ ativo: e.target.checked }); desenharFundo(); };
$('#fundo-opacidade').oninput = (e) => { $('#fundo-op-valor').textContent = Math.round(e.target.value * 100) + '%'; api.fundo({ opacidade: e.target.value }); };
$('#fundo-mistura').onchange = (e) => api.fundo({ mistura: e.target.value });
$('#fundo-trocar').onclick = async () => { estado.fundo = await api.fundoTrocar(); desenharFundo(); avisar('Fundo atualizado'); };

function desenharTemas() {
  const lista = $('#lista-temas');
  lista.replaceChildren();
  if (!estado.temas.length) lista.append(el('p', { class: 'dica' }, 'Nenhum tema ainda.'));
  for (const t of estado.temas) {
    const mini = el('div', { class: 'miniatura', title: 'Clique pra ver a prévia' }, previas[t.id] ? '' : 'Clique pra gerar a prévia');
    if (previas[t.id]) mini.style.backgroundImage = `url("${previas[t.id]}")`;
    mini.onclick = () => (previas[t.id] ? abrirModal(t.nome, previas[t.id]) : gerarPrevia(t, mini));

    const botoes = el('div', { class: 'acoes' },
      el('button', { class: 'fantasma pequeno', onclick: () => gerarPrevia(t, mini, true) }, previas[t.id] ? 'Atualizar prévia' : 'Ver prévia'),
      t.origem !== 'Embutido' ? el('button', { class: 'perigo pequeno', onclick: async () => {
        if (!confirm(`Remover o tema "${t.nome}"?`)) return;
        await api.temaRemover(t.id); delete previas[t.id]; $('#fechar').onclick = () => window.close();
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modal').classList.contains('escondido')) $('#modal').classList.add('escondido');
  else window.close();
});

recarregarEstado();
      } }, 'Remover') : null
    );

    lista.append(el('div', { class: 'tema' + (t.ativo ? ' on' : '') },
      mini,
      el('div', { class: 'corpo' },
        el('div', { class: 'linha' },
          el('div', {}, el('div', { class: 'etiqueta' }, t.origem), el('h2', {}, t.nome)),
          chave(t.ativo, async (v) => { await api.temaAtivar(t.id, v); t.ativo = v; desenharTemas(); avisar(v ? 'Tema ligado' : 'Tema desligado'); })
        ),
        el('div', { class: 'desc' }, t.descricao || ''),
        botoes
      )
    ));
  }
}

async function gerarPrevia(t, mini, abrir) {
  mini.textContent = 'Gerando prévia…';
  mini.style.backgroundImage = '';
  const img = await api.temaPrevia(t.id);
  if (!img) { mini.textContent = 'Não deu pra gerar (o Discord está aberto?)'; return; }
  previas[t.id] = img;
  mini.textContent = '';
  mini.style.backgroundImage = `url("${img}")`;
  if (abrir !== false) abrirModal(t.nome, img);
}

function abrirModal(titulo, img) {
  $('#modal-titulo').textContent = 'Prévia: ' + titulo;
  $('#modal-img').src = img;
  $('#modal').classList.remove('escondido');
}
$('#modal-fechar').onclick = () => $('#modal').classList.add('escondido');
$('#modal').onclick = (e) => { if (e.target.id === 'modal') $('#modal').classList.add('escondido'); };

$('#tema-importar').onclick = async () => { if (await api.temaImportar()) { avisar('Tema importado e ligado'); recarregarEstado(); } };
$('#tema-link-add').onclick = async () => {
  const v = $('#tema-link').value.trim();
  if (!(await api.temaLink(v))) return avisar('Link inválido: precisa começar com https://');
  $('#tema-link').value = '';
  avisar('Tema por link adicionado');
  $('#fechar').onclick = () => window.close();
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modal').classList.contains('escondido')) $('#modal').classList.add('escondido');
  else window.close();
});

recarregarEstado();
};

// ======================================================
//  SONS
// ======================================================
const NOMES_SONS = {
  message1: 'Mensagem nova', message2: 'Mensagem nova (alternativo)', message3: 'Mensagem nova (alternativo 2)',
  mention1: 'Menção', mention2: 'Menção (2)', mention3: 'Menção (3)',
  deafen: 'Ensurdecer', undeafen: 'Desensurdecer', mute: 'Mutar microfone', unmute: 'Desmutar microfone',
  disconnect: 'Sair da chamada', reconnect: 'Reconectar', ptt_start: 'Pressionar pra falar (início)', ptt_stop: 'Pressionar pra falar (fim)',
  user_join: 'Alguém entrou na call', user_leave: 'Alguém saiu da call', user_moved: 'Alguém foi movido',
  call_calling: 'Chamando alguém', call_ringing: 'Recebendo chamada', call_ringing_beat: 'Recebendo chamada (alt.)',
  stream_started: 'Transmissão começou', stream_ended: 'Transmissão terminou',
  stream_user_joined: 'Entrou na transmissão', stream_user_left: 'Saiu da transmissão',
  activity_launch: 'Atividade iniciada', activity_end: 'Atividade terminou',
  activity_user_join: 'Entrou na atividade', activity_user_left: 'Saiu da atividade',
  stage_waiting: 'Palco: aguardando', clip_save: 'Clipe salvo', clip_error: 'Erro no clipe',
  highfive_clap: 'Toca aqui (palma)', highfive_whistle: 'Toca aqui (assobio)', vibing_wumpus: 'Wumpus dançando',
  overlayunlock: 'Overlay desbloqueado', discodo: 'Discodo', human_man: 'Humano', robot_man: 'Robô'
};
const ORDEM_SONS = Object.keys(NOMES_SONS);
let sonsLista = {};
const tocador = new Audio();

async function carregarSons() {
  const g = estado.sons.geral;
  $('#sons-ativos').checked = !g.mudo;
  $('#sons-volume').value = g.volume;
  $('#sons-vol-valor').textContent = Math.round(g.volume * 100) + '%';
  const r = (await api.sonsListar()) || {};
  sonsLista = Object.assign({}, r.mapeados || {}, r.detectados || {});
  const mapeados = Object.keys(r.mapeados || {}).length;
  $('#sons-aviso').textContent = mapeados
    ? ''
    : 'Ainda não deu pra ler a lista completa de sons do Discord. Os sons vão aparecendo aqui conforme tocam (mande uma mensagem, entre numa call…) e depois clique em "Atualizar lista".';
  desenharSons();
}

function desenharSons() {
  const busca = $('#sons-busca').value.trim().toLowerCase();
  const cfg = estado.sons.cfg || {};
  const nomes = Array.from(new Set([...Object.keys(sonsLista), ...Object.keys(cfg)]));
  nomes.sort((a, b) => {
    const ia = ORDEM_SONS.indexOf(a), ib = ORDEM_SONS.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
  const lista = $('#lista-sons');
  lista.replaceChildren();
  for (const nome of nomes) {
    const rotulo = NOMES_SONS[nome] || nome;
    if (busca && !(rotulo + ' ' + nome).toLowerCase().includes(busca)) continue;
    const c = cfg[nome] || { volume: 1, mudo: false };
    const vol = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: c.volume ?? 1 });
    const volTxt = el('b', {}, Math.round((c.volume ?? 1) * 100) + '%');
    vol.oninput = () => { volTxt.textContent = Math.round(vol.value * 100) + '%'; };
    vol.onchange = async () => { await api.somConfig(nome, { volume: Number(vol.value) }); (estado.sons.cfg[nome] ||= {}).volume = Number(vol.value); };

    lista.append(el('div', { class: 'som' + (c.arquivo || c.mudo || (c.volume ?? 1) !== 1 ? ' mudado' : '') },
      el('div', { class: 'nome' }, el('b', {}, rotulo), el('small', {}, c.arquivo ? `Trocado: ${c.arquivo}` : nome)),
      el('label', {}, el('span', {}, 'Volume ', volTxt), vol),
      el('label', { style: 'flex-direction:row;align-items:center;gap:8px' },
        chave(!c.mudo, async (v) => { await api.somConfig(nome, { mudo: !v }); (estado.sons.cfg[nome] ||= {}).mudo = !v; desenharSons(); }),
        el('span', {}, c.mudo ? 'Silenciado' : 'Ligado')),
      el('div', { class: 'botoes' },
        sonsLista[nome] ? el('button', { class: 'fantasma pequeno', onclick: () => tocar(sonsLista[nome]) }, '▶ Original') : null,
        c.arquivo ? el('button', { class: 'fantasma pequeno', onclick: async () => tocar(await api.somUrl(nome), c.volume) }, '▶ Novo') : null,
        el('button', { class: 'pequeno', onclick: async () => { if (await api.somEscolher(nome)) { await recarregarEstado(); desenharSons(); avisar('Som trocado'); } } }, 'Trocar…'),
        (c.arquivo || c.mudo || (c.volume ?? 1) !== 1) ? el('button', { class: 'perigo pequeno', onclick: async () => { await api.somRestaurar(nome); await recarregarEstado(); desenharSons(); } }, 'Restaurar') : null
      )
    ));
  }
  if (!lista.children.length) lista.append(el('p', { class: 'dica' }, 'Nenhum som encontrado.'));
}

function tocar(url, volume = 1) {
  if (!url) return;
  tocador.pause();
  tocador.src = url;
  tocador.volume = Math.max(0, Math.min(1, volume * (estado.sons.geral.volume ?? 1)));
  tocador.play().catch(() => avisar('Não consegui tocar esse som'));
}

$('#sons-busca').oninput = desenharSons;
$('#sons-atualizar').onclick = carregarSons;
$('#sons-ativos').onchange = async (e) => { await api.sonsGeral({ mudo: !e.target.checked }); estado.sons.geral.mudo = !e.target.checked; };
$('#sons-volume').oninput = (e) => { $('#sons-vol-valor').textContent = Math.round(e.target.value * 100) + '%'; };
$('#sons-volume').onchange = async (e) => { await api.sonsGeral({ volume: Number(e.target.value) }); estado.sons.geral.volume = Number(e.target.value); };

// ======================================================
//  PERFIL
// ======================================================
function desenharPerfil() {
  const p = estado.perfil;
  $('#perfil-ativo').checked = !!p.ativo;
  if (document.activeElement !== $('#perfil-nome')) $('#perfil-nome').value = p.nomeExibicao || '';
  if (document.activeElement !== $('#perfil-usuario')) $('#perfil-usuario').value = p.usuario || '';
  const img = $('#perfil-avatar-img');
  if (estado.perfilUrls.avatar) img.src = estado.perfilUrls.avatar;
  else img.removeAttribute('src');

  const minhas = p.badges || [];
  const pres = $('#badges-presets');
  pres.replaceChildren();
  for (const b of estado.badgesPresets) {
    const on = minhas.some((x) => x.preset === b.id);
    pres.append(el('div', {
      class: 'badge' + (on ? ' on' : ''),
      onclick: () => salvarBadges(on ? minhas.filter((x) => x.preset !== b.id) : [...minhas, { nome: b.nome, preset: b.id }])
    }, el('img', { src: b.url, alt: '' }), b.nome));
  }

  const meu = $('#badges-minhas');
  meu.replaceChildren();
  const urls = {};
  (estado.perfilUrls.badges || []).forEach((b) => (urls[b.nome] = b.url));
  minhas.forEach((b, i) => {
    const src = b.preset ? `meufundo://badge/${encodeURIComponent(b.preset)}` : urls[b.nome];
    meu.append(el('div', { class: 'badge on', title: 'Clique pra remover', onclick: () => salvarBadges(minhas.filter((_, j) => j !== i)) },
      src ? el('img', { src, alt: '' }) : null, b.nome, el('span', { class: 'x' }, '✕')));
  });
  if (!minhas.length) meu.append(el('span', { class: 'sub' }, 'Nenhuma badge escolhida.'));
}

async function salvarBadges(badges) {
  estado = await api.perfil({ badges });
  desenharPerfil();
  avisar('Badges atualizadas: abra o seu perfil pra ver');
}

let perfilTimer;
const salvarPerfilTexto = () => {
  clearTimeout(perfilTimer);
  perfilTimer = setTimeout(async () => {
    estado = await api.perfil({ nomeExibicao: $('#perfil-nome').value, usuario: $('#perfil-usuario').value });
    avisar('Perfil atualizado');
  }, 500);
};
$('#perfil-nome').oninput = salvarPerfilTexto;
$('#perfil-usuario').oninput = salvarPerfilTexto;
$('#perfil-ativo').onchange = async (e) => { estado = await api.perfil({ ativo: e.target.checked }); desenharPerfil(); };
$('#perfil-avatar-trocar').onclick = async () => { estado = await api.perfilAvatar(false); desenharPerfil(); };
$('#perfil-avatar-remover').onclick = async () => { estado = await api.perfilAvatar(true); desenharPerfil(); };
$('#badge-add').onclick = async () => {
  estado = await api.badgeCustom($('#badge-nome').value.trim() || 'Minha badge');
  $('#badge-nome').value = '';
  desenharPerfil();
};

// ======================================================
//  NITRO E PLUGINS
// ======================================================
const PACOTES = [
  {
    nome: '💎 Nitro grátis', desc: 'Emojis e figurinhas de qualquer servidor, temas do Nitro, stream em qualidade alta e sem propagandas do Nitro. Quem não usa mod vê emojis/figurinhas como link ou imagem.',
    plugins: {
      FakeNitro: 'Emojis, figurinhas, temas e qualidade de stream do Nitro',
      NoNitroUpsell: 'Some com as propagandas do Nitro',
      LimitlessScreenshare: 'Escolher resolução e FPS da transmissão'
    }
  },
  {
    nome: '✨ Perfil e efeitos', desc: 'Cores de perfil, decorações, banners, foto animada e badges de outros mods. Os outros só veem se usarem o mesmo mod/plugin.',
    plugins: {
      FakeProfileThemes: 'Cores de perfil do Nitro (quem usa Vencord/Equicord vê)',
      Decor: 'Decorações de avatar (quem usa Decor vê)',
      USRBG: 'Banner de perfil grátis (quem usa USRBG vê)',
      UserPFP: 'Foto de perfil animada local (quem usa UserPFP vê)',
      GlobalBadges: 'Mostra badges de outros mods (Equicord, Aliucord etc.)',
      AlwaysExpandProfiles: 'Perfis sempre abertos em tela cheia',
      BannersEverywhere: 'Banners na lista de membros',
      FriendshipRanks: 'Badge de há quanto tempo vocês são amigos',
      Streaks: 'Sequência de dias conversando, estilo Snapchat',
      ProfileSets: 'Salvar e trocar entre perfis prontos'
    }
  },
  {
    nome: '🧹 Visual limpo', desc: 'Tira o que é inútil e deixa a interface do seu jeito.',
    plugins: {
      Declutter: 'Remove loja, efeitos, impulsos e outras tralhas',
      Questify: 'Tira ou melhora as Missões',
      CollapsibleUI: 'Esconder canais, membros e barras',
      HideChatButtons: 'Esconder botões da caixa de mensagem',
      HideServers: 'Esconder servidores da lista',
      FontLoader: 'Qualquer fonte do Google Fonts',
      CustomTimestamps: 'Formato de horário personalizado',
      CustomUserColors: 'Cor personalizada pra qualquer pessoa'
    }
  },
  {
    nome: '🧰 Essenciais', desc: 'Os que quase todo mundo usa.',
    plugins: {
      MessageLogger: 'Mostra mensagens apagadas e editadas', ShowHiddenChannels: 'Mostra que canais escondidos existem',
      ViewIcons: 'Abre avatar e ícones em tamanho grande', PlatformIndicators: 'PC, celular ou web',
      ImageZoom: 'Lupa nas imagens', WhoReacted: 'Quem reagiu, sem abrir', PermissionsViewer: 'Ver permissões de cargos',
      ReverseImageSearch: 'Pesquisa reversa de imagens', Translate: 'Traduzir mensagens', MessageTranslate: 'Tradução automática',
      CallTimer: 'Tempo de chamada', BetterFolders: 'Pastas de servidores melhores', BetterGifPicker: 'Seletor de GIF melhor',
      MemberCount: 'Contador de membros', ShowMeYourName: 'Mostra o @ junto com o apelido', ServerInfo: 'Informações do servidor',
      CopyUserURLs: 'Copiar link do usuário', BetterSettings: 'Configurações mais rápidas', ClickableRoles: 'Clicar no cargo e ver quem tem',
      BetterInvites: 'Ver servidor antes de entrar pelo convite'
    }
  },
  {
    nome: '💬 Chat turbinado', desc: 'Mais coisas na conversa.',
    plugins: {
      ChannelTabs: 'Abas de canais, igual navegador', CommandPalette: 'Paleta de comandos (estilo Raycast)',
      MessageLinkTooltip: 'Prévia ao passar o mouse em links de mensagem', MessagePeek: 'Última mensagem na lista de DMs',
      ShowRolesInChat: 'Cargo ao lado do nome no chat', MarkdownTables: 'Tabelas nas mensagens', PinIcon: 'Ícone em mensagens fixadas',
      ReactionTimestamps: 'Quando cada reação foi feita', DownloadAllAttachments: 'Baixar todos os anexos de uma vez',
      FavoriteAnything: 'Favoritar imagens, vídeos e arquivos', GifCollections: 'Coleções de GIFs', ExportMessages: 'Exportar mensagens',
      BetterActivities: 'Ícones de atividade na lista de membros', ToastNotifications: 'Notificações pop-up', StatusPresets: 'Status salvos'
    }
  },
  {
    nome: '🎧 Voz e música', desc: 'Pra quem vive em call.',
    plugins: {
      SpotifyControls: 'Controles do Spotify', MusicControls: 'Controles e letra de música (vários serviços)',
      VolumeBooster: 'Volume acima de 200%', UserVoiceShow: 'Em qual call a pessoa está', GameActivityToggle: 'Esconder o jogo que você joga',
      VCPanelSettings: 'Ajustes de voz no painel da call', VoiceButtons: 'Mutar/DM rápido na call', VoiceChannelLog: 'Histórico de quem entrou e saiu',
      FollowVoiceUser: 'Seguir um amigo de call em call', WhosWatching: 'Quem está vendo sua live', VoiceJoinMessages: 'Aviso quando amigo entra em call',
      MicLoopbackTester: 'Testar o próprio microfone', VoiceStats: 'Tempo em call com cada pessoa'
    }
  },
  {
    nome: '🛡️ Privacidade e controle', desc: 'Menos rastreamento e mais controle sobre o que você vê.',
    plugins: {
      NoTrack: 'Bloqueia rastreamento', ClearURLs: 'Limpa rastreadores dos links', SilentTyping: 'Esconde o "digitando…"',
      NoTypingAnimation: 'Sem animação de digitando', ClientSideBlock: 'Esconder tudo de alguém só pra você',
      BlockKeywords: 'Bloquear mensagens com palavras', IRememberYou: 'Guarda quem você conheceu, caso perca a conta'
    }
  },
  {
    nome: '🔊 Sons', desc: 'Além da aba Sons deste painel.',
    plugins: { CustomSounds: 'Trocar sons pelo próprio Equicord', KeyboardSounds: 'Som de teclado (OperaGX / osu!)', Animalese: 'Mensagens com voz de Animal Crossing' }
  },
  {
    nome: '🎉 Diversão', desc: 'Só pra zoar.',
    plugins: {
      petpet: 'GIF de carinho com /petpet', PetPet: 'GIF de carinho com /petpet', CursorBuddy: 'Bichinho seguindo o mouse',
      Snowfall: 'Neve no Discord', PartyMode: 'Modo festa', WigglyText: 'Texto que treme', Quoter: 'Transforma mensagem em citação com imagem',
      GifMaker: 'Criar GIF com legenda', MoreCommands: 'Vários comandos divertidos', Ghosted: 'Fantasminha quando te deixam no vácuo'
    }
  }
];

let subAba = 'pacotes';
document.querySelectorAll('.subabas button').forEach((b) => {
  b.onclick = () => {
    subAba = b.dataset.sub;
    document.querySelectorAll('.subabas button').forEach((x) => x.classList.toggle('ativo', x === b));
    $('#pacotes').classList.toggle('escondido', subAba !== 'pacotes');
    $('#todos').classList.toggle('escondido', subAba !== 'todos');
    carregarPacotes();
  };
});

let todosPlugins = [];
async function carregarPacotes() {
  const lista = await api.pluginsListar();
  if (!lista) {
    $('#nitro-aviso').textContent = 'Os plugins ainda não carregaram (ou estão desligados em Ajustes). Espere o Discord abrir e clique na aba de novo.';
    $('#pacotes').replaceChildren(); $('#plugins-lista').replaceChildren();
    return;
  }
  todosPlugins = lista;
  const nomeMod = estado.config.mod === 'vencord' ? 'Vencord' : 'Equicord';
  $('#plugins-total').textContent = `(${lista.length})`;
  $('#nitro-aviso').textContent = `Usando ${nomeMod}. Mods vão contra os termos do Discord: ban é raro, mas evite plugins que mandam mensagens sozinhos.`;
  if (subAba === 'pacotes') desenharPacotes(); else desenharTodos();
}

function desenharPacotes() {
  const st = Object.fromEntries(todosPlugins.map((p) => [p.nome, p.ativo]));
  const caixa = $('#pacotes');
  caixa.replaceChildren();
  for (const p of PACOTES) {
    const nomes = Object.keys(p.plugins).filter((n) => n in st);
    if (!nomes.length) continue;
    const todosOn = nomes.every((n) => st[n]);
    caixa.append(el('div', { class: 'cartao pacote' },
      el('div', { class: 'linha' },
        el('div', {}, el('h2', {}, p.nome), el('p', { class: 'sub' }, p.desc)),
        el('button', { class: todosOn ? 'fantasma' : '', onclick: async () => { await api.pluginsAtivar(nomes, !todosOn); await carregarPacotes(); avisar('Clique em "Aplicar" pra valer'); } },
          todosOn ? 'Desligar pacote' : 'Ligar pacote')
      ),
      el('div', { class: 'plugins' }, nomes.map((n) =>
        el('div', { class: 'plugin' },
          el('div', {}, el('b', {}, n), el('small', {}, p.plugins[n])),
          chave(st[n], async (v) => { await api.pluginsAtivar([n], v); const x = todosPlugins.find((q) => q.nome === n); if (x) x.ativo = v; avisar('Clique em "Aplicar" pra valer'); })
        )))
    ));
  }
}

function desenharTodos() {
  const busca = $('#plugins-busca').value.trim().toLowerCase();
  const filtro = $('#plugins-filtro').value;
  const caixa = $('#plugins-lista');
  caixa.replaceChildren();
  let n = 0;
  for (const p of todosPlugins) {
    if (busca && !(p.nome + ' ' + p.descricao + ' ' + p.tags.join(' ')).toLowerCase().includes(busca)) continue;
    if (filtro === 'on' && !p.ativo) continue;
    if (filtro === 'off' && p.ativo) continue;
    if (++n > 400) break;
    caixa.append(el('div', { class: 'plugin' },
      el('div', {}, el('b', {}, p.nome, p.obrigatorio ? el('span', { class: 'tag-api' }, 'sistema') : null), el('small', { title: p.descricao }, p.descricao)),
      p.obrigatorio ? null : chave(p.ativo, async (v) => { await api.pluginsAtivar([p.nome], v); p.ativo = v; avisar('Clique em "Aplicar" pra valer'); })
    ));
  }
  if (!n) caixa.append(el('p', { class: 'dica' }, 'Nenhum plugin encontrado.'));
}
$('#plugins-busca').oninput = () => desenharTodos();
$('#plugins-filtro').onchange = () => desenharTodos();
$('#plugins-recarregar').onclick = async () => { await api.recarregar(); avisar('Recarregando o Discord…'); };

// ======================================================
//  MUTE FALSO
// ======================================================
function desenharMute(st) {
  const cfg = estado.muteFalso || { habilitado: true, atalho: true };
  $('#mute-habilitado').checked = !!cfg.habilitado;
  $('#mute-atalho').checked = !!cfg.atalho;
  const on = !!(st && st.ativo);
  $('#mute-bolinha').classList.toggle('on', on);
  $('#mute-titulo').textContent = on ? 'Ligado' : 'Desligado';
  $('#mute-sub').textContent = !st
    ? 'Abra o Discord pra usar.'
    : on
      ? (st.emCall ? 'Na call, os outros te veem mutado, mas ouvem você.' : 'Vai valer assim que você entrar numa call.')
      : 'Você aparece do jeito que está de verdade.';
  const b = $('#mute-alternar');
  b.textContent = on ? 'Desligar mute falso' : 'Ligar mute falso';
  b.classList.toggle('on', on);
  b.disabled = !cfg.habilitado || !st;
}
async function carregarMute() { desenharMute(await api.muteFalsoEstado()); }
$('#mute-alternar').onclick = async () => desenharMute(await api.muteFalsoAlternar());
$('#mute-habilitado').onchange = async (e) => {
  estado.muteFalso = Object.assign({}, estado.muteFalso, { habilitado: e.target.checked });
  desenharMute(await api.muteFalsoConfig({ habilitado: e.target.checked }));
};
$('#mute-atalho').onchange = async (e) => {
  estado.muteFalso = Object.assign({}, estado.muteFalso, { atalho: e.target.checked });
  desenharMute(await api.muteFalsoConfig({ atalho: e.target.checked }));
};

// ======================================================
//  CSS
// ======================================================
async function carregarCss() { $('#css-texto').value = await api.cssLer(); }
async function salvarCss() {
  await api.cssSalvar($('#css-texto').value);
  $('#css-status').textContent = 'Salvo às ' + new Date().toLocaleTimeString();
  avisar('CSS aplicado');
}
$('#css-salvar').onclick = salvarCss;
$('#css-texto').addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); salvarCss(); }
  if (e.key === 'Tab') {
    e.preventDefault();
    const t = e.target, i = t.selectionStart;
    t.setRangeText('  ', i, t.selectionEnd, 'end');
  }
});

// ======================================================
//  AJUSTES
// ======================================================
const AJUSTES = [
  ['plugins', 'Plugins (Vencord)', 'Liga todo o sistema de plugins', true],
  ['botaoPainel', 'Botão ✦ no Discord', 'Atalho pra este painel no canto de cima', false],
  ['semAnimacoes', 'Sem animações', 'Interface mais rápida e leve', false],
  ['bloquearTelemetria', 'Bloquear telemetria', 'Menos rastreamento e requisições em segundo plano', true],
  ['aceleracaoHardware', 'Aceleração de hardware', 'Desligue se der tela preta ou travar', true],
  ['economizarEmSegundoPlano', 'Economizar em segundo plano', 'Menos CPU com a janela minimizada', true],
  ['corretorOrtografico', 'Corretor ortográfico', 'Desligado deixa mais leve', true]
];
function desenharAjustes() {
  const c = estado.config;
  const caixa = $('#ajustes');
  caixa.replaceChildren();
  for (const [k, titulo, desc, reinicia] of AJUSTES) {
    caixa.append(el('div', { class: 'linha' },
      el('div', {}, el('b', {}, titulo + (reinicia ? ' ↻' : '')), el('p', { class: 'sub' }, desc)),
      chave(c[k], async (v) => { await api.config({ [k]: v }); c[k] = v; if (reinicia) avisar('Reinicie o app pra valer'); })
    ));
  }
  $('#mod').value = c.mod || 'equicord';
  $('#zoom').value = c.zoom;
  $('#zoom-valor').textContent = Math.round(c.zoom * 100) + '%';
}
$('#zoom').oninput = (e) => { $('#zoom-valor').textContent = Math.round(e.target.value * 100) + '%'; };
$('#zoom').onchange = (e) => api.config({ zoom: Number(e.target.value) });
$('#mod').onchange = async (e) => {
  await api.config({ mod: e.target.value });
  estado.config.mod = e.target.value;
  if (confirm('Pra trocar o pacote de plugins, o app precisa reiniciar. Reiniciar agora?')) api.reiniciar();
};
$('#reiniciar').onclick = () => api.reiniciar();

$('#fechar').onclick = () => window.close();
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modal').classList.contains('escondido')) $('#modal').classList.add('escondido');
  else window.close();
});

recarregarEstado();
