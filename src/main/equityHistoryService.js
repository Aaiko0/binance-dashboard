const { EventEmitter } = require("node:events");
const {
  createEquityHistoryRepository,
  buildEmptyHistory,
  SAMPLE_INTERVAL_MINUTES,
  MAX_LOCAL_RETENTION_DAYS
} = require("./equityHistoryRepository");

const SAMPLE_INTERVAL_MS = SAMPLE_INTERVAL_MINUTES * 60 * 1000;
const EXPORT_INTERVAL_OPTIONS = [5, 10, 15, 20, 30, 60, 120, 240];

function toNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function cloneHistoryPayload(payload) {
  return {
    ...payload,
    records: payload.records.map((record) => ({ ...record }))
  };
}

function sanitizeIntervalMinutes(value) {
  const intervalMinutes = Math.max(SAMPLE_INTERVAL_MINUTES, Math.trunc(toNumber(value)));
  if (intervalMinutes % SAMPLE_INTERVAL_MINUTES !== 0) {
    throw new Error(`导出间隔必须是 ${SAMPLE_INTERVAL_MINUTES} 分钟的倍数`);
  }

  return intervalMinutes;
}

function aggregateRecords(records, intervalMinutes) {
  const normalizedIntervalMinutes = sanitizeIntervalMinutes(intervalMinutes);
  const intervalMs = normalizedIntervalMinutes * 60 * 1000;

  if (intervalMs === SAMPLE_INTERVAL_MS) {
    return records.map((record) => ({ ...record }));
  }

  const bucketMap = new Map();

  for (const record of records) {
    const exportBucketStart = Math.floor(record.bucketStart / intervalMs) * intervalMs;
    const current = bucketMap.get(exportBucketStart);

    if (!current || record.bucketStart > current.bucketStart) {
      bucketMap.set(exportBucketStart, {
        ...record,
        bucketStart: exportBucketStart,
        aggregatedFrom: normalizedIntervalMinutes
      });
    }
  }

  return Array.from(bucketMap.values()).sort((left, right) => left.bucketStart - right.bucketStart);
}

class EquityHistoryService extends EventEmitter {
  constructor({ app, repository } = {}) {
    super();
    this.repository = repository || createEquityHistoryRepository({ app });
    this.latestSettings = null;
    this.latestSnapshot = null;
    this.captureTimer = null;
  }

  start() {
    this.scheduleNextCapture();
  }

  dispose() {
    clearTimeout(this.captureTimer);
    this.captureTimer = null;
  }

  noteSnapshot(settings, snapshot) {
    this.latestSettings = settings ? { ...settings } : null;
    this.latestSnapshot = snapshot
      ? {
          ...snapshot,
          positions: Array.isArray(snapshot.positions) ? snapshot.positions.map((position) => ({ ...position })) : []
        }
      : null;
  }

  getHistory(settings, currentSnapshot = null) {
    if (!settings?.apiKey) {
      return this.buildPayload(null, buildEmptyHistory(settings || {}, "default"), currentSnapshot);
    }

    const context = this.repository.getContext(settings);
    const history = this.repository.load(context, settings);
    return this.buildPayload(context, history, currentSnapshot);
  }

  exportHistoryCsv(settings, intervalMinutes) {
    const historyPayload = this.getHistory(settings, this.latestSnapshot);
    const aggregatedRecords = aggregateRecords(historyPayload.records, intervalMinutes);
    const rows = [
      ["北京时间", "时间戳 ISO", "净值(USDT)", "钱包余额", "可用余额", "总浮盈亏", "持仓数"]
    ];

    for (const record of aggregatedRecords) {
      rows.push([
        new Date(record.bucketStart).toLocaleString("zh-CN", { hour12: false }),
        record.recordedAt,
        record.totalMarginBalance.toFixed(2),
        record.walletBalance.toFixed(2),
        record.availableBalance.toFixed(2),
        record.totalUnrealizedProfit.toFixed(2),
        String(record.positionCount)
      ]);
    }

    const accountLabel = historyPayload.accountAlias || historyPayload.accountId || "account";
    const exportFileName = `净值历史-${accountLabel}-${intervalMinutes}m.csv`.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");

    return {
      defaultFileName: exportFileName,
      csvText: `\uFEFF${rows.map((row) => row.join(",")).join("\n")}`
    };
  }

