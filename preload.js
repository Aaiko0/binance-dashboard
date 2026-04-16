const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = {
  alert: "alert:triggered",
  history: "history:updated",
  snapshot: "panel:snapshot"
};

const capabilities = Object.freeze({
  alwaysOnTop: true,
  folderAccess: true,
  windowControls: true
});

contextBridge.exposeInMainWorld("binancePanel", {
  platform: "electron",
  capabilities,
  getSettings: () => ipcRenderer.invoke("panel:get-settings"),
  getDefaultSettings: () => ipcRenderer.invoke("panel:get-default-settings"),
  getState: () => ipcRenderer.invoke("panel:get-state"),
  saveSettings: (payload) => ipcRenderer.invoke("panel:save-settings", payload),
  refresh: () => ipcRenderer.invoke("panel:refresh"),
  openEquityHistoryWindow: () => ipcRenderer.invoke("history:open-window"),
  getEquityHistory: () => ipcRenderer.invoke("history:get-data"),
  exportEquityHistory: (intervalMinutes) => ipcRenderer.invoke("history:export", { intervalMinutes }),
  openEquityHistoryFolder: () => ipcRenderer.invoke("history:open-folder"),
  setAlwaysOnTop: (value) => ipcRenderer.invoke("window:set-always-on-top", value),
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  quitApp: () => ipcRenderer.send("app:quit"),
  onSnapshot: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(CHANNELS.snapshot, listener);
    return () => ipcRenderer.removeListener(CHANNELS.snapshot, listener);
  },
  onEquityHistoryUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(CHANNELS.history, listener);
    return () => ipcRenderer.removeListener(CHANNELS.history, listener);
  },
  onEquityAlert: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(CHANNELS.alert, listener);
    return () => ipcRenderer.removeListener(CHANNELS.alert, listener);
  }
});
