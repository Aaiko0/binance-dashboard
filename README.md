# 币安持仓实时板

一个独立的 Windows 桌面小面板，用来读取 Binance USDⓈ-M 合约账户的只读 API，并实时显示持仓、标记价格、浮盈亏和账户权益。

## 功能

- 小尺寸桌面窗口，适合常驻在屏幕边缘
- 支持保存只读 `API Key / Secret`
- 启动后自动拉取账户快照
- 通过用户数据流接收账户变动
- 通过 `markPrice@1s` 流刷新持仓浮盈亏
- 可一键切换窗口置顶

## 使用

1. 安装依赖

```bash
npm install
```

2. 开发模式启动

```bash
npm run dev
```

3. 打包 Windows 安装包

```bash
npm run dist
```

打包产物会出现在 `release/`。

## API 配置建议

- 使用 Binance 合约账户 API
- 只开“读取”权限，不开交易权限
- 建议在 Binance 后台绑定本机出口 IP 白名单
- 当前版本默认接入 USDⓈ-M 合约接口:
  - REST: `https://fapi.binance.com`
  - WS: `wss://fstream.binance.com`

## 数据链路

- 初始快照:
  - `GET /fapi/v3/account`
  - `GET /fapi/v3/positionRisk`
- 用户实时流:
  - `POST /fapi/v1/listenKey`
  - `PUT /fapi/v1/listenKey`
  - `wss://fstream.binance.com/ws/<listenKey>`
- 标记价格流:
  - `wss://fstream.binance.com/stream?streams=<symbol>@markPrice@1s`

## 说明

- `Secret` 只保存在本机配置目录。Windows 可用系统加密时会优先加密保存。
- 当前版本没有接入下单、改单、撤单能力，只做持仓和权益显示。
- 当前版本默认按 USDⓈ-M 合约账户处理，没有同时覆盖 COIN-M。
