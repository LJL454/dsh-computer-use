// Prints the environment variables the launcher is supposed to have removed, so a test
// can prove the child really got a clean environment (and not just that we think so).
// Also exits with the code the caller asks for, which the tests reuse.
const names = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const exitArg = process.argv.find((arg) => arg.startsWith('--exit='));
const payload = { pid: process.pid, cwd: process.cwd(), values: {} };
for (const name of names) {
  payload.values[name] = Object.prototype.hasOwnProperty.call(process.env, name)
    ? String(process.env[name])
    : null;
}
process.stdout.write(`${JSON.stringify(payload)}\n`);
if (exitArg) process.exit(Number(exitArg.split('=')[1]) || 0);
