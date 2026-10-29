import { useQuery } from "@tanstack/react-query";
import type { AiChoice } from "./ai";
import { api, request } from "./api";
import type { StepResult } from "../../../src/git/types.ts";
import type { Row } from "./types";
import { isReadOnly } from "./mode";

export type ChangeKind = "added" | "modified" | "deleted";

export interface RecordChange {
  key: string;
  kind: ChangeKind;
  // the top-level fields that changed; empty when the record came or went, or only its formatting changed
  fields: string[];
}

export interface GitChange {
  path: string;
  status: ChangeKind;
  table: string | null;
  // null for files that are not records (yamlite.yaml, pages) or that cannot be read
  records: RecordChange[] | null;
}

export interface FieldValues {
  field: string;
  from: unknown;
  to: unknown;
}

export interface Reverted {
  table: string;
  key: string;
  before: Row | null;
  after: Row | null;
}

export interface GitState {
  branch: string | null;
  defaultBranch: string | null;
  upstream: string | null;
  // the host takes a branch name for a new review
  namesBranch: boolean;
  // on a review branch whose files can be put back as the default branch has them
  restoresDefault: boolean;
  changes: GitChange[];
}

// a file the review changes from the default branch
export interface DefaultChange {
  path: string;
  status: ChangeKind;
  table: string | null;
  // the file also has edits not sent yet, which putting it back loses
  unsent: boolean;
}

export interface ReviewResult {
  branch: string;
  steps: string[];
  results: StepResult[];
  url: string | null;
  created: boolean;
  error?: string;
}

export const GIT_KEY = ["git"];

export const gitApi = {
  state: () => request<{ git: GitState | null }>("GET", "/api/git").then((r) => r.git),
  review: (body: { title: string; body: string; paths: string[]; branch?: string }) =>
    request<ReviewResult>("POST", "/api/git/review", body),
  // the open PR the review is added to; null when there is none or the host cannot tell
  openPr: () => request<{ url: string | null }>("GET", "/api/git/pr").then((r) => r.url),
  draft: (body: { paths: string[]; mode: "pr" | "commit"; locale: string } & AiChoice) =>
    request<{ title: string; body?: string }>("POST", "/api/git/review/draft", body),
  diff: (path: string) =>
    request<{ records: Array<{ key: string; kind: ChangeKind; fields: FieldValues[] }> }>(
      "GET",
      `/api/git/diff?path=${encodeURIComponent(path)}`,
    ),
  // files: paths of changed files that are not records, written back as committed or removed when never committed
  revert: (body: { records: Array<{ table: string; key: string; delete?: boolean }>; files: string[] }) =>
    request<{ reverted: Reverted[]; files: string[] }>("POST", "/api/git/revert", body),
  defaultChanges: () => request<{ files: DefaultChange[] }>("GET", "/api/git/default").then((r) => r.files),
  // the files go back as the default branch has them, or are removed when it has none, as edits to send
  restoreDefault: (files: string[]) => request<{ files: string[] }>("POST", "/api/git/restore-default", { files }),
};

// puts reverted records back the way they were before the revert, through the same writes as the forms
export async function undoRevert(items: Reverted[]): Promise<void> {
  for (const { table, key, before, after } of items) {
    if (before === null) await api.remove(table, key);
    else if (after === null) await api.create(table, key, before);
    else {
      const cleared = Object.fromEntries(
        Object.keys(after)
          .filter((f) => !(f in before))
          .map((f) => [f, null]),
      );
      await api.update(table, key, { ...cleared, ...before }, after);
    }
  }
}

// null outside a git repository with an origin, and in the static export
export function useGit(): GitState | null {
  const enabled = !isReadOnly();
  return useQuery({ queryKey: GIT_KEY, queryFn: gitApi.state, enabled, refetchOnWindowFocus: true }).data ?? null;
}

// the changes grouped by table; files outside every table (yamlite.yaml, pages) come last under null
export function groupChanges<C extends { table: string | null }>(
  changes: C[],
): Array<{ table: string | null; changes: C[] }> {
  const groups = new Map<string | null, C[]>();
  for (const c of changes) groups.set(c.table, [...(groups.get(c.table) ?? []), c]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([table, changes]) => ({ table, changes }));
}
