# 币安持仓实时板

一个同时支持桌面端和 Web 端的 Binance USDⓈ-M 持仓面板，用于接入只读 API，实时查看账户权益、持仓、浮盈亏、止盈止损，以及按 5 分钟采样的净值历史。

## 当前能力

- 桌面版：`Electron + 原生 HTML/CSS/JS`
- Web 版：本地 Node 服务 + 浏览器页面
- 共享前端：桌面端和 Web 端复用同一套页面、样式和交互逻辑
- 共享运行时：桌面主进程和 Web 服务复用同一套账户快照、净值历史、净值预警能力
- 净值采样：固定每 5 分钟记录一次
- 净值提醒：按 `X 分钟 / Y%` 规则触发，`X` 必须是 5 的倍数

## 目录结构

- `main.js`
  Electron 主进程，只负责窗口和 IPC
- `web-server.js`
  本地 Web 服务入口
- `src/server/panelRuntime.js`
  桌面端与 Web 端共用的运行时编排层
- `src/server/createWebServer.js`
  Web API 与 SSE 推送入口
- `src/server/integrationPorts.js`
  预留的推送接口、云同步接口
- `src/main/binanceService.js`
  币安账户快照与持仓链路
- `src/main/equityHistoryService.js`
  净值采样、历史读取、导出
- `index.html` / `renderer.js`
  主面板
- `equity-history.html` / `equity-history.js`
  净值历史窗口
- `web-bridge.js`
  浏览器桥接层，模拟 `window.binancePanel` 协议
- `preload.js`
  Electron 桥接层，暴露同一份 `window.binancePanel` 协议

## 启动

1. 安装依赖

```bash
npm install
```

2. 启动桌面版

```bash
npm run dev
```

3. 启动 Web 版

```bash
npm run web
```

默认会启动在 [http://127.0.0.1:4580](http://127.0.0.1:4580)。

如果你想直接双击打开网页版，优先使用 [网页版.vbs](D:/OpenAi%20Codex/币安持仓实时板/网页版.vbs)。  
它会自动检查本项目的本地 Web 服务，没启动就后台拉起，再自动打开浏览器。

命令行方式也可以直接用：

```bash
npm run web:open
```

4. 打包桌面版

```bash
npm run dist
```

## Web 版说明

- Web 版目前使用本地 `Node` 服务承载 API 和 SSE 推送，方便后续平滑迁移到云端
- Web 运行时数据默认写入项目目录下的 `.web-runtime/`
- Web 与桌面已经共用一套前端页面，后续 UI 和功能迭代默认同时落到两端

## 已预留的扩展口

- 推送接口
  `src/server/integrationPorts.js` 中的 `PushGateway`
- 上云同步接口
  `src/server/integrationPorts.js` 中的 `CloudGateway`
- Web / Android / 其他客户端统一接入协议
  `window.binancePanel` 前端桥接协议
- 浏览器实时推送
  `/api/events` SSE

## 当前 Web API

- `GET /api/settings`
- `POST /api/settings`
- `GET /api/state`
- `POST /api/refresh`
- `GET /api/history`
- `GET /api/history/export?intervalMinutes=15`
- `GET /api/history/storage`
- `GET /api/events`

## 币安接口链路

- 账户快照
  - `GET /fapi/v3/account`
  - `GET /fapi/v3/positionRisk`
- 条件单 / 止盈止损补充
  - `GET /fapi/v1/openOrders`
  - `GET /fapi/v1/openAlgoOrders`
- 用户流
  - `POST /fapi/v1/listenKey`
  - `PUT /fapi/v1/listenKey`
  - `wss://fstream.binance.com/ws/<listenKey>`
- 标记价格流
  - `wss://fstream.binance.com/stream?streams=<symbol>@markPrice@1s`

## 安全建议

- 只开启读取权限，不要开启交易权限
- 尽量在币安后台绑定 IP 白名单
- 当前仓库默认不包含真实 API Key / Secret
- Web 版现在是本地运行时，不是公网服务；如果后续上云，Secret 应迁移到服务端密钥管理
