// Roda antes do Discord carregar: injeta o Vencord (plugins) no próprio contexto da página.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('MeuDiscordNative', {
  // Requisições do Vencord sem bloqueio de CORS (temas, atualizações etc.)
  fetch: (url, opcoes) => ipcRenderer.invoke('meu-fetch', url, opcoes),
  abrirPainel: () => ipcRenderer.send('meu-abrir-painel')
});

const codigoVencord = ipcRenderer.sendSync('meu-vencord-codigo');

if (codigoVencord) {
  const inicio = `(function () {
  var unsafeWindow = window;
  function GM_xmlhttpRequest(d) {
    var metodo = d.method || 'GET';
    var corpo = d.data;
    var viaPonte = corpo == null || typeof corpo === 'string';
    var pedido = viaPonte
      ? window.MeuDiscordNative.fetch(d.url, { method: metodo, headers: d.headers || {}, body: corpo })
      : window.fetch(d.url, { method: metodo, headers: d.headers, body: corpo }).then(function (r) {
          var cab = []; r.headers.forEach(function (v, k) { cab.push(k + ': ' + v); });
          return r.arrayBuffer().then(function (b) { return { status: r.status, headers: cab.join('\\r\\n'), body: b }; });
        });
    pedido.then(function (r) {
      if (d.onload) d.onload({ status: r.status, statusText: '', response: new Blob([r.body]), responseHeaders: r.headers, finalUrl: d.url });
    }).catch(function () { if (d.onerror) d.onerror(); });
  }
`;
  const fim = `
  try { if (typeof Vencord !== 'undefined' && !window.Vencord) window.Vencord = Vencord; } catch (e) {}
})();`;
  webFrame.executeJavaScript(inicio + codigoVencord + fim).catch((e) => console.error('[ZeroCord] Falha ao carregar o Vencord', e));
}

// Dentro do Discord oficial: depois de tudo, carrega o preload original do Discord
try {
  const original = ipcRenderer.sendSync('meu-preload-original');
  if (original) require(original);
} catch (e) {
  console.error('[ZeroCord] Falha ao carregar o preload do Discord', e);
}
