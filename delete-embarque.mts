import type { Context, Config } from "@netlify/functions";
import { isHomolog, sheetWebhook, respostaSimulada } from "./lib/env.mts";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { category?: string; date?: string; routeId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON invalido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { category, date, routeId } = body;
  if (!date || !routeId) {
    return new Response(
      JSON.stringify({ error: "date e routeId sao obrigatorios" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const webhookUrl = sheetWebhook();

  if (!webhookUrl && isHomolog()) {
    return respostaSimulada({ type: "delete", category: category || "", date, routeId });
  }

  if (!webhookUrl) {
    return new Response(
      JSON.stringify({ error: "GSHEET_WEBHOOK_URL nao configurada" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const sheetRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "delete", category: category || "", date, routeId }),
      redirect: "follow",
    });
    const text = await sheetRes.text();
    if (!sheetRes.ok) {
      return new Response(
        JSON.stringify({ error: "Falha ao excluir na planilha", detail: text }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(text, { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Erro ao chamar a planilha", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = {
  path: "/api/delete-embarque",
};
