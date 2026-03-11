const DEFAULT_ACCOUNT_ALIAS = "我的币安账户";
const POSITION_MODE_STORAGE_KEY = "binance-panel.position-mode";

const dom = {
  statusBadge: document.querySelector("#statusBadge"),
  statusMeta: document.querySelector("#statusMeta"),
  accountAlias: document.querySelector("#accountAlias"),
  updatedAt: document.querySelector("#updatedAt"),
  metricMarginBalance: document.querySelector("#metricMarginBalance"),
  metricWalletBalance: document.querySelector("#metricWalletBalance"),
  metricAvailableBalance: document.querySelector("#metricAvailableBalance"),
  metricUnrealized: document.querySelector("#metricUnrealized"),
  positionCount: document.querySelector("#positionCount"),
  positionModeButton: document.querySelector("#positionModeButton"),
  positionsList: document.querySelector("#positionsList"),
  emptyState: document.querySelector("#emptyState"),
  errorBanner: document.querySelector("#errorBanner"),
  backdrop: document.querySelector("#backdrop"),
  settingsDrawer: document.querySelector("#settingsDrawer"),
  settingsForm: document.querySelector("#settingsForm"),
  formStatus: document.querySelector("#formStatus"),
  secretHint: document.querySelector("#secretHint"),
  accountAliasInput: document.querySelector("#accountAliasInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  apiSecretInput: document.querySelector("#apiSecretInput"),
  restBaseUrlInput: document.querySelector("#restBaseUrlInput"),
  wsBaseUrlInput: document.querySelector("#wsBaseUrlInput"),
  recvWindowInput: document.querySelector("#recvWindowInput"),
  alwaysOnTopInput: document.querySelector("#alwaysOnTopInput"),
  historyButton: document.querySelector("#historyButton"),
  pinButton: document.querySelector("#pinButton"),
  refreshButton: document.querySelector("#refreshButton"),
  settingsButton: document.querySelector("#settingsButton"),
  minimizeButton: document.querySelector("#minimizeButton"),
  closeButton: document.querySelector("#closeButton"),
  drawerCloseButton: document.querySelector("#drawerCloseButton"),
  cancelButton: document.querySelector("#cancelButton")
};

const state = {
  latestSnapshot: null,
  positionMode: loadPositionMode()
};

function loadPositionMode() {
  const value = window.localStorage.getItem(POSITION_MODE_STORAGE_KEY);
  return value === "usd" ? "usd" : "coin";
}

function savePositionMode(value) {
  window.localStorage.setItem(POSITION_MODE_STORAGE_KEY, value);
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

function formatSigned(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }

  return `${number > 0 ? "+" : ""}${formatMoney(number, digits)}`;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }

  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function formatTime(value) {
  if (!value) {
    return "未连接";
  }

  const time = new Date(value);
  if (Number.isNaN(time.valueOf())) {
    return "未连接";
  }

  return time.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return "--";
  }

  const absNumber = Math.abs(number);
  let digits = 6;
  if (absNumber >= 1000) {
    digits = 2;
  } else if (absNumber >= 100) {
    digits = 3;
  } else if (absNumber >= 1) {
    digits = 4;
  }

  return number.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function formatQuantity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }

  const absNumber = Math.abs(number);
  let digits = 4;
  if (absNumber >= 1000) {
    digits = 0;
  } else if (absNumber >= 100) {
    digits = 2;
  } else if (absNumber >= 1) {
    digits = 3;
  }

  return number.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function formatProtection(value, extraCount) {
  const priceLabel = formatPrice(value);
  if (priceLabel === "--") {
    return "--";
  }

  return extraCount > 0 ? `${priceLabel} +${extraCount}` : priceLabel;
}

function statusDescription(snapshot) {
  if (!snapshot.configured) {
    return "填入只读 API 后自动连接";
  }

  if (snapshot.status === "live") {
    return snapshot.lastEventAt
      ? `最近事件 ${formatTime(snapshot.lastEventAt)}`
      : "账户数据在线";
  }

  if (snapshot.status === "connecting") {
    return "正在同步账户和持仓";
  }

  if (snapshot.status === "error") {
    return snapshot.error || "连接失败";
  }

  return "等待下一次刷新";
}

function resolveStatusLabel(snapshot) {
  if (!snapshot.configured) {
    return "等待配置";
  }

  if (snapshot.status === "live") {
    return snapshot.connectionLabel || "在线";
  }

  if (snapshot.status === "connecting") {
    return snapshot.connectionLabel || "连接中";
  }

  return snapshot.connectionLabel || "连接失败";
}

function setStatusClass(snapshot) {
  dom.statusBadge.className = "status-badge";
  dom.statusBadge.classList.add(snapshot.status || "idle");
}

