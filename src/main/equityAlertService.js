const { EventEmitter } = require("node:events");
const { SAMPLE_INTERVAL_MINUTES } = require("./equityHistoryService");

const SAMPLE_INTERVAL_MS = SAMPLE_INTERVAL_MINUTES * 60 * 1000;

function toNumber(value) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : 0;
}

function normalizeWindowMinutes(value) {
  const rounded = Math.round(toNumber(value) / SAMPLE_INTERVAL_MINUTES) * SAMPLE_INTERVAL_MINUTES;
  return Math.max(SAMPLE_INTERVAL_MINUTES, rounded || SAMPLE_INTERVAL_MINUTES);
}

function normalizeRepeatMode(value) {
  const nextValue = String(value || "").trim().toLowerCase();
  if (nextValue === "triple" || nextValue === "until-closed") {
    return nextValue;
  }

  return "once";
}

function findReferenceRecord(records, targetBucketStart) {
  const exactMatch = records.find((record) => record.bucketStart === targetBucketStart);
  if (exactMatch) {
    return exactMatch;
  }

  return [...records]
    .reverse()
    .find((record) => record.bucketStart < targetBucketStart && (targetBucketStart - record.bucketStart) <= SAMPLE_INTERVAL_MS);
}

class EquityAlertService extends EventEmitter {
  constructor() {
    super();
    this.lastAlertKeyByAccount = new Map();
  }

  evaluate(settings = {}, historyPayload = {}) {
    const accountId = historyPayload.accountId || "default";

    if (!settings.equityAlertEnabled) {
      this.lastAlertKeyByAccount.delete(accountId);
      return null;
    }

    const thresholdPercent = Math.abs(toNumber(settings.equityAlertThresholdPercent));
    const windowMinutes = normalizeWindowMinutes(settings.equityAlertWindowMinutes);
    const records = Array.isArray(historyPayload.records) ? historyPayload.records : [];

    if (thresholdPercent <= 0 || records.length < 2) {
      return null;
    }

    const latestRecord = records[records.length - 1];
    const targetBucketStart = latestRecord.bucketStart - (windowMinutes * 60 * 1000);
    const referenceRecord = findReferenceRecord(records, targetBucketStart);

    if (!referenceRecord || referenceRecord.bucketStart >= latestRecord.bucketStart) {
      return null;
    }

    const referenceEquity = toNumber(referenceRecord.totalMarginBalance);
    const latestEquity = toNumber(latestRecord.totalMarginBalance);
    if (referenceEquity <= 0 || latestEquity <= 0) {
      return null;
    }

    const delta = latestEquity - referenceEquity;
    const deltaPercent = (delta / referenceEquity) * 100;
    if (Math.abs(deltaPercent) < thresholdPercent) {
      return null;
    }

    const direction = delta >= 0 ? "up" : "down";
    const alertKey = [
      windowMinutes,
      thresholdPercent,
      latestRecord.bucketStart,
      direction
    ].join(":");

    if (this.lastAlertKeyByAccount.get(accountId) === alertKey) {
      return null;
    }

    this.lastAlertKeyByAccount.set(accountId, alertKey);

    const payload = {
      accountId,
      accountAlias: historyPayload.accountAlias || "",
      direction,
      windowMinutes,
      thresholdPercent,
      delta,
      deltaPercent,
      baselineEquity: referenceEquity,
      latestEquity,
      baselineBucketStart: referenceRecord.bucketStart,
      latestBucketStart: latestRecord.bucketStart,
      sound: settings.equityAlertSound || "beacon",
      volume: Math.max(0, Math.min(100, Math.round(toNumber(settings.equityAlertVolume)))),
      repeatMode: normalizeRepeatMode(settings.equityAlertRepeatMode)
    };

    this.emit("alert", payload);
    return payload;
  }
}

module.exports = {
  EquityAlertService
};
