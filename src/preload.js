// Runs before Discord loads: injects the plugin engine (Equicord/Vencord) into the page.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('ZeroCordNative', {
  // CORS-free requests for the plugin engine (themes, updates, etc.)
  fetch: (url, options) => ipcRenderer.invoke('zc:fetch', url, options),
  // ZeroCord settings shown in Discord's settings (Plugins page)
  state: () => ipcRenderer.invoke('zc:state'),
  set: (partial) => ipcRenderer.invoke('zc:set', partial),
  action: (name, arg) => ipcRenderer.invoke('zc:action', name, arg),
  log: (msg) => ipcRenderer.send('zc:log', String(msg).slice(0, 2000))
});

let modCode = ipcRenderer.sendSync('zc:mod-code');

// Register ZeroCord's own plugins in the engine's plugin metadata, so they show up
// in its Plugins page. Matched by shape (the variable name changes between builds).
const ZEROCORD_PLUGINS = ['FakeMute', 'AnimatedBackground', 'ZeroCordThemes', 'LocalProfile', 'Performance'];
let metaPatched = false;
if (modCode) {
  modCode = modCode.replace(/(\b[\w$]+)=\{(\[[\w$]+\.name\]:\{folderName:"src\/)/, (_m, name, rest) => {
    metaPatched = true;
    const meta = ZEROCORD_PLUGINS.map((n) => `${n}:{folderName:"src/zerocord/${n}",userPlugin:!0}`).join(',');
    return `${name}={${meta},${rest}`;
  });
}

if (modCode) {
  // Userscript shims (GM_xmlhttpRequest / unsafeWindow) so the web build runs here
  const head = `(function () {
  var unsafeWindow = window;
  window.__zcMetaPatched = ${metaPatched};
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
  // FakeMute: the voice state Discord sends (self_mute / self_deaf) goes through ZeroCord first.
  // Registered before Discord's code loads; without ZeroCord's runtime it passes values through untouched.
  try {
    if (window.Vencord && window.Vencord.Plugins && window.Vencord.Plugins.addPatch) {
      window.Vencord.Plugins.addPatch({
        find: /self_mute:[^,]{1,40},self_deaf:[^,]{1,40},self_video:/,
        all: true,
        replacement: {
          match: /self_mute:([^,]{1,40}),self_deaf:([^,]{1,40}),self_video:/,
          replace: "self_mute:(window.__zcVoice?window.__zcVoice.mute($1):$1),self_deaf:(window.__zcVoice?window.__zcVoice.deaf($2):$2),self_video:"
        }
      }, "FakeMute");
    }
  } catch (e) { console.warn('[ZeroCord] voice patch', e); }
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
