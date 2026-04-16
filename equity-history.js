const RANGE_STORAGE_KEY = "binance-panel.history-range";
const METRIC_STORAGE_KEY = "binance-panel.history-metric";
const EXPORT_INTERVAL_STORAGE_KEY = "binance-panel.export-interval";

const RANGE_WINDOW_MS = Object.freeze({
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "180d": 180 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
  all: Number.POSITIVE_INFINITY
});

const METRIC_DEFINITIONS = Object.freeze({
  totalReturn: {
    label: "总收益率",
    summaryLabel: "当前总收益率",
    summaryDetail: "相对首条净值记录计算。",
    axisTitle: "收益率 %",
    kind: "percent",
    useSignedSummary: true
  },
  accountAsset: {
    label: "账户资产",
    summaryLabel: "当前账户资产",
    summaryDetail: "按账户总权益显示。",
    axisTitle: "资产 USDT",
    kind: "money",
    useSignedSummary: false
  },
  cumulativeProfit: {
    label: "累计收益",
    summaryLabel: "当前累计收益",
    summaryDetail: "相对首条净值记录计算。",
    axisTitle: "收益 USDT",
    kind: "money",
    useSignedSummary: true
  },
  monthlyReturn: {
    label: "月收益率",
    summaryLabel: "当前月收益率",
    summaryDetail: "按自然月首条净值记录计算。",
    axisTitle: "月收益率 %",
    kind: "percent",
    useSignedSummary: true
  }
});

const DEFAULT_RANGE = "30d";
const DEFAULT_METRIC = "accountAsset";

const bridge = window.binancePanel;
const urlParams = new URLSearchParams(window.location.search);
const isEmbedded = urlParams.get("embed") === "1";

const dom = {
  metricGroup: document.querySelector("#metricGroup"),
  summaryLabel: document.querySelector("#summaryLabel"),
  summaryValue: document.querySelector("#summaryValue"),
  summaryDetail: document.querySelector("#summaryDetail"),
  selectedPointTime: document.querySelector("#selectedPointTime"),
  selectedPointDetail: document.querySelector("#selectedPointDetail"),
  rangeGroup: document.querySelector("#rangeGroup"),
  exportIntervalInput: document.querySelector("#exportIntervalInput"),
  exportButton: document.querySelector("#exportButton"),
  openFolderButton: document.querySelector("#openFolderButton"),
  refreshButton: document.querySelector("#refreshButton"),
  minimizeButton: document.querySelector("#minimizeButton"),
  closeButton: document.querySelector("#closeButton"),
  rangeDelta: document.querySelector("#rangeDelta"),
  storagePath: document.querySelector("#storagePath"),
  chartEmpty: document.querySelector("#chartEmpty"),
  chartEmptyHint: document.querySelector("#chartEmptyHint"),
  chartCanvasWrap: document.querySelector("#chartCanvasWrap"),
  chartStage: document.querySelector(".chart-stage"),
  chartTooltip: document.querySelector("#chartTooltip"),
  chartSvg: document.querySelector("#chartSvg"),
  axisYTitle: document.querySelector("#axisYTitle"),
  axisYTop: document.querySelector("#axisYTop"),
  axisYMid: document.querySelector("#axisYMid"),
  axisYBottom: document.querySelector("#axisYBottom"),
  axisXTicks: document.querySelector("#axisXTicks"),
  recordsList: document.querySelector("#recordsList"),
  recordCountHint: document.querySelector("#recordCountHint"),
  statusMessage: document.querySelector("#statusMessage")
};

const state = {
  range: loadStoredRange(),
  metric: loadStoredMetric(),
  history: null,
  snapshot: null,
  selectedBucketStart: null
};

function loadStoredRange() {
  const value = window.localStorage.getItem(RANGE_STORAGE_KEY);
  return Object.prototype.hasOwnProperty.call(RANGE_WINDOW_MS, value) ? value : DEFAULT_RANGE;
}

function loadStoredMetric() {
  const value = window.localStorage.getItem(METRIC_STORAGE_KEY);
  return Object.prototype.hasOwnProperty.call(METRIC_DEFINITIONS, value) ? value : DEFAULT_METRIC;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }

  return number.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatSignedMoney(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }

  return `${number > 0 ? "+" : ""}${formatMoney(number, digits)}`;
}

function formatPercent(value, digits = 2, { signed = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }

  const prefix = signed && number > 0 ? "+" : "";
  return `${prefix}${number.toFixed(digits)}%`;
}

