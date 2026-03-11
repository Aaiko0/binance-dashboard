const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const WebSocket = require("ws");

const ACCOUNT_REFRESH_INTERVAL_MS = 30000;
const POLL_REFRESH_INTERVAL_MS = 3000;
const LISTEN_KEY_REFRESH_INTERVAL_MS = 50 * 60 * 1000;
const ACCOUNT_RECONNECT_BASE_MS = 3000;
const MARK_RECONNECT_BASE_MS = 2000;
const QUOTE_ASSET_SUFFIXES = ["USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH"];

const POWERSHELL_REFRESH_SCRIPT = `
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$baseUrl = if ([string]::IsNullOrWhiteSpace($env:BINANCE_BASE_URL)) { 'https://fapi.binance.com' } else { $env:BINANCE_BASE_URL }
$baseUrl = $baseUrl.TrimEnd('/')
$apiKey = $env:BINANCE_API_KEY
$apiSecret = $env:BINANCE_API_SECRET
$recvWindow = if ([string]::IsNullOrWhiteSpace($env:BINANCE_RECV_WINDOW)) { 5000 } else { [int]$env:BINANCE_RECV_WINDOW }
$headers = @{ 'X-MBX-APIKEY' = $apiKey }
$serverTimeOffset = 0

try {
  $serverTimeResponse = Invoke-WebRequest -Uri "$baseUrl/fapi/v1/time" -Method Get -UseBasicParsing -ErrorAction Stop
  $serverTimePayload = $serverTimeResponse.Content | ConvertFrom-Json
  $serverTimeOffset = [double]$serverTimePayload.serverTime - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
} catch {
  $serverTimeOffset = 0
}

function New-SignedQuery([hashtable]$extraParams = @{}) {
  $parts = New-Object 'System.Collections.Generic.List[string]'

  foreach ($entry in ($extraParams.GetEnumerator() | Sort-Object Name)) {
    if ($null -eq $entry.Value) {
      continue
    }

    $textValue = [string]$entry.Value
    if ([string]::IsNullOrWhiteSpace($textValue)) {
      continue
    }

    $parts.Add(("{0}={1}" -f [System.Uri]::EscapeDataString([string]$entry.Key), [System.Uri]::EscapeDataString($textValue)))
  }

  $timestamp = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $serverTimeOffset)
  $parts.Add("timestamp=$timestamp")
  $parts.Add("recvWindow=$recvWindow")
  $query = [string]::Join('&', $parts)
  $hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($apiSecret))
  $signatureBytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($query))
  $signature = -join ($signatureBytes | ForEach-Object { $_.ToString('x2') })
  return "$query&signature=$signature"
}

function Invoke-BinanceContent([string]$pathname, [hashtable]$extraParams = @{}) {
  $signedQuery = New-SignedQuery $extraParams
  $uri = "$($baseUrl)$($pathname)?$($signedQuery)"
  $response = Invoke-WebRequest -Uri $uri -Headers $headers -Method Get -UseBasicParsing -ErrorAction Stop
  return $response.Content
}

function Add-JsonItems([System.Collections.Generic.List[object]]$target, [string]$jsonText) {
  if ([string]::IsNullOrWhiteSpace($jsonText)) {
    return
  }

  $parsed = $jsonText | ConvertFrom-Json
  $items = if ($parsed -is [System.Array]) { $parsed } else { @($parsed) }
  foreach ($item in $items) {
    [void]$target.Add($item)
  }
}

try {
  $account = Invoke-BinanceContent '/fapi/v3/account' | ConvertFrom-Json
  $positionRiskRaw = Invoke-BinanceContent '/fapi/v3/positionRisk' | ConvertFrom-Json
  $positionRisk = if ($positionRiskRaw -is [System.Array]) { $positionRiskRaw } else { @($positionRiskRaw) }
  $openOrders = New-Object 'System.Collections.Generic.List[object]'
  $algoOrders = New-Object 'System.Collections.Generic.List[object]'

  $activeSymbols = @(
    $positionRisk |
      Where-Object { [math]::Abs([double]$_.positionAmt) -gt 0 } |
      ForEach-Object { $_.symbol } |
      Sort-Object -Unique
  )

  foreach ($symbol in $activeSymbols) {
    try {
      Add-JsonItems $openOrders (Invoke-BinanceContent '/fapi/v1/openOrders' @{ symbol = $symbol })
    } catch {
      continue
    }

    try {
      Add-JsonItems $algoOrders (Invoke-BinanceContent '/fapi/v1/openAlgoOrders' @{ symbol = $symbol; algoType = 'CONDITIONAL' })
    } catch {
      continue
    }
  }

  $result = [pscustomobject]@{
    account = $account
    positionRisk = @($positionRisk)
    openOrders = $openOrders.ToArray()
    algoOrders = $algoOrders.ToArray()
  }

  [Console]::Out.Write(($result | ConvertTo-Json -Depth 10 -Compress))
} catch {
  if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
    [Console]::Error.Write($_.ErrorDetails.Message)
  } else {
    [Console]::Error.Write($_.Exception.Message)
  }

  exit 1
}
`;

function toNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function normalizePositionSide(value) {
  const next = String(value || "BOTH").toUpperCase();
  return next || "BOTH";
}

function positionKey(symbol, positionSide) {
  return `${symbol}:${normalizePositionSide(positionSide)}`;
}

function computeUnrealized(positionAmt, markPrice, entryPrice) {
  return (markPrice - entryPrice) * positionAmt;
}

function normalizeOrderList(payload) {
  if (!payload) {
    return [];
  }

  return Array.isArray(payload) ? payload : [payload];
}

function inferBaseAsset(symbol, marginAsset) {
  const nextSymbol = String(symbol || "").toUpperCase();
  const nextMarginAsset = String(marginAsset || "").toUpperCase();

  if (!nextSymbol) {
    return "";
  }

  if (nextMarginAsset && nextSymbol.endsWith(nextMarginAsset)) {
    return nextSymbol.slice(0, -nextMarginAsset.length);
  }

  const quoteSuffix = QUOTE_ASSET_SUFFIXES.find((suffix) => nextSymbol.endsWith(suffix));
  if (!quoteSuffix) {
    return nextSymbol;
  }

  return nextSymbol.slice(0, -quoteSuffix.length);
}

function normalizePosition(source = {}) {
  const symbol = String(source.symbol || source.s || "").toUpperCase();
  const positionSide = normalizePositionSide(source.positionSide || source.ps);
  const positionAmt = toNumber(source.positionAmt ?? source.pa);
  const entryPrice = toNumber(source.entryPrice ?? source.ep);
  const breakEvenPrice = toNumber(source.breakEvenPrice ?? source.bep);
  const markPrice = toNumber(source.markPrice ?? source.mp);
  const leverage = Math.max(1, toNumber(source.leverage));
  const isolatedWallet = toNumber(source.isolatedWallet ?? source.iw);
  const initialMargin = toNumber(source.initialMargin ?? source.positionInitialMargin);
  const liquidationPrice = toNumber(source.liquidationPrice);
  const marginAsset = String(source.marginAsset || source.ma || "").toUpperCase() || "USDT";
  const notional = Math.abs(toNumber(source.notional)) || Math.abs(positionAmt * markPrice);
  const unrealizedProfit = source.unRealizedProfit !== undefined
    ? toNumber(source.unRealizedProfit)
    : source.unrealizedProfit !== undefined
      ? toNumber(source.unrealizedProfit)
      : source.up !== undefined
        ? toNumber(source.up)
        : computeUnrealized(positionAmt, markPrice, entryPrice);
  const marginType = String(source.marginType || source.mt || "cross").toLowerCase();
  const displaySide = positionSide !== "BOTH" ? positionSide : positionAmt >= 0 ? "LONG" : "SHORT";
  const usedMargin = isolatedWallet > 0 ? isolatedWallet : initialMargin > 0 ? initialMargin : leverage > 0 ? notional / leverage : 0;
  const roePercent = usedMargin > 0 ? (unrealizedProfit / usedMargin) * 100 : 0;
  const baseAsset = String(source.baseAsset || inferBaseAsset(symbol, marginAsset)).toUpperCase();

  return {
    key: positionKey(symbol, positionSide),
    symbol,
    positionSide,
    displaySide,
    positionAmt,
    size: Math.abs(positionAmt),
    entryPrice,
    breakEvenPrice,
    markPrice,
    leverage,
    notional,
    unrealizedProfit,
    liquidationPrice,
    isolatedWallet,
    initialMargin,
    marginType,
    marginAsset,
    baseAsset,
    roePercent,
    takeProfitPrice: toNumber(source.takeProfitPrice),
    stopLossPrice: toNumber(source.stopLossPrice),
    takeProfitExtraCount: Math.max(0, Math.trunc(toNumber(source.takeProfitExtraCount))),
    stopLossExtraCount: Math.max(0, Math.trunc(toNumber(source.stopLossExtraCount))),
    updateTime: toNumber(source.updateTime) || Date.now()
  };
}

