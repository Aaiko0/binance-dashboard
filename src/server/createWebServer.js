const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/web.html", "web.html"],
  ["/styles.css", "styles.css"],
  ["/renderer.js", "renderer.js"],
  ["/web-bridge.js", "web-bridge.js"],
  ["/equity-history.html", "equity-history.html"],
  ["/web-history.html", "web-history.html"],
  ["/equity-history.css", "equity-history.css"],
  ["/equity-history.js", "equity-history.js"],
  ["/web-history-bridge.js", "web-history-bridge.js"]
]);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function buildCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...buildCorsHeaders()
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, error) {
  sendJson(response, statusCode, {
    error: error.message || String(error)
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(text));
      } catch (_error) {
        reject(new Error("Request body is not valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function serveStaticFile(response, filePath) {
  if (!fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not Found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  fs.createReadStream(filePath).pipe(response);
}

function writeSseEvent(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createWebServer({ runtime, rootDirectory }) {
  const clients = new Set();

  const broadcast = (eventName, payload) => {
    for (const client of clients) {
      writeSseEvent(client, eventName, payload);
    }
  };

  runtime.on("snapshot", (payload) => broadcast("snapshot", payload));
  runtime.on("history-updated", (payload) => broadcast("history-updated", payload));
  runtime.on("alert", (payload) => broadcast("alert", payload));

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");

    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, buildCorsHeaders());
        response.end();
        return;
      }

      if (requestUrl.pathname === "/api/meta" && request.method === "GET") {
        sendJson(response, 200, {
          appId: "binance-position-panel",
          productName: "币安持仓实时板",
          platform: "web",
          capabilities: {
            alwaysOnTop: false,
            folderAccess: false,
            windowControls: false
          }
        });
        return;
      }

      if (requestUrl.pathname === "/api/events" && request.method === "GET") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*"
        });

        response.write(": connected\n\n");
        clients.add(response);
        writeSseEvent(response, "snapshot", runtime.getSnapshot());
        writeSseEvent(response, "history-updated", runtime.getHistory());

        request.on("close", () => {
          clients.delete(response);
        });
        return;
      }

      if (requestUrl.pathname === "/api/settings" && request.method === "GET") {
        sendJson(response, 200, runtime.getSettings());
        return;
      }

      if (requestUrl.pathname === "/api/settings" && request.method === "POST") {
        const payload = await readBody(request);
        sendJson(response, 200, await runtime.saveSettings(payload));
        return;
      }

      if (requestUrl.pathname === "/api/state" && request.method === "GET") {
        sendJson(response, 200, runtime.getSnapshot());
        return;
      }

      if (requestUrl.pathname === "/api/refresh" && request.method === "POST") {
        sendJson(response, 200, await runtime.refresh());
        return;
      }

      if (requestUrl.pathname === "/api/history" && request.method === "GET") {
        sendJson(response, 200, runtime.getHistory());
        return;
      }

      if (requestUrl.pathname === "/api/history/export" && request.method === "GET") {
        const intervalMinutes = Number(requestUrl.searchParams.get("intervalMinutes")) || 15;
        const exportData = runtime.exportHistoryCsv(intervalMinutes);
        response.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(exportData.defaultFileName)}"`,
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*"
        });
        response.end(exportData.csvText);
        return;
      }

      if (requestUrl.pathname === "/api/history/storage" && request.method === "GET") {
        sendJson(response, 200, {
          directory: runtime.getHistoryStorageDirectory()
        });
        return;
      }

      const fileName = STATIC_FILES.get(requestUrl.pathname);
      if (fileName) {
        serveStaticFile(response, path.join(rootDirectory, fileName));
        return;
      }

      response.writeHead(404);
      response.end("Not Found");
    } catch (error) {
      sendError(response, 500, error);
    }
  });

  return server;
}

module.exports = {
  createWebServer
};