  getStorageDirectory(settings) {
    return this.repository.getContext(settings).accountDirectory;
  }

  getExportIntervalOptions() {
    return [...EXPORT_INTERVAL_OPTIONS];
  }

  scheduleNextCapture() {
    clearTimeout(this.captureTimer);
    const now = Date.now();
    const remainder = now % SAMPLE_INTERVAL_MS;
    const delay = remainder === 0 ? SAMPLE_INTERVAL_MS : SAMPLE_INTERVAL_MS - remainder;

    this.captureTimer = setTimeout(() => {
      this.captureTimer = null;

      try {
        this.captureLatestSnapshot();
      } finally {
        this.scheduleNextCapture();
      }
    }, delay);
  }

  captureLatestSnapshot() {
    if (!this.latestSettings?.apiKey || !this.latestSnapshot) {
      return null;
    }

    return this.recordSnapshot(this.latestSettings, this.latestSnapshot, Date.now());
  }

  recordSnapshot(settings, snapshot, captureTimestamp = Date.now()) {
    if (!settings?.apiKey || !settings?.apiSecret) {
      return null;
    }

    if (snapshot.status !== "live") {
      return null;
    }

    const totalMarginBalance = Number(snapshot.totalMarginBalance);
    if (!Number.isFinite(totalMarginBalance)) {
      return null;
    }

    const context = this.repository.getContext(settings);
    const history = this.repository.load(context, settings);
    const bucketStart = Math.floor(captureTimestamp / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS;
    const nextRecord = {
      bucketStart,
      recordedAt: new Date(captureTimestamp).toISOString(),
      totalMarginBalance: toNumber(snapshot.totalMarginBalance),
      walletBalance: toNumber(snapshot.walletBalance),
      availableBalance: toNumber(snapshot.availableBalance),
      totalUnrealizedProfit: toNumber(snapshot.totalUnrealizedProfit),
      positionCount: Math.max(0, Math.trunc(toNumber(snapshot.positionCount)))
    };

    history.accountAlias = settings.accountAlias || history.accountAlias;
    const lastRecord = history.records[history.records.length - 1];
    let changed = false;

    if (!lastRecord || lastRecord.bucketStart < bucketStart) {
      history.records.push(nextRecord);
      changed = true;
    } else if (lastRecord.bucketStart === bucketStart) {
      const changedFields = [
        "recordedAt",
        "totalMarginBalance",
        "walletBalance",
        "availableBalance",
        "totalUnrealizedProfit",
        "positionCount"
      ];

      if (changedFields.some((field) => lastRecord[field] !== nextRecord[field])) {
        history.records[history.records.length - 1] = nextRecord;
        changed = true;
      }
    }

    if (!changed) {
      return null;
    }

    const persistedHistory = this.repository.save(context, history);
    const payload = this.buildPayload(context, persistedHistory, snapshot);
    this.emit("history-updated", payload);
    return payload;
  }

  buildPayload(context, history, currentSnapshot = null) {
    const nextCaptureTimestamp = this.getNextCaptureTimestamp();

    return {
      accountId: history.accountId,
      accountAlias: history.accountAlias,
      sampleIntervalMinutes: SAMPLE_INTERVAL_MINUTES,
      exportIntervalOptions: this.getExportIntervalOptions(),
      retentionDays: MAX_LOCAL_RETENTION_DAYS,
      storageBackend: context?.backend || "memory",
      cloudReady: context?.cloudReady ?? false,
      storageDirectory: context?.accountDirectory || "",
      filePath: context?.filePath || "",
      nextCaptureAt: new Date(nextCaptureTimestamp).toISOString(),
      currentEquity: toNumber(currentSnapshot?.totalMarginBalance),
      currentUpdatedAt: currentSnapshot?.updatedAt || "",
      records: cloneHistoryPayload(history).records
    };
  }

  getNextCaptureTimestamp() {
    const now = Date.now();
    const remainder = now % SAMPLE_INTERVAL_MS;
    if (remainder === 0) {
      return now + SAMPLE_INTERVAL_MS;
    }

    return now + (SAMPLE_INTERVAL_MS - remainder);
  }
}

module.exports = {
  EquityHistoryService,
  SAMPLE_INTERVAL_MINUTES,
  EXPORT_INTERVAL_OPTIONS,
  aggregateRecords
};
