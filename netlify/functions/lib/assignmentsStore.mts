import { getStore } from "@netlify/blobs";
import { storeName, chaveEscrita, chaveFallback, isHomolog } from "./env.mts";
const MAX_WRITE_ATTEMPTS = 8;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Consistencia forte: por padrao o Netlify Blobs usa consistencia "eventual"
// (uma escrita pode levar ate 60s para propagar para todas as leituras). Isso
// fazia com que, logo apos salvar em uma tela, a proxima leitura (nesta ou em
// outra tela) as vezes voltasse com a versao antiga — parecendo que o dado
// "sumiu" e exigindo tentar salvar de novo. Com consistencia forte, toda
// leitura reflete a escrita mais recente.
export function getAssignmentsStore() {
  return getStore({ name: storeName(), consistency: "strong" });
}

// Chave de ESCRITA do dia (em homologacao vem com prefixo hml:).
export function keyForDate(dateKey: string) {
  return chaveEscrita(`assignments:${dateKey}`);
}

// Chave de producao do mesmo dia, usada so como fallback de LEITURA.
export function keyOriginal(dateKey: string) {
  return `assignments:${dateKey}`;
}

// Leitura com fallback: usa o que a homologacao ja gravou; se ainda nao houver
// nada, mostra os dados reais de producao (somente leitura).
export async function readAssignments(
  store: ReturnType<typeof getStore>,
  dateKey: string
): Promise<Record<string, any>> {
  const proprio = (await store.get(keyForDate(dateKey), { type: "json" })) as any;
  if (proprio) return proprio;

  const base = chaveFallback(`assignments:${dateKey}`);
  if (base) {
    const producao = (await store.get(base, { type: "json" })) as any;
    if (producao) return producao;
  }
  return {};
}

// Le o blob do dia, aplica "mutate" sobre o objeto de rotas e tenta gravar de
// forma condicional (onlyIfMatch / onlyIfNew). Se outra requisicao (outra
// tela, outro usuario) gravou no meio do caminho, o etag nao bate, a
// gravacao falha e tentamos de novo lendo o valor mais recente. Isso evita
// perder atualizacoes quando duas telas salvam quase ao mesmo tempo — a
// causa do "só salva na terceira tentativa".
export async function updateAssignments<T>(
  store: ReturnType<typeof getStore>,
  key: string,
  mutate: (assignments: Record<string, any>) => T
): Promise<T> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const current = await store.getWithMetadata(key, { type: "json" });
    let assignments: Record<string, any> = (current && current.data) || {};

    // Copy-on-write: se a homologacao ainda nao tem nada gravado neste dia,
    // parte de uma COPIA dos dados de producao. A origem nunca e alterada.
    if (isHomolog() && (!current || !current.data) && key.startsWith("hml:")) {
      const origem = (await store.get(key.slice(4), { type: "json" })) as any;
      if (origem) assignments = JSON.parse(JSON.stringify(origem));
    }
    const result = mutate(assignments);

    const writeOptions = current && current.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const writeRes = await store.setJSON(key, assignments, writeOptions);

    if (writeRes && writeRes.modified) {
      return result;
    }

    await sleep(60 + Math.random() * 140);
  }

  throw new Error("Nao foi possivel salvar: muitas gravacoes concorrentes. Tente novamente.");
}