function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "--";
  }

  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatAxisTime(value) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "--";
  }

  if (state.range === "24h") {
    return date.toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  if (state.range === "7d" || state.range === "30d") {
    return `${date.toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit"
    })}\n${date.toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    })}`;
  }

  if (state.range === "90d" || state.range === "180d" || state.range === "1y") {
    return date.toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit"
    });
  }

  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function setStatus(message) {
  dom.statusMessage.textContent = message;
}

function getMetricDefinition(metricKey = state.metric) {
  return METRIC_DEFINITIONS[metricKey] || METRIC_DEFINITIONS[DEFAULT_METRIC];
}

function getMonthKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

function buildMetricContext(rawRecords) {
  const monthAnchors = new Map();

  for (const record of rawRecords) {
    const monthKey = getMonthKey(record.bucketStart);
    if (!monthAnchors.has(monthKey)) {
      monthAnchors.set(monthKey, toNumber(record.totalMarginBalance));
    }
  }

  return {
    firstAsset: rawRecords.length ? toNumber(rawRecords[0].totalMarginBalance) : null,
    monthAnchors
  };
}

function computeMetricValues(assetValue, bucketStart, context) {
  const asset = toNumber(assetValue, NaN);
  if (!Number.isFinite(asset)) {
    return {
      totalReturn: NaN,
      accountAsset: NaN,
      cumulativeProfit: NaN,
      monthlyReturn: NaN
    };
  }

  const firstAsset = Number.isFinite(context.firstAsset) ? context.firstAsset : asset;
  const monthAnchor = context.monthAnchors.get(getMonthKey(bucketStart));
  const monthlyBase = Number.isFinite(monthAnchor) ? monthAnchor : asset;

  return {
    totalReturn: firstAsset > 0 ? ((asset - firstAsset) / firstAsset) * 100 : 0,
    accountAsset: asset,
    cumulativeProfit: asset - firstAsset,
    monthlyReturn: monthlyBase > 0 ? ((asset - monthlyBase) / monthlyBase) * 100 : 0
  };
}

function buildDerivedSeries(rawRecords) {
  const context = buildMetricContext(rawRecords);

  return {
    context,
    records: rawRecords.map((record) => ({
      ...record,
      metrics: computeMetricValues(record.totalMarginBalance, record.bucketStart, context)
    }))
  };
}

function buildLiveSnapshotPoint(context) {
  const totalMarginBalance = Number(state.snapshot?.totalMarginBalance);
  if (!Number.isFinite(totalMarginBalance)) {
    return null;
  }

  const timestamp = new Date(state.snapshot?.updatedAt || Date.now()).valueOf();
  const bucketStart = Number.isFinite(timestamp) ? timestamp : Date.now();

  return {
    bucketStart,
    recordedAt: state.snapshot?.updatedAt || new Date(bucketStart).toISOString(),
    totalMarginBalance,
    walletBalance: toNumber(state.snapshot?.walletBalance),
    availableBalance: toNumber(state.snapshot?.availableBalance),
    totalUnrealizedProfit: toNumber(state.snapshot?.totalUnrealizedProfit),
    positionCount: Math.max(0, Math.trunc(toNumber(state.snapshot?.positionCount))),
    metrics: computeMetricValues(totalMarginBalance, bucketStart, context)
  };
}

function getMetricValue(record, metricKey = state.metric) {
  return record?.metrics?.[metricKey];
}

function getFilteredRecords(records) {
  const windowMs = RANGE_WINDOW_MS[state.range] ?? RANGE_WINDOW_MS[DEFAULT_RANGE];
  if (!Number.isFinite(windowMs)) {
    return records;
  }

  const cutoff = Date.now() - windowMs;
  return records.filter((record) => record.bucketStart >= cutoff);
}

function updateMetricButtons() {
  const buttons = dom.metricGroup.querySelectorAll(".metric-button");
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.metric === state.metric);
  });
}

function updateRangeButtons() {
  const buttons = dom.rangeGroup.querySelectorAll(".range-button");
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.range === state.range);
  });
}

function ensureSelectedRecord(records) {
  if (!records.length) {
    state.selectedBucketStart = null;
    return null;
  }

  const matched = records.find((record) => record.bucketStart === state.selectedBucketStart);
  if (matched) {
    return matched;
  }

  const fallback = records[records.length - 1];
  state.selectedBucketStart = fallback.bucketStart;
  return fallback;
}

function formatMetricValue(metricKey, value, { signed = false } = {}) {
  const definition = getMetricDefinition(metricKey);
  if (definition.kind === "percent") {
    return formatPercent(value, 2, { signed });
  }

  return signed ? formatSignedMoney(value, 2) : formatMoney(value, 2);
}

