/* Headless Shell can exercise the browser DOM/renderers but does not host MV3 extensions.
   This test-only shim substitutes the extension IPC, settings and download entry points. */
export function installChromeShim() {
  if (location.origin !== 'https://chatgpt.com') return;
  const base = location.origin + '/test-preview/';
  function event() {
    const handlers = new Set();
    return { addListener: callback => handlers.add(callback), removeListener: callback => handlers.delete(callback),
      emit: (...args) => handlers.forEach(handler => handler(...args)) };
  }
  const onConnect = event();
  const onChanged = event();
  const downloads = new Map();
  let counter = 0;
  function port(channel, sender) {
    const onMessage = event();
    const onDisconnect = event();
    channel.onmessage = ({ data }) => onMessage.emit(data);
    return { onMessage, onDisconnect, sender, name: channel.name,
      postMessage: message => channel.postMessage(message), disconnect: () => { channel.close(); onDisconnect.emit(); } };
  }
  const api = {
    runtime: {
      onMessage: event(), onConnect, getURL: path => base + path,
      sendMessage: async ({ token }) => {
        const channel = new BroadcastChannel(token);
        channel.onmessage = ({ data }) => {
          if (data === 'connect') onConnect.emit(port(channel, { url: base + 'preview.html#1/' + token }));
        };
        window.open(base + 'preview.html#1/' + token, '_blank');
        return { ok: true };
      },
    },
    tabs: { connect: (_id, { name }) => {
      const channel = new BroadcastChannel(name);
      const result = port(channel);
      channel.postMessage('connect');
      return result;
    } },
    storage: { local: {
      get: async key => ({ [key]: JSON.parse(localStorage.getItem('test-' + key) || 'null') }),
      set: async settings => { for (const [key, value] of Object.entries(settings)) localStorage.setItem('test-' + key, JSON.stringify(value)); },
    } },
    downloads: {
      onChanged,
      download: async ({ url, filename }) => {
        const id = ++counter;
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
        downloads.set(id, 'in_progress');
        setTimeout(() => { downloads.set(id, 'complete'); onChanged.emit({ id, state: { current: 'complete' } }); }, 200);
        return id;
      },
      search: async ({ id }) => [{ id, state: downloads.get(id) }],
      cancel: async id => downloads.set(id, 'interrupted'),
    },
  };
  Object.assign(window.chrome || (window.chrome = {}), api);
}
