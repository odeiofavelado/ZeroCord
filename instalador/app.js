/* global inst */
const $ = (s) => document.querySelector(s);

// ---------- Cenas do fundo (trocam com fade) ----------
const CENAS = ['midia/cena1.webm', 'midia/cena2.webm', 'midia/cena3.webm', 'midia/cena4.webm'];
let cenaAtual = 0;
let usandoA = true;
function trocarCena() {
  const entra = usandoA ? $('#cenaA') : $('#cenaB');
  const sai = usandoA ? $('#cenaB') : $('#cenaA');
  entra.src = CENAS[cenaAtual % CENAS.length];
  entra.play().catch(() => {});
  entra.classList.add('visivel');
  sai.classList.remove('visivel');
  cenaAtual++;
  usandoA = !usandoA;
}
trocarCena();
setInterval(trocarCena, 9000);

// ---------- Zero Two (muda conforme o estado) ----------
const POSES = { inicio: 'midia/zt-sorrindo.webp', trabalhando: 'midia/zt-dancando.webp', pronto: 'midia/zt-apontando.webp' };
function estado(nome, fala) {
  document.body.className = 'estado-' + nome;
  const img = $('#zt');
  if (!img.src.endsWith(POSES[nome])) {
    img.classList.add('trocando');
    setTimeout(() => { img.src = POSES[nome]; img.classList.remove('trocando'); }, 300);
  }
  if (fala) falar(fala);
}
function falar(texto) {
  const b = $('#balao');
  b.textContent = texto;
  b.classList.add('pulo');
  void b.offsetWidth;
  b.classList.remove('pulo');
}

// ---------- Log ----------
function log(msg) {
  const linha = document.createElement('div');
  linha.textContent = '> ' + msg;
  if (/^✓/.test(msg)) linha.className = 'ok';
  else if (/^⚠/.test(msg)) linha.className = 'aviso';
  else if (/^✗/.test(msg)) linha.className = 'erro';
  $('#log').append(linha);
  $('#log').scrollTop = $('#log').scrollHeight;
}
inst.aoLog(log);

// ---------- Lista de Discords ----------
const ICONE_DISCORD = '<svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M19.73 4.87a18.2 18.2 0 0 0-4.6-1.44c-.21.4-.4.8-.58 1.21-1.69-.25-3.4-.25-5.1 0-.18-.41-.37-.82-.59-1.2-1.6.27-3.14.75-4.6 1.43A19.04 19.04 0 0 0 .96 17.7a18.43 18.43 0 0 0 5.63 2.87c.46-.62.86-1.28 1.2-1.98-.65-.25-1.29-.55-1.9-.92.17-.12.32-.24.47-.37 3.58 1.7 7.7 1.7 11.28 0l.46.37c-.6.36-1.25.67-1.9.92.35.7.75 1.35 1.2 1.98 2.03-.63 3.94-1.6 5.64-2.87.47-4.87-.78-9.09-3.3-12.83ZM8.3 15.12c-1.1 0-2-1.02-2-2.27 0-1.24.88-2.26 2-2.26s2.02 1.02 2 2.26c0 1.25-.89 2.27-2 2.27Zm7.4 0c-1.1 0-2-1.02-2-2.27 0-1.24.88-2.26 2-2.26s2.02 1.02 2 2.26c0 1.25-.88 2.27-2 2.27Z"/></svg>';
const ROTULO = { instalado: 'Instalado', limpo: 'Não instalado', 'outro-mod': 'Outro mod' };
let lista = [];
const marcados = new Set();
let primeira = true;

async function carregar() {
  lista = await inst.listar();
  if (primeira) {
    lista.filter((v) => !v.outroMod).forEach((v) => marcados.add(v.id));
    primeira = false;
  }
  desenhar();
}