function setSummaryTone(metricValue) {
  dom.summaryValue.classList.remove("positive", "negative");

  if (!Number.isFinite(metricValue) || state.metric === "accountAsset") {
    return;
  }

  if (metricValue > 0) {
    dom.summaryValue.classList.add("positive");
  } else if (metricValue < 0) {
    dom.summaryValue.classList.add("negative");
  }
}

function renderSummary(context, derivedRecords) {
  const definition = getMetricDefinition();
  const fallbackPoint = derivedRecords[derivedRecords.length - 1] || null;
  const livePoint = buildLiveSnapshotPoint(context) || fallbackPoint;
  const metricValue = getMetricValue(livePoint, state.metric);

  dom.summaryLabel.textContent = definition.summaryLabel;
  dom.summaryValue.textContent = formatMetricValue(state.metric, metricValue, {
    signed: definition.useSignedSummary
  });
  dom.summaryDetail.textContent = definition.summaryDetail;
  setSummaryTone(metricValue);
}

function renderDelta(records) {
  if (!records.length) {
    dom.rangeDelta.textContent = "--";
    dom.rangeDelta.style.color = "var(--ink)";
    return;
  }

  const firstRecord = records[0];
  const lastRecord = records[records.length - 1];
  const firstValue = getMetricValue(firstRecord, state.metric);
  const lastValue = getMetricValue(lastRecord, state.metric);
  const definition = getMetricDefinition();

  let deltaText = "--";
  let deltaNumber = 0;

  if (definition.kind === "percent") {
    deltaNumber = toNumber(lastValue) - toNumber(firstValue);
    deltaText = formatPercent(deltaNumber, 2, { signed: true });
  } else {
    const amountDelta = toNumber(lastRecord.totalMarginBalance) - toNumber(firstRecord.totalMarginBalance);
    const amountPercent = toNumber(firstRecord.totalMarginBalance) > 0
      ? (amountDelta / toNumber(firstRecord.totalMarginBalance)) * 100
      : 0;

    deltaNumber = amountDelta;
    deltaText = `${formatSignedMoney(amountDelta, 2)} (${formatPercent(amountPercent, 2, { signed: true })})`;
  }

  dom.rangeDelta.textContent = deltaText;
  dom.rangeDelta.style.color = deltaNumber >= 0 ? "var(--good)" : "var(--bad)";
}

function buildXTicks(records) {
  if (!records.length) {
    return [];
  }

  const indexes = new Set([
    0,
    Math.floor((records.length - 1) / 3),
    Math.floor(((records.length - 1) * 2) / 3),
    records.length - 1
  ]);

  return Array.from(indexes)
    .sort((left, right) => left - right)
    .map((index) => records[index])
    .filter(Boolean);
}

function renderAxes(records) {
  dom.axisYTitle.textContent = getMetricDefinition().axisTitle;

  if (!records.length) {
    dom.axisYTop.textContent = "--";
    dom.axisYMid.textContent = "--";
    dom.axisYBottom.textContent = "--";
    dom.axisXTicks.innerHTML = "";
    return;
  }

  const values = records.map((record) => getMetricValue(record, state.metric));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const midValue = minValue + ((maxValue - minValue) / 2);

  dom.axisYTop.textContent = formatMetricValue(state.metric, maxValue);
  dom.axisYMid.textContent = formatMetricValue(state.metric, midValue);
  dom.axisYBottom.textContent = formatMetricValue(state.metric, minValue);

  const ticks = buildXTicks(records);
  dom.axisXTicks.innerHTML = ticks
    .map((record) => `<span class="x-axis-tick">${formatAxisTime(record.bucketStart).replace("\n", "<br />")}</span>`)
    .join("");
}

