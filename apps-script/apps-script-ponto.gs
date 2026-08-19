/**
 * TRANSTAC — Controle de Ponto dos Motoristas
 * Planilha: https://docs.google.com/spreadsheets/d/1w2Q6fwQqegpxrNQWyf7v2TRto9vSWKCfcLom1heflcI/edit
 *
 * COMO ATUALIZAR (você já publicou uma vez):
 * 1. Planilha > Extensões > Apps Script.
 * 2. Apague o conteúdo do Código.gs e cole TODO este arquivo. Salve.
 * 3. Implantar > Gerenciar implantações > lápis (editar) >
 *    Versão: "Nova versão" > Implantar.
 *    A URL /exec continua a mesma — não precisa mexer no index.html.
 *
 * SOBRE AS COLUNAS:
 * O script localiza as colunas que você já criou mesmo com variações de
 * escrita ("Data de Entrada", "DATA DE ENTRADA", "Data Entrada", "Data De Saida",
 * "Data de Saída"...). Acento e maiúscula não importam.
 * Colunas que não existirem são criadas automaticamente no fim da planilha.
 */

var ABA_PONTO = 'Ponto';

/**
 * Cada campo tem os apelidos aceitos, em ordem de prioridade.
 * O primeiro da lista é o nome usado caso a coluna precise ser criada.
 */
var CAMPOS = [
  { chave: 'registro',   nomes: ['Registro', 'Data do Registro', 'Carimbo de data/hora'] },
  { chave: 'id',         nomes: ['ID', 'Id'] },
  { chave: 'dataIni',    nomes: ['Data de Entrada', 'Data Entrada', 'Data de Inicio', 'Data Inicio', 'Data'] },
  { chave: 'dataFim',    nomes: ['Data de Saida', 'Data Saida', 'Data Fim', 'Data Final'] },
  { chave: 'rota',       nomes: ['Rota'] },
  { chave: 'motorista',  nomes: ['Motorista', 'Nome'] },
  { chave: 'placa',      nomes: ['Placa'] },
  { chave: 'entrada',    nomes: ['Entrada Ponto', 'Entrada do Ponto', 'Entrada'] },
  { chave: 'intervalos', nomes: ['Intervalos', 'Resumo Intervalos'] },
  { chave: 'saida',      nomes: ['Saida Ponto', 'Saida do Ponto', 'Saida'] },
  { chave: 'totalInt',   nomes: ['Total Intervalo', 'Total Intervalos'] },
  { chave: 'horas',      nomes: ['Horas Trabalhadas', 'Horas'] }
];

/* ---------------- utilidades ---------------- */

