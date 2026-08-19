import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Cargas Terceiros 2.0 — operacao independente das rotas do dia.
// As cargas ficam em um store proprio (nao expiram no fim do dia, porque
// coleta e entrega podem cair em dias diferentes).
const STORE_NAME = "terceiros2";
const KEY = "cargas";
const MAX_WRITE_ATTEMPTS = 8;

// Campos aceitos do frontend. Qualquer coisa fora desta lista e ignorada.
const FIELDS = [
  "cliente",
  "documento",
  "contato",
  "telefone",
  "email",
  "origem",
  "destino",
  "tipoCarga",
  "notaFiscal",
  "peso",
  "volumes",
  "valorMercadoria",
  "dataColeta",
  "dataPrevista",
  "dataEntrega",
  "driver",
  "plate",
  "vehicleType",
  "pallets",
  "ordemColeta",
  "statusAgenda",
  "freteRecebido",
  "valorPago",
  "gerouCusto",
  "custoDescricao",
  "custoTipo",
  "custoValor",
  "valorLiquido",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCargasStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

// Mesma estrategia de escrita condicional usada em assignmentsStore: le,
// aplica a mutacao e grava com onlyIfMatch. Se outra aba gravou no meio do
// caminho, tenta de novo com o valor mais recente.
async function updateCargas<T>(
  store: ReturnType<typeof getStore>,
  mutate: (cargas: Record<string, any>) => T
): Promise<T> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const current = await store.getWithMetadata(KEY, { type: "json" });
    const cargas: Record<string, any> = (current && current.data) || {};
    const result = mutate(cargas);

    const writeOptions = current && current.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const writeRes = await store.setJSON(KEY, cargas, writeOptions);

    if (writeRes && writeRes.modified) {
      return result;
    }

    await sleep(60 + Math.random() * 140);
  }

  throw new Error("Nao foi possivel salvar: muitas gravacoes concorrentes. Tente novamente.");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, context: Context) => {
  const store = getCargasStore();

  if (req.method === "GET") {
    const cargas = (await store.get(KEY, { type: "json" })) || {};
    return json({ cargas });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON invalido" }, 400);
  }

  const id = body.id;
  if (!id || typeof id !== "string") {
    return json({ error: "Campo id e obrigatorio" }, 400);
  }

  if (body.action === "delete") {
    try {
      await updateCargas(store, (cargas) => {
        delete cargas[id];
        return true;
      });
    } catch (err) {
      return json({ error: (err as Error).message || String(err) }, 409);
    }
    return json({ ok: true, deleted: id });
  }

  const updatedAt = new Date().toISOString();

  let record: Record<string, any>;
  try {
    record = await updateCargas(store, (cargas) => {
      const existing = cargas[id] || { createdAt: updatedAt };
      const next: Record<string, any> = { ...existing };
      FIELDS.forEach((f) => {
        if (body[f] !== undefined) next[f] = body[f];
      });
      next.updatedAt = updatedAt;
      cargas[id] = next;
      return next;
    });
  } catch (err) {
    return json({ error: (err as Error).message || String(err) }, 409);
  }

  let warning: string | undefined;

  if (body.registrar) {
    const webhookUrl = Netlify.env.get("GSHEET_TERCEIROS2_WEBHOOK_URL");
    if (!webhookUrl) {
      warning = "GSHEET_TERCEIROS2_WEBHOOK_URL nao configurada — carga salva apenas no sistema.";
    } else {
      // Ordem das colunas na planilha. Precisa bater com o cabecalho criado
      // pelo Apps Script (funcao ensureHeader).
      const row = [
        record.dataColeta || "",
        record.cliente || "",
        record.documento || "",
        record.contato || "",
        record.telefone || "",
        record.email || "",
        record.origem || "",
        record.destino || "",
        record.tipoCarga || "",
        record.notaFiscal || "",
        record.peso ?? "",
        record.volumes ?? "",
        record.valorMercadoria ?? "",
        record.dataPrevista || "",
        record.dataEntrega || "",
        record.driver || "",
        record.plate || "",
        record.vehicleType || "",
        record.pallets ?? "",
        record.ordemColeta || "",
        record.statusAgenda || "",
        record.freteRecebido ?? "",
        record.valorPago ?? "",
        record.gerouCusto || "",
        record.custoDescricao || "",
        record.custoTipo || "",
        record.custoValor ?? "",
        record.valorLiquido ?? "",
        id,
      ];

      try {
        const sheetRes = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "terceiros2", cargaId: id, row }),
          redirect: "follow",
        });
        if (!sheetRes.ok) {
          warning = "Falha ao gravar na planilha (HTTP " + sheetRes.status + ").";
        } else {
          const registradoEm = new Date().toISOString();
          try {
            record = await updateCargas(store, (cargas) => {
              const existing = cargas[id] || {};
              cargas[id] = { ...existing, registradoEm };
              return cargas[id];
            });
          } catch {
            warning = "Gravado na planilha, mas nao foi possivel marcar a carga como registrada.";
          }
        }
      } catch (err) {
        warning = "Erro ao chamar a planilha: " + String(err);
      }
    }
  }

  return json({ ok: true, updatedAt, record, warning });
};

export const config: Config = {
  path: "/api/terceiros2",
};
