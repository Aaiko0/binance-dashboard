const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const APP_ID = "binance-position-panel";
const PRODUCT_NAME = "币安持仓实时板";
const DEFAULT_PORT = 4580;
const PORT_RANGE_SIZE = 10;
const ROOT_DIRECTORY = path.resolve(__dirname, "..");
const SERVER_ENTRY = path.join(ROOT_DIRECTORY, "web-server.js");
const RUNTIME_DIRECTORY = path.join(ROOT_DIRECTORY, ".web-runtime");
const LAST_PORT_FILE = path.join(RUNTIME_DIRECTORY, "last-web-port.json");
const HEALTH_TIMEOUT_MS = 15000;
const HEALTH_RETRY_INTERVAL_MS = 400;

function sleep(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function ensureRuntimeDirectory() {
  fs.mkdirSync(RUNTIME_DIRECTORY, { recursive: true });
}

function readLastPort() {
  try {
    const payload = JSON.parse(fs.readFileSync(LAST_PORT_FILE, "utf8"));
    const port = Number(payload.port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch (_error) {
    return null;
  }
}

function writeLastPort(port) {
  ensureRuntimeDirectory();
  fs.writeFileSync(LAST_PORT_FILE, JSON.stringify({
    port,
    updatedAt: new Date().toISOString()
  }, null, 2), "utf8");
}

function requestMeta(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: "127.0.0.1",
      port,
      path: "/api/meta",
      timeout: timeoutMs
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8").trim();

        if (response.statusCode !== 200) {
          resolve({ status: "occupied", port });
          return;
        }

        try {
          const payload = JSON.parse(body);
          if (payload.appId === APP_ID) {
            resolve({ status: "running", port, payload });
            return;
          }

          resolve({ status: "occupied", port });
        } catch (_error) {
          resolve({ status: "occupied", port });
        }
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("timeout"));
    });

    request.on("error", (error) => {
      if (error.code === "ECONNREFUSED") {
        resolve({ status: "free", port });
        return;
      }

      resolve({ status: "occupied", port });
    });
  });
}

function buildPortCandidates() {
  const lastPort = readLastPort();
  const candidates = [];

  if (lastPort) {
    candidates.push(lastPort);
  }

  for (let offset = 0; offset < PORT_RANGE_SIZE; offset += 1) {
    const port = DEFAULT_PORT + offset;
    if (!candidates.includes(port)) {
      candidates.push(port);
    }
  }

  return candidates;
}

async function findRunningServer() {
  for (const port of buildPortCandidates()) {
    const probe = await requestMeta(port);
    if (probe.status === "running") {
      writeLastPort(port);
      return port;
    }
  }

  return null;
}

function startServerProcess(port) {
  ensureRuntimeDirectory();

  const outputPath = path.join(RUNTIME_DIRECTORY, "web-server.log");
  const outputHandle = fs.openSync(outputPath, "a");
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT_DIRECTORY,
    detached: true,
    stdio: ["ignore", outputHandle, outputHandle],
    env: {
      ...process.env,
      PORT: String(port)
    }
  });

  child.unref();
}

async function waitForHealthyServer(port, timeoutMs = HEALTH_TIMEOUT_MS) {
  const startAt = Date.now();
  while ((Date.now() - startAt) < timeoutMs) {
    const probe = await requestMeta(port, 1500);
    if (probe.status === "running") {
      writeLastPort(port);
      return true;
    }

    if (probe.status === "occupied") {
      return false;
    }

    await sleep(HEALTH_RETRY_INTERVAL_MS);
  }

  return false;
}

async function ensureServer() {
  const runningPort = await findRunningServer();
  if (runningPort) {
    return runningPort;
  }

  for (const port of buildPortCandidates()) {
    const probe = await requestMeta(port);
    if (probe.status !== "free") {
      continue;
    }

    startServerProcess(port);
    const ready = await waitForHealthyServer(port);
    if (ready) {
      return port;
    }
  }

  throw new Error(`无法为 ${PRODUCT_NAME} 找到可用的本地 Web 端口。`);
}

function openBrowser(url) {
  const child = spawn("cmd.exe", ["/c", "start", "", url], {
    cwd: ROOT_DIRECTORY,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function main() {
  const port = await ensureServer();
  openBrowser(`http://127.0.0.1:${port}/`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
