/**
 * 降级挂载的回归测试（1.40.3，报告 P1-A）。
 *
 * 宿主导入失败时，插件不再让整个模块导入失败：
 *   * 模块照样可导入，`inject` 不依赖 `tools`；
 *   * `apply()` 注册两条只读路由，`/computer-use/status` 回答 503 + 结构化原因；
 *   * 不注册任何工具，也不启动后端。
 *
 *   node degraded-bootstrap-test.mjs
 */
import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error?.message ?? error}`);
  }
}

console.log('== A. module still imports when the host packages are unreachable ==');
const plugin = await import('./index.js');
check('name is exported', () => assert.equal(plugin.name, 'computer-use'));
check('it does not wait for the tools service', () => assert.deepEqual(plugin.inject, []));
check('apply is callable', () => assert.equal(typeof plugin.apply, 'function'));

console.log('\n== B. apply() mounts a read-only failure surface ==');
const routes = [];
const logs = [];
const fakeCtx = {
  logger: { error: (message) => logs.push(String(message)) },
  inject(names, callback) {
    assert.deepEqual(names, ['webServer']);
    callback({
      effect(fn) { fn(); return () => {}; },
      webServer: { register(route) { routes.push(route); return () => {}; } },
    });
  },
};
plugin.apply(fakeCtx, {});
check('two routes are registered', () => assert.equal(routes.length, 2));
check('status and doctor routes', () => {
  assert.deepEqual(routes.map((route) => route.path).sort(), ['/computer-use/doctor', '/computer-use/status']);
});
check('the mount is logged as degraded', () => {
  assert.ok(logs.some((line) => /degraded mount/.test(line)), `logs: ${logs.join(' | ')}`);
});

const status = routes.find((route) => route.path === '/computer-use/status');
const res = {
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(name, value) { this.headers[name] = value; },
  end(text) { this.body = text; },
};
status.handler({}, res);
const payload = JSON.parse(res.body);
check('it answers 503, not 200 and not 404', () => assert.equal(res.statusCode, 503));
check('the payload says failed, with a stable stage', () => {
  assert.equal(payload.ok, false);
  assert.equal(payload.state, 'failed');
  assert.equal(payload.stage, 'resolve/import');
});
check('the payload names a host-package code', () => {
  assert.match(payload.code, /^(ASAR_RUNTIME_REQUIRED|HOST_PACKAGE_NOT_RESOLVED|HOST_PACKAGE_IMPORT_FAILED|HOST_INSTANCE_CONFLICT|HOST_PACKAGE_LOCAL_COPY)$/);
});
check('it never claims tools are mounted', () => {
  assert.equal(payload.tools, undefined);
  assert.match(payload.note, /no tools, no backend/);
});
check('the content type is JSON', () => assert.match(String(res.headers['content-type']), /application\/json/));

console.log('\n== C. a throwing logger does not take the row down ==');
let threw = false;
try {
  plugin.apply({ logger: { error() { throw new Error('logger broke'); } }, inject() {} }, {});
} catch {
  threw = true;
}
check('apply survives a broken logger and a missing web server', () => assert.equal(threw, false));

console.log(`\n===== ${passed} passed, ${failed} failed =====`);
process.exit(failed === 0 ? 0 : 1);
