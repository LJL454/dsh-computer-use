// Unit tests for the structured-summary transform.
//
// Fixtures are synthetic `pwsh`-shaped outputs, sized to the samples that originally blew
// the budget — so the assertions still run against realistically sized inputs without
// carrying anything off a real machine. Regenerate them with
// `node tools/regen-token-guard-fixtures.mjs`.
//
// Usage: node tests/token-guard/summarize-test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  summarizeToolText,
  estimateTokens,
  readStatus,
  markerPatterns,
  errorPattern,
} from '../../internal/summarize.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

let failures = 0;
let checks = 0;

function check(name, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------- fixtures --
section('real pwsh fixtures');
for (const name of readdirSync(fixtures).filter((f) => f.endsWith('.txt'))) {
  const raw = readFileSync(join(fixtures, name), 'utf8');
  const status = readStatus(raw);
  const limits = { normalMaxTokens: 800, troubleshootingMaxTokens: 2000 };
  const { text, stats } = summarizeToolText(raw, { limits });
  const budget = estimateTokens(raw) <= 800 ? estimateTokens(raw) : 800;
  const markerLines = raw.split('\n').filter((line) => markerPatterns.some((p) => p.test(line.trim())));

  if (estimateTokens(raw) <= 800) {
    check(`${name}: within budget stays byte-identical`, text === raw,
      `${estimateTokens(raw)} token`);
    continue;
  }

  check(`${name}: fits the 800-token budget`, estimateTokens(text) <= budget,
    `${estimateTokens(text)} > ${budget}`);
  check(`${name}: every harness marker survived`,
    markerLines.every((line) => text.includes(line)),
    `${markerLines.length} marker line(s)`);
  check(`${name}: reports the omission`, /omitted: \d+ lines/.test(text));
  check(`${name}: status header present`, text.startsWith('[token-guard] status='));
  check(`${name}: stats consistent`,
    stats.omittedLines === stats.inputLines - stats.keptLines && stats.inputBytes > 0,
    JSON.stringify({ omitted: stats.omittedLines, kept: stats.keptLines, lines: stats.inputLines }));
  check(`${name}: body is a real prefix, not reordered`,
    text.includes(raw.split('\n')[0].slice(0, 20)));
  if (status.status === 'failed') {
    check(`${name}: failed run uses the troubleshooting budget`, stats.budgetTokens === 2000);
  }
  if (status.status === 'unknown') {
    // §8.3: no exit code and no failure marker is `unknown`, not `ok` — the header has to say
    // so rather than reporting a status the output never carried.
    check(`${name}: an output with no exit code is reported as unknown, not as ok`,
      stats.status === 'unknown' && stats.ok === false, JSON.stringify({ status: stats.status, ok: stats.ok }));
    check(`${name}: and the header says so`, text.includes('status=unknown'), text.split('\n')[0].slice(0, 80));
    check(`${name}: while its budget stays the normal one`,
      stats.budgetTokens === 800, String(stats.budgetTokens));
  }
}

// --------------------------------------------------------------- synthetic --
section('synthetic failure case');
{
  const lines = [];
  for (let i = 0; i < 4000; i += 1) lines.push(`chatty progress line ${i} :: ${'x'.repeat(60)}`);
  lines[2000] = 'Error: Cannot bind argument to parameter because it is null.';
  lines[2001] = '  at <ScriptBlock>, C:\\work\\script.ps1: line 42';
  lines[3500] = 'Warning: deprecated parameter -Foo';
  lines.push('[sandbox: file access denied under workspace-write mode]');
  lines.push('[exit code: 1]');
  const raw = lines.join('\n');

  const { text, stats } = summarizeToolText(raw, {});
  check('failed run picks the 2000-token budget', stats.budgetTokens === 2000, String(stats.budgetTokens));
  check('fits the budget', estimateTokens(text) <= 2000, String(estimateTokens(text)));
  check('mid-file error line survives (not a naive head/tail cut)',
    text.includes('Error: Cannot bind argument to parameter because it is null.'));
  check('error stack line survives', text.includes('C:\\work\\script.ps1: line 42'));
  check('sandbox marker survives', text.includes('[sandbox: file access denied under workspace-write mode]'));
  check('exit marker survives', text.includes('[exit code: 1]'));
  check('report says how much was omitted', /omitted: \d+ lines \/ \d+ bytes/.test(text));
  check('summary is far smaller than the input',
    estimateTokens(text) < estimateTokens(raw) / 10,
    `${estimateTokens(text)} vs ${estimateTokens(raw)}`);
}

section('an interrupted run is never reported as a success (evidence JS08)');
{
  const body = Array.from({ length: 3000 }, (_, i) => `progress line ${i} :: ${'x'.repeat(50)}`);
  const timedOut = [...body, '[timed out after 30000 ms]'].join('\n');
  const timeoutResult = summarizeToolText(timedOut, {});
  check('a timeout with no exit code is not reported as ok',
    timeoutResult.stats.status !== 'ok' && timeoutResult.stats.ok === false,
    JSON.stringify({ status: timeoutResult.stats.status, ok: timeoutResult.stats.ok }));
  check('it is reported as failed, because the marker says so',
    timeoutResult.stats.status === 'failed', String(timeoutResult.stats.status));
  check('and it gets the troubleshooting budget',
    timeoutResult.stats.budgetTokens === 2000, String(timeoutResult.stats.budgetTokens));
  check('the timeout marker itself survives',
    timeoutResult.text.includes('[timed out after 30000 ms]'));

  const cancelled = summarizeToolText([...body, '[cancelled by user]'].join('\n'), {});
  check('a cancellation is a failure too', cancelled.stats.status === 'failed', String(cancelled.stats.status));

  const explicitOk = summarizeToolText([...body, '[exit code: 0]'].join('\n'), {});
  check('an explicit exit code 0 is the only thing that reads as ok',
    explicitOk.stats.status === 'ok' && explicitOk.stats.ok === true, String(explicitOk.stats.status));

  const explicitFail = summarizeToolText([...body, '[exit code: 2]'].join('\n'), {});
  check('a non-zero exit code is a failure even without a marker',
    explicitFail.stats.status === 'failed', String(explicitFail.stats.status));

  // §8.3: the footer that says where the full output went is budgeted for, not appended on top
  // of a body that already filled the budget.
  const withNote = summarizeToolText(timedOut, { note: `full output: ${'C:\\logs\\'.repeat(20)}run.txt` });
  check('a long note does not push the summary over its budget',
    estimateTokens(withNote.text) <= withNote.stats.budgetTokens + 40,
    `${estimateTokens(withNote.text)} > ${withNote.stats.budgetTokens}`);
  check('and the note is still there', /full output: C:\\logs\\/.test(withNote.text));
}

section('edge cases');
{
  const small = 'hello\n[exit code: 0]\n';
  const { text, stats } = summarizeToolText(small, {});
  check('small text untouched', text === small);
  check('small text marked unsummarized', stats.summarized === false);

  const empty = '';
  check('empty text untouched', summarizeToolText(empty, {}).text === empty);

  const hugeSingleLine = `[exit code: 3]\n${'y'.repeat(40000)}`;
  const forced = summarizeToolText(hugeSingleLine, {});
  check('single giant line still bounded',
    estimateTokens(forced.text) <= 800 * 4, String(estimateTokens(forced.text)));
  check('single giant line keeps exit code', forced.text.includes('[exit code: 3]'));

  const note = summarizeToolText(
    Array.from({ length: 3000 }, (_, i) => `line ${i} ${'z'.repeat(40)}`).join('\n'),
    { note: 'full output: C:\\logs\\run.txt' });
  check('caller note is appended', note.text.includes('full output: C:\\logs\\run.txt'));
  check('note counts against no budget overrun', estimateTokens(note.text) <= 800 * 4);

  const errorOnly = errorPattern.test('  Error: something broke  ');
  check('error pattern is case-insensitive and anchored', errorOnly === true);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
