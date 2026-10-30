import { relative, sep } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import { deniedFile, entryCovers, fileGranted } from "../pages/access.ts";
import type { PageSpec } from "../types.ts";

const SETTLE_MS = 100;
const TEMP = /(^|\/)\.yamlite-[^/]*\.tmp$/;

// reports changes to the files pages declare, so an open page learns of an edit made elsewhere
export class FileWatch {
  private watcher: FSWatcher | undefined;
  private files: PageSpec["files"] = {};
  private readonly changed = new Set<string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly root: string,
    private readonly denied: string[],
    private readonly onChange: (paths: string[]) => void,
    private readonly debounceMs = 100,
  ) {}

  // resolves once the new entries are watched, so a change made right after it is seen
  async update(pages: readonly PageSpec[]): Promise<void> {
    const files: PageSpec["files"] = Object.assign({}, ...pages.map((p) => p.files));
    const same = Object.keys(files).sort().join("\n") === Object.keys(this.files).sort().join("\n");
    this.files = files;
    if (same && this.watcher) return;
    await this.watcher?.close();
    this.watcher = undefined;
    if (Object.keys(files).length === 0) return;
    // the root itself is watched, with everything but the entries and the folders leading to them ignored, so an
    // entry that does not exist yet is seen once it appears
    const watcher = watch(this.root, { ignoreInitial: true, ignored: (path) => !this.leadsToEntry(this.rel(path)) });
    this.watcher = watcher;
    watcher.on("all", (event, path) => {
      if (event === "addDir" || event === "unlinkDir") return;
      const rel = this.rel(path);
      if (fileGranted(this.files, rel) && !deniedFile(rel, this.denied) && !TEMP.test(rel)) this.fire(rel);
    });
    // chokidar reports ready before the OS watcher (FSEvents on macOS) delivers events, as in src/watch.ts
    await new Promise((r) => watcher.once("ready", () => setTimeout(r, SETTLE_MS)));
  }

  private rel(path: string): string {
    return relative(this.root, path).split(sep).join("/");
  }

  private leadsToEntry(rel: string): boolean {
    if (rel === "") return true;
    return Object.keys(this.files).some((entry) => entry.startsWith(`${rel}/`) || entryCovers(entry, rel));
  }

  private fire(path: string): void {
    this.changed.add(path);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const paths = [...this.changed];
      this.changed.clear();
      this.onChange(paths);
    }, this.debounceMs);
  }

  async close(): Promise<void> {
    clearTimeout(this.timer);
    await this.watcher?.close();
  }
}
