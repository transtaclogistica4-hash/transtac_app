import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getTodayKey } from "./lib/dateKey.mts";
import { storeName, chaveEscrita, chaveFallback } from "./lib/env.mts";

function keyForTrigger(dateKey: string) {
  return chaveEscrita(`ae-trigger:${dateKey}`);
}

// Le o gatilho da homologacao; se ainda nao existir, mostra o de producao.
async function lerTrigger(store: any, dateKey: string) {
  const proprio = await store.get(keyForTrigger(dateKey), { type: "json" });
  if (proprio) return proprio;
  const base = chaveFallback(`ae-trigger:${dateKey}`);
  if (base) {
    const producao = await store.get(base, { type: "json" });
    if (producao) return producao;
  }
  return null;
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, context: Context) => {
  const store = getStore({ name: storeName(), consistency: "strong" });
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const dateKey = dateParam || getTodayKey();
  const key = keyForTrigger(dateKey);

  if (req.method === "GET") {
    const data = (await lerTrigger(store, dateKey)) as any;
    return json(data || { triggered: false, date: dateKey });
  }

  if (req.method === "POST") {
    let body: { action?: string; date?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const action = body.action || "start";
    const targetDateKey = body.date || dateKey;
    const targetKey = keyForTrigger(targetDateKey);
    const current = ((await lerTrigger(store, targetDateKey)) as any) || {};

    let value: Record<string, unknown>;

    if (action === "start") {
      value = {
        ...current,
        triggered: true,
        date: targetDateKey,
        triggeredAt: new Date().toISOString(),
        processedAt: null,
      };
    } else if (action === "complete") {
      value = {
        ...current,
        processedAt: new Date().toISOString(),
      };
    } else if (action === "reset") {
      value = { triggered: false, date: targetDateKey };
    } else {
      return json({ error: "action invalida" }, 400);
    }

    await store.setJSON(targetKey, value);
    return json({ ok: true, ...value });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/ae-trigger",
};
