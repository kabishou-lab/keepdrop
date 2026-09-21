import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";

export interface WatchHandle {
  close: () => void;
  /** Call after we write this path so our own compact does not retrigger. */
  markSelfWrite: () => Promise<void>;
}

export interface WatchOpts {
  debounceMs?: number;
  pollMs?: number;
  onError?: (err: unknown) => void;
}

/**
 * Fire `onChange` after the file's mtime moves. Poll + fs.watch, debounced.
 * First observed mtime does not fire (baseline).
 */
export function watchFile(
  path: string,
  onChange: () => Promise<void> | void,
  opts: WatchOpts = {},
): WatchHandle {
  const debounceMs = opts.debounceMs ?? 300;
  const pollMs = opts.pollMs ?? 500;
  const onError = opts.onError ?? (() => undefined);
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  let suppressUntil = 0;

  const kick = () => {
    if (closed) return;
    if (Date.now() < suppressUntil) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (Date.now() < suppressUntil) return;
      Promise.resolve(onChange()).catch(onError);
    }, debounceMs);
  };

  const check = async () => {
    if (closed) return;
    try {
      const st = await stat(path);
      if (st.mtimeMs !== last) {
        const prev = last;
        last = st.mtimeMs;
        if (prev !== 0) kick();
      }
    } catch (err) {
      onError(err);
    }
  };

  void check();
  const poll = setInterval(() => {
    void check();
  }, pollMs);

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(path, () => kick());
    watcher.on("error", onError);
  } catch {
    // poll only
  }

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      watcher?.close();
    },
    markSelfWrite: async () => {
      suppressUntil = Date.now() + debounceMs + pollMs + 100;
      try {
        const st = await stat(path);
        last = st.mtimeMs;
      } catch {
        // file may not exist yet
      }
    },
  };
}
