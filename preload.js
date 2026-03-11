const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("binancePanel", {
  getSettings: () => ipcRenderer.invoke("panel:get-settings"),
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
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("panel:snapshot", listener);
    return () => {
      ipcRenderer.removeListener("panel:snapshot", listener);
    };
  },
  onEquityHistoryUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("history:updated", listener);
    return () => {
      ipcRenderer.removeListener("history:updated", listener);
    };
  }
});
