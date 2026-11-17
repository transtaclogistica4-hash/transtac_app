// ============================================================================
// CPF DOS MOTORISTAS — fonte unica: Cadastro de Motoristas do portal
// ----------------------------------------------------------------------------
// O CPF que vai para a planilha "GAM - Controle de Embarques Finalizados" sai
// do Cadastro de Motoristas (cadastro-motoristas.html -> Apps Script). Assim,
// cadastrou ou corrigiu o CPF no portal, o proximo embarque ja sai certo, sem
// precisar mexer no codigo.
//
// - Nome comparado sem acento, sem diferenca de maiusculas e espacos extras
//   ("Lucas de Souza" = "LUCAS DE SOUZA", "JOSUE" = "JOSUÉ").
// - CPF sempre gravado no formato 000.000.000-00 (o cadastro aceita so os
//   numeros e as vezes perde o zero da frente).
// - Se o cadastro nao responder, usa a lista de reserva passada pelo chamador.
//
// Variavel opcional: MOTORISTAS_SCRIPT_URL (Netlify > Environment variables).
// Sem ela, usa a mesma URL que a tela de Cadastro de Motoristas usa.
// ============================================================================

const URL_PADRAO =
  "https://script.google.com/macros/s/AKfycbypzKdoWY99DAZxKFhAitZ4gfsaUZr0EqBs56zJWTrsy8XgF3xI4zZ1EtAr6dLTHDZPrQ/exec";

const CACHE_MS = 5 * 60 * 1000;
let cache: { em: number; mapa: Record<string, string> } | null = null;

export function normalizarNome(nome: string): string {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function formatarCpf(cpf: string): string {
  const d = String(cpf || "").replace(/\D/g, "");
  if (!d || d.length > 11) return String(cpf || "").trim();
  const n = d.padStart(11, "0");
  return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
}

async function carregarCadastro(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.mapa;
  const url = Netlify.env.get("MOTORISTAS_SCRIPT_URL") || URL_PADRAO;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    const j: any = await r.json();
    const mapa: Record<string, string> = {};
    for (const m of j?.motoristas || []) {
      if (m?.ativo === false) continue;
      const cpf = formatarCpf(m?.cpf);
      if (m?.nome && cpf) mapa[normalizarNome(m.nome)] = cpf;
    }
    cache = { em: Date.now(), mapa };
    return mapa;
  } finally {
    clearTimeout(t);
  }
}

export async function cpfDoMotorista(
  nome: string,
  reserva: Record<string, string> = {}
): Promise<string> {
  const chave = normalizarNome(nome);
  try {
    const cadastro = await carregarCadastro();
    if (cadastro[chave]) return cadastro[chave];
  } catch (e) {
    console.warn("Cadastro de Motoristas indisponivel, usando lista de reserva:", e);
  }
  for (const [n, c] of Object.entries(reserva)) {
    if (normalizarNome(n) === chave && c) return formatarCpf(c);
  }
  return "";
}
