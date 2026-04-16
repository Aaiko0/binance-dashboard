const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { ConfigStore } = require("./src/main/configStore");
const { BinancePositionsService } = require("./src/main/binanceService");
const { EquityAlertService } = require("./src/main/equityAlertService");
const { EquityHistoryService } = require("./src/main/equityHistoryService");
const { PanelRuntime } = require("./src/server/panelRuntime");

let mainWindow = null;
let historyWindow = null;
let runtime = null;

const startupLogPath = path.join(process.env.APPDATA || os.tmpdir(), "binance-position-panel", "startup.log");

function writeStartupLog(message) {
  try {
    fs.mkdirSync(path.dirname(startupLogPath), { recursive: true });
    fs.appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch (_error) {
    return;
  }
}

function getCurrentSettings() {
  return runtime ? runtime.getSettings() : { alwaysOnTop: true };
}

function broadcast(channel, payload) {
  for (const targetWindow of BrowserWindow.getAllWindows()) {
    if (!targetWindow.isDestroyed()) {
      targetWindow.webContents.send(channel, payload);
    }
  }
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
  const nextValue = Boolean(alwaysOnTop);
  mainWindow?.setAlwaysOnTop(nextValue, "screen-saver");
  historyWindow?.setAlwaysOnTop(nextValue, "screen-saver");
}

function attachWindowLifecycle(targetWindow, label) {
  targetWindow.on("ready-to-show", () => {
    writeStartupLog(`${label} ready-to-show`);
    targetWindow.show();
    targetWindow.focus();
  });

  targetWindow.on("show", () => {
    writeStartupLog(`${label} show`);
  });

  targetWindow.on("closed", () => {
    writeStartupLog(`${label} closed`);
    if (targetWindow === mainWindow) {
      mainWindow = null;
    }

    if (targetWindow === historyWindow) {
      historyWindow = null;
    }
  });

  targetWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    writeStartupLog(`${label} did-fail-load code=${errorCode} desc=${errorDescription}`);
  });

  targetWindow.webContents.on("render-process-gone", (_event, details) => {
    writeStartupLog(`${label} render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
}

function createMainWindow() {
  writeStartupLog("createMainWindow begin");
  const settings = getCurrentSettings();

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
  const settings = getCurrentSettings();

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

async function exportEquityHistory(intervalMinutes) {
  const exportData = runtime.exportHistoryCsv(intervalMinutes);
  const defaultDirectory = runtime.getHistoryStorageDirectory();
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
  const directoryPath = runtime.getHistoryStorageDirectory();
  fs.mkdirSync(directoryPath, { recursive: true });
  const errorMessage = await shell.openPath(directoryPath);
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return directoryPath;
}

function registerIpc() {
  ipcMain.handle("panel:get-settings", () => runtime.getSettings());
  ipcMain.handle("panel:get-default-settings", () => runtime.getDefaultSettings());
  ipcMain.handle("panel:get-state", () => runtime.getSnapshot());
  ipcMain.handle("panel:save-settings", async (_event, payload) => {
    const result = await runtime.saveSettings(payload);
    syncWindowAlwaysOnTop(result.settings.alwaysOnTop);
    return result;
  });
  ipcMain.handle("panel:refresh", () => runtime.refresh());
  ipcMain.handle("history:open-window", () => {
    createHistoryWindow();
    return true;
  });
  ipcMain.handle("history:get-data", () => runtime.getHistory());
  ipcMain.handle("history:export", async (_event, payload = {}) => exportEquityHistory(payload.intervalMinutes));
  ipcMain.handle("history:open-folder", () => openEquityHistoryFolder());
  ipcMain.handle("window:set-always-on-top", async (_event, alwaysOnTop) => {
    const result = await runtime.saveSettings({ alwaysOnTop: Boolean(alwaysOnTop) });
    syncWindowAlwaysOnTop(result.settings.alwaysOnTop);
    return result.settings;
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

  runtime = new PanelRuntime({
    configStore: new ConfigStore({ app, safeStorage }),
    positionsService: new BinancePositionsService(),
    equityHistoryService: new EquityHistoryService({ app }),
    equityAlertService: new EquityAlertService()
  });

  runtime.on("snapshot", (snapshot) => {
    broadcast("panel:snapshot", snapshot);
  });

  runtime.on("history-updated", (historyPayload) => {
    broadcast("history:updated", historyPayload);
  });

  runtime.on("alert", (alertPayload) => {
    flashMainWindowTemporarily();
    broadcast("alert:triggered", alertPayload);
  });

  registerIpc();
  await runtime.start();
  createMainWindow();
  writeStartupLog("runtime started");
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

app.on("before-quit", async () => {
  writeStartupLog("before-quit");
  await runtime?.dispose();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
