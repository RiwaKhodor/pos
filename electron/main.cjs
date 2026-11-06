const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = process.env.PORT || "3210";
let serverProcess = null;
let mainWindow = null;
let updater = null;
let updateState = {
  status: "checking",
  version: null,
  current: "",
};

function publishUpdate(patch) {
  updateState = { ...updateState, ...patch, current: app.getVersion() };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("vano-update", updateState);
  }
}

async function requireLogin(win) {
  const ses = win.webContents.session;
  const origins = [
    `http://127.0.0.1:${PORT}`,
    "http://127.0.0.1:3000",
    "http://127.0.0.1",
    "http://localhost",
  ];
  const cookies = await ses.cookies.get({ name: "pos_token" });
  for (const cookie of cookies) {
    const host = (cookie.domain || "127.0.0.1").replace(/^\./, "");
    const protocol = cookie.secure ? "https" : "http";
    origins.push(`${protocol}://${host}${cookie.path || "/"}`);
  }
  for (const url of origins) {
    await ses.cookies.remove(url, "pos_token");
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    show: true,
    title: "VANO POS",
    icon: path.join(__dirname, "icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  win.on("closed", () => {
    mainWindow = null;
  });
  return win;
}

function showMessage(win, heading, detail) {
  const esc = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#140b08;color:#f6efe6;font-family:Segoe UI,sans-serif"><div style="max-width:560px;padding:32px"><h1 style="font-size:28px;margin:0 0 12px">${esc(heading)}</h1><p style="font-size:16px;line-height:1.5;white-space:pre-wrap">${esc(detail)}</p></div></body></html>`;
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

function waitForServer(url) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > 90000) {
          reject(new Error("The POS server did not start."));
          return;
        }
        setTimeout(tick, 400);
      });
    };
    tick();
  });
}

function loadServerEnv(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, eq).trim()] = value;
  }
  return env;
}

function bundledNode() {
  const packaged = path.join(process.resourcesPath, "node", "node.exe");
  if (fs.existsSync(packaged)) return packaged;
  return process.env.VANO_NODE || "node";
}

function readUpdateToken() {
  const file = path.join(process.resourcesPath || "", "github-update.token");
  if (file && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) return trimmed;
    }
  }
  return (process.env.GH_TOKEN || "").trim();
}

function startUpdater() {
  if (!app.isPackaged) {
    publishUpdate({ status: "none", version: null });
    return;
  }
  try {
    updater = require("electron-updater").autoUpdater;
  } catch (error) {
    console.error(error);
    publishUpdate({ status: "error", version: null });
    return;
  }
  const token = readUpdateToken();
  if (token) {
    updater.setFeedURL({
      provider: "github",
      owner: "RiwaKhodor",
      repo: "pos",
      private: true,
      token,
    });
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("update-available", (info) => {
    publishUpdate({ status: "downloading", version: info.version || null });
  });
  updater.on("update-downloaded", (info) => {
    publishUpdate({ status: "ready", version: info.version || null });
  });
  updater.on("update-not-available", () => {
    publishUpdate({ status: "none", version: null });
  });
  updater.on("error", (error) => {
    console.error(error);
    publishUpdate({ status: "error", version: null });
  });
  publishUpdate({ status: "checking", version: null });
  updater.checkForUpdates().catch((error) => {
    console.error(error);
    publishUpdate({ status: "error", version: null });
  });
}

ipcMain.handle("vano-update-state", () => updateState);
ipcMain.handle("vano-update-install", () => {
  if (!updater || updateState.status !== "ready") return false;
  updater.quitAndInstall(false, true);
  return true;
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  startUpdater();
  mainWindow = createWindow();
  if (process.env.VANO_ELECTRON_DEV === "1") {
    await requireLogin(mainWindow);
    mainWindow.loadURL(process.env.VANO_DEV_URL || "http://127.0.0.1:3000");
    return;
  }

  showMessage(mainWindow, "VANO POS", "Opening the register…");
  const serverJs = path.join(process.resourcesPath, "standalone", "server.js");
  const serverEnv = loadServerEnv(path.join(process.resourcesPath, "server.env"));
  const logPath = path.join(app.getPath("userData"), "server.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  let serverLog = "";
  const remember = (chunk) => {
    serverLog = (serverLog + chunk.toString()).slice(-4000);
    logStream.write(chunk);
  };
  serverProcess = spawn(bundledNode(), [serverJs], {
    cwd: path.dirname(serverJs),
    env: {
      ...process.env,
      ...serverEnv,
      PORT,
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      VANO_DESKTOP: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", remember);
  serverProcess.stderr.on("data", remember);
  serverProcess.on("error", (error) => {
    remember(String(error));
  });
  try {
    await waitForServer(`http://127.0.0.1:${PORT}`);
    if (mainWindow) {
      await requireLogin(mainWindow);
      mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
    }
  } catch (error) {
    const safe = serverLog.replace(/postgres(?:ql)?:\/\/\S+/gi, "[database]").slice(-1200);
    showMessage(
      mainWindow,
      "VANO POS could not open",
      (error && error.message ? error.message : "The register did not start.") +
        (safe ? "\n\n" + safe : "")
    );
  }
});

app.on("before-quit", () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
