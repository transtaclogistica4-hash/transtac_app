// ============================================================================
// AMBIENTE — controle central de homologação
// ----------------------------------------------------------------------------
// Este pacote é o ambiente de PRODUÇÃO. O padrão aqui é gravar de verdade: se
// a variável APP_ENV não existir, o sistema assume produção. Homologação só
// acontece com APP_ENV = "homolog" declarado explicitamente.
//
// O padrão inverso (assumir homologação) seria pior neste pacote: uma variável
// esquecida faria a gravação ser simulada em silêncio, e ninguém perceberia
// que os embarques pararam de chegar na planilha.
//
// Variáveis de ambiente usadas (Netlify > Site configuration > Environment):
//   APP_ENV                 -> "producao" (padrão) ou "homolog"
//   GSHEET_WEBHOOK_URL      -> webhook da planilha de PRODUÇÃO
//   GSHEET_WEBHOOK_URL_HML  -> webhook da planilha de TESTE (opcional)
//   WHATSAPP_TESTE          -> número que recebe todos os testes de WhatsApp
// ============================================================================

export function isHomolog(): boolean {
  const env = (Netlify.env.get("APP_ENV") || "producao").toLowerCase();
  return env === "homolog" || env === "homologacao" || env === "hml";
}

export function ambienteNome(): string {
  return isHomolog() ? "homolog" : "producao";
}

// Store do Netlify Blobs — o MESMO da producao. O isolamento nao e mais por
// store separado (que deixava a homologacao vazia), e sim por PREFIXO DE CHAVE:
//
//   producao    -> assignments:2026-07-30
//   homologacao -> hml:assignments:2026-07-30
//
// Leitura: procura primeiro a chave de homologacao; se ainda nao existir,
//          devolve a de producao. Assim as telas aparecem com os dados reais.
// Escrita: SEMPRE na chave com prefixo hml:. A chave de producao nunca e
//          alterada nem apagada pela homologacao.
export function storeName(): string {
  return "gam-rotas";
}

// Prefixo aplicado a toda chave gravada em homologacao.
export function keyPrefix(): string {
  return isHomolog() ? "hml:" : "";
}

// Chave de escrita (com prefixo) e chave de leitura de fallback (producao).
export function chaveEscrita(base: string): string {
  return keyPrefix() + base;
}
export function chaveFallback(base: string): string | null {
  return isHomolog() ? base : null;
}

// Webhook da planilha. Em homologação NUNCA devolve a URL de produção:
// ou devolve a URL de teste, ou devolve null (e a função simula a gravação).
export function sheetWebhook(): string | null {
  if (isHomolog()) {
    return Netlify.env.get("GSHEET_WEBHOOK_URL_HML") || null;
  }
  return Netlify.env.get("GSHEET_WEBHOOK_URL") || null;
}

// Número único que recebe os testes de WhatsApp. Sem ele, homologação não
// devolve nenhum número de motorista.
export function whatsappTeste(): string | null {
  return Netlify.env.get("WHATSAPP_TESTE") || null;
}

// Resposta padrão de gravação simulada.
export function respostaSimulada(payload: unknown, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      ok: true,
      simulado: true,
      ambiente: "homolog",
      aviso: "Homologação sem planilha de teste configurada: nada foi gravado.",
      payload,
      ...extra,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
