import type { Context, Config } from "@netlify/functions";
import { isHomolog, whatsappTeste } from "./lib/env.mts";

// Numeros de WhatsApp dos motoristas (planilha Motorista.xlsx).
// Mantido apenas no servidor: o cliente nunca recebe a lista inteira,
// só o link "wa.me" já pronto do motorista da rota que ele está finalizando.
const DRIVER_WHATSAPP: Record<string, string> = {
  "ALCEU MAZZUCHETTI": "+55 48 9968-7871",
  "ALEXANDRE LUCIO ALVES": "+55 48 9942-0575",
  "BRENO ANTONIO DA ROSA": "+55 48 9945-2440",
  "CASSIO FERNANDO SENA": "+55 48 8808-5246",
  "DANIEL CLASEN MACHADO": "+55 48 9134-7165",
  "EVANDRO VIEIRA RODRIGUES": "+55 41 9935-9017",
  "FARIDES TEIXEIRA GOMES": "+55 92 8431-9021",
  "GERALDO JULIO AVILA": "+55 48 9845-4909",
  "HIGOR DOMINGOS RUFINO TEXEIRA": "+55 48 9641-3147",
  "ISRAEL OLIVEIRA MARTINS ROCHA": "+55 48 9934-2992",
  "JAIR QUERINO DA COSTA": "+55 48 9915-5110",
  "LEANDRO FERNANDES": "+55 47 9667-7698",
  "LEANDRO FLAVIO DE ANDRADE": "+55 41 7402-0889",
  "LEONARDO ALVES THRONICKE": "+55 47 9928-7114",
  "LILIAN CRISTIAN SANSONOWICZ": "+55 48 9699-3600",
  "LUCAS DE SOUZA": "+55 48 99667-1397",
  "LUCINARA VARELA BORGES": "+55 54 9171-9552",
  "LUIZ EDUARDO LEAL PEREIRA": "+55 48 9970-7758",
  "MARCIO MACHETTI RAMBO": "+55 41 8870-4104",
  "MARCOS CLASEN MACHADO": "+55 48 9907-9581",
  "MESSIAS GARCIA DA SILVA": "+55 48 9614-9775",
  "OTAVIO EUCLIDES NASCIMENTO": "+55 48 9131-7780",
  "RICARDO NUNES MARTINS": "+55 48 9927-6813",
  "VALDECIR VOLKMER": "+55 41 9669-8691",
  "ERIC CARDOSO KERBER": "+55 48 99826-8637",
};

function montarMensagem(b: any): string {
  const linhas = [
    (isHomolog() ? "[TESTE - HOMOLOGACAO] " : "") + "Embarque Agendado",
    "Rota: " + (b.routeName || "-"),
    "Motorista: " + (b.driver || "-"),
  ];
  if (b.plate) linhas.push("Placa: " + b.plate);
  if (b.vehicleType) linhas.push("Tipo de veículo: " + b.vehicleType);
  if (b.pallets !== undefined && b.pallets !== null && String(b.pallets).trim() !== "") {
    linhas.push("Paletes: " + b.pallets);
  }
  if (b.aeNumber !== undefined && b.aeNumber !== null && String(b.aeNumber).trim() !== "") {
    linhas.push("Autorização de Embarque: " + b.aeNumber);
  }
  linhas.push("Data: " + formatDateBR(b.date));
  return linhas.join("\n");
}

function formatDateBR(dateKey?: string) {
  if (!dateKey || dateKey.indexOf("-") === -1) return dateKey || "-";
  const [y, m, d] = dateKey.split("-");
  return `${d}/${m}/${y}`;
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: {
    driver?: string;
    routeName?: string;
    plate?: string;
    vehicleType?: string;
    pallets?: string | number;
    date?: string;
aeNumber?: string | number;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON invalido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { driver, routeName, plate, vehicleType, pallets, date , aeNumber} = body;

  if (!driver) {
    return new Response(JSON.stringify({ ok: false, error: "Campo driver e obrigatorio" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const raw = DRIVER_WHATSAPP[driver];
  if (!raw) {
    return new Response(JSON.stringify({ ok: false, error: "Numero nao cadastrado para este motorista" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // HOMOLOG: nunca devolve o numero real do motorista. Ou usa o numero de
  // teste (WHATSAPP_TESTE), ou devolve so a previa da mensagem, sem link.
  let numeroBase = raw;
  let simulado = false;
  if (isHomolog()) {
    const teste = whatsappTeste();
    // Com WHATSAPP_TESTE definido, todo teste vai para esse unico numero.
    // Sem ele, o link e gerado normalmente (a tela continua funcionando),
    // mas a mensagem sai marcada como teste. Nada e enviado sozinho: o
    // WhatsApp so abre; quem dispara e a pessoa.
    if (teste) numeroBase = teste;
    simulado = true;
  }

  const number = numeroBase.replace(/\D/g, "");
  const texto = encodeURIComponent(montarMensagem(body));
  const url = "https://wa.me/" + number + "?text=" + texto;

  return new Response(JSON.stringify({ ok: true, url, simulado, ambiente: isHomolog() ? "homolog" : "producao" }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/whatsapp-link",
};