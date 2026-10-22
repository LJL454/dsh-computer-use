/**
 * 同一宿主里的唯一实例登记（1.40.0 §A）。
 *
 * 为什么不能只用模块级布尔值：同一份包可以被解析成两个模块 URL（两个目录、两条 link、
 * 或者一个 preset 子行），两个模块各有一份布尔值，谁都看不见对方。为什么不能直接用
 * `globalThis`：同一个 Node 进程可以承载两个独立宿主（测试、嵌入式 SDK），它们并不共享
 * 授权表和路由。
 *
 * 所以登记表挂在 **host root** 上：`ctx.root` 是 cordis 的根上下文，同一个宿主里的所有
 * 模块副本拿到的是同一个对象；不同宿主各有各的 root。没有 root 的上下文（单元测试里的
 * 假 ctx）退回到模块内的 WeakMap，按 ctx 对象隔离，不会把两个测试实例误判成重复挂载。
 *
 * 第二个实例在**注册任何工具、路由或钩子之前**被拒绝：日志里写明 `DUPLICATE_INSTANCE`、
 * 已有实例的包路径/版本，以及本次尝试的路径/版本。第一个实例继续工作，卸载后登记会释放，
 * 下一次挂载可以重新拿到所有权。
 */

/** 登记表在 host root / ctx 上的属性名。`Symbol.for` 让两份模块副本看到同一个键。 */
const REGISTRY_KEY = Symbol.for('@local/dsh-computer-use.instance-registry.v1');

/** 没有 root 时的隔离表：按 ctx 对象分，模块级（所以是"每份副本各自隔离"）。 */
const localRegistries = new WeakMap();

/**
 * Pick the registry owned by this host.
 * @param ctx - plugin context; `ctx.root` identifies the host when cordis provides it.
 * @returns a registry object with an `instances` Map.
 */
function registryFor(ctx) {
  const scope = ctx !== null && typeof ctx === 'object' ? (ctx.root ?? ctx) : null;
  if (scope === null || (typeof scope !== 'object' && typeof scope !== 'function')) {
    // No context at all: a single module-local registry is the only honest fallback.
    return globalRegistry();
  }
  const existing = scope[REGISTRY_KEY];
  if (existing !== undefined && existing !== null && existing.instances instanceof Map) return existing;
  const registry = { instances: new Map() };
  try {
    Object.defineProperty(scope, REGISTRY_KEY, {
      value: registry,
      configurable: true,
      enumerable: false,
      writable: false,
    });
    return registry;
  } catch {
    // A frozen context cannot carry the marker. Falling back to a per-ctx registry still
    // catches duplicate mounts in this module copy, and reports why it is weaker.
    return localRegistry(ctx);
  }
}

/** The last-resort registry for calls without a usable context. */
let fallbackRegistry = null;
function globalRegistry() {
  if (fallbackRegistry === null) fallbackRegistry = { instances: new Map() };
  return fallbackRegistry;
}

/**
 * A per-context registry for frozen contexts.
 * @param ctx - the context object used as the key.
 * @returns a registry object.
 */
function localRegistry(ctx) {
  let registry = localRegistries.get(ctx);
  if (registry === undefined) {
    registry = { instances: new Map(), isolated: true };
    localRegistries.set(ctx, registry);
  }
  return registry;
}

/**
 * Claim the single instance slot for a package name.
 *
 * A successful claim must be released with {@link releaseInstance}; the caller registers that
 * release with the host's disposer immediately after claiming, so a throw later in `apply()`
 * cannot leave a permanent tombstone.
 * @param options.ctx - plugin context (its root selects the host).
 * @param options.packageName - identity of the capability, normally the npm package name.
 * @param options.version - this copy's version.
 * @param options.root - this copy's package directory.
 * @returns `{ ok, record, registry, existing? }`. On `ok: false`, `record` is the existing
 *   instance's record and no ownership was taken.
 */
export function claimInstance({ ctx, packageName, version, root }) {
  const registry = registryFor(ctx);
  const existing = registry.instances.get(packageName);
  if (existing !== undefined) {
    existing.duplicateAttempts = Number(existing.duplicateAttempts ?? 0) + 1;
    existing.lastDuplicate = {
      at: new Date().toISOString(),
      version: String(version ?? ''),
      root: String(root ?? ''),
    };
    return { ok: false, existing, record: existing, registry };
  }
  const record = {
    packageName,
    version: String(version ?? ''),
    root: String(root ?? ''),
    mountedAt: Date.now(),
    duplicateAttempts: 0,
    lastDuplicate: null,
  };
  registry.instances.set(packageName, record);
  return { ok: true, record, registry };
}

/**
 * Release a claim, but only if it is still the one this caller owns.
 *
 * The identity check matters during a rollback: a disposed first instance must not delete a
 * newer instance's record.
 * @param registry - the registry returned by {@link claimInstance}.
 * @param record - the record returned by {@link claimInstance}.
 * @returns whether the record was removed.
 */
export function releaseInstance(registry, record) {
  if (registry === null || registry === undefined || record === null || record === undefined) return false;
  const current = registry.instances?.get(record.packageName);
  if (current !== record) return false;
  registry.instances.delete(record.packageName);
  return true;
}

/** A snapshot for diagnostics (never the live Map). */
export function describeInstance(record) {
  if (record === null || record === undefined) return null;
  return {
    packageName: record.packageName,
    version: record.version,
    root: record.root,
    mountedAt: new Date(record.mountedAt).toISOString(),
    duplicateAttempts: Number(record.duplicateAttempts ?? 0),
    lastDuplicate: record.lastDuplicate === null ? null : { ...record.lastDuplicate },
  };
}
