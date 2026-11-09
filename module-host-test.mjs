/**
 * PR18（条件项）—— 可选扩展的宿主管家（方案 4.21）。
 *
 * 这一层的价值全在**边界**上，所以断言也围着边界写：
 *
 *   - 没装的扩展没有任何开销（管家不扫目录，列表就是空）；
 *   - 装完是 `installed-disabled`，`enable` 只是保存选择，`activate` 才真的跑；
 *   - 停用**先**改准入代次：旧代次请求（含收尾期间到达的）一律拒；
 *   - 扩展抛错只把自己标成 `failed`，核心与其它扩展不受影响；
 *   - 工具只能落在 `module.<id>.` 下，`computer_*` 这类核心名字一律拒绝；
 *   - 还有在途作业时 `uninstall` 报 `uninstall-pending`，不谎报已卸载。
 *
 *   node module-host-test.mjs
 */
import {
  HOST_API_VERSION,
  MODULE_PROTOCOL_VERSION,
  createModuleHost,
  inspectManifest,
  satisfiesHostApiRange,
} from './internal/module-host.mjs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

const manifest = (overrides = {}) => ({
  moduleId: 'demo.module',
  moduleVersion: '0.1.0',
  hostApiRange: '^1.0.0',
  moduleProtocolVersion: MODULE_PROTOCOL_VERSION,
  entry: 'dist/index.js',
  permissions: ['tools'],
  platforms: [process.platform],
  architectures: [process.arch],
  ...overrides,
});

console.log('\n== the host API range is checked, not assumed ==');
check('a caret range admits the current major', satisfiesHostApiRange('^1.0.0', '1.4.2') === true);
check('and refuses the next major', satisfiesHostApiRange('^1.0.0', '2.0.0') === false);
check('a comparator range works', satisfiesHostApiRange('>=1.0.0 <2.0.0', '1.9.9') === true && satisfiesHostApiRange('>=1.0.0 <2.0.0', '2.0.1') === false);
check('1.x works', satisfiesHostApiRange('1.x', '1.2.3') === true && satisfiesHostApiRange('1.x', '0.9.0') === false);
check('a wildcard admits everything', satisfiesHostApiRange('*') === true);
check('a range nobody can parse is refused', satisfiesHostApiRange('latest') === false);

console.log('\n== manifest: unknown required fields and bad paths are refused ==');
{
  const good = inspectManifest(manifest());
  check('a well formed manifest passes', good.ok === true, JSON.stringify(good.problems));
  check('it reports the protocol it was built for', good.manifest?.moduleProtocolVersion === MODULE_PROTOCOL_VERSION);
  const traversal = inspectManifest(manifest({ entry: '../../escape.js' }));
  check('a traversing entry is refused', traversal.ok === false && traversal.problems.some((one) => /traverse/.test(one)), JSON.stringify(traversal.problems));
  const absolute = inspectManifest(manifest({ entry: 'C:/Windows/System32/x.js' }));
  check('an absolute entry is refused', absolute.ok === false, JSON.stringify(absolute.problems));
  const wrongProtocol = inspectManifest(manifest({ moduleProtocolVersion: MODULE_PROTOCOL_VERSION + 1 }));
  check('an incompatible protocol is refused', wrongProtocol.ok === false && wrongProtocol.problems.some((one) => /protocol/i.test(one)), JSON.stringify(wrongProtocol.problems));
  const wrongApi = inspectManifest(manifest({ hostApiRange: '^9.0.0' }));
  check('an incompatible host API range is refused', wrongApi.ok === false && wrongApi.problems.some((one) => /hostApiRange/.test(one)), JSON.stringify(wrongApi.problems));
  const wrongArch = inspectManifest(manifest({ architectures: ['not-this-one'] }));
  check('a foreign architecture is refused', wrongArch.ok === false && wrongArch.problems.some((one) => /architecture/.test(one)), JSON.stringify(wrongArch.problems));
  const missing = inspectManifest({ moduleId: 'x' });
  check('missing required fields are all named', ['moduleVersion', 'hostApiRange', 'moduleProtocolVersion', 'entry'].every((key) => missing.problems.some((one) => one.includes(key))), JSON.stringify(missing.problems));
  const slug = inspectManifest(manifest({ moduleId: 'Demo Module' }));
  check('a non-slug moduleId is refused', slug.ok === false && slug.problems.some((one) => /lowercase slug/.test(one)), JSON.stringify(slug.problems));
  check('the host API version is the one we document', HOST_API_VERSION === '1.0.0', HOST_API_VERSION);
}

console.log('\n== nothing is listed until something is installed ==');
{
  const host = createModuleHost({ trace: () => {} });
  check('an empty host has no modules', host.list().length === 0);
  check('and no tools', host.toolsFor('demo.module').length === 0);
  check('an unknown module is not admitted', host.admits('demo.module', { admissionEpoch: 1 }) === false);
}

