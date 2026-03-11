const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { ConfigStore, sanitizeSettings } = require("./src/main/configStore");
const { BinancePositionsService } = require("./src/main/binanceService");
const { EquityAlertService } = require("./src/main/equityAlertService");
const { EquityHistoryService } = require("./src/main/equityHistoryService");

let mainWindow = null;
let historyWindow = null;
let configStore = null;
let positionsService = null;
let equityHistoryService = null;
let equityAlertService = null;

const startupLogPath = path.join(process.env.APPDATA || os.tmpdir(), "binance-position-panel", "startup.log");

function writeStartupLog(message) {
  try {
    fs.mkdirSync(path.dirname(startupLogPath), { recursive: true });
    fs.appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch (_error) {
    return;
  }
}

function broadcast(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function broadcastSnapshot(snapshot) {
  broadcast("panel:snapshot", snapshot);
}

function broadcastHistoryUpdate(historyPayload) {
  broadcast("history:updated", historyPayload);
}

function broadcastEquityAlert(alertPayload) {
  broadcast("alert:triggered", alertPayload);
}

function flashMainWindowTemporarily() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.flashFrame(true);
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.flashFrame(false);
    }
  }, 3000);
}

function syncWindowAlwaysOnTop(alwaysOnTop) {
  mainWindow?.setAlwaysOnTop(Boolean(alwaysOnTop), "screen-saver");
  historyWindow?.setAlwaysOnTop(Boolean(alwaysOnTop), "screen-saver");
}

