import { spawn } from "node:child_process";
import { IndicatorSupervisor } from "./interaction/indicator-supervisor.mjs";
const FAKE = "E:/inkos/work/dsh-computer-use/tests/fake-indicator.mjs";
const s = new IndicatorSupervisor({
  exePath: FAKE,
  spawn: (_e, _a, o) => spawn(process.execPath, [FAKE], { ...o, env: { ...process.env, FAKE_CRASH_ON: "updateState" } }),
  trace: (n, d) => console.log("trace", n, JSON.stringify(d)),
});
await s.start();
await s.beginScope({ scopeId: "c1", epoch: 1 });
console.log("state before", s.state);
try { await s.updateState({ active: true }); } catch (e) { console.log("caught", e.message.slice(0, 80)); }
console.log("state after", s.state, "gen", s.generation);
setTimeout(() => { console.log("state later", s.state); process.exit(0); }, 300);
