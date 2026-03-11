const RANGE_STORAGE_KEY = "binance-panel.history-range";
const EXPORT_INTERVAL_STORAGE_KEY = "binance-panel.export-interval";

const dom = {
  currentEquity: document.querySelector("#currentEquity"),
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
  axisYTop: document.querySelector("#axisYTop"),
  axisYMid: document.querySelector("#axisYMid"),
  axisYBottom: document.querySelector("#axisYBottom"),
  axisXTicks: document.querySelector("#axisXTicks"),
  recordsList: document.querySelector("#recordsList"),
  recordCountHint: document.querySelector("#recordCountHint"),
  statusMessage: document.querySelector("#statusMessage")
};

const state = {
  range: window.localStorage.getItem(RANGE_STORAGE_KEY) || "7d",
  history: null,
  snapshot: null,
  selectedBucketStart: null
};

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

function formatSigned(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }

  return `${number > 0 ? "+" : ""}${formatMoney(number, digits)}`;
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

  return `${date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}\n${date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function setStatus(message) {
  dom.statusMessage.textContent = message;
}

function getRangeWindowMs(range) {
  if (range === "24h") {
    return 24 * 60 * 60 * 1000;
  }

  if (range === "7d") {
    return 7 * 24 * 60 * 60 * 1000;
  }

  if (range === "30d") {
    return 30 * 24 * 60 * 60 * 1000;
  }

  return Number.POSITIVE_INFINITY;
}

function getFilteredRecords() {
  const records = state.history?.records || [];
  const windowMs = getRangeWindowMs(state.range);
  if (!Number.isFinite(windowMs)) {
    return records;
  }

  const cutoff = Date.now() - windowMs;
  return records.filter((record) => record.bucketStart >= cutoff);
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

  const selected = records.find((record) => record.bucketStart === state.selectedBucketStart);
  if (selected) {
    return selected;
  }

  const fallback = records[records.length - 1];
  state.selectedBucketStart = fallback.bucketStart;
  return fallback;
}

function renderSummary(records) {
  const currentEquity = Number(state.snapshot?.totalMarginBalance);
  const fallbackEquity = Number(state.history?.currentEquity);
  const latestEquity = Number.isFinite(currentEquity)
    ? currentEquity
    : Number.isFinite(fallbackEquity)
      ? fallbackEquity
      : records[records.length - 1]?.totalMarginBalance;

  dom.currentEquity.textContent = formatMoney(latestEquity);

  const selectedRecord = ensureSelectedRecord(records);
  dom.selectedPointTime.textContent = selectedRecord ? formatDateTime(selectedRecord.bucketStart) : "--";
  dom.selectedPointDetail.textContent = selectedRecord
    ? `净值 ${formatMoney(selectedRecord.totalMarginBalance, 2)} · ${selectedRecord.positionCount} 笔持仓`
    : "点击曲线上的点查看详情";
}

function renderDelta(records) {
  if (!records.length) {
    dom.rangeDelta.textContent = "--";
    dom.rangeDelta.style.color = "var(--ink)";
    return;
  }

  const first = Number(records[0].totalMarginBalance);
  const last = Number(records[records.length - 1].totalMarginBalance);
  const delta = last - first;
  const percent = first > 0 ? (delta / first) * 100 : 0;
  dom.rangeDelta.textContent = `${formatSigned(delta, 2)} (${delta >= 0 ? "+" : ""}${percent.toFixed(2)}%)`;
  dom.rangeDelta.style.color = delta >= 0 ? "var(--good)" : "var(--bad)";
}

function buildXTicks(records) {
  if (!records.length) {
    return [];
  }

  const indexes = new Set([0, Math.floor((records.length - 1) / 3), Math.floor(((records.length - 1) * 2) / 3), records.length - 1]);
  return Array.from(indexes)
    .sort((left, right) => left - right)
    .map((index) => records[index])
    .filter(Boolean);
}

function renderAxes(records) {
  if (!records.length) {
    dom.axisYTop.textContent = "--";
    dom.axisYMid.textContent = "--";
    dom.axisYBottom.textContent = "--";
    dom.axisXTicks.innerHTML = "";
    return;
  }

  const values = records.map((record) => Number(record.totalMarginBalance));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const midValue = minValue + ((maxValue - minValue) / 2);

  dom.axisYTop.textContent = formatMoney(maxValue, 2);
  dom.axisYMid.textContent = formatMoney(midValue, 2);
  dom.axisYBottom.textContent = formatMoney(minValue, 2);

  const ticks = buildXTicks(records);
  dom.axisXTicks.innerHTML = ticks.map((record) => `<span class="x-axis-tick">${formatAxisTime(record.bucketStart).replace("\n", "<br />")}</span>`).join("");
}

function buildChartMarkup(records, selectedRecord) {
  const width = 680;
  const height = 260;
  const padding = {
    top: 18,
    right: 16,
    bottom: 18,
    left: 10
  };
  const values = records.map((record) => Number(record.totalMarginBalance));
  const times = records.map((record) => Number(record.bucketStart));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const valueSpan = maxValue - minValue || Math.max(maxValue * 0.01, 1);
  const timeSpan = maxTime - minTime || 1;
  const baseY = height - padding.bottom;

  const points = records.map((record) => {
    const x = padding.left + ((record.bucketStart - minTime) / timeSpan) * chartWidth;
    const y = padding.top + (1 - ((record.totalMarginBalance - minValue) / valueSpan)) * chartHeight;
    return { x, y, record };
  });

  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const y = padding.top + (chartHeight / 3) * index;
    return `<line class="chart-grid" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"></line>`;
  }).join("");

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${baseY} L ${points[0].x.toFixed(2)} ${baseY} Z`;

  const pointMarkup = points.map((point) => {
    const isSelected = selectedRecord && selectedRecord.bucketStart === point.record.bucketStart;
    return `
      <circle class="chart-point-hit" data-bucket-start="${point.record.bucketStart}" data-point-x="${point.x.toFixed(2)}" data-point-y="${point.y.toFixed(2)}" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="12"></circle>
      <circle class="chart-point ${isSelected ? "selected" : ""}" data-bucket-start="${point.record.bucketStart}" data-point-x="${point.x.toFixed(2)}" data-point-y="${point.y.toFixed(2)}" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${isSelected ? 4.5 : 3.5}"></circle>
    `;
  }).join("");

  if (points.length === 1) {
    return `
      ${gridLines}
      ${pointMarkup}
    `;
  }

  return `
    ${gridLines}
    <path class="chart-area" d="${areaPath}"></path>
    <path class="chart-line" d="${linePath}"></path>
    ${pointMarkup}
  `;
}

function positionTooltip(selectedRecord) {
  if (!selectedRecord) {
    dom.chartTooltip.hidden = true;
    return;
  }

  const selectedPoint = dom.chartSvg.querySelector(`.chart-point.selected[data-bucket-start="${selectedRecord.bucketStart}"]`);
  if (!selectedPoint) {
    dom.chartTooltip.hidden = true;
    return;
  }

  dom.chartTooltip.hidden = false;

  const stageRect = dom.chartStage.getBoundingClientRect();
  const pointRect = selectedPoint.getBoundingClientRect();
  const pointCenterX = pointRect.left - stageRect.left + (pointRect.width / 2);
  const pointTopY = pointRect.top - stageRect.top;
  const tooltipWidth = dom.chartTooltip.offsetWidth || 140;
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
    dom.chartEmptyHint.textContent = "应用会每 5 分钟自动写入一条净值。";
    dom.chartSvg.innerHTML = "";
    dom.chartTooltip.hidden = true;
    renderAxes([]);
    return;
  }

  const selectedRecord = ensureSelectedRecord(records);
  dom.chartCanvasWrap.hidden = false;
  dom.chartEmpty.hidden = true;
  renderAxes(records);
  dom.chartSvg.innerHTML = buildChartMarkup(records, selectedRecord);
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
      row.className = "record-row";
      row.innerHTML = `
        <span class="record-time">${formatDateTime(record.bucketStart)}</span>
        <strong class="record-value">${formatMoney(record.totalMarginBalance, 2)}</strong>
        <span class="record-side">${record.positionCount} 笔持仓</span>
      `;
      dom.recordsList.appendChild(row);
    });
}

function renderAll() {
  const filteredRecords = getFilteredRecords();
  updateRangeButtons();
  renderSummary(filteredRecords);
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
      window.binancePanel.getEquityHistory(),
      window.binancePanel.getState()
    ]);

    state.history = history;
    state.snapshot = snapshot;
    renderAll();
    setStatus(`历史文件: ${history.filePath || "未生成"}`);
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
    const result = await window.binancePanel.exportEquityHistory(intervalMinutes);
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
    const folderPath = await window.binancePanel.openEquityHistoryFolder();
    setStatus(`已打开目录 ${folderPath}`);
  } catch (error) {
    setStatus(error.message || "打开目录失败");
  }
}

function bindEvents() {
  const savedInterval = window.localStorage.getItem(EXPORT_INTERVAL_STORAGE_KEY);
  if (savedInterval) {
    dom.exportIntervalInput.value = savedInterval;
  }

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
  dom.minimizeButton.addEventListener("click", () => window.binancePanel.minimizeWindow());
  dom.closeButton.addEventListener("click", () => window.binancePanel.closeWindow());
}

function bindSubscriptions() {
  window.binancePanel.onSnapshot((snapshot) => {
    state.snapshot = snapshot;
    renderAll();
  });

  window.binancePanel.onEquityHistoryUpdated((historyPayload) => {
    state.history = historyPayload;
    renderAll();
    setStatus(`已采样 ${formatDateTime(historyPayload.records[historyPayload.records.length - 1]?.bucketStart)}`);
  });
}

async function bootstrap() {
  bindEvents();
  bindSubscriptions();
  window.addEventListener("resize", () => {
    renderAll();
  });
  await loadData();
}

bootstrap();
