/**
 * Wildwood als eigenständiges Programm (Electron): öffnet das gebaute Spiel (`dist/`) in einem eigenen
 * Fenster – ohne Browser, ohne Dev-Server. Die Dateien kommen über ein eigenes Protokoll `app://`,
 * damit Module, WASM und Modelle wie von einem Webserver geladen werden. Spielstände landen im
 * Benutzerordner des Programms (localStorage von `app://wildwood`).
 */
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// Auf Laptops mit zwei Grafikkarten die schnelle nehmen; ältere Treiber nicht von WebGL aussperren.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    title: 'Wildwood',
    backgroundColor: '#000000',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  // Kein Menü: Strg+W, Strg+R & Co. gehören dem Spiel.
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  // F11: Vollbild an/aus.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  // Links (z. B. zum Repository) im normalen Browser öffnen.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://wildwood/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const file = path.normalize(path.join(DIST, decodeURIComponent(new URL(request.url).pathname)));
    if (!file.startsWith(DIST)) return new Response('Nicht gefunden', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