/** tira acento, espaco extra e caixa, para comparar cabecalhos */
function _norm(t) {
  return String(t == null ? '' : t)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function _aba() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ABA_PONTO);
  if (!sh) {
    // usa a aba existente, onde voce ja criou as colunas
    sh = ss.getSheets()[0] || ss.insertSheet(ABA_PONTO);
  }
  if (sh.getLastRow() === 0) {
    var padrao = CAMPOS.map(function (c) { return c.nomes[0]; });
    sh.getRange(1, 1, 1, padrao.length).setValues([padrao])
      .setFontWeight('bold').setBackground('#1E2328').setFontColor('#F2700D');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _cabecalhos(sh) {
  var n = sh.getLastColumn();
  if (n === 0) return [];
  return sh.getRange(1, 1, 1, n).getValues()[0].map(function (c) { return String(c).trim(); });
}

/**
 * Devolve { mapa: {chave: indice}, cab: [...] }.
 * Cria no fim da planilha as colunas que faltarem (se criarFaltantes).
 * Uma mesma coluna nunca e usada por dois campos diferentes.
 */
function _mapaColunas(sh, criarFaltantes) {
  var cab = _cabecalhos(sh);
  var norm = cab.map(_norm);
  var usadas = {};
  var mapa = {};
  var novas = [];

  CAMPOS.forEach(function (campo) {
    var achou = -1;
    for (var n = 0; n < campo.nomes.length && achou === -1; n++) {
      var alvo = _norm(campo.nomes[n]);
      for (var i = 0; i < norm.length; i++) {
        if (norm[i] === alvo && !usadas[i]) { achou = i; break; }
      }
    }
    if (achou > -1) {
      usadas[achou] = true;
      mapa[campo.chave] = achou;
    } else if (criarFaltantes) {
      novas.push({ chave: campo.chave, nome: campo.nomes[0] });
    }
  });

  if (novas.length) {
    sh.getRange(1, cab.length + 1, 1, novas.length)
      .setValues([novas.map(function (n) { return n.nome; })])
      .setFontWeight('bold').setBackground('#1E2328').setFontColor('#F2700D');
    novas.forEach(function (n, k) { mapa[n.chave] = cab.length + k; });
    cab = cab.concat(novas.map(function (n) { return n.nome; }));
  }

  return { mapa: mapa, cab: cab };
}

/** colunas de intervalo: "Entrada Intervalo 1", "Volta Intervalo 1", ... */
function _colIntervalo(sh, cab, rotulo, criar) {
  var i = cab.map(_norm).indexOf(_norm(rotulo));
  if (i > -1) return { idx: i, cab: cab };
  if (!criar) return { idx: -1, cab: cab };
  sh.getRange(1, cab.length + 1, 1, 1).setValue(rotulo)
    .setFontWeight('bold').setBackground('#1E2328').setFontColor('#F2700D');
  cab = cab.concat([rotulo]);
  return { idx: cab.length - 1, cab: cab };
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- gravacao ---------------- */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    var d = JSON.parse(e.postData.contents);
    var sh = _aba();
    var r = _mapaColunas(sh, true);
    var mapa = r.mapa, cab = r.cab;

    var valores = [];
    function set(idx, v) {
      if (idx == null || idx < 0) return;
      while (valores.length <= idx) valores.push('');
      valores[idx] = v;
    }

    set(mapa.registro, d.Registro || new Date().toISOString());
    set(mapa.id, d.id || '');
    set(mapa.dataIni, d['Data de Entrada'] || d['Data Inicio'] || d.Data || '');
    set(mapa.dataFim, d['Data de Saida'] || d['Data Fim'] || d['Data de Entrada'] || d.Data || '');
    set(mapa.rota, d.Rota || '');
    set(mapa.motorista, d.Motorista || '');
    set(mapa.placa, d.Placa || '');
    set(mapa.entrada, d['Entrada Ponto'] || '');
    set(mapa.intervalos, d.Intervalos || '');
    set(mapa.saida, d['Saida Ponto'] || '');
    set(mapa.totalInt, d['Total Intervalo'] || '');
    set(mapa.horas, d['Horas Trabalhadas'] || '');

    var intervalos = d.intervalos || [];
    for (var i = 0; i < intervalos.length; i++) {
      var a = _colIntervalo(sh, cab, 'Entrada Intervalo ' + (i + 1), true);
      cab = a.cab; set(a.idx, intervalos[i].saida || '');
      var b = _colIntervalo(sh, cab, 'Volta Intervalo ' + (i + 1), true);
      cab = b.cab; set(b.idx, intervalos[i].volta || '');
    }

    while (valores.length < cab.length) valores.push('');

    sh.appendRow(valores);
    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, erro: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ---------------- leitura (relatorio do site) ---------------- */

function doGet(e) {
  try {
    var sh = _aba();
    var ultima = sh.getLastRow();
    if (ultima < 2) return _json({ ok: true, registros: [] });

    var r = _mapaColunas(sh, false);
    var mapa = r.mapa, cab = r.cab;
    var linhas = sh.getRange(2, 1, ultima - 1, cab.length).getValues();
    var norm = cab.map(_norm);

    function idxInt(rotulo) { return norm.indexOf(_norm(rotulo)); }

    var registros = linhas.map(function (l) {
      function v(k) {
        var i = mapa[k];
        return (i == null || i < 0) ? '' : l[i];
      }

      var intervalos = [];
      for (var i = 1; i <= 20; i++) {
        var ia = idxInt('Entrada Intervalo ' + i);
        var ib = idxInt('Volta Intervalo ' + i);
        var a = ia > -1 ? l[ia] : '';
        var b = ib > -1 ? l[ib] : '';
        if (a || b) intervalos.push({ saida: _hora(a), volta: _hora(b) });
      }

      var ini = _data(v('dataIni'));
      var fim = _data(v('dataFim')) || ini;

      return {
        id: String(v('id') || ''),
        data: ini,
        dataFim: fim,
        rota: String(v('rota') || ''),
        motorista: String(v('motorista') || ''),
        placa: String(v('placa') || ''),
        entrada: _hora(v('entrada')),
        saida: _hora(v('saida')),
        intervalos: intervalos
      };
    }).filter(function (x) { return x.data || x.motorista; });

    return _json({ ok: true, registros: registros });
  } catch (err) {
    return _json({ ok: false, erro: String(err), registros: [] });
  }
}

/* a planilha pode devolver Date em vez de texto — normaliza */
function _data(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var t = String(v).trim();
  var br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return br[3] + '-' + br[2] + '-' + br[1];
  return t.slice(0, 10);
}

function _hora(v) {
  if (!v && v !== 0) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(v).trim().slice(0, 5);
}
