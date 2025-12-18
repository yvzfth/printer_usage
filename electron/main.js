const path = require('path');
const http = require('http');
const next = require('next');
const { app, BrowserWindow } = require('electron');

const DEFAULT_PORT = 3000;
const port = Number(process.env.PORT) || DEFAULT_PORT;
const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

let nextServerPromise;
let nextHttpServer;
process.env.NEXT_TELEMETRY_DISABLED = '1';

const resolveAppDirectory = () =>
  app.isPackaged ? app.getAppPath() : path.join(__dirname, '..');

const getAppIconPath = () => path.join(resolveAppDirectory(), 'public', 'app-icon.png');

const ensureReportsDirectory = () => {
  if (process.env.REPORTS_DIRECTORY && process.env.REPORTS_DIRECTORY.trim()) {
    return process.env.REPORTS_DIRECTORY;
  }

  const basePath = app.isPackaged
    ? app.getPath('userData')
    : path.join(process.cwd(), 'storage');

  const targetPath = app.isPackaged
    ? path.join(basePath, 'reports')
    : path.join(basePath, 'reports');

  process.env.REPORTS_DIRECTORY = targetPath;
  return targetPath;
};

const prepareNextServer = () => {
  if (isDev) {
    return Promise.resolve();
  }

  if (!nextServerPromise) {
    nextServerPromise = (async () => {
      const nextApp = next({
        dev: isDev,
        dir: resolveAppDirectory(),
      });
      const handle = nextApp.getRequestHandler();
      await nextApp.prepare();

      nextHttpServer = http.createServer((req, res) => handle(req, res));

      await new Promise((resolve, reject) => {
        nextHttpServer.once('error', reject);
        nextHttpServer.listen(port, resolve);
      });

      return nextHttpServer;
    })().catch((error) => {
      nextServerPromise = undefined;
      console.error('Failed to start Next.js server', error);
      throw error;
    });
  }

  return nextServerPromise;
};

const createMainWindow = async () => {
  try {
    ensureReportsDirectory();
    await prepareNextServer();

    const window = new BrowserWindow({
      width: 1440,
      height: 900,
      backgroundColor: '#0b0b0b',
      show: false,
      icon: getAppIconPath(),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const showWindow = () => {
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
    };

    window.once('ready-to-show', showWindow);

    const appUrl =
      process.env.ELECTRON_START_URL || `http://localhost:${port}`;
    await window.loadURL(appUrl);

    if (!window.isVisible()) {
      showWindow();
    }

    if (isDev) {
      window.webContents.openDevTools({ mode: 'detach' });
    }

    return window;
  } catch (error) {
    console.error('Unable to create main window', error);
  }
};

const shutdownServer = () => {
  if (nextHttpServer) {
    nextHttpServer.close();
    nextHttpServer = undefined;
    nextServerPromise = undefined;
  }
};

const bootstrap = async () => {
  await app.whenReady();
  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
};

app.on('before-quit', shutdownServer);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

bootstrap().catch((error) => {
  console.error('Electron bootstrap failed', error);
  app.quit();
});
