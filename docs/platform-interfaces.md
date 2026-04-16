# 平台接口预留说明

这个项目现在已经拆成三层：

## 1. 共享前端协议

前端统一通过 `window.binancePanel` 访问能力，桌面版由 [preload.js](/D:/OpenAi Codex/币安持仓实时板/preload.js) 提供，Web 版由 [web-bridge.js](/D:/OpenAi Codex/币安持仓实时板/web-bridge.js) 提供。

当前协议包含：

- `getSettings()`
- `getState()`
- `saveSettings(payload)`
- `refresh()`
- `openEquityHistoryWindow()`
- `getEquityHistory()`
- `exportEquityHistory(intervalMinutes)`
- `openEquityHistoryFolder()`
- `setAlwaysOnTop(value)`
- `minimizeWindow()`
- `closeWindow()`
- `quitApp()`
- `onSnapshot(callback)`
- `onEquityHistoryUpdated(callback)`
- `onEquityAlert(callback)`

后续 Android 或正式 Web App 只要实现同一份桥接协议，就能直接复用现有前端页面。

## 2. 共享运行时

[src/server/panelRuntime.js](/D:/OpenAi Codex/币安持仓实时板/src/server/panelRuntime.js) 是桌面端与 Web 服务共用的运行时入口，负责组合：

- 配置存储
- 币安账户快照
- 净值历史
- 净值预警

这层已经把 UI 和底层服务解耦，未来接云端或移动端时，不需要复制业务规则。

## 3. 推送与上云扩展口

[src/server/integrationPorts.js](/D:/OpenAi Codex/币安持仓实时板/src/server/integrationPorts.js) 中预留了两个接口：

- `PushGateway`
  用于消息推送、Webhook、企业微信、Telegram、App Push
- `CloudGateway`
  用于云端同步设置、快照、净值历史、预警事件

当前默认是空实现，不影响本地运行；后续只需要替换实现，不需要改 UI 层。

## Web 服务实时推送

Web 版当前使用 SSE：

- `GET /api/events`

事件类型：

- `snapshot`
- `history-updated`
- `alert`

后续如果 Android 需要长连接，可以在这一层平滑切到 WebSocket，而不影响前端渲染逻辑。