function desenhar() {
  const caixa = $('#lista');
  caixa.replaceChildren();
  if (!lista.length) {
    const d = document.createElement('div');
    d.className = 'vazio';
    d.innerHTML = 'Não achei nenhum Discord instalado neste computador.<br>Baixe em <a href="https://discord.com/download" target="_blank">discord.com/download</a> e abra este instalador de novo.';
    caixa.append(d);
  }
  for (const v of lista) {
    const c = document.createElement('div');
    c.className = `cartao ${v.id}` + (marcados.has(v.id) ? ' marcado' : '') + (v.outroMod ? ' bloqueado' : '');
    c.innerHTML = `<span class="marcar"></span><div class="logo">${ICONE_DISCORD}</div>
      <div class="info"><b></b><small></small></div><span class="chip ${v.estado}"></span>`;
    c.querySelector('b').textContent = v.nome;
    c.querySelector('small').textContent = 'versão ' + v.versao;
    c.querySelector('.chip').textContent = ROTULO[v.estado] || v.estado;
    if (v.outroMod) c.title = 'Esse Discord já tem outro mod (Vencord/Equicord oficial). Desinstale ele antes: o ZeroCord já inclui o Equicord.';
    c.onclick = () => { marcados.has(v.id) ? marcados.delete(v.id) : marcados.add(v.id); desenhar(); };
    caixa.append(c);
  }
  const algum = [...marcados].some((id) => lista.find((v) => v.id === id));
  $('#instalar').disabled = !algum;
  $('#desinstalar').disabled = !lista.some((v) => v.instalado && marcados.has(v.id));
  const jaTem = lista.some((v) => v.instalado && marcados.has(v.id));
  $('#instalar span').textContent = jaTem ? 'Reinstalar' : 'Instalar';
}

function escolhidos() { return lista.filter((v) => marcados.has(v.id)).map((v) => v.id); }

async function fecharSeAberto(ids) {
  const abertos = await inst.abertos(ids);
  if (!abertos.length) return true;
  const nomes = lista.filter((v) => abertos.includes(v.id)).map((v) => v.nome).join(', ');
  const r = await inst.confirmar('O Discord está aberto', `Preciso fechar ${nomes} pra continuar. Pode fechar?`, ['Fechar e continuar', 'Cancelar']);
  if (r !== 0) return false;
  log('Fechando ' + nomes + '…');
  await inst.fecharDiscord(abertos);
  return true;
}

function travar(sim) {
  for (const b of document.querySelectorAll('.botoes button')) b.disabled = sim;
  document.querySelectorAll('.cartao').forEach((c) => (c.style.pointerEvents = sim ? 'none' : ''));
}

$('#instalar').onclick = async () => {
  const ids = escolhidos();
  if (!ids.length) return;
  if (!(await fecharSeAberto(ids))) return;
  travar(true);
  $('#log').replaceChildren();
  estado('trabalhando', 'Só um instante, darling… tô arrumando tudo pra você.');
  const r = await inst.instalar(ids, { trocarIcone: $('#op-icone').checked });
  await new Promise((ok) => setTimeout(ok, 150)); // deixa as últimas mensagens chegarem
  lista = r.lista;
  travar(false);
  desenhar();
  if (r.ok && lista.some((v) => ids.includes(v.id) && v.instalado)) {
    estado('pronto', 'Prontinho! Seu Discord agora tem plugins, temas e o painel ✦');
    log('✓ Tudo certo! Abra o Discord e procure o ícone ✦ no canto de cima.');
    if ($('#op-abrir').checked) inst.abrirDiscord(ids.filter((id) => lista.find((v) => v.id === id && v.instalado)));
  } else {
    estado('inicio', 'Hmm… algo não deu certo. Dá uma olhada embaixo.');
  }
};

$('#desinstalar').onclick = async () => {
  const ids = escolhidos().filter((id) => lista.find((v) => v.id === id && v.instalado));
  if (!ids.length) return;
  const r = await inst.confirmar('Desinstalar o ZeroCord?', 'O Discord volta ao normal, com o ícone original.', ['Desinstalar e manter minhas configurações', 'Desinstalar e apagar tudo', 'Cancelar']);
  if (r === 2) return;
  if (!(await fecharSeAberto(ids))) return;
  travar(true);
  $('#log').replaceChildren();
  estado('trabalhando', 'Tá bom… tirando tudo com cuidado.');
  const res = await inst.desinstalar(ids, { apagarDados: r === 1 });
  await new Promise((ok) => setTimeout(ok, 150));
  lista = res.lista;
  travar(false);
  desenhar();
  estado('inicio', res.ok ? 'Pronto, voltou ao normal. Quando quiser, é só instalar de novo.' : 'Algo deu errado, olha o registro embaixo.');
};

$('#pasta').onclick = () => inst.abrirPasta();
document.querySelectorAll('.jb').forEach((b) => (b.onclick = () => inst.janela(b.dataset.acao)));

carregar();
