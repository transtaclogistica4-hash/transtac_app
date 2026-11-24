/*******************************************************************
 * TRANSTAC - Webhook de Embarques Finalizados
 * Planilha: CARGAS DIARIAS (substitui "GAM - Controle de Embarques
 * Finalizados", que ficou sem espaco)
 *
 * Recebe as chamadas do portal (transtac.netlify.app):
 *   /api/finalize        -> grava o embarque finalizado
 *   /api/routes          -> type "comercial": atualiza frete, pago, custos
 *   /api/delete-embarque -> type "delete": apaga o embarque
 *
 * Cada embarque vai para DUAS abas: "TODOS OS EMBARQUES" e a aba da
 * categoria (CARGAS DA GAM, CARGAS DA JAD LOG, CARGAS TERCEIROS,
 * TRANSFERENCIAS ENTRE CD). As colunas sao achadas pelo nome do
 * cabecalho, entao inserir ou mover colunas nao quebra nada.
 * A linha e identificada por Data do Embarque + ID Rota.
 *
 * COMO INSTALAR
 *  1. Abra a planilha CARGAS DIARIAS > Extensoes > Apps Script.
 *  2. Apague o que estiver no editor, cole este codigo e salve.
 *  3. Escolha a funcao configurarPlanilha e clique em Executar
 *     (autorize quando o Google pedir). Ela cria as abas e cabecalhos.
 *  4. Implantar > Nova implantacao > tipo "App da Web"
 *       Executar como: Eu
 *       Quem pode acessar: Qualquer pessoa
 *     Copie a URL que termina em /exec.
 *  5. No Netlify (projeto transtac) troque GSHEET_WEBHOOK_URL por essa
 *     URL e publique o site de novo.
 *******************************************************************/

var ABA_TODOS = 'TODOS OS EMBARQUES';

var ABAS_CATEGORIA = {
  gam: 'CARGAS DA GAM',
  jadlog: 'CARGAS DA JAD LOG',
  terceiros: 'CARGAS TERCEIROS',
  transferencias: 'TRANSFERENCIAS ENTRE CD'
};

var ROTULOS_CATEGORIA = {
  gam: 'GAM',
  jadlog: 'JadLog',
  terceiros: 'Cargas Terceiros',
  transferencias: 'Transferências'
};

var CAB_BASE = ['Data do Embarque', 'Rota', 'Nome do Motorista', 'CPF', 'Placa',
  'Tipo do Veiculo', 'Quantidade de Paletes', 'ID Rota', 'Ordem de Coleta',
  'Status da Agenda', 'Valor Frete Recebido', 'Valor Pago', 'Gerou Custo',
  'Descrição do Custo', 'Valor do Custo', 'Valor Líquido'];

var CAB_TODOS = ['Categoria'].concat(CAB_BASE);
var CAB_GAM = CAB_BASE.concat(['Autorização de Embarque']);

// Nomes aceitos para cada campo (o cabecalho da data veio como "A2"
// na planilha antiga e na Pagina1 desta; os dois sao aceitos).
var ALIAS = {
  categoria: ['categoria'],
  data: ['data do embarque', 'data', 'a2'],
  rota: ['rota'],
  motorista: ['nome do motorista', 'motorista'],
  cpf: ['cpf'],
  placa: ['placa'],
  veiculo: ['tipo do veiculo', 'tipo do veículo'],
  pallets: ['quantidade de paletes', 'paletes'],
  routeId: ['id rota'],
  ordemColeta: ['ordem de coleta'],
  statusAgenda: ['status da agenda'],
  freteRecebido: ['valor frete recebido'],
  valorPago: ['valor pago'],
  gerouCusto: ['gerou custo'],
  custoDescricao: ['descrição do custo', 'descricao do custo'],
  custoValor: ['valor do custo'],
  valorLiquido: ['valor líquido', 'valor liquido']
};

/* ------------------------------------------------------------------ */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var res;
    if (body.type === 'comercial') res = atualizarComercial_(body);
    else if (body.type === 'delete') res = excluirEmbarque_(body);
    else res = gravarEmbarque_(body);
    return json_(res);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet() {
  return json_({ ok: true, planilha: SpreadsheetApp.getActiveSpreadsheet().getName() });
}

/* ---------------------------- gravar ------------------------------ */

