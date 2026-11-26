// ZeroCord dentro do Discord oficial (Stable / PTB / Canary).
// Carregado por resources/app/index.js, criado pelo instalador.
const electron = require('electron');
const path = require('path');
const fs = require('fs');
const Module = require('module');

process.env.MEUDISCORD_DADOS = path.join(process.env.APPDATA || electron.app.getPath('appData'), 'ZeroCord');
process.env.MEUDISCORD_MODO = 'injetado';

// ...\app-1.0.xxxx\resources (a pasta "app" que o instalador criou fica dentro dela)
const recursos = path.dirname(electron.app.getAppPath());
const asarOriginal = path.join(recursos, 'app.asar');

let nucleo = null;
try {
  nucleo = require('./nucleo');
} catch (e) {
  console.error('[ZeroCord] Erro ao carregar, abrindo o Discord normal', e);
}

if (nucleo) {
  // Envolve a janela do Discord: troca o preload pelo nosso, que depois carrega o original
  class BrowserWindow extends electron.BrowserWindow {
    constructor(opcoes) {
      const wp = opcoes && opcoes.webPreferences;
      const doDiscord = !!(opcoes && !opcoes.meuDiscord && wp && wp.preload && opcoes.title);
      let preloadOriginal = null;
      const iconeZT = path.join(__dirname, 'icones', process.platform === 'win32' ? 'icone-discord.ico' : 'icone-discord.png');
      const usarIcone = doDiscord && nucleo.config.iconeZeroTwo !== false && fs.existsSync(iconeZT);
      if (usarIcone) opcoes.icon = iconeZT;
      if (doDiscord) {
        preloadOriginal = wp.preload;
        wp.preload = path.join(__dirname, 'preload.js');
        wp.sandbox = false;
        if (nucleo.config.economizarEmSegundoPlano === false) wp.backgroundThrottling = false;
      }
      super(opcoes);
      if (usarIcone) {
        try { this.setIcon(iconeZT); } catch {}
        // o Discord às vezes troca o ícone depois (notificações): mantém o nosso
        const setIconOriginal = this.setIcon.bind(this);
        this.setIcon = () => setIconOriginal(iconeZT);
      }
      if (doDiscord) {
        nucleo.preloadsOriginais.set(this.webContents.id, preloadOriginal);
        nucleo.definirJanela(this);
      }
    }
  }
  Object.assign(BrowserWindow, electron.BrowserWindow);
  Object.defineProperty(BrowserWindow, 'name', { value: 'BrowserWindow', configurable: true });

  const caminhoElectron = require.resolve('electron');
  delete require.cache[caminhoElectron].exports;
  require.cache[caminhoElectron].exports = { ...electron, BrowserWindow };

  electron.app.whenReady().then(() => nucleo.iniciarAposPronto());
}

// Quando o Discord se atualiza, ele cria uma pasta app-x.y.z nova sem o ZeroCord.
// Aqui a gente coloca o ZeroCord nela também (ao abrir e ao fechar o Discord).
function reinjetar() {
  try {
    const raiz = path.dirname(path.dirname(recursos)); // ...\Discord
    const nossoIndex = path.join(recursos, 'app', 'index.js');
    const nossoPkg = path.join(recursos, 'app', 'package.json');
    for (const pastaApp of fs.readdirSync(raiz)) {
      if (!/^app-/.test(pastaApp)) continue;
      const res = path.join(raiz, pastaApp, 'resources');
      if (!fs.existsSync(path.join(res, 'app.asar'))) continue;
      if (fs.existsSync(path.join(res, '_app.asar'))) continue; // outro mod instalado
      const destino = path.join(res, 'app');
      if (fs.existsSync(path.join(destino, 'index.js'))) continue;
      fs.mkdirSync(destino, { recursive: true });
      fs.copyFileSync(nossoIndex, path.join(destino, 'index.js'));
      fs.copyFileSync(nossoPkg, path.join(destino, 'package.json'));
    }
  } catch (e) {
    console.error('[ZeroCord] reinjetar', e);
  }
}
reinjetar();
electron.app.on('before-quit', reinjetar);

// Agora inicia o Discord de verdade
const pacote = require(path.join(asarOriginal, 'package.json'));
electron.app.setAppPath(asarOriginal);
if (pacote.name) electron.app.name = pacote.name;
Module._load(path.join(asarOriginal, pacote.main || 'index.js'), null, true);
