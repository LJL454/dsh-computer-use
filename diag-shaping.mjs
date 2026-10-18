// The two shaping passes, against trees that are actually messy.
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 90_000 });
await b.start();

const node = (depth, name, controlType, extra = {}) => ({
  depth, name, controlType, automationId: '', className: '', enabled: true, offscreen: false,
  x: 0, y: 0, width: 100, height: 20, patterns: [], ...extra,
});
const prune = (nodes, maxNodes = 250) => b.request('prune', { nodes, maxNodes }, { timeoutMs: 30_000 });

const show = (label, out) => {
  console.log(`\n${label}  in=${out.input} out=${out.nodes.length} pruned=${out.pruned}`);
  for (const n of out.nodes) {
    const bits = [`${'  '.repeat(n.depth)}${n.controlType.replace('ControlType.', '')}`];
    if (n.name !== '') bits.push(`"${n.name}"`);
    if (n.merged !== undefined) bits.push(`merged=${n.merged}`);
    if (n.repeated !== undefined) bits.push(`repeated=${n.repeated}`);
    if (n.automationId !== '') bits.push(`id=${n.automationId}`);
    console.log(`  ${bits.join(' ')}`);
  }
};

// 1. A run of text-only siblings: one line to read, not six rows to scroll.
show('six text siblings', await prune([
  node(0, 'Window', 'ControlType.Window'),
  node(1, 'Name:', 'ControlType.Text'),
  node(1, 'report.txt', 'ControlType.Text'),
  node(1, 'modified', 'ControlType.Text'),
  node(1, '12 KB', 'ControlType.Text'),
  node(1, 'yesterday', 'ControlType.Text'),
  node(1, 'read-only', 'ControlType.Text'),
]));

// 2. A list of choices keeps a list separator.
show('a radio run', await prune([
  node(0, 'Window', 'ControlType.Window'),
  node(1, 'Small', 'ControlType.RadioButton'),
  node(1, 'Medium', 'ControlType.RadioButton'),
  node(1, 'Large', 'ControlType.RadioButton'),
]));

// 3. Text runs interrupted by something real must not merge across it.
show('a run broken by a button', await prune([
  node(0, 'Window', 'ControlType.Window'),
  node(1, 'left', 'ControlType.Text'),
  node(1, 'right', 'ControlType.Text'),
  node(1, 'OK', 'ControlType.Button', { patterns: ['invoke'], automationId: 'okButton' }),
  node(1, 'after', 'ControlType.Text'),
  node(1, 'more', 'ControlType.Text'),
]));

// 4. A chain of single-child wrappers is indentation that says nothing.
show('four pass-through wrappers', await prune([
  node(0, 'Window', 'ControlType.Window'),
  node(1, '', 'ControlType.Pane'),
  node(2, '', 'ControlType.Group'),
  node(3, '', 'ControlType.Custom'),
  node(4, 'Save', 'ControlType.Button', { patterns: ['invoke'], automationId: 'save' }),
]));

// 5. A wrapper with two children is a real level: it must stay.
show('a wrapper with two children', await prune([
  node(0, 'Window', 'ControlType.Window'),
  node(1, '', 'ControlType.Pane'),
  node(2, 'A', 'ControlType.Button', { patterns: ['invoke'] }),
  node(2, 'B', 'ControlType.Button', { patterns: ['invoke'] }),
]));

// 6. Invariants: nothing addressable and nothing named may be swallowed.
show('a wrapper that has an automationId', await prune([
  node(0, 'Window', 'ControlType.Window'),
  node(1, '', 'ControlType.Pane', { automationId: 'thePane' }),
  node(2, 'Save', 'ControlType.Button', { patterns: ['invoke'] }),
]));
show('a wrapper that is clickable', await prune([
  node(0, 'Window', 'ControlType.Window'),
  node(1, '', 'ControlType.Pane', { patterns: ['invoke'] }),
  node(2, 'Save', 'ControlType.Button', { patterns: ['invoke'] }),
]));
show('a text run with an unnamed button in it', await prune([
  node(0, 'Window', 'ControlType.Window'),
  node(1, 'a', 'ControlType.Text'),
  node(1, '', 'ControlType.Button', { patterns: ['invoke'] }),
  node(1, 'b', 'ControlType.Text'),
]));

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
