// 纯逻辑冒烟测试：状态合成口径必须与官方详情页「包含的组件」逐行一致。
// 运行：node tests/smoke.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

// client.js 是 classic script，会在 window 上挂纯逻辑；这里用最小 window 桩评估它。
let registered = null;
const sandboxWindow = {
  __ModuleLoader__: { load: (entry) => { registered = entry; } },
};
new Function('window', 'document', 'MutationObserver', 'setTimeout', source)(
  sandboxWindow, undefined, undefined, () => 0
);
const core = sandboxWindow.__dshSubitemStatusCore;

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}\n  actual   ${a}\n  expected ${e}`); }
}

// 1. 状态合成：与官方 rowStateText + rowDotState 同口径
check('运行中', core.stateOf(true, 'active'), { key: 'rowPhaseActive', dot: 'done' });
check('已关闭', core.stateOf(false, null), { key: 'partOff', dot: 'idle' });
check('未运行(启用但 phase 为 null)', core.stateOf(true, null), { key: 'rowStateIdle', dot: 'idle' });
check('异常', core.stateOf(true, 'failed'), { key: 'rowPhaseFailed', dot: 'error' });
check('等待依赖', core.stateOf(true, 'pending'), { key: 'rowPhasePending', dot: 'idle' });
check('加载中', core.stateOf(true, 'loading'), { key: 'rowPhaseLoading', dot: 'ongoing' });
check('卸载中', core.stateOf(true, 'unloading'), { key: 'rowPhaseUnloading', dot: 'ongoing' });
check('关闭优先于 phase', core.stateOf(false, 'active'), { key: 'partOff', dot: 'idle' });

// 2. row 没有 live entry：官方口径 enabled=false
check('无 live entry', core.rowView({ rowId: 'a' }, []), { enabled: false, phase: null });
check('有 live entry', core.rowView({ rowId: 'a', entryId: 'e1' }, [{ entryId: 'e1', enabled: true, fiberPhase: 'active' }]),
  { enabled: true, phase: 'active' });

// 3. 标题口径：本地化优先，回落模块名
check('标题取本地化', core.titleOf({ moduleName: 'm', meta: { title: '中文名' } }, () => 'X'), '中文名');
check('标题回落模块名', core.titleOf({ moduleName: 'm' }, () => 'X'), 'm');
check('标题走 resolveText', core.titleOf({ moduleName: 'm', meta: { title: { zh: '中文', en: 'EN' } } }, () => '中文'), '中文');

// 4. 一个包里有多个组件：逐个显示，顺序与详情页一致
check('多组件逐行', core.buildItems({
  name: 'pkg', rows: [
    { rowId: 'a', moduleName: 'mod-a', entryId: 'e1' },
    { rowId: 'b', moduleName: 'mod-b', entryId: 'e2' },
    { rowId: 'c', moduleName: 'mod-c', entryId: 'e3' },
  ],
}, [
  { entryId: 'e1', enabled: true, fiberPhase: 'active' },
  { entryId: 'e2', enabled: false, fiberPhase: null },
  { entryId: 'e3', enabled: true, fiberPhase: 'active' },
], null), [
  { title: 'mod-a', key: 'rowPhaseActive', dot: 'done' },
  { title: 'mod-b', key: 'partOff', dot: 'idle' },
  { title: 'mod-c', key: 'rowPhaseActive', dot: 'done' },
]);

// 5. 单组件（用户截图那种「共 1 个 · 1 运行中」）
check('单组件', core.buildItems({
  name: 'pkg', rows: [{ rowId: 'a', moduleName: 'mod-a', entryId: 'e1' }],
}, [{ entryId: 'e1', enabled: true, fiberPhase: 'active' }], null),
  [{ title: 'mod-a', key: 'rowPhaseActive', dot: 'done' }]);

// 6. 兜底措辞必须与官方 zh 字典一致
check('兜底文案', core.FALLBACK, {
  partOff: '已关闭', rowStateIdle: '未运行', rowPhasePending: '等待依赖',
  rowPhaseLoading: '加载中', rowPhaseActive: '运行中', rowPhaseFailed: '异常',
  rowPhaseUnloading: '卸载中',
});

// 7. 边界
check('空 bundle', core.buildItems(null, [], null), []);
check('无 rows', core.buildItems({ name: 'p' }, [], null), []);

// 8. 注册形态
check('已注册', registered !== null && registered.id, 'dsh-plugin-subitem-status');
const mod = registered.factory();
// inject 必须为空：服务一律走 ctx.get() 惰性读取。
// 写进 inject 的两种后果都会卡死 boot gate ——
// 读未声明属性抛错(failed)，声明了但服务未挂载则 pending。
check('inject 为空（不阻塞启动门禁）', mod.inject, []);
check('导出 apply', typeof mod.apply, 'function');

if (failed > 0) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log('\n全部通过');
