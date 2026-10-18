type EdgeRuntimeGlobal = typeof globalThis & {
  EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
};

export function waitUntilEdgeTask(task: Promise<unknown>) {
  const runtime = (globalThis as EdgeRuntimeGlobal).EdgeRuntime;
  if (typeof runtime?.waitUntil !== 'function') return false;
  runtime.waitUntil(task);
  return true;
}
