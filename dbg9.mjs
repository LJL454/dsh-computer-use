import { spawn } from "node:child_process";
const real = "E:/inkos/work/dsh-computer-use/native/indicator-helper/build/dsh-interaction-indicator.exe";
const child = spawn(real, [], { stdio: ["pipe","pipe","pipe"], windowsHide: true });
child.stdout.setEncoding("utf8");
child.stdout.on("data", (c) => {
  for (const line of String(c).split("\n")) {
    if (line.includes('"health"')) console.log("HEALTH", line.trim());
  }
});
const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
send({ requestId: "h", method: "hello", protocolVersion: 1 });
setTimeout(() => send({ requestId: "b", method: "beginScope", scopeId: "cur-2", epoch: 1 }), 200);
for (const t of [600, 1200, 1800]) setTimeout(() => send({ requestId: `k${t}`, method: "health" }), t);
setTimeout(() => send({ requestId: "q", method: "shutdown" }), 2400);
setTimeout(() => { child.kill(); process.exit(0); }, 4000);