function extractProtectionKind(order = {}) {
  if (toNumber(order.tpTriggerPrice) > 0) {
    return "takeProfit";
  }

  if (toNumber(order.slTriggerPrice) > 0) {
    return "stopLoss";
  }

  const markers = [
    order.orderType,
    order.type,
    order.origType,
    order.stopOrderType
  ]
    .filter(Boolean)
    .map((item) => String(item).toUpperCase());

  if (markers.some((item) => item.includes("TAKE_PROFIT"))) {
    return "takeProfit";
  }

  if (markers.some((item) => item === "STOP" || item.includes("STOP"))) {
    return "stopLoss";
  }

  return "";
}

function extractProtectionPrice(order = {}, kind) {
  const keys = kind === "takeProfit"
    ? ["tpTriggerPrice", "triggerPrice", "stopPrice", "activatePrice", "price"]
    : ["slTriggerPrice", "stopPrice", "triggerPrice", "activatePrice", "price"];

  for (const key of keys) {
    const price = toNumber(order[key]);
    if (price > 0) {
      return price;
    }
  }

  return 0;
}

function chooseLatestCandidate(candidates) {
  if (!candidates.length) {
    return null;
  }

  return candidates
    .slice()
    .sort((left, right) => {
      const updateGap = right.updateTime - left.updateTime;
      return updateGap !== 0 ? updateGap : right.price - left.price;
    })[0];
}

function matchesPosition(order, position) {
  const orderSymbol = String(order.symbol || "").toUpperCase();
  if (orderSymbol !== position.symbol) {
    return false;
  }

  const orderPositionSide = normalizePositionSide(order.positionSide || order.ps);
  return orderPositionSide === position.positionSide
    || orderPositionSide === "BOTH"
    || position.positionSide === "BOTH";
}

function annotatePositionProtection(position, openOrders, algoOrders) {
  const candidates = {
    takeProfit: [],
    stopLoss: []
  };

  for (const order of [...normalizeOrderList(openOrders), ...normalizeOrderList(algoOrders)]) {
    if (!matchesPosition(order, position)) {
      continue;
    }

    const kind = extractProtectionKind(order);
    if (!kind) {
      continue;
    }

    const price = extractProtectionPrice(order, kind);
    if (price <= 0) {
      continue;
    }

    candidates[kind].push({
      price,
      updateTime: toNumber(order.updateTime || order.time || order.createTime || order.workingTime || order.orderId)
    });
  }

  const takeProfit = chooseLatestCandidate(candidates.takeProfit);
  const stopLoss = chooseLatestCandidate(candidates.stopLoss);

  return {
    ...position,
    baseAsset: position.baseAsset || inferBaseAsset(position.symbol, position.marginAsset),
    takeProfitPrice: takeProfit?.price || 0,
    stopLossPrice: stopLoss?.price || 0,
    takeProfitExtraCount: Math.max(candidates.takeProfit.length - 1, 0),
    stopLossExtraCount: Math.max(candidates.stopLoss.length - 1, 0)
  };
}

function cloneSnapshot(snapshot) {
  return {
    ...snapshot,
    positions: snapshot.positions.map((position) => ({ ...position }))
  };
}

