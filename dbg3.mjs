import { IndicatorSupervisor } from "./interaction/indicator-supervisor.mjs";
const real = "E:/inkos/work/dsh-computer-use/native/indicator-helper/build/dsh-interaction-indicator.exe";
const s = new IndicatorSupervisor({ exePath: real, timeouts: { startMs: 3000 } });
try {
  const ready = await s.start();
  console.log("ready:", JSON.stringify(ready).slice(0, 200));
  console.log("stderr:", s.stderrTail);
  await s.stop();
} catch (e) {
  console.log("ERR", e.message);
  console.log("state", s.state, "stderr", JSON.stringify(s.stderrTail));
  await s.stop();
}
process.exit(0);
