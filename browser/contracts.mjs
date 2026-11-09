/** Small registration/rendering contracts; loading a desktop plugin needs no CDP engine. */
export const ACTION_BUDGET = Object.freeze({ defaultMs: 15000, maxMs: 60000 });
export function clampActionBudget(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return ACTION_BUDGET.defaultMs;
  return Math.min(ACTION_BUDGET.maxMs, Math.max(1000, Math.round(requested)));
}
export const BROWSER_ACTIONS = Object.freeze(['navigate', 'click', 'fill', 'type', 'upload', 'scroll', 'hover', 'press', 'select', 'tabs', 'wait_for', 'state']);
export function formatBrowserNode(node) {
  const states = node.states.length > 0 ? ` [${node.states.join(',')}]` : '';
  const value = node.value === undefined || node.value === '' ? '' : ` = ${JSON.stringify(node.value)}`;
  return `${node.ref ? `[${node.ref}] ` : ''}${node.role} ${JSON.stringify(node.name)}${value}${states}`;
}
