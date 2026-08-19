import type { Context, Config } from "@netlify/functions";

/**
 * Modulo Devolucoes
 *
 * Planilha: 1DUDe705yi_YwJMFIPrVP1g404jzSdbvQFAm9Sc1aK-I
 *   aba DEVOLUCAO -> cadastro da devolucao (ID gerado no Apps Script)
 *   aba ENTREGA   -> motorista, placa e data da entrega
 *   aba GERAL     -> consolidado registrado no envio ao motorista
 *
 * Exige a variavel DEVOLUCOES_WEBHOOK_URL no Netlify, com a URL /exec
 * do Apps Script publicado (ver apps-script/devolucoes.gs).
 *
 * GET  /api/devolucoes?data=all|devolucao|entrega|geral
 * GET  /api/devolucoes?data=ping   -> diagnostico da conexao
 * POST /api/devolucoes  { acao: "nova"|"entrega"|"geral", dados }
 */

const ACOES_VALIDAS = ["nova", "entrega", "geral"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Traduz respostas tipicas do Apps Script em mensagem util. */
function diagnosticar(status: number, texto: string): string | null {
  const t = (texto || "").slice(0, 3000);

  if (t.indexOf("<!DOCTYPE") !== -1 || t.indexOf("<html") !== -1) {
    if (/accounts\.google\.com|ServiceLogin|Sign in|Fazer login/i.test(t)) {
      return "O Apps Script esta pedindo login. Na implantacao, ajuste 'Quem pode acessar' para 'Qualquer pessoa'.";
    }
    if (/autoriza|authoriz|permission/i.test(t)) {
      return "O Apps Script nao foi autorizado. Abra o projeto, rode a funcao doGet uma vez e aceite as permissoes.";
    }
    return "A URL respondeu com pagina HTML em vez de JSON. Confirme que ela termina em /exec e que a implantacao e do tipo 'App da Web'.";
  }
  if (status === 404) return "URL do Apps Script nao encontrada (404). Confira DEVOLUCOES_WEBHOOK_URL.";
  if (status === 401 || status === 403) {
    return "Acesso negado pelo Google. Na implantacao, ajuste 'Quem pode acessar' para 'Qualquer pessoa'.";
  }
  if (/openById|No item with the given ID/i.test(t)) {
    return "O Apps Script nao conseguiu abrir a planilha. A conta que publicou precisa ter acesso de edicao.";
  }
  return null;
}

async function chamarScript(url: string, init?: RequestInit) {
  const res = await fetch(url, { redirect: "follow", ...(init || {}) });
  const texto = await res.text();
  return { status: res.status, ok: res.ok, texto };
}

export default async (req: Request, _context: Context) => {
  const webhookUrl = Netlify.env.get("DEVOLUCOES_WEBHOOK_URL");
  if (!webhookUrl) {
    return json(
      {
        ok: false,
        error:
          "DEVOLUCOES_WEBHOOK_URL nao configurada no Netlify. Publique o Apps Script de Devolucoes e cadastre a URL /exec nas variaveis de ambiente.",
      },
      500
    );
  }
  if (webhookUrl.indexOf("/exec") === -1) {
    return json(
      {
        ok: false,
        error:
          "DEVOLUCOES_WEBHOOK_URL nao termina em /exec. Use a URL da implantacao (App da Web), nao a do editor nem a que termina em /dev.",
      },
      500
    );
  }

  const url = new URL(req.url);
  const sep = webhookUrl.indexOf("?") === -1 ? "?" : "&";

  // ---------- Diagnostico ----------
  if (req.method === "GET" && url.searchParams.get("data") === "ping") {
    try {
      const r = await chamarScript(webhookUrl + sep + "data=devolucao&t=" + Date.now());
      let parsed: any = null;
      try {
        parsed = JSON.parse(r.texto);
      } catch {
        parsed = null;
      }
      return json({
        ok: true,
        statusHttp: r.status,
        respostaEhJson: parsed !== null,
        scriptOk: parsed ? parsed.ok === true : false,
        erroDoScript: parsed && parsed.ok === false ? parsed.error : null,
        diagnostico: diagnosticar(r.status, r.texto),
        amostraResposta: r.texto.slice(0, 500),
      });
    } catch (err) {
      return json({ ok: false, error: "Nao consegui contatar a URL", detail: String(err) }, 502);
    }
  }

  // ---------- Leitura ----------
  if (req.method === "GET") {
    const data = url.searchParams.get("data") || "all";
    try {
      const r = await chamarScript(webhookUrl + sep + "data=" + encodeURIComponent(data) + "&t=" + Date.now());
      const dica = diagnosticar(r.status, r.texto);
      if (!r.ok || dica) {
        return json({ ok: false, error: dica || "Falha ao ler a planilha", statusHttp: r.status, detail: r.texto.slice(0, 300) }, 502);
      }
      try {
        const out = JSON.parse(r.texto);
        if (out && out.ok === false) {
          return json({ ok: false, error: "Erro no Apps Script: " + (out.error || "sem detalhe") }, 502);
        }
        return json(out);
      } catch {
        return json({ ok: false, error: "Resposta invalida do Apps Script", detail: r.texto.slice(0, 300) }, 502);
      }
    } catch (err) {
      return json({ ok: false, error: "Erro ao contatar a planilha", detail: String(err) }, 502);
    }
  }

  // ---------- Gravacao ----------
  if (req.method !== "POST") {
    return json({ ok: false, error: "Metodo nao permitido" }, 405);
  }

  let body: { acao?: string; dados?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON invalido" }, 400);
  }

  const acao = String(body.acao || "").toLowerCase();
  const dados = body.dados || {};

  if (ACOES_VALIDAS.indexOf(acao) === -1) {
    return json({ ok: false, error: "acao deve ser 'nova', 'entrega' ou 'geral'" }, 400);
  }
  if (!dados || typeof dados !== "object" || !Object.keys(dados).length) {
    return json({ ok: false, error: "Nenhum campo enviado" }, 400);
  }

  try {
    const r = await chamarScript(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        acao,
        dados,
        registradoEm: new Date().toISOString(),
      }),
    });

    const dica = diagnosticar(r.status, r.texto);
    if (!r.ok || dica) {
      return json({ ok: false, error: dica || "Falha ao gravar na planilha", statusHttp: r.status, detail: r.texto.slice(0, 300) }, 502);
    }

    let out: any = {};
    try {
      out = JSON.parse(r.texto);
    } catch {
      return json({ ok: false, error: "Resposta invalida do Apps Script", detail: r.texto.slice(0, 300) }, 502);
    }
    if (!out.ok) {
      return json({ ok: false, error: "Erro no Apps Script: " + (out.error || "sem detalhe") }, 502);
    }
    return json({ ok: true, acao, id: out.id || null, linha: out.linha || null });
  } catch (err) {
    return json({ ok: false, error: "Erro ao chamar a planilha", detail: String(err) }, 502);
  }
};

export const config: Config = {
  path: "/api/devolucoes",
};
