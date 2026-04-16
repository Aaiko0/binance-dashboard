(function initBridgeLoader() {
  function resolveApiOrigin() {
    if (window.BINANCE_PANEL_API_ORIGIN) {
      return String(window.BINANCE_PANEL_API_ORIGIN).replace(/\/+$/, "");
    }

    const currentUrl = new URL(window.location.href);
    const queryOrigin = currentUrl.searchParams.get("apiOrigin");
    if (queryOrigin) {
      return queryOrigin.replace(/\/+$/, "");
    }

    if (window.location.protocol === "file:") {
      return "http://127.0.0.1:4580";
    }

    return window.location.origin.replace(/\/+$/, "");
  }

  const apiOrigin = resolveApiOrigin();

  function extractFileName(dispositionHeader) {
    if (!dispositionHeader) {
      return "equity-history.csv";
    }

    const utf8Match = dispositionHeader.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) {
      return decodeURIComponent(utf8Match[1]);
    }

    const simpleMatch = dispositionHeader.match(/filename="?([^"]+)"?/i);
    if (simpleMatch) {
      return decodeURIComponent(simpleMatch[1]);
    }

    return "equity-history.csv";
  }

  async function requestJson(pathname, options = {}) {
    const response = await fetch(`${apiOrigin}${pathname}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `${pathname} request failed`);
    }

    return payload;
  }

  function createWebBridge() {
    const listeners = {
      alert: new Set(),
      history: new Set(),
      snapshot: new Set()
    };

    let eventSource = null;

    function emit(type, payload) {
      for (const listener of listeners[type]) {
        listener(payload);
      }
    }

    function ensureEventSource() {
      if (eventSource || typeof EventSource !== "function") {
        return;
      }

      eventSource = new EventSource(`${apiOrigin}/api/events`);
      eventSource.addEventListener("snapshot", (event) => emit("snapshot", JSON.parse(event.data)));
      eventSource.addEventListener("history-updated", (event) => emit("history", JSON.parse(event.data)));
      eventSource.addEventListener("alert", (event) => emit("alert", JSON.parse(event.data)));
    }

    function addListener(type, callback) {
      ensureEventSource();
      listeners[type].add(callback);
      return () => listeners[type].delete(callback);
    }

    return {
      platform: "web",
      capabilities: {
        alwaysOnTop: false,
        folderAccess: false,
        windowControls: false
      },
      getSettings() {
        return requestJson("/api/settings");
      },
      getState() {
        return requestJson("/api/state");
      },
      saveSettings(payload) {
        return requestJson("/api/settings", {
          method: "POST",
          body: payload
        });
      },
      refresh() {
        return requestJson("/api/refresh", {
          method: "POST"
        });
      },
      openEquityHistoryWindow() {
        const nextUrl = window.location.protocol === "file:"
          ? new URL("./web-history.html", window.location.href)
          : new URL("/equity-history.html", apiOrigin);

        nextUrl.searchParams.set("apiOrigin", apiOrigin);
        window.open(nextUrl.toString(), "binance-equity-history", "width=1040,height=700");
        return Promise.resolve(true);
      },
      getEquityHistory() {
        return requestJson("/api/history");
      },
      async exportEquityHistory(intervalMinutes) {
        const response = await fetch(`${apiOrigin}/api/history/export?intervalMinutes=${encodeURIComponent(intervalMinutes)}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "导出失败");
        }

        const blob = await response.blob();
        const fileName = extractFileName(response.headers.get("content-disposition"));
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(objectUrl);

        return {
          canceled: false,
          filePath: fileName
        };
      },
      async openEquityHistoryFolder() {
        const payload = await requestJson("/api/history/storage");
        return payload.directory;
      },
      async setAlwaysOnTop() {
        const settings = await requestJson("/api/settings");
        return {
          ...settings,
          alwaysOnTop: false
        };
      },
      minimizeWindow() {},
      closeWindow() {
        window.close();
      },
      quitApp() {
        window.close();
      },
      onSnapshot(callback) {
        return addListener("snapshot", callback);
      },
      onEquityHistoryUpdated(callback) {
        return addListener("history", callback);
      },
      onEquityAlert(callback) {
        return addListener("alert", callback);
      }
    };
  }

  window.__loadBinanceWebBridge = function loadBinanceWebBridge() {
    if (!window.binancePanel) {
      window.binancePanel = createWebBridge();
    }
  };

  window.__loadBinanceWebBridge();
})();
