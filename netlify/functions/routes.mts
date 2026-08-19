import type { Context, Config } from "@netlify/functions";
import { getTodayKey } from "./lib/dateKey.mts";
import { getAssignmentsStore, keyForDate, updateAssignments, readAssignments } from "./lib/assignmentsStore.mts";
import { isHomolog, sheetWebhook } from "./lib/env.mts";

export default async (req: Request, context: Context) => {
  const store = getAssignmentsStore();
  const dateKey = getTodayKey();
  const KEY = keyForDate(dateKey);

  if (req.method === "GET") {
    const assignments = await readAssignments(store, dateKey);
    return new Response(JSON.stringify({ date: dateKey, assignments }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST") {
    let body: {
      id?: string;
      name?: string;
      plate?: string;
      driver?: string;
      extraRoute?: string;
      comercial?: boolean;
      ordemColeta?: string;
      statusAgenda?: string;
      freteRecebido?: number | string;
      valorPago?: number | string;
      gerouCusto?: string;
      custoDescricao?: string;
      custoTipo?: string;
      custoValor?: number | string;
      valorLiquido?: number | string;
    };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "JSON invalido" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const {
      id,
      name,
      plate,
      driver,
      extraRoute,
      comercial,
      ordemColeta,
      statusAgenda,
      freteRecebido,
      valorPago,
      gerouCusto,
      custoDescricao,
      custoTipo,
      custoValor,
      valorLiquido,
    } = body;
    if (!id) {
      return new Response(JSON.stringify({ error: "Campo id e obrigatorio" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const updatedAt = new Date().toISOString();
    let sheetWarning: string | undefined;

    if (comercial) {
      const webhookUrl = sheetWebhook();
      if (!webhookUrl && isHomolog()) {
        sheetWarning = "HOMOLOG: sem planilha de teste configurada — dados comerciais salvos apenas no store de homologacao.";
      } else if (!webhookUrl) {
        sheetWarning = "GSHEET_WEBHOOK_URL nao configurada — dados comerciais salvos apenas localmente.";
      } else {
        try {
          const sheetRes = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "comercial",
              date: dateKey,
              routeId: id,
              routeName: name || "",
              ordemColeta: ordemColeta ?? "",
              statusAgenda: statusAgenda ?? "",
              freteRecebido: freteRecebido ?? "",
              valorPago: valorPago ?? "",
              gerouCusto: gerouCusto ?? "",
              custoDescricao: custoDescricao ?? "",
              custoTipo: custoTipo ?? "",
              custoValor: custoValor ?? "",
              valorLiquido: valorLiquido ?? "",
            }),
            redirect: "follow",
          });
          if (!sheetRes.ok) {
            sheetWarning = "Falha ao gravar dados comerciais na planilha.";
          }
        } catch (err) {
          sheetWarning = "Erro ao chamar a planilha: " + String(err);
        }
      }
    }

    let record: Record<string, unknown>;
    try {
      record = await updateAssignments(store, KEY, (assignments) => {
        const existing = assignments[id] || {};
        const next: Record<string, unknown> = { ...existing };
        next.name = name || existing.name || "";

        if (driver !== undefined) {
          next.driver = driver;
          next.updatedAtDriver = updatedAt;
        }
        if (plate !== undefined) {
          next.plate = plate;
          next.updatedAtPlaca = updatedAt;
        }
        if (extraRoute !== undefined) {
          next.extraRoute = extraRoute;
        }
        if (comercial) {
          next.ordemColeta = ordemColeta ?? "";
          next.statusAgenda = statusAgenda ?? "";
          next.freteRecebido = freteRecebido ?? "";
          next.valorPago = valorPago ?? "";
          next.gerouCusto = gerouCusto ?? "";
          next.custoDescricao = custoDescricao ?? "";
          next.custoTipo = custoTipo ?? "";
          next.custoValor = custoValor ?? "";
          next.valorLiquido = valorLiquido ?? "";
          next.updatedAtComercial = updatedAt;
        }

        assignments[id] = next;
        return next;
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: (err as Error).message || String(err) }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, updatedAt, date: dateKey, record, warning: sheetWarning }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/routes",
};