function renderHeader(snapshot) {
  dom.statusBadge.textContent = resolveStatusLabel(snapshot);
  dom.statusMeta.textContent = statusDescription(snapshot);
  dom.accountAlias.textContent = snapshot.accountAlias || DEFAULT_ACCOUNT_ALIAS;
  dom.updatedAt.textContent = formatTime(snapshot.updatedAt);
  setStatusClass(snapshot);
}

function renderMetrics(snapshot) {
  dom.metricMarginBalance.textContent = formatMoney(snapshot.totalMarginBalance);
  dom.metricWalletBalance.textContent = formatMoney(snapshot.walletBalance);
  dom.metricAvailableBalance.textContent = formatMoney(snapshot.availableBalance);
  dom.metricUnrealized.textContent = formatSigned(snapshot.totalUnrealizedProfit, 2);
  dom.metricUnrealized.className = `metric-value ${snapshot.totalUnrealizedProfit >= 0 ? "positive" : "negative"}`;
  dom.positionCount.textContent = String(snapshot.positionCount || 0);
}

function updatePositionModeButton() {
  const isUsdMode = state.positionMode === "usd";
  dom.positionModeButton.textContent = isUsdMode ? "USD" : "数量";
  dom.positionModeButton.setAttribute("aria-pressed", String(isUsdMode));
  dom.positionModeButton.title = isUsdMode
    ? "当前显示美金价值，点击切换为币种数量"
    : "当前显示币种数量，点击切换为美金价值";
}

