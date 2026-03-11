const DEFAULT_ACCOUNT_ALIAS = "我的币安账户";
const POSITION_MODE_STORAGE_KEY = "binance-panel.position-mode";

const ALERT_SOUND_PATTERNS = Object.freeze({
  pulse: [
    { frequency: 880, duration: 0.18, gain: 0.72, type: "triangle", gap: 0.04 },
    { frequency: 1046, duration: 0.2, gain: 0.82, type: "triangle", gap: 0.06 },
    { frequency: 1318, duration: 0.26, gain: 0.78, type: "triangle", gap: 0.05 }
  ],
  alarm: [
    { frequency: 760, frequencyTo: 1120, duration: 0.28, gain: 0.86, type: "sawtooth", gap: 0.06 },
    { frequency: 1120, frequencyTo: 760, duration: 0.28, gain: 0.86, type: "sawtooth", gap: 0.06 },
    { frequency: 760, frequencyTo: 1120, duration: 0.3, gain: 0.9, type: "sawtooth", gap: 0.06 }
  ],
  chime: [
    { frequency: 660, duration: 0.2, gain: 0.62, type: "sine", gap: 0.05 },
    { frequency: 990, duration: 0.24, gain: 0.68, type: "sine", gap: 0.05 },
    { frequency: 1320, duration: 0.28, gain: 0.72, type: "sine", gap: 0.06 }
  ],
  beacon: [
    { frequency: 480, duration: 0.32, gain: 0.72, type: "triangle", gap: 0.08 },
    { frequency: 720, duration: 0.32, gain: 0.78, type: "triangle", gap: 0.08 },
    { frequency: 960, duration: 0.36, gain: 0.84, type: "triangle", gap: 0.1 },
    { frequency: 720, duration: 0.3, gain: 0.76, type: "triangle", gap: 0.08 },
    { frequency: 960, duration: 0.4, gain: 0.86, type: "triangle", gap: 0.12 }
  ],
  siren: [
    { frequency: 540, frequencyTo: 1180, duration: 0.52, gain: 0.88, type: "sawtooth", gap: 0.08 },
    { frequency: 1180, frequencyTo: 540, duration: 0.52, gain: 0.88, type: "sawtooth", gap: 0.08 },
    { frequency: 540, frequencyTo: 1240, duration: 0.56, gain: 0.92, type: "sawtooth", gap: 0.08 },
    { frequency: 1240, frequencyTo: 540, duration: 0.56, gain: 0.92, type: "sawtooth", gap: 0.12 }
  ],
  cascade: [
    { frequency: 1320, duration: 0.24, gain: 0.72, type: "sine", gap: 0.05 },
    { frequency: 1188, duration: 0.24, gain: 0.72, type: "sine", gap: 0.05 },
    { frequency: 990, duration: 0.26, gain: 0.74, type: "sine", gap: 0.05 },
    { frequency: 880, duration: 0.28, gain: 0.76, type: "sine", gap: 0.05 },
    { frequency: 660, duration: 0.34, gain: 0.8, type: "sine", gap: 0.06 },
    { frequency: 990, duration: 0.42, gain: 0.82, type: "sine", gap: 0.08 }
  ]
});

const ALERT_REPEAT_MODE_OPTIONS = Object.freeze({
  once: 1,
  triple: 3,
  "until-closed": Number.POSITIVE_INFINITY
});

const ALERT_SOUND_LABELS = Object.freeze({
  pulse: "Pulse 短促",
  alarm: "Alarm 短警报",
  chime: "Chime 短提示",
  beacon: "Beacon 长提示",
  siren: "Siren 长警报",
  cascade: "Cascade 长回响"
});

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
  alertOverlay: document.querySelector("#alertOverlay"),
  alertDialogTitle: document.querySelector("#alertDialogTitle"),
  alertDialogMessage: document.querySelector("#alertDialogMessage"),
  alertDialogMeta: document.querySelector("#alertDialogMeta"),
  alertDismissButton: document.querySelector("#alertDismissButton"),
  alertStopSoundButton: document.querySelector("#alertStopSoundButton"),
  alertDialogCloseButton: document.querySelector("#alertDialogCloseButton"),
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
  equityAlertEnabledInput: document.querySelector("#equityAlertEnabledInput"),
  equityAlertWindowInput: document.querySelector("#equityAlertWindowInput"),
  equityAlertThresholdInput: document.querySelector("#equityAlertThresholdInput"),
  equityAlertSoundInput: document.querySelector("#equityAlertSoundInput"),
  equityAlertVolumeInput: document.querySelector("#equityAlertVolumeInput"),
  equityAlertRepeatModeInput: document.querySelector("#equityAlertRepeatModeInput"),
  testAlertButton: document.querySelector("#testAlertButton"),
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
  latestSettings: null,
  positionMode: loadPositionMode(),
  audioContext: null,
  activePlaybackTimer: null,
  activePlaybackNodes: new Set(),
  activeMasterGain: null
};

