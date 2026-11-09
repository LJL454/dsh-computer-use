/**
 * 分层资源（`renderMode: layered`）与 pack 校验（方案 4.6 / 5.3）。
 *
 * 交付资源是 `composite`（帧里已经含尾部动作），所以 layered 这条分支平时根本没被执行过。
 * 这里用一个**夹具包**（`tests/fixtures/layered-pack`：1 帧身体 + 1 帧尾巴片区）把路径跑起来：
 * 引擎必须报 `renderMode: layered`、把部件画出来（`characterFrames` 递增），
 * 并且对"分层却没声明 contentBounds"的坏包明确降级而不是崩。
 *
 *   node layered-pack-test.mjs
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE = join(HERE, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
const FIXTURE = join(HERE, 'tests', 'fixtures', 'layered-pack');

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

if (!existsSync(EXE)) {
  console.error(`FAIL  no helper at ${EXE}`);
  process.exit(2);
}
if (!existsSync(join(FIXTURE, 'pack.json'))) {
  console.error(`FAIL  no layered fixture at ${FIXTURE}（用 work/_scratch/make-layered-fixture.py 生成）`);
  process.exit(2);
}

/** 起一个 helper，跑一段协议，收集事件。`pump` 允许在运行中再发命令。 */
async function run(assetsDir, pump) {
  const child = spawn(EXE, [`--assets=${assetsDir}`], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let carry = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    carry += chunk;
    let index;
    while ((index = carry.indexOf('\n')) >= 0) {
      const line = carry.slice(0, index).trim();
      carry = carry.slice(index + 1);
      if (line !== '') { try { lines.push(JSON.parse(line)); } catch { /* ignore */ } }
    }
  });
  let requestId = 0;
  const send = (message) => child.stdin.write(`${JSON.stringify({ requestId: `l${(requestId += 1)}`, ...message })}\n`);
  const waitFor = async (event, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = lines.findIndex((one) => one.event === event);
      if (found >= 0) return lines.splice(found, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    return null;
  };
  try {
    return await pump({ send, waitFor });
  } finally {
    try { child.kill(); } catch { /* gone */ }
  }
}

console.log('\n== the layered fixture is driven through the real renderer ==');
{
  const result = await run(FIXTURE, async ({ send, waitFor }) => {
    send({ method: 'hello', protocolVersion: 2 });
    const ready = await waitFor('ready');
    send({ method: 'setVisualPreferences', settingsRevision: 1, preferences: { enabled: true, cursorCharacter: true, cursorHalo: false, bannerCharacter: false } });
    await waitFor('visualPreferencesApplied');
    send({ method: 'beginScope', scopeId: 'layered', epoch: 1 });
    const scope = await waitFor('scopeReady');
    await new Promise((resolve) => setTimeout(resolve, 400));
    send({ method: 'health' });
    const first = await waitFor('health');
    await new Promise((resolve) => setTimeout(resolve, 600));
    send({ method: 'health' });
    const second = await waitFor('health');
    send({ method: 'shutdown' });
    await waitFor('closed');
    return { ready, scope, first, second };
  });
  check('the assistant reports layered mode', result.ready?.renderMode === 'layered', String(result.ready?.renderMode));
  check('the fixture pack loads', result.ready?.characterLoaded === true, JSON.stringify({ loaded: result.ready?.characterLoaded }));
  check('the scope is visually ready', result.scope?.visualReady === true, JSON.stringify(result.scope?.counts));
  check('the layered surface is ready', result.first?.characterSurface === 'ready', String(result.first?.characterSurface));
  check('it reports no character error', (result.first?.characterError ?? '') === '', String(result.first?.characterError));
  check('the body and its part actually draw', Number(result.first?.characterFrames) > 0, String(result.first?.characterFrames));
  // 分层部件的相位是连续运动：光标表面必须按部件期限重画，否则单帧片段会僵在那里。
  // （修之前这里恒等：`UpdateCursorPose` 先把期限推到未来再判断，永远等不到下一次。）
  check('the part keeps animating the surface', Number(result.second?.characterFrames) > Number(result.first?.characterFrames), `${result.first?.characterFrames} -> ${result.second?.characterFrames}`);
}

console.log('\n== a layered pack without contentBounds is refused, not crashed ==');
{
  const brokenRoot = mkdtempSync(join(tmpdir(), 'dsh-layered-broken-'));
  // 逐文件复制：`cpSync` 对"目标目录已存在/不存在"的语义容易把整层目录塞进去，这里不要那种惊喜。
  const broken = join(brokenRoot, 'pack');
  mkdirSync(broken, { recursive: true });
  for (const entry of readdirSync(FIXTURE)) {
    copyFileSync(join(FIXTURE, entry), join(broken, entry));
  }
  const document = JSON.parse(readFileSync(join(broken, 'pack.json'), 'utf8'));
  delete document.parts[0].contentBounds;
  writeFileSync(join(broken, 'pack.json'), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  const result = await run(broken, async ({ send, waitFor }) => {
    send({ method: 'hello', protocolVersion: 2 });
    const ready = await waitFor('ready');
    // 角色必须**被要求显示**，否则健康度是 `disabled`（没开），而不是 `degraded`（开了但资源坏）。
    send({ method: 'setVisualPreferences', settingsRevision: 1, preferences: { enabled: true, cursorCharacter: true, cursorHalo: false } });
    await waitFor('visualPreferencesApplied');
    send({ method: 'beginScope', scopeId: 'broken', epoch: 1 });
    const scope = await waitFor('scopeReady');
    send({ method: 'health' });
    const health = await waitFor('health');
    send({ method: 'shutdown' });
    await waitFor('closed');
    return { ready, scope, health };
  });
  rmSync(brokenRoot, { recursive: true, force: true });
  check('the helper still starts', result.ready?.protocolVersion === 2, JSON.stringify(result.ready?.protocolVersion));
  check('the broken pack is not loaded', result.ready?.characterLoaded === false, String(result.ready?.characterLoaded));
  check('the base prompt is still ready', result.scope?.visualReady === true, JSON.stringify(result.scope?.counts));
  check('the character degrades instead of taking the overlay down', result.health?.characterSurface === 'degraded', String(result.health?.characterSurface));
  check('and the reason names the missing field', /contentBounds/.test(String(result.health?.characterError)), String(result.health?.characterError));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
