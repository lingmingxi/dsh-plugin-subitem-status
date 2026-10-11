/**
 * 启动门禁回归测试（用真实 cordis，不是桩）。
 *
 * 背景：2026-10-11 本插件曾因 `inject: ['remote','locale']` 却直接读
 * `ctx.remote.pluginManager`，被 cordis 注入代理抛
 * `cannot get property "remote.pluginManager" without inject`，
 * fiber 停在非 active，触发 Web UI 的 boot gate「1 entry did not activate」，
 * **整页打不开**。
 *
 * 这类 bug 用普通对象桩测不出来（桩里 ctx.remote 是普通对象，不会拒绝读取），
 * 必须用真实 cordis 跑。本文件即为此而设。
 *
 * 断言：client.js 在下列任意环境下都必须让 fiber 进入 active(2)。
 *   1. 服务齐全
 *   2. remote.pluginManager 命名空间缺失
 *   3. remote 服务整体缺失
 *   4. locale 缺失
 *   5. 什么服务都没有（最恶劣）
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * 定位 cordis：优先用本仓库能解析到的副本，其次回落到 DSH 安装目录。
 * 通过 DSH_CORDIS_PATH 环境变量可显式指定。
 * 找不到时跳过本测试（而不是让整个 npm test 失败）。
 */
async function loadCordis() {
  const candidates = [];
  if (process.env.DSH_CORDIS_PATH) candidates.push(process.env.DSH_CORDIS_PATH);
  // 1) 作为依赖解析（若使用者把本仓库装在 DSH profile 里，这里就能命中）
  try {
    const require = createRequire(import.meta.url);
    candidates.push(require.resolve('@deepseek-ai/cordis'));
  } catch { /* 忽略 */ }

  for (const c of candidates) {
    try {
      const url = c.startsWith('file:') ? c : pathToFileURL(c).href;
      const mod = await import(url);
      if (mod.Context && mod.Service) return mod;
    } catch { /* 试下一个 */ }
  }
  return null;
}

const cordis = await loadCordis();
if (cordis === null) {
  console.error('FAIL: 未找到可加载的 @deepseek-ai/cordis。');
  console.error('设置 DSH_CORDIS_PATH 指向 cordis/lib/index.js，再运行测试。');
  process.exit(1);
}
const { Context, Service } = cordis;

const ACTIVE = 2;
const STATE_NAME = { 0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 4: 'disposed', 5: 'unloading' };

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

// ── 复刻官方最小服务形态 ────────────────────────────────────────────
class RemoteService extends Service {
  constructor(ctx) { super(ctx, 'remote'); }
  $on() { return () => {}; }
}
class RemoteNamespaceService extends Service {
  constructor(ctx, name) { super(ctx, 'remote.' + name); }
  listBundles() { return Promise.resolve({ ok: true, value: [] }); }
  listPlugins() { return Promise.resolve({ ok: true, value: [] }); }
}
class LocaleService extends Service {
  constructor(ctx) { super(ctx, 'locale'); }
  bind() { return (k) => k; }
  subscribe() { return () => {}; }
  resolveText(t) { return t; }
}

// ── 从真实 client.js 里取出 factory，确保测的是出货代码而非副本 ──────
const SRC = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function loadFactory() {
  let captured = null;
  const fakeWindow = {
    __ModuleLoader__: { load(def) { captured = def.factory(); } }
  };
  // client.js 是经典脚本：给它 window/document 就能跑完注册段
  const fn = new Function('window', 'document', SRC);
  fn(fakeWindow, undefined);
  if (captured === null) throw new Error('client.js 未通过 __ModuleLoader__.load 注册 factory');
  return captured;
}

const plugin = loadFactory();
console.log(`factory 返回: inject=${JSON.stringify(plugin.inject)}`);
check('inject 必须为空（避免 pending / failed 卡死 boot gate）',
  Array.isArray(plugin.inject) && plugin.inject.length === 0,
  `实际 ${JSON.stringify(plugin.inject)}`);

async function boot(label, env) {
  const plugin = loadFactory(); // 每个场景独立闭包，避免跨场景共享缓存和定时器
  const root = new Context();
  if (env.remote) {
    await root.plugin({ name: 'remote', apply(ctx) {
      new RemoteService(ctx);
      if (env.namespace) ctx.plugin({ name: 'remote.pluginManager', apply(c) { new RemoteNamespaceService(c, 'pluginManager'); } });
    }});
  }
  if (env.locale) await root.plugin({ name: 'locale', apply(ctx) { new LocaleService(ctx); } });

  const fiber = root.plugin({
    name: 'dsh-plugin-subitem-status',
    inject: plugin.inject,
    apply: plugin.apply
  });
  let err = null;
  try { await fiber; } catch (e) { err = e; }
  await new Promise((r) => setTimeout(r, 60));
  const st = fiber.state;
  check(`${label} → active`, st === ACTIVE,
    `state=${st}(${STATE_NAME[st] ?? '?'}) await=${err ? err.message : 'ok'}`);
  return st;
}

console.log('\n启动门禁回归（真实 cordis）:');
await boot('1. 服务齐全',              { remote: true,  namespace: true,  locale: true });
await boot('2. 命名空间缺失',          { remote: true,  namespace: false, locale: true });
await boot('3. remote 整体缺失',       { remote: false, namespace: false, locale: true });
await boot('4. locale 缺失',           { remote: true,  namespace: true,  locale: false });
await boot('5. 什么服务都没有',        { remote: false, namespace: false, locale: false });

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
