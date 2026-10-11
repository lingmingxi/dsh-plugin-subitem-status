import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
function mount(pm) {
  const timers = new Map();
  let sequence = 0, plugin, dispose;
  const window = { __ModuleLoader__: { load(x) { plugin = x.factory(); } } };
  new Function('window', 'document', 'setTimeout', 'clearTimeout', source)(
    window, undefined,
    fn => { const id = ++sequence; timers.set(id, fn); return id; },
    id => timers.delete(id)
  );
  const ctx = {
    get(name) { return name === 'remote.pluginManager' ? pm : undefined; },
    effect(fn) { dispose = fn(); }
  };
  assert.doesNotThrow(() => plugin.apply(ctx));
  return { timers, dispose: () => dispose(), apply: () => plugin.apply(ctx) };
}
const thrown = mount({ listBundles: () => Promise.reject(new Error('offline')), listPlugins() { throw new Error('sync'); } });
await new Promise(resolve => setImmediate(resolve));
assert.ok(thrown.timers.size > 0, '同步异常进入退避，而非让 apply 抛错');
thrown.dispose();
assert.equal(thrown.timers.size, 0);
let resolve;
const pending = mount({ listBundles: () => new Promise(r => { resolve = r; }), listPlugins: async () => ({ ok: true, value: [] }) });
pending.dispose();
resolve({ ok: true, value: [] });
await new Promise(r => setImmediate(r));
assert.equal(pending.timers.size, 0, '卸载后迟到响应不得重建定时器');
console.log('ok 同步异常保护、拒绝 Promise 消费、无 DOM 卸载、迟到响应隔离');
