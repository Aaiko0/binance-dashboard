const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const HISTORY_FILE_NAME = "equity-history.json";
const SAMPLE_INTERVAL_MINUTES = 5;
const MAX_LOCAL_RETENTION_DAYS = 365;
const MAX_LOCAL_RECORDS = (MAX_LOCAL_RETENTION_DAYS * 24 * 60) / SAMPLE_INTERVAL_MINUTES;

function toNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function resolveTimestamp(value, fallback = Date.now()) {
  const next = new Date(value || fallback).valueOf();
  return Number.isFinite(next) ? next : fallback;
}

function ensureDirectoryWritable(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
  const probePath = path.join(directoryPath, `.write-probe-${process.pid}`);
  fs.writeFileSync(probePath, "ok", "utf8");
  fs.unlinkSync(probePath);
}

function sanitizeRecords(records = []) {
  return records
    .map((record) => ({
      bucketStart: resolveTimestamp(record.bucketStart),
      recordedAt: record.recordedAt || new Date(resolveTimestamp(record.bucketStart)).toISOString(),
      totalMarginBalance: toNumber(record.totalMarginBalance),
      walletBalance: toNumber(record.walletBalance),
      availableBalance: toNumber(record.availableBalance),
      totalUnrealizedProfit: toNumber(record.totalUnrealizedProfit),
      positionCount: Math.max(0, Math.trunc(toNumber(record.positionCount)))
    }))
    .sort((left, right) => left.bucketStart - right.bucketStart);
}

function trimRecords(records = []) {
  const cutoff = Date.now() - (MAX_LOCAL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const filtered = records.filter((record) => record.bucketStart >= cutoff);

  if (filtered.length <= MAX_LOCAL_RECORDS) {
    return filtered;
  }

  return filtered.slice(filtered.length - MAX_LOCAL_RECORDS);
}

function buildAccountId(settings) {
  return crypto.createHash("sha1")
    .update(String(settings.apiKey || settings.accountAlias || "default"))
    .digest("hex")
    .slice(0, 12);
}

function buildEmptyHistory(settings, accountId) {
  return {
    version: 1,
    accountId,
    accountAlias: settings.accountAlias || "我的币安账户",
    sampleIntervalMinutes: SAMPLE_INTERVAL_MINUTES,
    records: []
  };
}

class EquityHistoryRepository {
  getContext(_settings) {
    throw new Error("getContext is not implemented");
  }

  load(_context, _settings) {
    throw new Error("load is not implemented");
  }

  save(_context, _history) {
    throw new Error("save is not implemented");
  }
}

class LocalEquityHistoryRepository extends EquityHistoryRepository {
  constructor({ app }) {
    super();
    this.app = app;
    this.cache = new Map();
  }

  getContext(settings) {
    const accountId = buildAccountId(settings);
    const baseDirectory = path.join(this.app.getPath("userData"), "data", "equity-history");
    ensureDirectoryWritable(baseDirectory);

    const accountDirectory = path.join(baseDirectory, accountId);
    ensureDirectoryWritable(accountDirectory);

    return {
      accountId,
      backend: "local-fs",
      cloudReady: true,
      accountDirectory,
      filePath: path.join(accountDirectory, HISTORY_FILE_NAME)
    };
  }

  load(context, settings) {
    const cached = this.cache.get(context.filePath);
    if (cached) {
      return cached;
    }

    let history = buildEmptyHistory(settings, context.accountId);
    this.#migrateLegacyFileIfNeeded(context);

    if (fs.existsSync(context.filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(context.filePath, "utf8").replace(/^\uFEFF/, ""));
        history = {
          ...history,
          ...raw,
          records: trimRecords(sanitizeRecords(raw.records))
        };
      } catch (_error) {
        history = buildEmptyHistory(settings, context.accountId);
      }
    }

    this.cache.set(context.filePath, history);
    return history;
  }

  save(context, history) {
    const payload = {
      ...history,
      records: trimRecords(sanitizeRecords(history.records))
    };

    fs.mkdirSync(context.accountDirectory, { recursive: true });
    fs.writeFileSync(context.filePath, JSON.stringify(payload, null, 2), "utf8");
    this.cache.set(context.filePath, payload);
    return payload;
  }

  #migrateLegacyFileIfNeeded(context) {
    if (fs.existsSync(context.filePath)) {
      return;
    }

    const legacyFilePath = path.join(path.dirname(this.app.getPath("exe")), "data", "equity-history", context.accountId, HISTORY_FILE_NAME);
    if (!fs.existsSync(legacyFilePath) || legacyFilePath === context.filePath) {
      return;
    }

    fs.mkdirSync(path.dirname(context.filePath), { recursive: true });
    fs.copyFileSync(legacyFilePath, context.filePath);
  }
}

function createEquityHistoryRepository(options) {
  return new LocalEquityHistoryRepository(options);
}

module.exports = {
  EquityHistoryRepository,
  LocalEquityHistoryRepository,
  createEquityHistoryRepository,
  buildEmptyHistory,
  SAMPLE_INTERVAL_MINUTES,
  MAX_LOCAL_RETENTION_DAYS
};
