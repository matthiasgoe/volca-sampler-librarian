// Electron main process for Volca Sampler.
//
// Why a local HTTP server instead of loading build/index.html via file://?
//  - The app uses Web Workers, an AudioWorklet, and streaming-compiled WASM
//    (the Korg Syro encoder). Chromium blocks several of these over file://.
//  - The plugin system expects the origin http://127.0.0.1:3000 when it runs
//    over http (see src/utils/plugins.js), so serving on that exact port keeps
//    plugins working fully offline.
// So we serve the static build/ folder on 127.0.0.1:3000 and point the window
// at it. This mirrors exactly how the README recommends running offline.

const { app, BrowserWindow, session, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PREFERRED_PORT = 3000; // must stay 3000 for the plugin iframe to work
const BUILD_DIR = path.join(__dirname, '..', 'build');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function createStaticServer(rootDir) {
  return http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = path.join(rootDir, urlPath);
      // Prevent path traversal outside the build directory.
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
        // SPA fallback so client-side routing still resolves.
        filePath = path.join(rootDir, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end('Server error: ' + String(err));
    }
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function startServer() {
  const server = createStaticServer(BUILD_DIR);
  try {
    const port = await listen(server, PREFERRED_PORT);
    return { server, port, pluginsOk: port === PREFERRED_PORT };
  } catch (err) {
    // Port 3000 busy: fall back to a random free port. The core app still
    // works fully; only the optional plugin iframe may not load.
    const port = await listen(server, 0);
    return { server, port, pluginsOk: false };
  }
}

let mainWindow = null;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: '#1e2327',
    title: 'Volca Sampler Librarian',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  // Open external links (KORG FAQ, GitHub, etc.) in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Auto-grant microphone access for recording (Info.plist also carries the
  // NSMicrophoneUsageDescription string required by macOS).
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'media' || permission === 'microphone');
  });

  const { port } = await startServer();
  createWindow(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