console.log('\n== install is not enable, and enable is not activate ==');
{
  const calls = [];
  const host = createModuleHost();
  const runtime = {
    activate: (api) => { calls.push(['activate', Object.keys(api).length]); return () => calls.push(['dispose']); },
    quiesce: () => { calls.push(['quiesce']); return { drained: true }; },
    deactivate: () => { calls.push(['deactivate']); },
  };
  const installed = host.install(manifest(), runtime);
  check('install succeeds', installed.ok === true, JSON.stringify(installed.problems));
  check('installing does not call the module', calls.length === 0, JSON.stringify(calls));
  check('the state is installed-disabled', host.get('demo.module').state === 'installed-disabled');
  check('a duplicate install is refused', host.install(manifest(), runtime).ok === false);
  host.enable('demo.module');
  check('enable only records the choice', host.get('demo.module').state === 'enabled-idle' && calls.length === 0, JSON.stringify(calls));
  check('tools can be registered while idle', host.registerTool('demo.module', 'ping', { description: 'p' }).ok === true);
  check('but none is dispatchable before activation', host.toolsFor('demo.module').length === 0);
  const activated = await host.activate('demo.module', { tools: {} });
  check('activate runs the module once', activated.ok === true && calls.length === 1, JSON.stringify(calls));
  check('the module becomes ready', host.get('demo.module').state === 'ready');
  check('and its tools become dispatchable', host.toolsFor('demo.module').length === 1, JSON.stringify(host.toolsFor('demo.module')));
  const again = await host.activate('demo.module', {});
  check('re-activating a ready module is idempotent', again.ok === true && again.alreadyActive === true && again.generation === 1, JSON.stringify(again));
  check('and it does not run the module twice', calls.filter((one) => one[0] === 'activate').length === 1, JSON.stringify(calls));
}

console.log('\n== disabling changes the admission epoch first ==');
{
  const host = createModuleHost();
  const order = [];
  host.install(manifest(), {
    activate: () => () => order.push('dispose'),
    quiesce: () => { order.push('quiesce'); return { drained: true }; },
    deactivate: () => order.push('deactivate'),
  });
  host.enable('demo.module');
  await host.activate('demo.module', {});
  const before = host.get('demo.module').admissionEpoch;
  check('a request of the current epoch is admitted', host.admits('demo.module', { admissionEpoch: before }) === true);
  const quiesced = await host.quiesce('demo.module');
  check('quiesce bumps the epoch', quiesced.admissionEpoch === before + 1, `${before} -> ${quiesced.admissionEpoch}`);
  check('an in-flight request of the old epoch is refused', host.admits('demo.module', { admissionEpoch: before }) === false);
  check('the state is quiescing', host.get('demo.module').state === 'quiescing');
  const deactivated = await host.deactivate('demo.module');
  check('deactivate disposes the module', deactivated.ok === true && order.includes('dispose'), JSON.stringify(order));
  check('it goes back to installed-disabled', host.get('demo.module').state === 'installed-disabled');
  check('the generation is retired', host.get('demo.module').generation === 0);
  check('re-enabling gives a fresh generation', (await host.activate('demo.module', {})).generation === 1);
}

console.log('\n== a module that throws only takes itself down ==');
{
  const host = createModuleHost();
  host.install(manifest(), { activate: () => { throw new Error('the module exploded'); } });
  host.enable('demo.module');
  const outcome = await host.activate('demo.module', {});
  check('activate reports the failure', outcome.ok === false && /exploded/.test(outcome.problems[0]), JSON.stringify(outcome));
  check('the module is marked failed', host.get('demo.module').state === 'failed');
  check('the failure is visible in the listing', host.list()[0].failure === 'the module exploded', JSON.stringify(host.list()[0]));
  check('a failed module has no dispatchable tools', host.toolsFor('demo.module').length === 0);
  host.install(manifest({ moduleId: 'second.module' }), { activate: () => {} });
  host.enable('second.module');
  check('another module is unaffected', (await host.activate('second.module', {})).ok === true);

  const quiesceFails = createModuleHost();
  quiesceFails.install(manifest({ moduleId: 'flaky.module' }), {
    activate: () => {},
    quiesce: () => { throw new Error('cleanup failed'); },
  });
  quiesceFails.enable('flaky.module');
  await quiesceFails.activate('flaky.module', {});
  const result = await quiesceFails.quiesce('flaky.module');
  check('a failed drain is reported as not drained', result.drained === false, JSON.stringify(result));
}

console.log('\n== module tools cannot squat on core names ==');
{
  const host = createModuleHost();
  host.install(manifest(), { activate: () => {} });
  host.enable('demo.module');
  await host.activate('demo.module', {});
  check('a core-prefixed name is refused', host.registerTool('demo.module', 'computer_actions', {}).ok === false);
  check('an app-prefixed name is refused', host.registerTool('demo.module', 'app_launch', {}).ok === false);
  const registered = host.registerTool('demo.module', 'augment', {});
  check('a plain name is namespaced', registered.name === 'module.demo.module.augment', registered.name);
  check('the module cannot register into another namespace', host.toolsFor('other.module').length === 0);
  host.install(manifest({ moduleId: 'other.module' }), { activate: () => {} });
  check('an uninstalled module cannot register tools', host.registerTool('ghost.module', 'x', {}).ok === false);
}

console.log('\n== uninstall refuses to lie about work in flight ==');
{
  const host = createModuleHost();
  host.install(manifest(), { activate: () => {} });
  host.enable('demo.module');
  await host.activate('demo.module', {});
  const inFlight = host.uninstall('demo.module', { inFlight: 2 });
  check('work in flight means uninstall-pending', inFlight.ok === false && inFlight.state === 'uninstall-pending', JSON.stringify(inFlight));
  check('a ready module must be deactivated first', host.uninstall('demo.module').ok === false);
  await host.deactivate('demo.module');
  check('after deactivation it can be removed', host.uninstall('demo.module').ok === true);
  check('and the listing is empty again', host.list().length === 0);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
