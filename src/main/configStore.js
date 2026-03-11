const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ACCOUNT_ALIAS = "我的币安账户";
const LEGACY_ALIAS_MAP = new Map([
  ["鎴戠殑甯佸畨璐︽埛", DEFAULT_ACCOUNT_ALIAS],
  ["閹存垹娈戠敮浣哥暔鐠愶附鍩?", DEFAULT_ACCOUNT_ALIAS]
]);

const DEFAULT_SETTINGS = {
  accountAlias: DEFAULT_ACCOUNT_ALIAS,
  apiKey: "",
  apiSecret: "",
  restBaseUrl: "https://fapi.binance.com",
  wsBaseUrl: "wss://fstream.binance.com",
  alwaysOnTop: true,
  recvWindow: 5000
};

function normalizeBaseUrl(value, fallback) {
  const nextValue = String(value || fallback).trim() || fallback;
  return nextValue.replace(/\/+$/, "");
}

function normalizeAccountAlias(value) {
  const nextValue = String(value || "").trim();
  if (!nextValue) {
    return DEFAULT_ACCOUNT_ALIAS;
  }

  return LEGACY_ALIAS_MAP.get(nextValue) || nextValue;
}

function normalizeSettings(raw = {}) {
  return {
    accountAlias: normalizeAccountAlias(raw.accountAlias || DEFAULT_SETTINGS.accountAlias),
    apiKey: String(raw.apiKey || "").trim(),
    apiSecret: String(raw.apiSecret || "").trim(),
    restBaseUrl: normalizeBaseUrl(raw.restBaseUrl, DEFAULT_SETTINGS.restBaseUrl),
    wsBaseUrl: normalizeBaseUrl(raw.wsBaseUrl, DEFAULT_SETTINGS.wsBaseUrl),
    alwaysOnTop: raw.alwaysOnTop === undefined ? DEFAULT_SETTINGS.alwaysOnTop : Boolean(raw.alwaysOnTop),
    recvWindow: Number.isFinite(Number(raw.recvWindow))
      ? Math.max(100, Math.min(60000, Number(raw.recvWindow)))
      : DEFAULT_SETTINGS.recvWindow
  };
}

function sanitizeSettings(settings) {
  return {
    accountAlias: settings.accountAlias,
    apiKey: settings.apiKey,
    hasApiSecret: Boolean(settings.apiSecret),
    restBaseUrl: settings.restBaseUrl,
    wsBaseUrl: settings.wsBaseUrl,
    alwaysOnTop: settings.alwaysOnTop,
    recvWindow: settings.recvWindow
  };
}

function parseSettingsFile(filePath) {
  const rawText = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(rawText);
}

class ConfigStore {
  constructor({ app, safeStorage }) {
    this.app = app;
    this.safeStorage = safeStorage;
    this.filePath = path.join(app.getPath("userData"), "settings.json");
    this.cache = null;
  }

  load() {
    if (this.cache) {
      return { ...this.cache };
    }

    if (!fs.existsSync(this.filePath)) {
      this.cache = { ...DEFAULT_SETTINGS };
      return { ...this.cache };
    }

    let raw = {};

    try {
      raw = parseSettingsFile(this.filePath);
    } catch (_error) {
      this.cache = { ...DEFAULT_SETTINGS };
      return { ...this.cache };
    }

    const apiSecret = this.#readSecret(raw);
    const normalized = normalizeSettings({
      ...raw,
      apiSecret
    });

    this.cache = normalized;

    if (raw.accountAlias !== normalized.accountAlias) {
      this.#persist(normalized);
    }

    return { ...this.cache };
  }

  save(partial) {
    const current = this.load();
    const next = {
      ...current
    };

    if (Object.prototype.hasOwnProperty.call(partial, "accountAlias")) {
      next.accountAlias = partial.accountAlias;
    }

    if (Object.prototype.hasOwnProperty.call(partial, "apiKey")) {
      next.apiKey = partial.apiKey;
    }

    if (Object.prototype.hasOwnProperty.call(partial, "apiSecret")) {
      next.apiSecret = partial.apiSecret;
    }

    if (Object.prototype.hasOwnProperty.call(partial, "restBaseUrl")) {
      next.restBaseUrl = partial.restBaseUrl;
    }

    if (Object.prototype.hasOwnProperty.call(partial, "wsBaseUrl")) {
      next.wsBaseUrl = partial.wsBaseUrl;
    }

    if (Object.prototype.hasOwnProperty.call(partial, "alwaysOnTop")) {
      next.alwaysOnTop = partial.alwaysOnTop;
    }

    if (Object.prototype.hasOwnProperty.call(partial, "recvWindow")) {
      next.recvWindow = partial.recvWindow;
    }

    this.cache = normalizeSettings(next);
    this.#persist(this.cache);
    return { ...this.cache };
  }

  #persist(settings) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

    const payload = {
      version: 1,
      accountAlias: settings.accountAlias,
      apiKey: settings.apiKey,
      restBaseUrl: settings.restBaseUrl,
      wsBaseUrl: settings.wsBaseUrl,
      alwaysOnTop: settings.alwaysOnTop,
      recvWindow: settings.recvWindow
    };

    if (settings.apiSecret) {
      if (this.safeStorage.isEncryptionAvailable()) {
        payload.apiSecretEncrypted = this.safeStorage.encryptString(settings.apiSecret).toString("base64");
      } else {
        payload.apiSecretPlain = settings.apiSecret;
      }
    }

    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  #readSecret(raw) {
    if (raw.apiSecretEncrypted && this.safeStorage.isEncryptionAvailable()) {
      try {
        return this.safeStorage.decryptString(Buffer.from(raw.apiSecretEncrypted, "base64"));
      } catch (_error) {
        return "";
      }
    }

    return String(raw.apiSecretPlain || "");
  }
}

module.exports = {
  ConfigStore,
  DEFAULT_SETTINGS,
  sanitizeSettings
};
