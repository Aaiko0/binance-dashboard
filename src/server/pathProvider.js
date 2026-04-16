const os = require("node:os");
const path = require("node:path");

function createPathProvider(options = {}) {
  const userDataPath = options.userDataPath || path.join(os.homedir(), ".binance-position-panel-web");
  const exePath = options.exePath || process.execPath;

  return {
    getPath(name) {
      if (name === "userData") {
        return userDataPath;
      }

      if (name === "exe") {
        return exePath;
      }

      throw new Error(`Unsupported path key: ${name}`);
    }
  };
}

module.exports = {
  createPathProvider
};
