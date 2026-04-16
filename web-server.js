const path = require("node:path");
const { ConfigStore } = require("./src/main/configStore");
const { BinancePositionsService } = require("./src/main/binanceService");
const { EquityAlertService } = require("./src/main/equityAlertService");
const { EquityHistoryService } = require("./src/main/equityHistoryService");
const { PanelRuntime } = require("./src/server/panelRuntime");
const { createPathProvider } = require("./src/server/pathProvider");
const { createWebServer } = require("./src/server/createWebServer");

function createPlainSafeStorage() {
  return {
    isEncryptionAvailable() {
      return false;
    },
    encryptString(value) {
      return Buffer.from(String(value), "utf8");
    },
    decryptString(value) {
      return Buffer.isBuffer(value) ? value.toString("utf8") : Buffer.from(value).toString("utf8");
    }
  };
}

async function bootstrap() {
  const port = Number(process.env.PORT) || 4580;
  const appPaths = createPathProvider({
    userDataPath: path.join(process.cwd(), ".web-runtime")
  });

  const runtime = new PanelRuntime({
    configStore: new ConfigStore({
      app: appPaths,
      safeStorage: createPlainSafeStorage()
    }),
    positionsService: new BinancePositionsService(),
    equityHistoryService: new EquityHistoryService({ app: appPaths }),
    equityAlertService: new EquityAlertService()
  });

  await runtime.start();

  const server = createWebServer({
    runtime,
    rootDirectory: __dirname
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Web panel running at http://127.0.0.1:${port}`);
  });

  const shutdown = async () => {
    server.close();
    await runtime.dispose();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
