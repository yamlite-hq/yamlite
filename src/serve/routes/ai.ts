import { readFileSync } from "node:fs";
import { parseConfig } from "../../config.ts";
import { applyAiInstructions, configHash } from "../../configfile.ts";
import { writeAtomic } from "../../fsutil.ts";
import type { AiInstructions } from "../../types.ts";
import { HttpError } from "../http.ts";
import { objectBody } from "../write.ts";
import type { Routes } from "./index.ts";

function instructionsBody(b: Record<string, unknown>): AiInstructions {
  const text = (key: "instructions" | "pullRequests") => {
    const v = b[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") throw new HttpError(400, `${key} must be text`, { field: key });
    return v.trim() === "" ? null : v.trim();
  };
  return { instructions: text("instructions"), pullRequests: text("pullRequests") };
}

export const aiRoutes: Routes = (router, ctx) => {
  router.add("GET", "/api/ai/instructions", () => {
    // read from the same text as base: the loaded config can lag behind the file, or keep an older one it could not load
    const text = readFileSync(ctx.configFile, "utf8");
    let ai: AiInstructions;
    try {
      ai = parseConfig(text).ai;
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
    return { ...ai, base: configHash(text) };
  });

  // base is the hash GET gave, so an edit made meanwhile elsewhere (an editor, another tab) is not written over
  router.add("PUT", "/api/ai/instructions", ({ body }) => {
    ctx.proposals.assertIdle();
    const b = objectBody(body, "body");
    if (typeof b.base !== "string") throw new HttpError(400, "base is required", { field: "base" });
    const next = instructionsBody(b);
    const text = readFileSync(ctx.configFile, "utf8");
    if (configHash(text) !== b.base)
      throw new HttpError(409, "yamlite.yaml changed since editing started", { current: configHash(text) });
    const written = applyAiInstructions(text, next);
    if (written !== null) {
      try {
        parseConfig(written);
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
      writeAtomic(ctx.configFile, written);
      ctx.reloadConfig();
    }
    return { ...next, base: configHash(written ?? text) };
  });
};
