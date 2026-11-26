// ZeroCord como app separado (npm start / .exe portátil)
const { app, BrowserWindow } = require('electron');
const path = require('path');

if (!process.env.MEUDISCORD_DADOS) {
  process.env.MEUDISCORD_DADOS = process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(process.execPath) : __dirname);
}
process.env.MEUDISCORD_MODO = 'separado';

const nucleo = require('./nucleo');
const { config } = nucleo;

if (!config.aceleracaoHardware) app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService,SpareRendererForSitePerProcess');

if (!app.requestSingleInstanceLock()) app.quit();

let janela = null;

function criarJanela() {
  janela = new BrowserWindow({
    width: 1280, height: 800, minWidth: 940, minHeight: 500,
    title: 'ZeroCord', backgroundColor: '#1e1f22', show: false, autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: !!config.corretorOrtografico,
      backgroundThrottling: !!config.economizarEmSegundoPlano
    }
  });
  janela.once('ready-to-show', () => janela.show());
  nucleo.definirJanela(janela, { separado: true });
  janela.on('closed', () => { janela = null; });
  janela.loadURL(nucleo.URL_DISCORD);
}

app.on('second-instance', () => {
  if (janela) { if (janela.isMinimized()) janela.restore(); janela.focus(); }
});

app.whenReady().then(() => {
  nucleo.iniciarAposPronto();
  criarJanela();
});

app.on('window-all-closed', () => app.quit());
