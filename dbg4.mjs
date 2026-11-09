import { spawn } from "node:child_process";
const real = "E:/inkos/work/dsh-computer-use/native/indicator-helper/build/dsh-interaction-indicator.exe";
const child = spawn(real, [], { stdio: ["pipe","pipe","pipe"], windowsHide: true });
child.stdout.on("data", (c) => console.log("RAW:", JSON.stringify(String(c)).slice(0,200)));
child.stderr.on("data", (c) => console.log("ERR:", String(c)));
child.on("exit", (code) => console.log("exit", code));
child.stdin.write(JSON.stringify({ requestId: "a1", method: "hello", protocolVersion: 1 }) + "\n");
setTimeout(() => { child.kill(); process.exit(0); }, 2000);