function gravarEmbarque_(body) {
  var c = body.campos || camposDoRow_(body.row || []);
  var cat = normCat_(body.categoria || c.categoria);
  var data = String(c.data || body.date || '').trim();
  var routeId = String(c.routeId || body.routeId || '').trim();
  if (!data || !routeId) throw new Error('data e routeId sao obrigatorios');

  var valores = {
    categoria: ROTULOS_CATEGORIA[cat] || c.categoria || body.categoriaLabel || '',
    data: data,
    rota: c.rota || '',
    motorista: c.motorista || '',
    cpf: c.cpf || '',
    placa: c.placa || '',
    veiculo: c.veiculo || '',
    pallets: c.pallets === undefined ? '' : c.pallets,
    routeId: routeId
  };

  var abas = [ABA_TODOS];
  var abaCat = ABAS_CATEGORIA[cat] || body.abaCategoria;
  if (abaCat) abas.push(abaCat);

  var gravadas = [];
  abas.forEach(function (nome) {
    var aba = obterAba_(nome);
    var mapa = mapaCabecalho_(aba);
    var linha = acharLinha_(aba, mapa, data, routeId);
    if (linha > 0) {
      escreverCampos_(aba, mapa, linha, valores); // finalizou de novo: atualiza
    } else {
      linha = Math.max(aba.getLastRow(), 1) + 1;
      escreverCampos_(aba, mapa, linha, valores);
    }
    gravadas.push(nome + ' (linha ' + linha + ')');
  });
  return { ok: true, gravado: gravadas };
}

/* --------------------------- comercial ---------------------------- */

function atualizarComercial_(body) {
  var data = String(body.date || '').trim();
  var routeId = String(body.routeId || '').trim();
  var desc = String(body.custoDescricao || '');
  if (body.custoTipo) desc = body.custoTipo + (desc ? ' - ' + desc : '');

  var valores = {
    ordemColeta: body.ordemColeta,
    statusAgenda: body.statusAgenda,
    freteRecebido: body.freteRecebido,
    valorPago: body.valorPago,
    gerouCusto: body.gerouCusto,
    custoDescricao: desc,
    custoValor: body.custoValor,
    valorLiquido: body.valorLiquido
  };

  var atualizadas = 0;
  todasAbasDeEmbarque_().forEach(function (aba) {
    var mapa = mapaCabecalho_(aba);
    var linha = acharLinha_(aba, mapa, data, routeId);
    if (linha > 0) { escreverCampos_(aba, mapa, linha, valores); atualizadas++; }
  });
  return { ok: true, atualizadas: atualizadas };
}

/* ---------------------------- excluir ----------------------------- */

function excluirEmbarque_(body) {
  var data = String(body.date || '').trim();
  var routeId = String(body.routeId || '').trim();
  var removidas = 0;
  todasAbasDeEmbarque_().forEach(function (aba) {
    var mapa = mapaCabecalho_(aba);
    var linha;
    while ((linha = acharLinha_(aba, mapa, data, routeId)) > 0) {
      aba.deleteRow(linha);
      removidas++;
    }
  });
  return { ok: true, removidas: removidas };
}

/* --------------------------- utilitarios -------------------------- */

function configurarPlanilha() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // A Pagina1 que veio com o cabecalho da GAM vira a aba CARGAS DA GAM
  var p1 = ss.getSheetByName('Página1') || ss.getSheetByName('Pagina1') || ss.getSheetByName('Sheet1');
  if (p1 && !ss.getSheetByName(ABAS_CATEGORIA.gam) && p1.getLastRow() <= 1) {
    p1.setName(ABAS_CATEGORIA.gam);
  }

  obterAba_(ABA_TODOS);
  Object.keys(ABAS_CATEGORIA).forEach(function (k) { obterAba_(ABAS_CATEGORIA[k]); });

  // Corrige o cabecalho "A2" para "Data do Embarque"
  todasAbasDeEmbarque_().forEach(function (aba) {
    var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
    cab.forEach(function (h, i) {
      if (String(h).trim().toUpperCase() === 'A2') aba.getRange(1, i + 1).setValue('Data do Embarque');
    });
  });

  // Ordem das abas: TODOS primeiro
  var todos = ss.getSheetByName(ABA_TODOS);
  ss.setActiveSheet(todos); ss.moveActiveSheet(1);

  var msg = 'Planilha pronta: ' + [ABA_TODOS].concat(Object.keys(ABAS_CATEGORIA).map(function (k) { return ABAS_CATEGORIA[k]; })).join(', ');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (x) {}
}