function buildChartMarkup(records) {
  const width = 680;
  const height = 260;
  const padding = {
    top: 18,
    right: 16,
    bottom: 18,
    left: 10
  };

  const values = records.map((record) => getMetricValue(record, state.metric));
  const times = records.map((record) => Number(record.bucketStart));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const valueSpan = maxValue - minValue || Math.max(Math.abs(maxValue) * 0.01, 1);
  const timeSpan = maxTime - minTime || 1;
  const baseY = height - padding.bottom;

  const points = records.map((record) => {
    const x = padding.left + ((record.bucketStart - minTime) / timeSpan) * chartWidth;
    const y = padding.top + (1 - ((getMetricValue(record, state.metric) - minValue) / valueSpan)) * chartHeight;
    return { x, y, record };
  });

  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const y = padding.top + (chartHeight / 3) * index;
    return `<line class="chart-grid" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"></line>`;
  }).join("");

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${baseY} L ${points[0].x.toFixed(2)} ${baseY} Z`;
  const hitPoints = points
    .map((point) => `
      <circle
        class="chart-point-hit"
        data-bucket-start="${point.record.bucketStart}"
        cx="${point.x.toFixed(2)}"
        cy="${point.y.toFixed(2)}"
        r="12"
      ></circle>
    `)
    .join("");

  if (points.length === 1) {
    return `
      ${gridLines}
      ${hitPoints}
    `;
  }

  return `
    ${gridLines}
    <path class="chart-area" d="${areaPath}"></path>
    <path class="chart-line" d="${linePath}"></path>
    ${hitPoints}
  `;
}

function renderTooltipContent(selectedRecord) {
  if (!selectedRecord) {
    dom.chartTooltip.hidden = true;
    return;
  }

  const metricValue = formatMetricValue(state.metric, getMetricValue(selectedRecord, state.metric), {
    signed: state.metric !== "accountAsset"
  });

  dom.selectedPointTime.textContent = formatDateTime(selectedRecord.bucketStart);
  dom.selectedPointDetail.textContent = state.metric === "accountAsset"
    ? `${selectedRecord.positionCount} 笔持仓`
    : `${metricValue} · 资产 ${formatMoney(selectedRecord.totalMarginBalance)} · ${selectedRecord.positionCount} 笔持仓`;
}

function positionTooltip(selectedRecord) {
  if (!selectedRecord) {
    dom.chartTooltip.hidden = true;
    return;
  }

  const selectedPoint = dom.chartSvg.querySelector(`.chart-point-hit[data-bucket-start="${selectedRecord.bucketStart}"]`);
  if (!selectedPoint) {
    dom.chartTooltip.hidden = true;
    return;
  }

  dom.chartTooltip.hidden = false;

  const stageRect = dom.chartStage.getBoundingClientRect();
  const pointRect = selectedPoint.getBoundingClientRect();
  const pointCenterX = pointRect.left - stageRect.left + (pointRect.width / 2);
  const pointTopY = pointRect.top - stageRect.top;
  const tooltipWidth = dom.chartTooltip.offsetWidth || 156;
  const safeHalfWidth = tooltipWidth / 2;
  const clampedX = Math.max(safeHalfWidth + 8, Math.min(stageRect.width - safeHalfWidth - 8, pointCenterX));
  const top = Math.max(12, pointTopY - 6);

  dom.chartTooltip.style.left = `${clampedX}px`;
  dom.chartTooltip.style.top = `${top}px`;
}

function renderChart(records) {
  if (!records.length) {
    dom.chartCanvasWrap.hidden = true;
    dom.chartEmpty.hidden = false;
    dom.chartEmptyHint.textContent = "应用会每 5 分钟自动写入一条净值记录。";
    dom.chartSvg.innerHTML = "";
    dom.chartTooltip.hidden = true;
    renderAxes([]);
    return;
  }

  const selectedRecord = ensureSelectedRecord(records);
  dom.chartCanvasWrap.hidden = false;
  dom.chartEmpty.hidden = true;
  renderAxes(records);
  dom.chartSvg.innerHTML = buildChartMarkup(records);
  renderTooltipContent(selectedRecord);
  positionTooltip(selectedRecord);
}

function renderRecords(records) {
  dom.recordsList.innerHTML = "";
  dom.recordCountHint.textContent = `${records.length} 条`;

  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "record-row";
    empty.innerHTML = `
      <span class="record-time">暂无记录</span>
      <strong class="record-value">--</strong>
      <span class="record-side">等待采样</span>
    `;
    dom.recordsList.appendChild(empty);
    return;
  }

  records
    .slice(-8)
    .reverse()
    .forEach((record) => {
      const row = document.createElement("div");
      const metricValue = formatMetricValue(state.metric, getMetricValue(record, state.metric), {
        signed: state.metric !== "accountAsset"
      });

      row.className = "record-row";
      row.innerHTML = `
        <span class="record-time">${formatDateTime(record.bucketStart)}</span>
        <strong class="record-value">${metricValue}</strong>
        <span class="record-side">资产 ${formatMoney(record.totalMarginBalance)} · ${record.positionCount} 笔持仓</span>
      `;
      dom.recordsList.appendChild(row);
    });
}

function renderAll() {
  const rawRecords = state.history?.records || [];
  const { context, records: derivedRecords } = buildDerivedSeries(rawRecords);
  const filteredRecords = getFilteredRecords(derivedRecords);

  updateMetricButtons();
  updateRangeButtons();
  renderSummary(context, derivedRecords);
  renderDelta(filteredRecords);
  renderChart(filteredRecords);
  renderRecords(filteredRecords);

  dom.storagePath.textContent = state.history?.storageDirectory || "--";
  dom.storagePath.title = state.history?.filePath || "";
}

async function loadData() {
  setStatus("正在读取净值历史...");

  try {
    const [history, snapshot] = await Promise.all([
      bridge.getEquityHistory(),
      bridge.getState()
    ]);

    state.history = history;
    state.snapshot = snapshot;
    renderAll();
    setStatus(`历史文件：${history.filePath || "尚未生成"}`);
  } catch (error) {
    setStatus(error.message || "读取净值历史失败");
  }
}

async function handleExport() {
  const intervalMinutes = Number(dom.exportIntervalInput.value) || 5;
  if (intervalMinutes < 5 || intervalMinutes % 5 !== 0) {
    setStatus("导出间隔必须是 5 分钟的倍数");
    return;
  }

  window.localStorage.setItem(EXPORT_INTERVAL_STORAGE_KEY, String(intervalMinutes));
  setStatus("正在导出 CSV...");

  try {
    const result = await bridge.exportEquityHistory(intervalMinutes);
    if (result.canceled) {
      setStatus("已取消导出");
      return;
    }

    setStatus(`已导出到 ${result.filePath}`);
  } catch (error) {
    setStatus(error.message || "导出失败");
  }
}

async function handleOpenFolder() {
  try {
    const folderPath = await bridge.openEquityHistoryFolder();
    setStatus(`历史目录：${folderPath}`);
  } catch (error) {
    setStatus(error.message || "打开目录失败");
  }
}

function applyCapabilities() {
  const capabilities = bridge.capabilities || {};
  document.documentElement.dataset.platform = bridge.platform || "electron";
  document.body.classList.toggle("web-mode", bridge.platform === "web");
  document.body.classList.toggle("embed-mode", isEmbedded);

  if (isEmbedded) {
    dom.openFolderButton.hidden = true;
    dom.minimizeButton.hidden = true;
    dom.closeButton.hidden = true;
    return;
  }

  if (!capabilities.windowControls) {
    dom.minimizeButton.hidden = true;
    dom.closeButton.hidden = true;
  }

  if (!capabilities.folderAccess) {
    dom.openFolderButton.hidden = true;
  }
}

function bindEvents() {
  const savedInterval = window.localStorage.getItem(EXPORT_INTERVAL_STORAGE_KEY);
  if (savedInterval) {
    dom.exportIntervalInput.value = savedInterval;
  }

  dom.metricGroup.addEventListener("click", (event) => {
    const button = event.target.closest(".metric-button");
    if (!button) {
      return;
    }

    state.metric = button.dataset.metric;
    window.localStorage.setItem(METRIC_STORAGE_KEY, state.metric);
    renderAll();
  });

  dom.rangeGroup.addEventListener("click", (event) => {
    const button = event.target.closest(".range-button");
    if (!button) {
      return;
    }

    state.range = button.dataset.range;
    window.localStorage.setItem(RANGE_STORAGE_KEY, state.range);
    renderAll();
  });

  dom.chartSvg.addEventListener("click", (event) => {
    const target = event.target.closest("[data-bucket-start]");
    if (!target) {
      return;
    }

    state.selectedBucketStart = Number(target.dataset.bucketStart);
    renderAll();
  });

  dom.exportButton.addEventListener("click", handleExport);
  dom.openFolderButton.addEventListener("click", handleOpenFolder);
  dom.refreshButton.addEventListener("click", loadData);
  dom.minimizeButton.addEventListener("click", () => bridge.minimizeWindow());
  dom.closeButton.addEventListener("click", () => bridge.closeWindow());
}

function bindSubscriptions() {
  bridge.onSnapshot((snapshot) => {
    state.snapshot = snapshot;
    renderAll();
  });

  bridge.onEquityHistoryUpdated((historyPayload) => {
    state.history = historyPayload;
    renderAll();
    setStatus(`已采样 ${formatDateTime(historyPayload.records[historyPayload.records.length - 1]?.bucketStart)}`);
  });
}

async function bootstrap() {
  if (!bridge) {
    throw new Error("binancePanel bridge is not available");
  }

  applyCapabilities();
  bindEvents();
  bindSubscriptions();
  window.addEventListener("resize", renderAll);
  await loadData();
}

bootstrap().catch((error) => {
  setStatus(error.message || "净值历史初始化失败");
});