function attachWindowLifecycle(window, label) {
  window.on("ready-to-show", () => {
    writeStartupLog(`${label} ready-to-show`);
    window.show();
    window.focus();
  });

  window.on("show", () => {
    writeStartupLog(`${label} show`);
  });

  window.on("closed", () => {
    writeStartupLog(`${label} closed`);
    if (window === mainWindow) {
      mainWindow = null;
    }

    if (window === historyWindow) {
      historyWindow = null;
    }
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    writeStartupLog(`${label} did-fail-load code=${errorCode} desc=${errorDescription}`);
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    writeStartupLog(`${label} render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
}

function createMainWindow() {
  writeStartupLog("createMainWindow begin");
  const settings = configStore.load();

  mainWindow = new BrowserWindow({
    width: 354,
    height: 552,
    minWidth: 320,
    minHeight: 460,
    backgroundColor: "#f2e1b8",
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    show: false,
    alwaysOnTop: Boolean(settings.alwaysOnTop),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  attachWindowLifecycle(mainWindow, "mainWindow");
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  writeStartupLog(`mainWindow loadFile ${path.join(__dirname, "index.html")}`);
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  return mainWindow;
}

function createHistoryWindow() {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.show();
    historyWindow.focus();
    return historyWindow;
  }

  writeStartupLog("createHistoryWindow begin");
  const settings = configStore.load();

  historyWindow = new BrowserWindow({
    width: 500,
    height: 356,
    minWidth: 440,
    minHeight: 320,
    backgroundColor: "#f4ead0",
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    show: false,
    parent: mainWindow || undefined,
    alwaysOnTop: Boolean(settings.alwaysOnTop),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  attachWindowLifecycle(historyWindow, "historyWindow");
  historyWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  writeStartupLog(`historyWindow loadFile ${path.join(__dirname, "equity-history.html")}`);
  historyWindow.loadFile(path.join(__dirname, "equity-history.html"));
  return historyWindow;
}

async function connectWithSavedSettings() {
  const settings = configStore.load();
  positionsService.hydrateFromSettings(settings);
  equityHistoryService.noteSnapshot(settings, positionsService.getSnapshot());

  if (settings.apiKey && settings.apiSecret) {
    await positionsService.start(settings);
  }
}

async function exportEquityHistory(intervalMinutes) {
  const settings = configStore.load();
  const exportData = equityHistoryService.exportHistoryCsv(settings, intervalMinutes);
  const defaultDirectory = equityHistoryService.getStorageDirectory(settings);
  const result = await dialog.showSaveDialog(historyWindow || mainWindow, {
    title: "导出净值历史",
    defaultPath: path.join(defaultDirectory, exportData.defaultFileName),
    filters: [
      {
        name: "CSV 文件",
        extensions: ["csv"]
      }
    ]
  });

  if (result.canceled || !result.filePath) {
    return {
      canceled: true
    };
  }

  fs.writeFileSync(result.filePath, exportData.csvText, "utf8");
  return {
    canceled: false,
    filePath: result.filePath
  };
}

async function openEquityHistoryFolder() {
  const settings = configStore.load();
  const directoryPath = equityHistoryService.getStorageDirectory(settings);
  fs.mkdirSync(directoryPath, { recursive: true });
  const errorMessage = await shell.openPath(directoryPath);
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return directoryPath;
}

function registerIpc() {
  ipcMain.handle("panel:get-settings", () => sanitizeSettings(configStore.load()));
  ipcMain.handle("panel:get-state", () => positionsService.getSnapshot());

  ipcMain.handle("panel:save-settings", async (_event, payload) => {
    const settings = configStore.save(payload);
    syncWindowAlwaysOnTop(settings.alwaysOnTop);

    positionsService.hydrateFromSettings(settings);
    equityHistoryService.noteSnapshot(settings, positionsService.getSnapshot());

    if (settings.apiKey && settings.apiSecret) {
      await positionsService.start(settings);
    } else {
      positionsService.stop({ emitSnapshot: true });
    }

    return {
      settings: sanitizeSettings(settings),
      snapshot: positionsService.getSnapshot()
    };
  });

  ipcMain.handle("panel:refresh", async () => {
    const settings = configStore.load();
    positionsService.hydrateFromSettings(settings);

    if (settings.apiKey && settings.apiSecret) {
      await positionsService.start(settings);
    }

    const snapshot = positionsService.getSnapshot();
    equityHistoryService.noteSnapshot(settings, snapshot);
    return snapshot;
  });

  ipcMain.handle("history:open-window", () => {
    createHistoryWindow();
    return true;
  });

  ipcMain.handle("history:get-data", () => {
    const settings = configStore.load();
    return equityHistoryService.getHistory(settings, positionsService.getSnapshot());
  });

  ipcMain.handle("history:export", async (_event, payload = {}) => exportEquityHistory(payload.intervalMinutes));
  ipcMain.handle("history:open-folder", async () => openEquityHistoryFolder());

  ipcMain.handle("window:set-always-on-top", (_event, alwaysOnTop) => {
    const settings = configStore.save({ alwaysOnTop: Boolean(alwaysOnTop) });
    syncWindowAlwaysOnTop(settings.alwaysOnTop);
    return sanitizeSettings(settings);
  });

  ipcMain.on("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.on("app:quit", () => {
    app.quit();
  });
}

writeStartupLog(`process start pid=${process.pid}`);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

process.on("uncaughtException", (error) => {
  writeStartupLog(`uncaughtException ${error.stack || error.message}`);
});

process.on("unhandledRejection", (reason) => {
  writeStartupLog(`unhandledRejection ${reason && reason.stack ? reason.stack : reason}`);
});

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  writeStartupLog("second instance denied");
  app.quit();
}

app.whenReady().then(async () => {
  writeStartupLog("app ready");
  configStore = new ConfigStore({ app, safeStorage });
  positionsService = new BinancePositionsService();
  equityHistoryService = new EquityHistoryService({ app });
  equityAlertService = new EquityAlertService();
  equityHistoryService.start();

  positionsService.on("snapshot", (snapshot) => {
    const settings = configStore.load();
    equityHistoryService.noteSnapshot(settings, snapshot);
    broadcastSnapshot(snapshot);
  });

  equityHistoryService.on("history-updated", (historyPayload) => {
    broadcastHistoryUpdate(historyPayload);

    const settings = configStore.load();
    const alertPayload = equityAlertService.evaluate(settings, historyPayload);
    if (!alertPayload) {
      return;
    }

    flashMainWindowTemporarily();
    broadcastEquityAlert(alertPayload);
  });

  registerIpc();
  createMainWindow();
  await connectWithSavedSettings();
  writeStartupLog("connectWithSavedSettings done");
});

app.on("second-instance", () => {
  writeStartupLog("second-instance event");
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on("before-quit", () => {
  writeStartupLog("before-quit");
  positionsService?.dispose();
  equityHistoryService?.dispose();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
