import { generateText, jsonSchema, type LanguageModel, Output } from "ai";
import type { RecordChange } from "../serve/gitrecords.ts";
import type { AiInstructions } from "../types.ts";

const VALUE_CHARS = 1_000;
const PROMPT_CHARS = 24_000;
const MAX_OUTPUT_TOKENS = 1_000;

export interface DraftFile {
  path: string;
  status: "added" | "modified" | "deleted";
  table: string | null;
  // null for files that are not records; their text is compared instead
  records: RecordChange[] | null;
  before?: string | null;
  after?: string | null;
}

export interface DraftInput {
  files: DraftFile[];
  // commit: the changes are added to an open PR as a commit, so only a commit message is drafted
  mode: "pr" | "commit";
  // the UI's language
  locale: string;
  // the repository's pull request template; used only for a new PR
  template: string | null;
  ai: AiInstructions;
}

export interface Draft {
  title: string;
  body?: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… (${s.length - n} more characters)` : s);

const show = (v: unknown) => clip(typeof v === "string" ? v : JSON.stringify(v), VALUE_CHARS);

function describeRecord(r: RecordChange): string {
  if (r.kind === "added") return `  + ${r.key}: ${show(r.after)}`;
  if (r.kind === "deleted") return `  - ${r.key}: ${show(r.before)}`;
  if (r.fields.length === 0) return `  ~ ${r.key}: only formatting or comments`;
  const fields = r.fields.map((f) => `    ${f}: ${show(r.before?.[f] ?? null)} → ${show(r.after?.[f] ?? null)}`);
  return [`  ~ ${r.key}`, ...fields].join("\n");
}

function describeFile(f: DraftFile): string {
  const head = `${f.path} (${f.status}${f.table ? `, table ${f.table}` : ""})`;
  if (f.records) return [head, ...f.records.map(describeRecord)].join("\n");
  const parts = [head];
  if (f.before) parts.push(`  before:\n${clip(f.before, VALUE_CHARS * 2)}`);
  if (f.after) parts.push(`  after:\n${clip(f.after, VALUE_CHARS * 2)}`);
  return parts.join("\n");
}

export function draftPrompt(input: DraftInput): { system: string; prompt: string } {
  const pr = input.mode === "pr";
  const what = pr
    ? "a pull request title (one line, also used as the commit message) and a short description"
    : "a one-line commit message";
  const template = pr && input.template?.trim() ? input.template.trim() : null;
  // later parts win: the repository's own instructions over the template, both over the defaults
  const system = [
    `You write ${what} for changes to data files in a YAMLite folder (YAML and Markdown records kept in sync with SQLite).`,
    "The title says what changed in the data, briefly, without file paths or a trailing period.",
    pr
      ? "The description says what changed and, when the changes make it clear, why, as a few Markdown bullet points. Do not invent reasons."
      : "",
    `Write in the language with this code: ${input.locale}.`,
    template
      ? `Fill in the description following this pull request template: keep its headings and structure, replace its comments and placeholders, and leave a section empty when the changes say nothing for it.\n<template>\n${clip(template, VALUE_CHARS * 4)}\n</template>`
      : "",
    input.ai.instructions
      ? `Instructions from the repository, which override the ones above:\n${input.ai.instructions}`
      : "",
    pr && input.ai.pullRequests
      ? `Instructions from the repository for pull requests, which override all of the above:\n${input.ai.pullRequests}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, prompt: clip(`Changes:\n${input.files.map(describeFile).join("\n\n")}`, PROMPT_CHARS) };
}

const SCHEMA = {
  pr: {
    type: "object",
    properties: { title: { type: "string" }, body: { type: "string" } },
    required: ["title", "body"],
    additionalProperties: false,
  },
  commit: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
    additionalProperties: false,
  },
} as const;

export async function draftReview(model: LanguageModel, input: DraftInput, signal?: AbortSignal): Promise<Draft> {
  const { system, prompt } = draftPrompt(input);
  const r = await generateText({
    model,
    instructions: system,
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    output: Output.object({ schema: jsonSchema<Draft>(SCHEMA[input.mode]) }),
    abortSignal: signal,
  });
  const title = r.output.title.replace(/\s+/g, " ").trim();
  return input.mode === "pr" ? { title, body: (r.output.body ?? "").trim() } : { title };
}
