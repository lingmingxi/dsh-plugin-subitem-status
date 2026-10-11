# dsh-plugin-subitem-status

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**插件页**（侧栏「插件」，不是设置页）加上子项状态显示：
每张插件卡片上直接标出这个包里有哪些组件没启用、哪些异常，**不用点进详情页才发现**。

## 解决什么问题

插件页的卡片只反映 **bundle 级**的开关。包开着，但里面某个组件其实没跑起来——
卡片上完全看不出来，必须点进详情页看「包含的组件」那一行才发现。

这个插件把那行状态（`● 运行中` / `● 已关闭` / `● 未运行` / `● 异常`）**原样搬到卡片上**：

```
┌──────────────────────────────────────────────┐
│  ▣  some-plugin-kit                          │
│     一组示例插件                              │
│     主组件   ● 运行中   附属组件  ● 已关闭     │  ← 新增
└──────────────────────────────────────────────┘
```

- 文案与状态点**直接取自官方字典命名空间**，与详情页一字不差；官方改措辞这里跟着变。
- 一个包里**多个组件就逐条列出**，不会只显示第一个。
- 每个组件显示一条状态（包括正常运行），没有组件时不占位。

## 设置页包名提示

设置中的配置页面导航及「插件」内部选项卡，标题下方显示淡色的提供者 npm 包名。
长包名省略显示，鼠标悬停可查看完整名字。

- 从 Slot 注册来源和实际加载的模块清单核对包名，不用中文标题推测。
- 6.0.1 中大量来源被压缩为 `mf`；对此使用已逐条核对注册源码的 ID→包名兜底表，
  且仍要求包名出现在当前模块清单中。表内覆盖 21 个设置页面、5 个内部选项卡。
  未收录的新页面显示「包名未声明」；其他插件覆盖同一 ID 时，此兜底信息可能不再准确。
- 来源未声明或无法确定时，显示「包名未声明」，不输出本机路径。
- 这是排障用的诊断信息，不是提供者身份的安全认证。
- 不读取配置值、聊天记录、账户凭据，不向外部服务发送数据。

## 安装

```bash
dsh plugin add github:lingmingxi/dsh-plugin-subitem-status --profile <你的 profile>
```

或用 tarball / 本地路径：

```bash
npm pack
dsh plugin add ./dsh-plugin-subitem-status-1.1.0.tgz --profile <你的 profile>
```

装完**重启 DSH**（客户端插件生效需要重启，除非 profile 启用了 client-hmr）。

## 设计要点

**纯客户端 DOM 增强，不覆盖 DSH 内核。**

插件页的卡片是内核 `@deepseek-ai/dsh-client-ui-plugin-manager` 里硬编码的 `PackageCard`，
**没有任何卡片级 slot 可用**（可用的只有 `plugins.item` 新增卡片、以及详情页的
`plugins.detail.badge/.actions/.section`）。所以「在父级卡片上显示子项状态」只能走
DOM 增强：观察已渲染的卡片，往里补一行。

- 数据源与官方插件页**同源**：`remote.pluginManager.listBundles()` + `listPlugins()`。
- 卡片定位只用稳定属性 `[data-plugin-package]` / `[data-plugin-panel]`；
  **类名是 CSS-module 哈希，绝不硬编码**。
- 被 React 重渲染抹掉时，由 `MutationObserver` 自动重放（自身写入的回调会跳过，避免死循环）。
- 卸载时清干净：样式、承载行、observer、订阅、定时器。

### 关于 `inject: []`（重要）

本插件的客户端 factory 声明 `inject: []`，所有服务一律用 `ctx.get()` 惰性读取。

这不是偷懒，是**必须的**。cordis 的 `ctx` 是注入代理：读一个没写进 `inject` 的属性会直接抛
`cannot get property "..." without inject`。而 DSH Web 的启动门禁要求**每个 entry 的 fiber 都 active**，
任何一个不合格就整页打不开（`web boot: N entry did not activate`）。

两种写法的实测结果：

| inject 声明 | 服务齐全 | 命名空间缺失 | remote 缺失 |
|---|---|---|---|
| `['remote','locale']` 且直接读 `ctx.remote.pluginManager` | **failed** | failed | failed |
| `['remote','locale','remote.pluginManager']` | active | **pending（照样卡死）** | pending |
| **`[]` + 全部走 `ctx.get()`** | **active** | **active** | **active** |

把命名空间写进 `inject` 看似正确，但该服务尚未挂载时 fiber 会变 `pending`，**同样卡死启动**。
只有 `ctx.get()` 在所有环境下都安全（官方插件页自己也用 `this.ctx.get("productAnalytics")?.`）。

## 测试

```bash
npm test
```

五个套件：

| 文件 | 覆盖内容 |
|---|---|
| `tests/smoke.mjs` | 纯逻辑：状态合成 vs 官方映射、多组件、文案兜底、注册形态 |
| `tests/dom.mjs` | DOM 粘合：单/多组件渲染、挂载位置、重渲染重放、实时更新、卸载清理 |
| `tests/boot-gate.mjs` | **启动门禁**：用真实 cordis 在 5 种服务组合下断言 fiber 必须 active |
| `tests/lifecycle.mjs` | 同步异常、迟到响应、卸载后的回调隔离 |
| `tests/settings.mjs` | 包名来源、未知/路径过滤、设置导航与内部 tab 对齐、重放与清理 |

`boot-gate.mjs` 需要 `@deepseek-ai/cordis`。可用 `DSH_CORDIS_PATH` 指向你自己的
`cordis/lib/index.js`（支持绝对路径和 `file:` URL）；找不到或加载失败则测试失败，避免假绿灯。
`tests/lifecycle.mjs` 另外验证同步异常及卸载后迟到响应不会继续运行。

> 为什么需要 boot-gate：这类 bug 用**普通对象桩测不出来**——桩里的 `ctx.remote` 是普通对象，
> 读 `.pluginManager` 不会报错，而真实 ctx 是注入代理。本插件第一版就是这么炸的，
> 所以补了这个用真实 cordis 的回归测试。

## 兼容性

- 平台：Web（`dsh.client.platform: "web"`）
- 无第三方运行时依赖，不 `require` 任何 Harness Client 包
- 只使用 `--dsw-alias-*` 主题 token，跟随明暗主题

## 许可

MIT
