import type { Context, Config } from "@netlify/functions";
import { getTodayKey } from "./lib/dateKey.mts";
import { getAssignmentsStore, keyForDate, updateAssignments } from "./lib/assignmentsStore.mts";
import { isHomolog, sheetWebhook } from "./lib/env.mts";

// CPF dos motoristas (nao exposto ao frontend)
const DRIVER_CPF: Record<string, string> = {
"DIKSON SOARES DE BONA": "057.064.309-00",
"HELIO ALEX GONCALVES GRECO": "012.126.550-10",
"ALCEU MAZZUCHETTI": "693.358.009-10",
"ALEXANDRE LUCIO ALVES": "043.602.529-94",
"BRENO ANTONIO DA ROSA": "107.543.459-98",
"CASSIO FERNANDO SENA": "815.472.000-06",
"DANIEL CLASEN MACHADO": "912.917.209-87",
"EVANDRO VIEIRA RODRIGUES": "039.014.149-67",
"FARIDES TEIXEIRA GOMES": "973.117.742-68",
"GERALDO JULIO AVILA": "075.746.189-17",
"HIGOR DOMINGOS RUFINO TEXEIRA": "098.882.629-12",
"ISRAEL OLIVEIRA MARTINS ROCHA": "040.002.389-06",
"JAIR QUERINO DA COSTA": "036.362.199-79",
"LEANDRO FERNANDES": "051.262.249-30",
"LEANDRO FLAVIO DE ANDRADE": "034.894.439-00",
"LEONARDO ALVES THRONICKE": "108.554.439-79",
"LILIAN CRISTIAN SANSONOWICZ": "027.795.659-50",
"LUCIANO MENDES DA LUZ": "",
"LUCINARA VARELA BORGES": "024.652.200-39",
"LUIZ EDUARDO LEAL PEREIRA": "057.651.129-35",
"MARCIO MACHETTI RAMBO": "042.856.509-32",
"MARCOS CLASEN MACHADO": "064.032.759-17",
"MESSIAS GARCIA DA SILVA": "081.868.589-11",
"OTAVIO EUCLIDES NASCIMENTO": "103.451.049-51",
"RICARDO NUNES MARTINS": "060.988.779-39",
"VALDECIR VOLKMER": "055.170.539-63",
"ERIC CARDOSO KERBER": "113.801.559-83",
};

const FLEET: Record<string, { model: string; capacity: number }> = {
RYF4J27: { model: "TRUCK", capacity: 16 },
RDS7B12: { model: "TRUCK", capacity: 20 },
RYF5E77: { model: "TRUCK", capacity: 16 },
GDD4J40: { model: "TRUCK", capacity: 22 },
MMB6D44: { model: "TRUCK", capacity: 22 },
QJV4E36: { model: "3.4", capacity: 8 },
QRM9C65: { model: "TRUCK", capacity: 20 },
RAA2E77: { model: "TRUCK", capacity: 16 },
RAJ7B50: { model: "3.4", capacity: 8 },
RLB6E83: { model: "TRUCK", capacity: 22 },
RLD2B13: { model: "TRUCK", capacity: 22 },
RXU3I20: { model: "TRUCK", capacity: 16 },
RXU6H46: { model: "TRUCK", capacity: 20 },
RXV6D60: { model: "TRUCK", capacity: 22 },
TPW6J49: { model: "TRUCK", capacity: 16 },
RBD9A22: { model: "TRUCK", capacity: 16 },
PLU4G47: { model: "TRUCK", capacity: 16 },
MMB7I20: { model: "3.4", capacity: 8 },
};

