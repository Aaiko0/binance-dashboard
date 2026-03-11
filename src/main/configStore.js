const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ACCOUNT_ALIAS = "我的币安账户";
const ALERT_SOUND_OPTIONS = ["pulse", "alarm", "chime", "beacon", "siren", "cascade"];
const ALERT_REPEAT_OPTIONS = ["once", "triple", "until-closed"];
const LEGACY_ALIAS_MAP = new Map([
  ["閹存垹娈戠敮浣哥暔鐠愶附鍩?", DEFAULT_ACCOUNT_ALIAS],
  ["闁瑰瓨鍨瑰▓鎴犳暜娴ｅ摜鏆旈悹鎰堕檮閸?", DEFAULT_ACCOUNT_ALIAS]
]);

const DEFAULT_SETTINGS = {
  accountAlias: DEFAULT_ACCOUNT_ALIAS,
  apiKey: "",
  apiSecret: "",
  restBaseUrl: "https://fapi.binance.com",
  wsBaseUrl: "wss://fstream.binance.com",
  alwaysOnTop: true,
  recvWindow: 5000,
  equityAlertEnabled: false,
  equityAlertWindowMinutes: 15,
  equityAlertThresholdPercent: 3,
  equityAlertSound: "beacon",
  equityAlertVolume: 85,
  equityAlertRepeatMode: "triple"
};

function clampNumber(value, { min, max, fallback }) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, nextValue));
}

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

function normalizeAlertWindowMinutes(value) {
  const clamped = clampNumber(value, {
    min: 5,
    max: 1440,
    fallback: DEFAULT_SETTINGS.equityAlertWindowMinutes
  });

  return Math.max(5, Math.round(clamped / 5) * 5);
}

function normalizeAlertThresholdPercent(value) {
  return clampNumber(value, {
    min: 0.1,
    max: 100,
    fallback: DEFAULT_SETTINGS.equityAlertThresholdPercent
  });
}

function normalizeAlertSound(value) {
  const nextValue = String(value || "").trim().toLowerCase();
  return ALERT_SOUND_OPTIONS.includes(nextValue) ? nextValue : DEFAULT_SETTINGS.equityAlertSound;
}

function normalizeAlertVolume(value) {
  return Math.round(clampNumber(value, {
    min: 0,
    max: 100,
    fallback: DEFAULT_SETTINGS.equityAlertVolume
  }));
}

function normalizeAlertRepeatMode(value) {
  const nextValue = String(value || "").trim().toLowerCase();
  return ALERT_REPEAT_OPTIONS.includes(nextValue) ? nextValue : DEFAULT_SETTINGS.equityAlertRepeatMode;
}

function normalizeSettings(raw = {}) {
  return {
    accountAlias: normalizeAccountAlias(raw.accountAlias || DEFAULT_SETTINGS.accountAlias),
    apiKey: String(raw.apiKey || "").trim(),
    apiSecret: String(raw.apiSecret || "").trim(),
    restBaseUrl: normalizeBaseUrl(raw.restBaseUrl, DEFAULT_SETTINGS.restBaseUrl),
    wsBaseUrl: normalizeBaseUrl(raw.wsBaseUrl, DEFAULT_SETTINGS.wsBaseUrl),
    alwaysOnTop: raw.alwaysOnTop === undefined ? DEFAULT_SETTINGS.alwaysOnTop : Boolean(raw.alwaysOnTop),
    recvWindow: Math.round(clampNumber(raw.recvWindow, {
      min: 100,
      max: 60000,
      fallback: DEFAULT_SETTINGS.recvWindow
    })),
    equityAlertEnabled: Boolean(raw.equityAlertEnabled),
    equityAlertWindowMinutes: normalizeAlertWindowMinutes(raw.equityAlertWindowMinutes),
    equityAlertThresholdPercent: normalizeAlertThresholdPercent(raw.equityAlertThresholdPercent),
    equityAlertSound: normalizeAlertSound(raw.equityAlertSound),
    equityAlertVolume: normalizeAlertVolume(raw.equityAlertVolume),
    equityAlertRepeatMode: normalizeAlertRepeatMode(raw.equityAlertRepeatMode)
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
    recvWindow: settings.recvWindow,
    equityAlertEnabled: settings.equityAlertEnabled,
    equityAlertWindowMinutes: settings.equityAlertWindowMinutes,
    equityAlertThresholdPercent: settings.equityAlertThresholdPercent,
    equityAlertSound: settings.equityAlertSound,
    equityAlertVolume: settings.equityAlertVolume,
    equityAlertRepeatMode: settings.equityAlertRepeatMode
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
    const next = { ...current };

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

    if (Object.prototype.hasOwnProperty.call(partial, "equityAlertEnabled")) {
      next.equityAlertEnabled = partial.equityAlertEnabled;
    }

    if (Object.prototype.hasOwnProperty.call(partial, "equityAlertWindowMinutes")) {
      next.equityAlertWindowMinutes = partial.equityAlertWindowMinutes;
    }

    if (Object.prototype.hasOwnProperty.call(partial, "equityAlertThresholdPercent")) {
      next.equityAlertThresholdPercent = partial.equityAlertThresholdPercent;
    }

    if (Object.prototype.hasOwnProperty.call(partial, "equityAlertSound")) {
      next.equityAlertSound = partial.equityAlertSound;
    }

    if (Object.prototype.hasOwnProperty.call(partial, "equityAlertVolume")) {
      next.equityAlertVolume = partial.equityAlertVolume;
    }

    if (Object.prototype.hasOwnProperty.call(partial, "equityAlertRepeatMode")) {
      next.equityAlertRepeatMode = partial.equityAlertRepeatMode;
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
      recvWindow: settings.recvWindow,
      equityAlertEnabled: settings.equityAlertEnabled,
      equityAlertWindowMinutes: settings.equityAlertWindowMinutes,
      equityAlertThresholdPercent: settings.equityAlertThresholdPercent,
      equityAlertSound: settings.equityAlertSound,
      equityAlertVolume: settings.equityAlertVolume,
      equityAlertRepeatMode: settings.equityAlertRepeatMode
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
  ALERT_REPEAT_OPTIONS,
  ALERT_SOUND_OPTIONS,
  ConfigStore,
  DEFAULT_SETTINGS,
  sanitizeSettings
};