function obterAba_(nome) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(nome) || acharAbaSemAcento_(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    var cab = nome === ABA_TODOS ? CAB_TODOS : (nome === ABAS_CATEGORIA.gam ? CAB_GAM : CAB_BASE);
    aba.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
    aba.setFrozenRows(1);
    // Data e ID Rota como texto: evita datas em dois formatos
    var mapa = mapaCabecalho_(aba);
    if (mapa.data) aba.getRange(2, mapa.data, aba.getMaxRows() - 1, 1).setNumberFormat('@');
    if (mapa.routeId) aba.getRange(2, mapa.routeId, aba.getMaxRows() - 1, 1).setNumberFormat('@');
  }
  return aba;
}

function acharAbaSemAcento_(nome) {
  var alvo = semAcento_(nome);
  var abas = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  for (var i = 0; i < abas.length; i++) if (semAcento_(abas[i].getName()) === alvo) return abas[i];
  return null;
}

function todasAbasDeEmbarque_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().filter(function (aba) {
    var m = mapaCabecalho_(aba);
    return m.data && m.routeId;
  });
}

function mapaCabecalho_(aba) {
  var lastCol = aba.getLastColumn();
  if (lastCol < 1) return {};
  var cab = aba.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return semAcento_(h);
  });
  var mapa = {};
  Object.keys(ALIAS).forEach(function (campo) {
    for (var i = 0; i < ALIAS[campo].length; i++) {
      var idx = cab.indexOf(semAcento_(ALIAS[campo][i]));
      if (idx >= 0) { mapa[campo] = idx + 1; break; }
    }
  });
  return mapa;
}

function acharLinha_(aba, mapa, data, routeId) {
  var last = aba.getLastRow();
  if (last < 2 || !mapa.data || !mapa.routeId) return -1;
  var datas = aba.getRange(2, mapa.data, last - 1, 1).getDisplayValues();
  var ids = aba.getRange(2, mapa.routeId, last - 1, 1).getDisplayValues();
  var d = normData_(data);
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === routeId && normData_(datas[i][0]) === d) return i + 2;
  }
  return -1;
}

function escreverCampos_(aba, mapa, linha, valores) {
  Object.keys(valores).forEach(function (campo) {
    var v = valores[campo];
    if (v === undefined || v === null || !mapa[campo]) return;
    var cel = aba.getRange(linha, mapa[campo]);
    if (campo === 'data' || campo === 'routeId' || campo === 'cpf') cel.setNumberFormat('@');
    cel.setValue(v);
  });
}

// Aceita 2026-11-23 e 23/11/2026 como a mesma data
function normData_(s) {
  s = String(s || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + m[2] + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + ('0' + m[2]).slice(-2) + ('0' + m[1]).slice(-2);
  return s;
}

function normCat_(c) {
  var s = semAcento_(c).replace(/\s+/g, '');
  if (s.indexOf('jad') === 0) return 'jadlog';
  if (s.indexOf('terceir') >= 0 || s.indexOf('cargasterceiros') >= 0) return 'terceiros';
  if (s.indexOf('transf') === 0) return 'transferencias';
  if (s === 'gam') return 'gam';
  return s;
}

function semAcento_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Versao antiga do portal mandava so o array "row"
function camposDoRow_(r) {
  return { data: r[0], rota: r[1], motorista: r[2], cpf: r[3], placa: r[4], veiculo: r[5], pallets: r[6], routeId: r[7], categoria: r[8] };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* Teste rapido no editor: grava um embarque falso e apaga em seguida */
function testarWebhook() {
  var fake = { postData: { contents: JSON.stringify({
    campos: { categoria: 'GAM', data: '2099-01-01', rota: 'TESTE', motorista: 'TESTE', cpf: '', placa: 'AAA0000', veiculo: 'TRUCK', pallets: 1, routeId: 'teste-1' },
    categoria: 'gam', abaCategoria: 'CARGAS DA GAM' }) } };
  Logger.log(doPost(fake).getContent());
  Logger.log(doPost({ postData: { contents: JSON.stringify({ type: 'delete', date: '2099-01-01', routeId: 'teste-1' }) } }).getContent());
}