export default async (req: Request, context: Context) => {
if (req.method !== "POST") {
return new Response("Method not allowed", { status: 405 });
}

let body: {
routeId?: string;
routeName?: string;
driver?: string;
plate?: string;
date?: string;
vehicleType?: string;
pallets?: number | string;
categoria?: string;
categoriaLabel?: string;
};
try {
body = await req.json();
} catch {
return new Response(JSON.stringify({ error: "JSON invalido" }), {
status: 400,
headers: { "Content-Type": "application/json" },
});
}

const { routeId, routeName, driver, plate, date, vehicleType, pallets, categoria, categoriaLabel } = body;

// Aba de destino na planilha, por categoria da operacao
const ABAS_POR_CATEGORIA: Record<string, string> = {
gam: "CARGAS DA GAM",
jadlog: "CARGAS DA JAD LOG",
terceiros: "CARGAS TERCEIROS",
transferencias: "TRANSFERENCIAS ENTRE CD",
};
const cat = String(categoria || "").toLowerCase();
const abaCategoria = ABAS_POR_CATEGORIA[cat] || "";
const rotuloCategoria = categoriaLabel || cat.toUpperCase();

if (!routeId || !driver || !plate) {
return new Response(
JSON.stringify({ error: "routeId, driver e plate sao obrigatorios" }),
{ status: 400, headers: { "Content-Type": "application/json" } }
);
}

const dateKey = getTodayKey();
const KEY = keyForDate(dateKey);

const cpf = DRIVER_CPF[driver] || "";
const fleetInfo = FLEET[plate];
const finalVehicleType = vehicleType || fleetInfo?.model || "";
const finalPallets = pallets !== undefined && pallets !== "" ? pallets : fleetInfo?.capacity ?? "";
const finalDate = date || dateKey;

// Campos nomeados: o Apps Script casa cada um com a coluna certa pelo
// cabecalho da aba, entao inserir ou mover colunas nao quebra a gravacao.
const campos = {
categoria: rotuloCategoria,
data: finalDate,
rota: routeName || routeId,
motorista: driver,
cpf,
placa: plate,
veiculo: finalVehicleType,
pallets: finalPallets,
routeId,
};

// Mantido por compatibilidade com a versao antiga do Apps Script
const row = [finalDate, routeName || routeId, driver, cpf, plate, finalVehicleType, finalPallets, routeId, rotuloCategoria];

const webhookUrl = sheetWebhook();
const simular = isHomolog() && !webhookUrl;

if (!webhookUrl && !simular) {
return new Response(
JSON.stringify({ error: "GSHEET_WEBHOOK_URL nao configurada" }),
{ status: 500, headers: { "Content-Type": "application/json" } }
);
}

if (!simular) {
try {
const sheetRes = await fetch(webhookUrl as string, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ campos, row, routeId, date: finalDate, categoria: cat, categoriaLabel: rotuloCategoria, abaCategoria }),
redirect: "follow",
});
if (!sheetRes.ok) {
const text = await sheetRes.text();
return new Response(
JSON.stringify({ error: "Falha ao gravar na planilha", detail: text }),
{ status: 502, headers: { "Content-Type": "application/json" } }
);
}
} catch (err) {
return new Response(
JSON.stringify({ error: "Erro ao chamar a planilha", detail: String(err) }),
{ status: 502, headers: { "Content-Type": "application/json" } }
);
}
}

// Marca a rota como finalizada no store, com escrita condicional (evita
// perder essa marcacao se outra tela salvar algo na mesma rota ao mesmo
// tempo — mesma causa do "só salva na terceira tentativa" corrigida aqui).
const store = getAssignmentsStore();
const finalizedAt = new Date().toISOString();
try {
await updateAssignments(store, KEY, (assignments) => {
const existing = assignments[routeId] || {};
assignments[routeId] = { ...existing, finalizedAt };
return assignments[routeId];
});
} catch (err) {
return new Response(
JSON.stringify({ error: (err as Error).message || String(err) }),
{ status: 409, headers: { "Content-Type": "application/json" } }
);
}

return new Response(JSON.stringify({ ok: true, finalizedAt, row, simulado: simular, ambiente: isHomolog() ? "homolog" : "producao" }), {
headers: { "Content-Type": "application/json" },
});
};

export const config: Config = {
path: "/api/finalize",
};
