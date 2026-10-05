import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { keyPrefix, isHomolog, ambienteNome } from "./lib/env.mts";

// ============================================================================
// BASES TRANSTAC — cadastro das bases (matriz, filiais, CDs, pontos de apoio)
// e da localização de cada uma.
//
// Armazenamento: Netlify Blobs, store "transtac-bases", uma chave por base:
//   producao    -> base:<id>
//   homologacao -> hml:base:<id>   (lê produção enquanto a homologação estiver vazia)
// ============================================================================

const STORE = "transtac-bases";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const TIPOS = ["Matriz", "Filial", "Centro de distribuição", "Ponto de apoio", "Garagem", "Outro"];
const TEXTO = ["nome", "tipo", "status", "cnpj", "cep", "logradouro", "numero", "complemento", "bairro",
  "cidade", "uf", "responsavel", "telefone", "email", "horario", "observacoes"];

function loja() {
  return getStore({ name: STORE, consistency: "strong" });
}

async function listar(store: ReturnType<typeof getStore>, prefixo: string) {
  const { blobs } = await store.list({ prefix: prefixo });
  const docs = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return docs.filter(Boolean) as Record<string, unknown>[];
}

function limpar(b: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of TEXTO) out[k] = String(b[k] ?? "").trim().slice(0, k === "observacoes" ? 1000 : 200);
  out.uf = String(out.uf).toUpperCase().slice(0, 2);
  if (!TIPOS.includes(String(out.tipo))) out.tipo = "Outro";
  out.status = out.status === "inativa" ? "inativa" : "ativa";
  for (const k of ["lat", "lng"]) {
    const n = b[k] === "" || b[k] === null || b[k] === undefined ? null : Number(b[k]);
    out[k] = n !== null && Number.isFinite(n) ? n : null;
  }
  if (out.lat !== null && (Math.abs(out.lat as number) > 90)) out.lat = null;
  if (out.lng !== null && (Math.abs(out.lng as number) > 180)) out.lng = null;
  return out;
}

export default async (req: Request) => {
  const store = loja();
  const pre = keyPrefix() + "base:";

  if (req.method === "GET") {
    let bases = await listar(store, pre);
    if (!bases.length && isHomolog()) bases = await listar(store, "base:");
    bases.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
    return json({ ok: true, ambiente: ambienteNome(), bases });
  }

  if (req.method !== "POST") return json({ ok: false, erro: "Método não suportado" }, 405);

  let body: { acao?: string; id?: string; base?: Record<string, unknown>; usuario?: string };
  try { body = await req.json(); } catch { return json({ ok: false, erro: "JSON inválido" }, 400); }

  const usuario = String(body.usuario || "").trim().slice(0, 80);
  if (!usuario) return json({ ok: false, erro: "Faça login no portal para alterar as bases." }, 401);

  if (body.acao === "salvar") {
    const dados = limpar(body.base || {});
    if (!dados.nome) return json({ ok: false, erro: "Informe o nome da base." }, 400);
    if (!dados.cidade || !dados.uf) return json({ ok: false, erro: "Informe cidade e UF." }, 400);
    const id = /^[a-z0-9-]{6,40}$/.test(String(body.id || "")) ? String(body.id) : crypto.randomUUID();
    const atual = (await store.get(pre + id, { type: "json" })) as Record<string, unknown> | null;
    const agora = new Date().toISOString();
    const doc = {
      ...dados, id,
      criadoEm: atual?.criadoEm || agora, criadoPor: atual?.criadoPor || usuario,
      atualizadoEm: agora, atualizadoPor: usuario,
    };
    await store.setJSON(pre + id, doc);
    return json({ ok: true, base: doc });
  }

  if (body.acao === "excluir") {
    const id = String(body.id || "");
    if (!/^[a-z0-9-]{6,40}$/.test(id)) return json({ ok: false, erro: "Base inválida." }, 400);
    await store.delete(pre + id);
    return json({ ok: true });
  }

  return json({ ok: false, erro: "Ação desconhecida." }, 400);
};

export const config: Config = {
  path: "/api/bases",
};
