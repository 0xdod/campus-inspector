import "server-only";
import { readConfig } from "./config";
import { Store } from "./db/store";
import { loadKeys } from "./crypto/keys";
async function initialize() {
  const config = readConfig();
  const store = new Store(config.dataDir);
  const keys = await loadKeys(config.dataDir);
  const timer = setInterval(() => {
    try {
      store.prune();
    } catch {
      console.error("inspector_maintenance_failed");
    }
  }, 60000);
  timer.unref();
  return { config, store, keys };
}
type Runtime = Awaited<ReturnType<typeof initialize>>;
const globalRuntime = globalThis as typeof globalThis & {
  inspectorRuntime?: Promise<Runtime>;
};
export function runtime() {
  return (globalRuntime.inspectorRuntime ??= initialize());
}
