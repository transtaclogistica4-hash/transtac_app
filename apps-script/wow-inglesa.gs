/*******************************************************************
 * TRANSTAC - Modulo WOW / Inglesa
 * Apps Script que grava e le as duas planilhas do modulo.
 *
 * COMO PUBLICAR:
 *  1. script.google.com  ->  Novo projeto  ->  cole este codigo
 *  2. Ajuste ABA_COTACAO / ABA_CARGAS se os nomes das abas forem outros
 *  3. Implantar  ->  Nova implantacao  ->  Tipo: App da Web
 *       Executar como.......: Eu
 *       Quem pode acessar...: Qualquer pessoa
 *  4. Copie a URL gerada (.../exec)
 *  5. Netlify  ->  Site settings  ->  Environment variables
 *       WOW_WEBHOOK_URL = a URL copiada
 *  6. Refaca o deploy do site
 *******************************************************************/

var ID_COTACAO = "1MWeJ2GRJZCNourhLi4QRdrHn1GEjbe2qbTKotCCem-k";
var ID_CARGAS  = "1BsDdwI7OqV_9Mu6a4-WLbkg4V14lHO20wR1eyGAcJJk";

// Deixe vazio ("") para usar a primeira aba da planilha.
var ABA_COTACAO = "";
var ABA_CARGAS  = "";

/* ---------------- utilitarios ---------------- */

function _resp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _aba(id, nome) {
  var ss = SpreadsheetApp.openById(id);
  if (nome) {
    var s = ss.getSheetByName(nome);
    if (s) return s;
  }
  return ss.getSheets()[0];
}

// normaliza cabecalho: sem acento, sem espaco, minusculo
function _norm(v) {
  return String(v == null ? "" : v)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

function _cabecalho(sheet) {
  var ultima = sheet.getLastColumn();
  if (ultima < 1) return [];
  return sheet.getRange(1, 1, 1, ultima).getValues()[0];
}

function _formatarData(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, "America/Sao_Paulo", "yyyy-MM-dd");
  }
  return v;
}

/* ---------------- leitura ---------------- */

function _lerLinhas(sheet) {
  var ultimaLinha = sheet.getLastRow();
  var ultimaCol = sheet.getLastColumn();
  if (ultimaLinha < 2 || ultimaCol < 1) return [];

  var valores = sheet.getRange(1, 1, ultimaLinha, ultimaCol).getValues();
  var cab = valores[0];
  var saida = [];

  for (var i = 1; i < valores.length; i++) {
    var linha = valores[i];
    var vazia = linha.every(function (c) { return c === "" || c === null; });
    if (vazia) continue;

    var obj = {};
    for (var j = 0; j < cab.length; j++) {
      var chave = String(cab[j] || "").trim();
      if (!chave) continue;
      obj[chave] = _formatarData(linha[j]);
    }
    obj["_linha"] = i + 1;
    saida.push(obj);
  }
  return saida;
}

function doGet(e) {
  try {
    var tipo = (e && e.parameter && e.parameter.data) ? String(e.parameter.data) : "all";
    var out = { ok: true };

    if (tipo === "cotacao" || tipo === "all") {
      out.cotacao = _lerLinhas(_aba(ID_COTACAO, ABA_COTACAO));
    }
    if (tipo === "cargas" || tipo === "all") {
      out.cargas = _lerLinhas(_aba(ID_CARGAS, ABA_CARGAS));
    }
    return _resp(out);
  } catch (err) {
    return _resp({ ok: false, error: String(err) });
  }
}

/* ---------------- gravacao ---------------- */

function _gravar(sheet, dados, registradoEm) {
  var cab = _cabecalho(sheet);

  // Sem cabecalho: cria um com as chaves recebidas
  if (!cab.length || cab.every(function (c) { return String(c || "").trim() === ""; })) {
    cab = Object.keys(dados);
    sheet.getRange(1, 1, 1, cab.length).setValues([cab]);
  }

  // indexa os dados recebidos pelo nome normalizado
  var mapa = {};
  Object.keys(dados).forEach(function (k) { mapa[_norm(k)] = dados[k]; });

  var linha = [];
  var usados = {};

  for (var j = 0; j < cab.length; j++) {
    var titulo = String(cab[j] || "").trim();
    var chave = _norm(titulo);
    var valor = "";

    if (chave && mapa.hasOwnProperty(chave)) {
      valor = mapa[chave];
      usados[chave] = true;
    } else if (chave === "registradoem" || chave === "dataregistro" || chave === "timestamp" || chave === "carimbodedatahora") {
      valor = registradoEm || new Date();
      usados[chave] = true;
    }
    linha.push(valor);
  }

  sheet.appendRow(linha);

  // campos enviados que nao existem no cabecalho da planilha
  var ignorados = Object.keys(mapa).filter(function (k) {
    return !usados[k] && String(mapa[k] || "").trim() !== "";
  });

  return { linha: linha, ignorados: ignorados };
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    var body = JSON.parse(e.postData.contents);
    var tipo = String(body.tipo || "").toLowerCase();
    var dados = body.dados || {};
    var registradoEm = body.registradoEm ? new Date(body.registradoEm) : new Date();

    var sheet;
    if (tipo === "cotacao") {
      sheet = _aba(ID_COTACAO, ABA_COTACAO);
    } else if (tipo === "cargas") {
      sheet = _aba(ID_CARGAS, ABA_CARGAS);
    } else {
      return _resp({ ok: false, error: "tipo invalido: use cotacao ou cargas" });
    }

    var r = _gravar(sheet, dados, registradoEm);
    return _resp({ ok: true, tipo: tipo, linha: r.linha, ignorados: r.ignorados });
  } catch (err) {
    return _resp({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}
