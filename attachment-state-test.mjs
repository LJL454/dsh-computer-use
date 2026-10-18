/**
 * When the "last thing you were shown" record is committed (9.txt §6 第 7 条).
 *
 * The record is what makes `unchanged: true` mean "nothing on screen has moved since you last
 * looked". Committing it before the attachment store answered meant a save that failed still
 * advanced the record, and the next identical capture was answered with "you have already seen
 * this screen" about a picture the caller never received.
 *
 * The rule is a property of one function's control flow, and driving it end to end would take
 * three real captures of a desktop that has to hold byte-still between them — so, exactly as
 * `test-schema-visibility.mjs` does for the route call sites that would otherwise start the
 * worker, the *source* is asserted here: the commit has to come after the store answered, and
 * the failure branches must not commit at all. The behaviour that depends on it (`unchanged`
 * never being claimed for a frame that was not delivered) is additionally covered by the
 * public reply shape in `wait-and-capture-test.mjs` / `lifecycle-test.mjs`.
 *
 *   node attachment-state-test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// §10 拆分之后，`admitCapture` 在 internal/capture.mjs 里（宿主只调 `captureService.admit`）。
// 断言的是同一个函数体的控制流，所以读的是它现在的家。
const source = readFileSync(join(HERE, 'internal', 'capture.mjs'), 'utf8');

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

/** The body of one function, by brace counting from its declaration. */
function functionBody(name) {
  const start = source.indexOf(`async function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`${name} has no end`);
}

const body = functionBody('admitCapture');
const saveAt = body.indexOf('await attachments.saveImages(');
const reuseAt = body.indexOf('if (cached !== undefined)');
const commitCalls = [...body.matchAll(/remember\(\);/g)].map((match) => match.index);

console.log('\n== the dedup record is committed when the frame is delivered, not before ==');
check('the function saves the image through the attachment store', saveAt >= 0, 'saveImages call not found');
check('the helper is the only thing that writes the record', (body.match(/lastShotDigest\.set\(/g) ?? []).length === 1, `${(body.match(/lastShotDigest\.set\(/g) ?? []).length} writers`);
check('the delivered path commits after the store answered', commitCalls.some((at) => at > saveAt), JSON.stringify({ saveAt, commitCalls }));
const early = commitCalls.filter((at) => at < saveAt);
check(
  'the only earlier commit is the cache-hit path, whose bytes are already stored',
  early.length === 1 && reuseAt > 0 && early[0] > reuseAt,
  JSON.stringify({ saveAt, reuseAt, early }),
);

console.log('\n== a failure leaves the record alone, so the capture stays retryable ==');
const noRef = body.indexOf('if (ref === undefined)');
const catchAt = body.indexOf('} catch (error) {');
check('the "no attachment" branch exists', noRef > 0, 'not found');
check('and the catch branch exists', catchAt > 0, 'not found');
const noRefBranch = body.slice(noRef, body.indexOf('}', noRef + 30));
check('the "no attachment" branch does not commit', !/lastShotDigest/.test(noRefBranch), noRefBranch.slice(0, 120));
const catchBranch = body.slice(catchAt);
check('the catch branch does not commit either', !/lastShotDigest/.test(catchBranch), catchBranch.slice(0, 160));
check('and it explains the fallback path instead', /read_image/.test(catchBranch), catchBranch.slice(0, 160));

console.log('\n== the same rule holds for the reuse path ==');
check('the cache-hit branch exists', reuseAt > 0, 'not found');
const reuseBranch = body.slice(reuseAt, saveAt);
check('a cache hit commits the record (those bytes really are in the store)', /remember\(\)/.test(reuseBranch), reuseBranch.slice(0, 200));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
