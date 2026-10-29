import { afterEach, expect, test } from "vitest";
import { expose } from "../src/browser/expose.ts";

let close: (() => void) | undefined;
let ports: MessagePort[] = [];
afterEach(() => {
  close?.();
  for (const p of ports) p.close();
  ports = [];
});

const bytes = (s: string) => new TextEncoder().encode(s).buffer;

// sends one request through expose and collects what comes back until its end message
async function roundTrip(dispatch: (r: Request) => Promise<Response>): Promise<unknown[]> {
  const { port1, port2 } = new MessageChannel();
  ports = [port1, port2];
  close = expose(port2, dispatch);
  const got: unknown[] = [];
  const done = new Promise<void>((resolve) => {
    port1.onmessage = (e: MessageEvent<{ kind: string }>) => {
      const { id: _, ...m } = e.data as { id: number; kind: string };
      got.push(m);
      if (m.kind === "end") resolve();
    };
  });
  port1.postMessage({
    id: 1,
    kind: "request",
    method: "GET",
    url: "/api/events",
    headers: [],
    body: null,
  });
  await done;
  return got;
}

test("a failure before the head answers 500 with a JSON error", async () => {
  const got = await roundTrip(async () => {
    throw new Error("boom");
  });
  expect(got).toEqual([
    {
      kind: "head",
      status: 500,
      headers: [["content-type", "application/json"]],
    },
    { kind: "chunk", data: bytes(JSON.stringify({ error: "Error: boom" })) },
    { kind: "end" },
  ]);
});

test("a failure after the head only ends the stream, without a JSON chunk", async () => {
  const enc = new TextEncoder();
  const got = await roundTrip(async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode("event: hello\ndata: {}\n\n"));
      },
      pull(c) {
        c.error(new Error("source went away"));
      },
    });
    return new Response(body, {
      headers: { "content-type": "text/event-stream" },
    });
  });
  expect(got).toEqual([
    {
      kind: "head",
      status: 200,
      headers: [["content-type", "text/event-stream"]],
    },
    { kind: "chunk", data: bytes("event: hello\ndata: {}\n\n") },
    { kind: "end" },
  ]);
});

test("interleaved bodies keep their own bytes, including a split character and a cut-off lead byte", async () => {
  const { port1, port2 } = new MessageChannel();
  ports = [port1, port2];
  const controllers = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  close = expose(port2, async (r) => {
    const body = new ReadableStream<Uint8Array>({
      start: (c) => void controllers.set(new URL(r.url).pathname, c),
    });
    return new Response(body);
  });
  const got = new Map<number, number[]>();
  const ended = new Set<number>();
  let seen = 0;
  port1.onmessage = (e: MessageEvent<{ id: number; kind: string; data?: ArrayBuffer }>) => {
    const m = e.data;
    if (m.kind === "chunk") got.set(m.id, [...(got.get(m.id) ?? []), ...new Uint8Array(m.data!)]);
    if (m.kind === "end") ended.add(m.id);
    seen++;
  };
  const until = async (ok: () => boolean) => {
    while (!ok()) await new Promise((r) => setTimeout(r, 1));
  };
  const request = (id: number, url: string) =>
    port1.postMessage({
      id,
      kind: "request",
      method: "GET",
      url,
      headers: [],
      body: null,
    });
  request(1, "/a");
  request(2, "/b");
  await until(() => controllers.size === 2 && seen >= 2);
  const send = async (path: string, bytes: number[]) => {
    const before = seen;
    controllers.get(path)!.enqueue(new Uint8Array(bytes));
    await until(() => seen > before);
  };
  // "é" is C3 A9 and "日" is E6 97 A5; each is split across two chunks, alternating between the responses
  await send("/a", [0x61, 0xc3]);
  await send("/b", [0x62, 0xe6]);
  await send("/a", [0xa9]);
  await send("/b", [0x97, 0xa5, 0xe6]);
  controllers.get("/a")!.close();
  controllers.get("/b")!.close();
  await until(() => ended.size === 2);
  expect(got.get(1)).toEqual([0x61, 0xc3, 0xa9]);
  // the trailing lone lead byte is passed on as is; decoding is the receiver's job
  expect(got.get(2)).toEqual([0x62, 0xe6, 0x97, 0xa5, 0xe6]);
});

test("a view on a larger buffer is copied so the source memory stays intact", async () => {
  const big = new Uint8Array([9, 9, 1, 2, 3, 9]);
  const view = big.subarray(2, 5);
  const got = (await roundTrip(async () => new Response(view))) as {
    kind: string;
    data?: ArrayBuffer;
  }[];
  const chunk = got.find((m) => m.kind === "chunk")!;
  expect([...new Uint8Array(chunk.data!)]).toEqual([1, 2, 3]);
  expect(big.buffer.byteLength).toBe(6);
});