function loadPositionMode() {
  const value = window.localStorage.getItem(POSITION_MODE_STORAGE_KEY);
  return value === "usd" ? "usd" : "coin";
}

function savePositionMode(value) {
  window.localStorage.setItem(POSITION_MODE_STORAGE_KEY, value);
}

function toNumber(value, fallback = 0) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function normalizeAlertWindowMinutes(value) {
  const rounded = Math.round(toNumber(value, 15) / 5) * 5;
  return Math.max(5, Math.min(1440, rounded || 15));
}

function normalizeAlertThreshold(value) {
  return Math.min(100, Math.max(0.1, toNumber(value, 3)));
}

function normalizeAlertVolume(value) {
  return Math.min(100, Math.max(0, Math.round(toNumber(value, 85))));
}

function normalizeRepeatMode(value) {
  return ALERT_REPEAT_MODE_OPTIONS[value] ? value : "triple";
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

function formatPercent(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }

  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
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

function describeRepeatMode(repeatMode) {
  if (repeatMode === "until-closed") {
    return "直到手动关闭";
  }

  if (repeatMode === "triple") {
    return "循环 3 次";
  }

  return "循环 1 次";
}

function describeSound(sound) {
  return ALERT_SOUND_LABELS[sound] || sound;
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
    ? "当前显示美元价值，点击切换为币种数量"
    : "当前显示币种数量，点击切换为美元价值";
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
  state.latestSettings = settings;
  dom.accountAliasInput.value = settings.accountAlias || DEFAULT_ACCOUNT_ALIAS;
  dom.apiKeyInput.value = settings.apiKey || "";
  dom.apiSecretInput.value = "";
  dom.restBaseUrlInput.value = settings.restBaseUrl || "https://fapi.binance.com";
  dom.wsBaseUrlInput.value = settings.wsBaseUrl || "wss://fstream.binance.com";
  dom.recvWindowInput.value = String(settings.recvWindow || 5000);
  dom.equityAlertEnabledInput.checked = Boolean(settings.equityAlertEnabled);
  dom.equityAlertWindowInput.value = String(settings.equityAlertWindowMinutes || 15);
  dom.equityAlertThresholdInput.value = String(settings.equityAlertThresholdPercent || 3);
  dom.equityAlertSoundInput.value = settings.equityAlertSound || "beacon";
  dom.equityAlertVolumeInput.value = String(settings.equityAlertVolume ?? 85);
  dom.equityAlertRepeatModeInput.value = settings.equityAlertRepeatMode || "triple";
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

function collectFormPayload() {
  const payload = {
    accountAlias: dom.accountAliasInput.value.trim() || DEFAULT_ACCOUNT_ALIAS,
    apiKey: dom.apiKeyInput.value.trim(),
    restBaseUrl: dom.restBaseUrlInput.value.trim(),
    wsBaseUrl: dom.wsBaseUrlInput.value.trim(),
    recvWindow: Math.round(Math.min(60000, Math.max(100, toNumber(dom.recvWindowInput.value, 5000)))),
    equityAlertEnabled: dom.equityAlertEnabledInput.checked,
    equityAlertWindowMinutes: normalizeAlertWindowMinutes(dom.equityAlertWindowInput.value),
    equityAlertThresholdPercent: normalizeAlertThreshold(dom.equityAlertThresholdInput.value),
    equityAlertSound: dom.equityAlertSoundInput.value || "beacon",
    equityAlertVolume: normalizeAlertVolume(dom.equityAlertVolumeInput.value),
    equityAlertRepeatMode: normalizeRepeatMode(dom.equityAlertRepeatModeInput.value),
    alwaysOnTop: dom.alwaysOnTopInput.checked
  };

  const secret = dom.apiSecretInput.value.trim();
  if (secret) {
    payload.apiSecret = secret;
  }

  return payload;
}

function buildTestAlertPayload() {
  const payload = collectFormPayload();
  const latestEquity = Math.max(100, toNumber(state.latestSnapshot?.totalMarginBalance, 5000));
  const thresholdPercent = Math.max(0.1, payload.equityAlertThresholdPercent);
  const deltaPercent = Math.max(thresholdPercent, thresholdPercent * 1.35);
  const baselineEquity = latestEquity / (1 + (deltaPercent / 100));

  dom.equityAlertWindowInput.value = String(payload.equityAlertWindowMinutes);
  dom.equityAlertThresholdInput.value = String(payload.equityAlertThresholdPercent);
  dom.equityAlertVolumeInput.value = String(payload.equityAlertVolume);

  return {
    accountAlias: payload.accountAlias,
    direction: "up",
    windowMinutes: payload.equityAlertWindowMinutes,
    thresholdPercent,
    delta: latestEquity - baselineEquity,
    deltaPercent,
    baselineEquity,
    latestEquity,
    sound: payload.equityAlertSound,
    volume: payload.equityAlertVolume,
    repeatMode: payload.equityAlertRepeatMode
  };
}

async function handleSave(event) {
  event.preventDefault();
  dom.formStatus.textContent = "正在保存并连接...";

  try {
    const result = await window.binancePanel.saveSettings(collectFormPayload());
    fillForm(result.settings);
    renderSnapshot(result.snapshot);
    dom.formStatus.textContent = result.settings.equityAlertEnabled
      ? "已保存。真实提醒会在新的 5 分钟采样写入后判断，可先点测试提醒确认弹窗和声音。"
      : "已保存，正在维持数据刷新。";
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
  fillForm({
    ...state.latestSettings,
    ...settings
  });
}

async function openEquityHistoryWindow() {
  try {
    await window.binancePanel.openEquityHistoryWindow();
  } catch (_error) {
    return;
  }
}

function getAudioContext() {
  if (state.audioContext) {
    return state.audioContext;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  state.audioContext = new AudioContextClass();
  return state.audioContext;
}

function clearPlaybackNodes() {
  for (const node of state.activePlaybackNodes) {
    try {
      if (typeof node.stop === "function") {
        node.stop();
      }
    } catch (_error) {
      continue;
    }
  }

  state.activePlaybackNodes.clear();

  if (state.activeMasterGain) {
    try {
      state.activeMasterGain.disconnect();
    } catch (_error) {
      // Ignore disconnect errors from already released nodes.
    }
  }

  state.activeMasterGain = null;
}

function stopAlertPlayback() {
  clearTimeout(state.activePlaybackTimer);
  state.activePlaybackTimer = null;
  clearPlaybackNodes();
}

function getPatternDuration(pattern) {
  return pattern.reduce((total, note) => total + note.duration + (note.gap || 0), 0) + 0.12;
}

function playPattern(soundName, volumePercent) {
  const context = getAudioContext();
  if (!context || volumePercent <= 0) {
    return;
  }

  const pattern = ALERT_SOUND_PATTERNS[soundName] || ALERT_SOUND_PATTERNS.beacon;
  const masterGain = context.createGain();
  masterGain.gain.value = Math.max(0, Math.min(1, volumePercent / 100)) * 0.95;
  masterGain.connect(context.destination);
  state.activeMasterGain = masterGain;

  let cursor = context.currentTime + 0.01;

  for (const note of pattern) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = note.type || "triangle";
    oscillator.frequency.setValueAtTime(note.frequency, cursor);
    if (note.frequencyTo) {
      oscillator.frequency.linearRampToValueAtTime(note.frequencyTo, cursor + note.duration);
    }

    gain.gain.setValueAtTime(0.0001, cursor);
    gain.gain.exponentialRampToValueAtTime(note.gain || 0.8, cursor + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, cursor + note.duration);

    oscillator.connect(gain);
    gain.connect(masterGain);

    oscillator.onended = () => {
      state.activePlaybackNodes.delete(oscillator);
      state.activePlaybackNodes.delete(gain);
    };

    state.activePlaybackNodes.add(oscillator);
    state.activePlaybackNodes.add(gain);

    oscillator.start(cursor);
    oscillator.stop(cursor + note.duration + 0.05);
    cursor += note.duration + (note.gap || 0.05);
  }

  window.setTimeout(() => {
    if (state.activeMasterGain === masterGain) {
      try {
        masterGain.disconnect();
      } catch (_error) {
        return;
      }
    }
  }, Math.ceil((cursor - context.currentTime + 0.2) * 1000));
}

async function startAlertPlayback({ sound, volume, repeatMode }) {
  stopAlertPlayback();

  const context = getAudioContext();
  if (!context || volume <= 0) {
    return;
  }

  if (context.state === "suspended") {
    await context.resume();
  }

  const pattern = ALERT_SOUND_PATTERNS[sound] || ALERT_SOUND_PATTERNS.beacon;
  const maxCycles = ALERT_REPEAT_MODE_OPTIONS[normalizeRepeatMode(repeatMode)];
  const patternDurationMs = Math.ceil(getPatternDuration(pattern) * 1000) + 180;
  let currentCycle = 0;

  const loop = () => {
    playPattern(sound, volume);
    currentCycle += 1;

    if (Number.isFinite(maxCycles) && currentCycle >= maxCycles) {
      state.activePlaybackTimer = null;
      return;
    }

    state.activePlaybackTimer = window.setTimeout(loop, patternDurationMs);
  };

  loop();
}

function openAlertDialog(alert) {
  const directionLabel = alert.direction === "up" ? "上冲" : "回撤";
  dom.alertDialogTitle.textContent = `净值${directionLabel}预警`;
  dom.alertDialogMessage.textContent = `${alert.windowMinutes} 分钟内 ${formatPercent(alert.deltaPercent)}，净值 ${formatMoney(alert.baselineEquity)} → ${formatMoney(alert.latestEquity)}`;
  dom.alertDialogMeta.textContent = `声音：${describeSound(alert.sound)} · 音量：${alert.volume} · ${describeRepeatMode(alert.repeatMode)}`;
  dom.alertOverlay.hidden = false;
}

function closeAlertDialog() {
  dom.alertOverlay.hidden = true;
  stopAlertPlayback();
}

async function handleEquityAlert(alert) {
  openAlertDialog(alert);

  try {
    await startAlertPlayback(alert);
  } catch (_error) {
    return;
  }
}

async function handleTestAlert() {
  const testPayload = buildTestAlertPayload();
  await handleEquityAlert(testPayload);
  dom.formStatus.textContent = "测试提醒已触发。真实提醒会在新的 5 分钟采样写入后按规则判断。";
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
  dom.testAlertButton.addEventListener("click", handleTestAlert);
  dom.positionModeButton.addEventListener("click", togglePositionMode);
  dom.positionsList.addEventListener("click", (event) => {
    if (event.target.closest(".size-toggle")) {
      togglePositionMode();
    }
  });
  dom.alertDismissButton.addEventListener("click", closeAlertDialog);
  dom.alertStopSoundButton.addEventListener("click", stopAlertPlayback);
  dom.alertDialogCloseButton.addEventListener("click", closeAlertDialog);
  dom.alertOverlay.addEventListener("click", (event) => {
    if (event.target === dom.alertOverlay) {
      closeAlertDialog();
    }
  });
  dom.minimizeButton.addEventListener("click", () => window.binancePanel.minimizeWindow());
  dom.closeButton.addEventListener("click", () => window.binancePanel.quitApp());
}

function bindSubscriptions() {
  window.binancePanel.onSnapshot(renderSnapshot);
  window.binancePanel.onEquityAlert(handleEquityAlert);
}

async function bootstrap() {
  bindEvents();
  bindSubscriptions();

  const [settings, snapshot] = await Promise.all([
    window.binancePanel.getSettings(),
    window.binancePanel.getState()
  ]);

  fillForm(settings);
  renderSnapshot(snapshot);
}

bootstrap();
