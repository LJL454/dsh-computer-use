/**
 * Structured-summary transform for oversized tool returns.
 *
 * 6.txt §三-2 asks for a *summary*, not a truncation: keep the decision-relevant
 * facts (status, exit code, key result, error summary, whether the output was
 * truncated) and hand back the path of the complete output, instead of cutting
 * the first and last few lines.
 *
 * Order of operations implemented here (and nothing else):
 *   1. classify every line (marker / error / warning / structure / body),
 *   2. select by role, in priority order, under a character budget,
 *   3. limit how many lines each role may contribute,
 *   4. only then compose the summary text.
 *
 * The transform is pure: it never writes files and never reads the clock, so it
 * can be unit-tested against real captured outputs.
 *
 * Token accounting reuses the harness's own density heuristic (4 characters per
 * token, `@deepseek-ai/dsh-token-meter`), so a budget quoted here means the same
 * thing the token meter reports.
 */

/** Characters per estimated token, matching @deepseek-ai/dsh-token-meter. */
export const CHARS_PER_TOKEN = 4;

/**
 * Lines the harness itself appends to a command's output. They carry the exit
 * status and the sandbox/timeout outcome, so they are never dropped.
 */
const MARKER_PATTERNS = [
  /^\[exit code:/,
  /^\[sandbox:/,
  /^\[stopped:/,
  /^\[timed out after/,
  /^\[killed by signal:/,
  /^\[still running after/,
  /^\[output truncated/,
  /^\[cancel/,
  /^\[interrupt/,
  /^\[abort/,
  /^\(no output\)$/,
];

/**
 * The markers that say the outcome was not a success, for outputs that carry no exit code.
 *
 * §8.3: the exit code is the structured status and is read first; when it is missing, these
 * markers are the only remaining evidence, and they are *explicit* -- a timeout, a kill, a
 * cancellation, a refusal by the sandbox. Anything else is `unknown`, never `ok`: "we were
 * not told" and "it worked" are different answers, and a timeout that reads as `status=ok`
 * is worse than a timeout that reads as `status=unknown` (evidence JS08).
 */
const FAILURE_MARKER_PATTERNS = [
  /^\[timed out after/,
  /^\[killed by signal:/,
  /^\[cancel/,
  /^\[interrupt/,
  /^\[abort/,
  /^\[stopped:/,
  /^\[sandbox:.*(denied|refused|blocked)/,
];

/** Lines that usually carry the reason a command failed. */
const ERROR_PATTERN =
  /\b(error|failed|failure|exception|denied|refused|unable|fatal|panic|cannot|invalid|not found|no such file|timeout|timed out|traceback|stack trace|aborted)\b|^(error|exception|traceback|fatal)\b/i;

/** Softer signal, kept only while budget remains. */
const WARNING_PATTERN = /\bwarn(ing)?\b|\bdeprecat/i;

/** Section headers and shallow structured keys, so a JSON dump still reads as a shape. */
const STRUCTURE_PATTERNS = [
  /^={2,}.*={2,}\s*$/,
  /^[-=]{3,}\s*$/,
  /^\s*"[^"]+"\s*:\s*[\[{]/,
  /^[A-Za-z_][\w.\-]*\s*[:=]\s*[\[{]/,
];

export const DEFAULT_LIMITS = {
  normalMaxTokens: 800,
  troubleshootingMaxTokens: 2000,
  headLines: 12,
  tailLines: 8,
  headFloor: 3,
  tailFloor: 2,
  errorLines: 20,
  errorContextLines: 2,
  warningLines: 8,
  structureLines: 12,
  markerLines: 10,
  maxLineChars: 1000,
};

/** Estimated tokens for a text under the harness heuristic. */
export function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function classify(line) {
  const trimmed = line.trim();
  if (MARKER_PATTERNS.some((pattern) => pattern.test(trimmed))) return "marker";
  if (trimmed === "") return "blank";
  if (ERROR_PATTERN.test(trimmed)) return "error";
  if (WARNING_PATTERN.test(trimmed)) return "warning";
  if (STRUCTURE_PATTERNS.some((pattern) => pattern.test(line))) return "structure";
  return "body";
}

/**
 * Read the harness's own outcome markers off a result text.
 *
 * @param text - the raw tool result text.
 * @returns the parsed exit status, plus the markers that were present.
 */
export function readStatus(text) {
  const markers = [];
  let exitCode = null;
  let truncated = false;
  let sandboxDenied = false;
  let failureMarker = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!MARKER_PATTERNS.some((pattern) => pattern.test(trimmed))) continue;
    markers.push(trimmed);
    const exit = /^\[exit code:\s*(-?\d+)\]/.exec(trimmed);
    if (exit) exitCode = Number(exit[1]);
    if (/^\[output truncated/.test(trimmed)) truncated = true;
    if (/^\[sandbox:/.test(trimmed)) sandboxDenied = true;
    if (FAILURE_MARKER_PATTERNS.some((pattern) => pattern.test(trimmed))) failureMarker = true;
  }
  // The structured status wins; without it, an explicit failure marker decides; with neither,
  // the answer is `unknown` -- §8.3: 信息不足时使用未知状态，不推断为成功.
  const status = exitCode !== null ? (exitCode === 0 ? "ok" : "failed") : (failureMarker ? "failed" : "unknown");
  return {
    status,
    exitCode,
    truncated,
    sandboxDenied,
    markers,
    ok: status === "ok",
  };
}

/**
 * Read one output once: status, budget, lines and their roles.
 *
 * §8.3: 每次输出只做一次解析和摘要. The caller that needs to decide *whether* to summarize and
 * then to build the summary no longer parses the text twice -- it parses here, decides on the
 * cheap facts this returns, and renders with {@link renderSummary}. Everything the summary is
 * made of (the body, the status, the kept/omitted counts) comes from this one intermediate
 * result.
 *
 * @param text - raw result text (never mutated).
 * @param options - budget and selection limits; see {@link DEFAULT_LIMITS}.
 * @returns the parse, with `stats` already carrying everything that does not depend on rendering.
 */
export function parseOutput(text, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const status = readStatus(text);
  // §8.3: only a *failed* run gets the troubleshooting budget. `unknown` is not a failure
  // claim -- it is the absence of one -- so it is budgeted like a clean run and says
  // `status=unknown` in the header instead of quietly reading as a success.
  const budgetTokens = options.budgetTokens
    ?? (status.status === "failed" ? limits.troubleshootingMaxTokens : limits.normalMaxTokens);
  const lines = text.split("\n");
  const totalBytes = Buffer.byteLength(text, "utf8");
  const inputTokens = estimateTokens(text);
  const stats = {
    inputBytes: totalBytes,
    inputLines: lines.length,
    budgetTokens,
    inputTokens,
    status: status.status,
    exitCode: status.exitCode,
    ok: status.ok,
    markers: status.markers,
    keptLines: lines.length,
    omittedLines: 0,
    omittedBytes: 0,
    outputTokens: inputTokens,
    summarized: false,
  };
  const classified = lines.map((line, index) => ({ line, index, role: classify(line) }));
  const buckets = { marker: [], error: [], warning: [], structure: [], body: [] };
  for (const item of classified) {
    if (item.role === "blank") continue;
    buckets[item.role].push(item);
  }
  return {
    text,
    limits,
    status,
    budgetTokens,
    totalBytes,
    lines,
    classified,
    buckets,
    // The decision the guard needs, computed from the same parse the summary will use.
    overBudget: inputTokens > budgetTokens,
    stats,
  };
}

/**
 * Render the summary of a parsed output.
 *
 * @param parsed - the result of {@link parseOutput}.
 * @param options - `note` (footer lines that must survive), `force` (summarize even under budget).
 * @returns the summary text and the measurements behind it.
 */
export function renderSummary(parsed, options = {}) {
  const { text, limits, status, budgetTokens, totalBytes, lines, classified, buckets } = parsed;
  const stats = { ...parsed.stats };

  // Fast path: within budget (and no caller-forced summarization) → untouched.
  if (options.force !== true && !parsed.overBudget) {
    return { text, stats };
  }

  // `dropPriority` is the trim order: highest goes first, `undefined` never.
  // Markers, the first errors and the head floor are the facts the caller must
  // not lose; warnings and body padding are the cheapest to give up.
  const selected = new Map();
  const mark = (item, dropPriority) => {
    const existing = selected.get(item.index);
    if (existing === undefined) {
      selected.set(item.index, { ...item, dropPriority });
    } else if (existing.dropPriority !== undefined
      && (dropPriority === undefined || dropPriority < existing.dropPriority)) {
      existing.dropPriority = dropPriority;
    }
  };

  for (const item of buckets.marker.slice(0, limits.markerLines)) mark(item, undefined);
  buckets.error.slice(0, limits.errorLines).forEach((item, position) => {
    mark(item, position < 3 ? undefined : 2.5);
    for (const context of classified.slice(item.index + 1, item.index + 1 + limits.errorContextLines)) {
      if (context.role !== "blank") mark(context, 2.5);
    }
  });
  classified.slice(0, limits.headLines).forEach((item, position) => {
    if (item.role !== "blank") mark(item, position < limits.headFloor ? undefined : 4);
  });
  classified.slice(-limits.tailLines).forEach((item, position, array) => {
    if (item.role !== "blank") mark(item, position >= array.length - limits.tailFloor ? 2 : 4);
  });
  buckets.structure.slice(0, limits.structureLines).forEach((item, position) => {
    mark(item, position < 3 ? 2 : 3);
  });
  for (const item of buckets.warning.slice(0, limits.warningLines)) mark(item, 5);

  const note = options.note === undefined
    ? []
    : (Array.isArray(options.note) ? options.note : [options.note]);
  // §8.3 (为状态、错误与完整输出位置预留预算): the footer is not droppable -- it names where the
  // full output went -- so its cost is taken out of the budget the body is trimmed to fit.
  // Without this the body filled the budget and the footer pushed the result over it.
  const noteTokens = note.length === 0 ? 0 : estimateTokens(note.join("\n")) + 1;
  const bodyBudgetTokens = Math.max(0, budgetTokens - noteTokens);
  const clampedLines = new Set();
  const clampLine = (item) => {
    if (item.line.length <= limits.maxLineChars) return item.line;
    clampedLines.add(item.index);
    const extra = item.line.length - limits.maxLineChars;
    return `${item.line.slice(0, limits.maxLineChars)}…[line +${extra} chars]`;
  };

  const render = () => {
    const ordered = [...selected.values()].sort((a, b) => a.index - b.index);
    const body = ordered.map(clampLine);
    const keptBytes = Buffer.byteLength(body.join("\n"), "utf8");
    const parts = [
      `status=${status.status}`,
      `exit=${status.exitCode === null ? "-" : status.exitCode}`,
      `lines=${lines.length}`,
      `kept=${ordered.length}`,
    ];
    const omittedLines = lines.length - ordered.length;
    if (omittedLines > 0) parts.push(`omitted_lines=${omittedLines}`);
    if (status.truncated) parts.push("upstream_truncated=true");
    if (clampedLines.size > 0) parts.push(`clamped_lines=${clampedLines.size}`);
    const footer = [
      `[token-guard] omitted: ${omittedLines} lines / `
      + `${Math.max(0, totalBytes - keptBytes)} bytes (of ${lines.length} lines / ${totalBytes} bytes)`,
      ...note,
    ];
    const header = `[token-guard] ${parts.join(" ")}`;
    return {
      text: `${[header, ...body, ...footer].join("\n")}\n`,
      bodyTokens: estimateTokens(header) + estimateTokens(body.join("\n")),
    };
  };

  let rendered = render();
  // Trim against the *body* budget: the header and the footer are the facts the caller must
  // not lose (markers, status, where the full output went).
  while (rendered.bodyTokens > bodyBudgetTokens) {
    const droppable = [...selected.values()]
      .filter((item) => item.dropPriority !== undefined)
      .sort((a, b) => b.dropPriority - a.dropPriority || Math.abs(b.index - lines.length / 2) - Math.abs(a.index - lines.length / 2));
    if (droppable.length === 0) break;
    selected.delete(droppable[0].index);
    rendered = render();
  }
  const renderedText = rendered.text;

  stats.summarized = true;
  stats.keptLines = selected.size;
  stats.omittedLines = lines.length - selected.size;
  const keptBytes = Buffer.byteLength(
    [...selected.values()].map(clampLine).join("\n"), "utf8");
  stats.omittedBytes = Math.max(0, totalBytes - keptBytes);
  stats.clampedLines = clampedLines.size;
  stats.outputTokens = estimateTokens(renderedText);
  stats.text = renderedText;
  return { text: renderedText, stats };
}

/**
 * Compress one tool result text into a structured summary.
 *
 * A text that already fits its budget is returned byte-identical: the transform
 * only ever acts on outputs that would otherwise dominate the context. The parse and the
 * render are separable so a caller that must decide first does not pay for two parses
 * (§8.3); this entry point is the single-parse convenience for everyone else.
 *
 * @param text - raw result text (never mutated).
 * @param options - budget and selection limits; see {@link DEFAULT_LIMITS}.
 * @param options.normalMaxTokens - budget for a clean run.
 * @param options.troubleshootingMaxTokens - budget when the run failed.
 * @param options.budgetTokens - explicit budget that overrides both presets.
 * @param options.note - extra footer lines the caller wants appended (for
 *   example the full-log path it stored).
 * @returns the summary text and the measurements behind it.
 */
export function summarizeToolText(text, options = {}) {
  return renderSummary(parseOutput(text, options), options);
}

/**
 * Whether a text may be dropped wholesale, keeping only its markers.
 *
 * The last resort for outputs whose value is entirely in the exit status: it is
 * only taken when the caller explicitly allows losing the body.
 */
export function markerOnly(text) {
  const status = readStatus(text);
  if (status.markers.length === 0) return undefined;
  return `${status.markers.join("\n")}\n`;
}

export const markerPatterns = MARKER_PATTERNS;
export const errorPattern = ERROR_PATTERN;