function createMetricRow(label, value) {
  return `
    <div class="quote-item">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function buildPositionExposure(position) {
  const marginLabel = position.marginType === "isolated" ? "逐仓" : "全仓";
  const assetLabel = position.baseAsset || position.symbol || "";

  if (state.positionMode === "usd") {
    const settleAsset = position.marginAsset || "USDT";
    return `${marginLabel} · 持仓 ${formatMoney(position.notional, 2)} ${settleAsset}`;
  }

  return `${marginLabel} · 持仓 ${formatQuantity(position.size)} ${assetLabel}`;
}

function buildPositionCard(position, index) {
  const wrapper = document.createElement("article");
  wrapper.className = `position-card ${position.displaySide === "SHORT" ? "short" : "long"}`;
  wrapper.style.animationDelay = `${Math.min(index * 0.04, 0.2)}s`;

  const pnlClass = position.unrealizedProfit >= 0 ? "positive" : "negative";
  const sideLabel = position.displaySide === "SHORT" ? "空" : "多";
  const takeProfitLabel = formatProtection(position.takeProfitPrice, position.takeProfitExtraCount);
  const stopLossLabel = formatProtection(position.stopLossPrice, position.stopLossExtraCount);

  wrapper.innerHTML = `
    <div class="position-top">
      <div class="position-main">
        <div class="symbol-row">
          <strong>${position.symbol}</strong>
          <span class="side-pill">${sideLabel}</span>
          <span class="leverage-pill">${position.leverage}x</span>
        </div>
        <button class="size-toggle" type="button">${buildPositionExposure(position)}</button>
      </div>
      <div class="pnl-box ${pnlClass}">
        <strong>${formatSigned(position.unrealizedProfit, 2)}</strong>
        <span>${formatPercent(position.roePercent)}</span>
      </div>
    </div>

    <div class="quote-grid">
      ${createMetricRow("开仓", formatPrice(position.entryPrice))}
      ${createMetricRow("标记", formatPrice(position.markPrice))}
      ${createMetricRow("强平", formatPrice(position.liquidationPrice))}
      ${createMetricRow("名义", formatMoney(position.notional, 2))}
    </div>

    <div class="protection-row">
      <span>仓位止盈止损</span>
      <strong>${takeProfitLabel} / ${stopLossLabel}</strong>
    </div>
  `;

  return wrapper;
}

function renderPositions(snapshot) {
  dom.positionsList.innerHTML = "";

  if (!snapshot.positions?.length) {
    dom.emptyState.hidden = false;
    return;
  }

  dom.emptyState.hidden = true;
  snapshot.positions.forEach((position, index) => {
    dom.positionsList.appendChild(buildPositionCard(position, index));
  });
}

function renderError(snapshot) {
  if (snapshot.error) {
    dom.errorBanner.hidden = false;
    dom.errorBanner.textContent = snapshot.error;
    return;
  }

  dom.errorBanner.hidden = true;
  dom.errorBanner.textContent = "";
}

function renderSnapshot(snapshot) {
  state.latestSnapshot = snapshot;
  renderHeader(snapshot);
  renderMetrics(snapshot);
  renderPositions(snapshot);
  renderError(snapshot);
  updatePositionModeButton();
}

function fillForm(settings) {
  dom.accountAliasInput.value = settings.accountAlias || DEFAULT_ACCOUNT_ALIAS;
  dom.apiKeyInput.value = settings.apiKey || "";
  dom.apiSecretInput.value = "";
  dom.restBaseUrlInput.value = settings.restBaseUrl || "https://fapi.binance.com";
  dom.wsBaseUrlInput.value = settings.wsBaseUrl || "wss://fstream.binance.com";
  dom.recvWindowInput.value = String(settings.recvWindow || 5000);
  dom.alwaysOnTopInput.checked = Boolean(settings.alwaysOnTop);
  dom.secretHint.textContent = settings.hasApiSecret
    ? "已保存 Secret，留空则保持原值。"
    : "尚未保存 Secret。";
  dom.pinButton.classList.toggle("active", Boolean(settings.alwaysOnTop));
  dom.pinButton.setAttribute("aria-pressed", String(Boolean(settings.alwaysOnTop)));
  dom.pinButton.title = settings.alwaysOnTop ? "取消窗口置顶" : "窗口置顶";
}

function openDrawer() {
  dom.backdrop.hidden = false;
  dom.settingsDrawer.hidden = false;
  document.body.classList.add("drawer-open");
}

function closeDrawer() {
  document.body.classList.remove("drawer-open");
  dom.backdrop.hidden = true;
  dom.settingsDrawer.hidden = true;
}

function togglePositionMode() {
  state.positionMode = state.positionMode === "usd" ? "coin" : "usd";
  savePositionMode(state.positionMode);
  updatePositionModeButton();

  if (state.latestSnapshot) {
    renderPositions(state.latestSnapshot);
  }
}

async function handleSave(event) {
  event.preventDefault();
  dom.formStatus.textContent = "正在保存并连接...";

  const payload = {
    accountAlias: dom.accountAliasInput.value.trim() || DEFAULT_ACCOUNT_ALIAS,
    apiKey: dom.apiKeyInput.value.trim(),
    restBaseUrl: dom.restBaseUrlInput.value.trim(),
    wsBaseUrl: dom.wsBaseUrlInput.value.trim(),
    recvWindow: Number(dom.recvWindowInput.value) || 5000,
    alwaysOnTop: dom.alwaysOnTopInput.checked
  };

  const secret = dom.apiSecretInput.value.trim();
  if (secret) {
    payload.apiSecret = secret;
  }

  try {
    const result = await window.binancePanel.saveSettings(payload);
    fillForm(result.settings);
    renderSnapshot(result.snapshot);
    dom.formStatus.textContent = "已保存，正在维持数据刷新。";
    closeDrawer();
  } catch (error) {
    dom.formStatus.textContent = error.message || "保存失败";
  }
}

async function handleRefresh() {
  dom.statusMeta.textContent = "正在手动刷新...";

  try {
    const snapshot = await window.binancePanel.refresh();
    renderSnapshot(snapshot);
  } catch (_error) {
    return;
  }
}

async function handlePinToggle() {
  const nextValue = !dom.alwaysOnTopInput.checked;
  const settings = await window.binancePanel.setAlwaysOnTop(nextValue);
  fillForm(settings);
}

async function openEquityHistoryWindow() {
  try {
    await window.binancePanel.openEquityHistoryWindow();
  } catch (_error) {
    return;
  }
}

function bindEvents() {
  dom.historyButton.addEventListener("click", openEquityHistoryWindow);
  dom.settingsButton.addEventListener("click", openDrawer);
  dom.drawerCloseButton.addEventListener("click", closeDrawer);
  dom.cancelButton.addEventListener("click", closeDrawer);
  dom.backdrop.addEventListener("click", closeDrawer);
  dom.settingsForm.addEventListener("submit", handleSave);
  dom.refreshButton.addEventListener("click", handleRefresh);
  dom.pinButton.addEventListener("click", handlePinToggle);
  dom.positionModeButton.addEventListener("click", togglePositionMode);
  dom.positionsList.addEventListener("click", (event) => {
    if (event.target.closest(".size-toggle")) {
      togglePositionMode();
    }
  });
  dom.minimizeButton.addEventListener("click", () => window.binancePanel.minimizeWindow());
  dom.closeButton.addEventListener("click", () => window.binancePanel.quitApp());
}

async function bootstrap() {
  bindEvents();

  const [settings, snapshot] = await Promise.all([
    window.binancePanel.getSettings(),
    window.binancePanel.getState()
  ]);

  fillForm(settings);
  renderSnapshot(snapshot);
  window.binancePanel.onSnapshot(renderSnapshot);
}

bootstrap();
