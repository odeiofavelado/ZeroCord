// Runs before Discord loads: injects the plugin engine (Equicord/Vencord) into the page.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('ZeroCordNative', {
  // CORS-free requests for the plugin engine (themes, updates, etc.)
  fetch: (url, options) => ipcRenderer.invoke('zc:fetch', url, options),
  openPanel: () => ipcRenderer.send('zc:open-panel')
});

const modCode = ipcRenderer.sendSync('zc:mod-code');

if (modCode) {
  // Userscript shims (GM_xmlhttpRequest / unsafeWindow) so the web build runs here
  const head = `(function () {
  var unsafeWindow = window;
  function GM_xmlhttpRequest(d) {
    var method = d.method || 'GET';
    var body = d.data;
    var viaBridge = body == null || typeof body === 'string';
    var req = viaBridge
      ? window.ZeroCordNative.fetch(d.url, { method: method, headers: d.headers || {}, body: body })
      : window.fetch(d.url, { method: method, headers: d.headers, body: body }).then(function (r) {
          var h = []; r.headers.forEach(function (v, k) { h.push(k + ': ' + v); });
          return r.arrayBuffer().then(function (b) { return { status: r.status, headers: h.join('\\r\\n'), body: b }; });
        });
    req.then(function (r) {
      if (d.onload) d.onload({ status: r.status, statusText: '', response: new Blob([r.body]), responseHeaders: r.headers, finalUrl: d.url });
    }).catch(function () { if (d.onerror) d.onerror(); });
  }
`;
  const tail = `
  try { if (typeof Vencord !== 'undefined' && !window.Vencord) window.Vencord = Vencord; } catch (e) {}
})();`;
  webFrame.executeJavaScript(head + modCode + tail).catch((e) => console.error('[ZeroCord] failed to load the plugin engine', e));
}

// Inside the official client: after everything, load Discord's own preload
try {
  const original = ipcRenderer.sendSync('zc:original-preload');
  if (original) require(original);
} catch (e) {
  console.error("[ZeroCord] failed to load Discord's preload", e);
}