function buildEmptySnapshot() {
  return {
    configured: false,
    status: "idle",
    connectionLabel: "等待配置",
    accountAlias: "我的币安账户",
    error: "",
    updatedAt: "",
    lastEventAt: "",
    walletBalance: 0,
    totalMarginBalance: 0,
    availableBalance: 0,
    totalUnrealizedProfit: 0,
    totalPositionInitialMargin: 0,
    positionCount: 0,
    positions: []
  };
}

function parseJsonResponse(text) {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return {
      msg: text
    };
  }
}

function runPowerShellScript(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "-"
      ],
      {
        windowsHide: true,
        env,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(stderr.trim() || `PowerShell exited with code ${code}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    child.stdin.end(`${script}\n`, "utf8");
  });
}

class BinancePositionsService extends EventEmitter {
  constructor() {
    super();
    this.settings = null;
    this.snapshot = buildEmptySnapshot();
    this.assetMap = new Map();
    this.positionsMap = new Map();
    this.serverTimeOffset = 0;
    this.listenKey = "";
    this.userSocket = null;
    this.markSocket = null;
    this.activeMarkStreamKey = "";
    this.keepAliveTimer = null;
    this.fullRefreshTimer = null;
    this.accountRefreshTimer = null;
    this.userReconnectTimer = null;
    this.markReconnectTimer = null;
    this.accountReconnectAttempts = 0;
    this.markReconnectAttempts = 0;
    this.sessionId = 0;
    this.refreshInFlight = null;
    this.preferPowerShellTransport = process.platform === "win32";
  }

  hydrateFromSettings(settings = {}) {
    this.settings = { ...settings };
    this.snapshot = {
      ...this.snapshot,
      configured: Boolean(settings.apiKey && settings.apiSecret),
      accountAlias: settings.accountAlias || buildEmptySnapshot().accountAlias,
      connectionLabel: settings.apiKey && settings.apiSecret ? "待连接" : "等待配置"
    };
    this.emitSnapshot();
  }

  getSnapshot() {
    return cloneSnapshot(this.snapshot);
  }

  async start(settings) {
    this.stop({ emitSnapshot: false });
    this.settings = { ...settings };
    this.assetMap.clear();
    this.positionsMap.clear();
    this.serverTimeOffset = 0;
    this.listenKey = "";
    this.activeMarkStreamKey = "";
    this.accountReconnectAttempts = 0;
    this.markReconnectAttempts = 0;
    this.sessionId += 1;
    const sessionId = this.sessionId;

    this.snapshot = {
      ...buildEmptySnapshot(),
      configured: true,
      status: "connecting",
      connectionLabel: "连接中",
      accountAlias: this.settings.accountAlias || buildEmptySnapshot().accountAlias
    };
    this.emitSnapshot();

    try {
      if (this.shouldUsePowerShellTransport()) {
        await this.refreshSnapshot(sessionId);
        this.scheduleFullRefresh(sessionId);
        return;
      }

      await this.syncServerTime();
      await this.refreshSnapshot(sessionId);
      await this.openListenKey();
      this.connectUserSocket(sessionId);
      this.scheduleKeepAlive();
      this.scheduleFullRefresh(sessionId);
    } catch (error) {
      this.handleFatalError(error);
    }
  }

  stop({ emitSnapshot = true } = {}) {
    this.sessionId += 1;
    this.listenKey = "";
    this.serverTimeOffset = 0;
    this.assetMap.clear();
    this.positionsMap.clear();
    this.refreshInFlight = null;
    this.clearTimers();
    this.closeSocket(this.userSocket);
    this.closeSocket(this.markSocket);
    this.userSocket = null;
    this.markSocket = null;
    this.activeMarkStreamKey = "";

    if (emitSnapshot) {
      this.snapshot = {
        ...buildEmptySnapshot(),
        configured: Boolean(this.settings?.apiKey && this.settings?.apiSecret),
        accountAlias: this.settings?.accountAlias || buildEmptySnapshot().accountAlias,
        connectionLabel: this.settings?.apiKey && this.settings?.apiSecret ? "已停止" : "等待配置"
      };
      this.emitSnapshot();
    }
  }

  dispose() {
    this.stop({ emitSnapshot: false });
  }

  async syncServerTime() {
    try {
      const response = await this.publicRequest("/fapi/v1/time");
      this.serverTimeOffset = toNumber(response.serverTime) - Date.now();
    } catch (_error) {
      this.serverTimeOffset = 0;
    }
  }

  async refreshSnapshot(sessionId = this.sessionId) {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = (async () => {
      if (this.shouldUsePowerShellTransport()) {
        const payload = await this.refreshSnapshotViaPowerShell();

        if (sessionId !== this.sessionId) {
          return;
        }

        this.applyAccountSnapshot(
          payload.account,
          payload.positionRisk,
          {
            status: "live",
            connectionLabel: "REST 轮询在线",
            error: "",
            skipMarkSocket: true
          },
          {
            openOrders: payload.openOrders,
            algoOrders: payload.algoOrders
          }
        );
        return;
      }

      const [account, positionRisk] = await Promise.all([
        this.signedRequest("GET", "/fapi/v3/account"),
        this.signedRequest("GET", "/fapi/v3/positionRisk")
      ]);

      if (sessionId !== this.sessionId) {
        return;
      }

      this.applyAccountSnapshot(account, positionRisk);
    })();

    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  applyAccountSnapshot(account, positionRiskList, snapshotMeta = {}, orderMeta = {}) {
    this.assetMap.clear();
    for (const asset of account.assets || []) {
      this.assetMap.set(asset.asset, {
        asset: asset.asset,
        walletBalance: toNumber(asset.walletBalance),
        availableBalance: toNumber(asset.availableBalance),
        crossWalletBalance: toNumber(asset.crossWalletBalance),
        updateTime: Date.now()
      });
    }

    const accountPositionMap = new Map();
    for (const accountPosition of account.positions || []) {
      accountPositionMap.set(positionKey(accountPosition.symbol, accountPosition.positionSide), accountPosition);
    }

    const openOrders = normalizeOrderList(orderMeta.openOrders);
    const algoOrders = normalizeOrderList(orderMeta.algoOrders);
    this.positionsMap.clear();

    for (const riskPosition of normalizeOrderList(positionRiskList)) {
      const merged = normalizePosition({
        ...(accountPositionMap.get(positionKey(riskPosition.symbol, riskPosition.positionSide)) || {}),
        ...riskPosition
      });

      if (merged.size <= 0) {
        continue;
      }

      this.positionsMap.set(merged.key, annotatePositionProtection(merged, openOrders, algoOrders));
    }

    this.rebuildSnapshot({
      walletBalance: toNumber(account.totalWalletBalance),
      totalMarginBalance: toNumber(account.totalMarginBalance),
      availableBalance: toNumber(account.availableBalance),
      totalPositionInitialMargin: toNumber(account.totalPositionInitialMargin),
      status: snapshotMeta.status,
      connectionLabel: snapshotMeta.connectionLabel,
      error: snapshotMeta.error,
      updatedAt: new Date().toISOString()
    });

    if (!snapshotMeta.skipMarkSocket) {
      this.refreshMarkSocket(this.sessionId);
    }
  }

  applyAccountUpdate(payload) {
    const accountPayload = payload.a || {};

    for (const balance of accountPayload.B || []) {
      const current = this.assetMap.get(balance.a) || {
        asset: balance.a,
        availableBalance: 0,
        crossWalletBalance: 0,
        walletBalance: 0
      };

      this.assetMap.set(balance.a, {
        ...current,
        asset: balance.a,
        walletBalance: toNumber(balance.wb),
        crossWalletBalance: toNumber(balance.cw),
        updateTime: Date.now()
      });
    }

    for (const rawPosition of accountPayload.P || []) {
      const nextPosition = normalizePosition({
        ...(this.positionsMap.get(positionKey(rawPosition.s, rawPosition.ps)) || {}),
        symbol: rawPosition.s,
        positionSide: rawPosition.ps,
        positionAmt: rawPosition.pa,
        entryPrice: rawPosition.ep,
        breakEvenPrice: rawPosition.bep,
        unrealizedProfit: rawPosition.up,
        marginType: rawPosition.mt,
        isolatedWallet: rawPosition.iw,
        updateTime: Date.now()
      });

      if (nextPosition.size > 0) {
        this.positionsMap.set(nextPosition.key, nextPosition);
      } else {
        this.positionsMap.delete(nextPosition.key);
      }
    }

    this.rebuildSnapshot({
      updatedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString()
    });
    this.refreshMarkSocket(this.sessionId);
    this.scheduleAccountRefresh(this.sessionId);
  }

  applyMarkPriceUpdate(update) {
    const symbol = String(update.s || "").toUpperCase();
    const markPrice = toNumber(update.p);

    if (!symbol || !markPrice) {
      return;
    }

    let changed = false;

    for (const [key, position] of this.positionsMap.entries()) {
      if (position.symbol !== symbol) {
        continue;
      }

      const nextPosition = normalizePosition({
        ...position,
        markPrice,
        notional: Math.abs(position.positionAmt * markPrice),
        unrealizedProfit: computeUnrealized(position.positionAmt, markPrice, position.entryPrice),
        updateTime: Date.now()
      });

      this.positionsMap.set(key, nextPosition);
      changed = true;
    }

    if (changed) {
      this.rebuildSnapshot({
        updatedAt: new Date().toISOString()
      });
    }
  }

  rebuildSnapshot(overrides = {}) {
    const positions = Array.from(this.positionsMap.values())
      .filter((position) => position.size > 0)
      .sort((left, right) => {
        const notionalGap = Math.abs(right.notional) - Math.abs(left.notional);
        return notionalGap !== 0 ? notionalGap : left.symbol.localeCompare(right.symbol);
      });

    const assetValues = Array.from(this.assetMap.values());
    const fallbackWalletBalance = assetValues.reduce((total, asset) => total + asset.walletBalance, 0);
    const fallbackAvailableBalance = assetValues.reduce((total, asset) => total + asset.availableBalance, 0);
    const totalUnrealizedProfit = positions.reduce((total, position) => total + position.unrealizedProfit, 0);
    const walletBalance = overrides.walletBalance ?? this.snapshot.walletBalance ?? fallbackWalletBalance;
    const totalMarginBalance = overrides.totalMarginBalance ?? (walletBalance + totalUnrealizedProfit);
    const availableBalance = overrides.availableBalance ?? this.snapshot.availableBalance ?? fallbackAvailableBalance;
    const totalPositionInitialMargin = overrides.totalPositionInitialMargin
      ?? positions.reduce((total, position) => total + position.initialMargin, 0);

    this.snapshot = {
      ...this.snapshot,
      status: overrides.status || (this.snapshot.status === "error" ? "error" : this.snapshot.status),
      connectionLabel: overrides.connectionLabel || this.snapshot.connectionLabel,
      walletBalance,
      totalMarginBalance,
      availableBalance,
      totalUnrealizedProfit,
      totalPositionInitialMargin,
      positionCount: positions.length,
      positions,
      updatedAt: overrides.updatedAt || new Date().toISOString(),
      lastEventAt: overrides.lastEventAt || this.snapshot.lastEventAt,
      error: overrides.error ?? this.snapshot.error
    };

    this.emitSnapshot();
  }

  async openListenKey() {
    const result = await this.apiKeyRequest("POST", "/fapi/v1/listenKey");
    this.listenKey = String(result.listenKey || "");
    if (!this.listenKey) {
      throw new Error("未拿到 listenKey，无法建立账户实时流");
    }
  }

  connectUserSocket(sessionId) {
    this.closeSocket(this.userSocket);
    const socket = new WebSocket(`${this.settings.wsBaseUrl}/ws/${this.listenKey}`);
    this.userSocket = socket;

    socket.on("open", () => {
      if (sessionId !== this.sessionId || socket !== this.userSocket) {
        return;
      }

      this.accountReconnectAttempts = 0;
      this.snapshot = {
        ...this.snapshot,
        status: "live",
        connectionLabel: "账户流在线",
        error: ""
      };
      this.emitSnapshot();
    });

    socket.on("message", (raw) => {
      if (sessionId !== this.sessionId || socket !== this.userSocket) {
        return;
      }

      try {
        const payload = JSON.parse(raw.toString());
        if (payload.e === "ACCOUNT_UPDATE") {
          this.applyAccountUpdate(payload);
        }
      } catch (_error) {
        return;
      }
    });

    socket.on("close", () => {
      if (sessionId !== this.sessionId || socket !== this.userSocket) {
        return;
      }

      this.scheduleUserReconnect(sessionId);
    });

    socket.on("error", (error) => {
      if (sessionId !== this.sessionId || socket !== this.userSocket) {
        return;
      }

      this.snapshot = {
        ...this.snapshot,
        status: "error",
        connectionLabel: "账户流异常",
        error: error.message || "账户流连接失败"
      };
      this.emitSnapshot();
    });
  }

  refreshMarkSocket(sessionId) {
    const symbols = Array.from(new Set(Array.from(this.positionsMap.values()).map((position) => position.symbol.toLowerCase())));
    const nextStreamKey = symbols.map((symbol) => `${symbol}@markPrice@1s`).join("/");

    if (nextStreamKey === this.activeMarkStreamKey && this.markSocket) {
      return;
    }

    this.activeMarkStreamKey = nextStreamKey;
    this.closeSocket(this.markSocket);
    this.markSocket = null;

    if (!nextStreamKey) {
      return;
    }

    const socket = new WebSocket(`${this.settings.wsBaseUrl}/stream?streams=${nextStreamKey}`);
    this.markSocket = socket;

    socket.on("open", () => {
      if (sessionId !== this.sessionId || socket !== this.markSocket) {
        return;
      }

      this.markReconnectAttempts = 0;
    });

    socket.on("message", (raw) => {
      if (sessionId !== this.sessionId || socket !== this.markSocket) {
        return;
      }

      try {
        const payload = JSON.parse(raw.toString());
        const data = payload.data || payload;
        if (data.e === "markPriceUpdate") {
          this.applyMarkPriceUpdate(data);
        }
      } catch (_error) {
        return;
      }
    });

    socket.on("close", () => {
      if (socket === this.markSocket) {
        this.markSocket = null;
      }

      if (sessionId !== this.sessionId || !this.activeMarkStreamKey) {
        return;
      }

      this.scheduleMarkReconnect(sessionId);
    });
  }

  scheduleKeepAlive() {
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = setInterval(async () => {
      try {
        await this.apiKeyRequest("PUT", "/fapi/v1/listenKey");
      } catch (_error) {
        return;
      }
    }, LISTEN_KEY_REFRESH_INTERVAL_MS);
  }

  scheduleFullRefresh(sessionId) {
    clearInterval(this.fullRefreshTimer);
    const intervalMs = this.shouldUsePowerShellTransport() ? POLL_REFRESH_INTERVAL_MS : ACCOUNT_REFRESH_INTERVAL_MS;
    this.fullRefreshTimer = setInterval(async () => {
      if (sessionId !== this.sessionId) {
        return;
      }

      try {
        await this.refreshSnapshot(sessionId);
      } catch (error) {
        this.snapshot = {
          ...this.snapshot,
          status: "error",
          connectionLabel: this.shouldUsePowerShellTransport() ? "REST 轮询失败" : "刷新失败",
          error: error.message || "刷新失败"
        };
        this.emitSnapshot();
      }
    }, intervalMs);
  }

  scheduleAccountRefresh(sessionId) {
    clearTimeout(this.accountRefreshTimer);
    this.accountRefreshTimer = setTimeout(async () => {
      if (sessionId !== this.sessionId) {
        return;
      }

      try {
        await this.refreshSnapshot(sessionId);
      } catch (_error) {
        return;
      }
    }, 800);
  }

  scheduleUserReconnect(sessionId) {
    clearTimeout(this.userReconnectTimer);
    const delay = Math.min(15000, ACCOUNT_RECONNECT_BASE_MS * (this.accountReconnectAttempts + 1));
    this.accountReconnectAttempts += 1;

    this.snapshot = {
      ...this.snapshot,
      status: "connecting",
      connectionLabel: `账户流重连 ${Math.round(delay / 1000)}s`
    };
    this.emitSnapshot();

    this.userReconnectTimer = setTimeout(async () => {
      if (sessionId !== this.sessionId) {
        return;
      }

      try {
        await this.start(this.settings);
      } catch (_error) {
        return;
      }
    }, delay);
  }

  scheduleMarkReconnect(sessionId) {
    clearTimeout(this.markReconnectTimer);
    const delay = Math.min(10000, MARK_RECONNECT_BASE_MS * (this.markReconnectAttempts + 1));
    this.markReconnectAttempts += 1;

    this.markReconnectTimer = setTimeout(() => {
      if (sessionId !== this.sessionId) {
        return;
      }

      this.refreshMarkSocket(sessionId);
    }, delay);
  }

  handleFatalError(error) {
    this.snapshot = {
      ...this.snapshot,
      status: "error",
      connectionLabel: "连接失败",
      error: error.message || "未知错误"
    };
    this.emitSnapshot();
  }

  async publicRequest(pathname) {
    const url = new URL(pathname, this.settings?.restBaseUrl || "https://fapi.binance.com");
    const response = await fetch(url);
    const text = await response.text();
    const payload = parseJsonResponse(text);

    if (!response.ok) {
      throw new Error(payload.msg || `${pathname} 请求失败`);
    }

    return payload;
  }

  async signedRequest(method, pathname, extraParams = new URLSearchParams()) {
    const params = new URLSearchParams(extraParams);
    params.set("timestamp", String(Date.now() + this.serverTimeOffset));
    params.set("recvWindow", String(this.settings.recvWindow || 5000));

    const signature = crypto
      .createHmac("sha256", this.settings.apiSecret)
      .update(params.toString())
      .digest("hex");

    params.set("signature", signature);
    return this.request(method, pathname, params, false);
  }

  async apiKeyRequest(method, pathname) {
    return this.request(method, pathname, new URLSearchParams(), true);
  }

  async request(method, pathname, searchParams = new URLSearchParams(), apiKeyOnly = false) {
    const url = new URL(pathname, this.settings.restBaseUrl);
    url.search = searchParams.toString();

    const response = await fetch(url, {
      method,
      headers: {
        "X-MBX-APIKEY": this.settings.apiKey
      }
    });

    const text = await response.text();
    const payload = parseJsonResponse(text);

    if (!response.ok) {
      const prefix = apiKeyOnly ? "账户流接口" : "签名接口";
      throw new Error(`${prefix} ${pathname} 失败: ${payload.msg || response.statusText}`);
    }

    return payload;
  }

  clearTimers() {
    clearInterval(this.keepAliveTimer);
    clearInterval(this.fullRefreshTimer);
    clearTimeout(this.accountRefreshTimer);
    clearTimeout(this.userReconnectTimer);
    clearTimeout(this.markReconnectTimer);
    this.keepAliveTimer = null;
    this.fullRefreshTimer = null;
    this.accountRefreshTimer = null;
    this.userReconnectTimer = null;
    this.markReconnectTimer = null;
  }

  closeSocket(socket) {
    if (!socket) {
      return;
    }

    try {
      socket.removeAllListeners();
      socket.close();
    } catch (_error) {
      return;
    }
  }

  emitSnapshot() {
    this.emit("snapshot", cloneSnapshot(this.snapshot));
  }

  shouldUsePowerShellTransport() {
    return this.preferPowerShellTransport;
  }

  async refreshSnapshotViaPowerShell() {
    let stdout = "";
    let stderr = "";

    try {
      const result = await runPowerShellScript(POWERSHELL_REFRESH_SCRIPT, {
        ...process.env,
        BINANCE_BASE_URL: this.settings.restBaseUrl,
        BINANCE_API_KEY: this.settings.apiKey,
        BINANCE_API_SECRET: this.settings.apiSecret,
        BINANCE_RECV_WINDOW: String(this.settings.recvWindow || 5000)
      });

      stdout = result.stdout || "";
      stderr = result.stderr || "";
    } catch (error) {
      stdout = error.stdout || "";
      stderr = error.stderr || error.message || "";
    }

    if (stderr && !stdout) {
      throw new Error(stderr.trim());
    }

    const payload = parseJsonResponse(stdout.trim());
    if (!payload.account || !payload.positionRisk) {
      throw new Error("PowerShell 返回的账户数据不完整");
    }

    return payload;
  }
}

module.exports = {
  BinancePositionsService
};
