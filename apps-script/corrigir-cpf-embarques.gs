/*******************************************************************
 * TRANSTAC - Corrigir CPF dos motoristas nos embarques
 * Planilha: GAM - Controle de Embarques Finalizados
 *
 * O que faz: em todas as abas que tem as colunas "Nome do Motorista" e
 * "CPF", coloca o CPF que esta no Cadastro de Motoristas do portal.
 *   - Linha sem CPF ............ preenche
 *   - Linha com CPF diferente .. corrige (o cadastro e a referencia)
 *   - Motorista fora do cadastro ou cadastrado sem CPF .. nao mexe
 * Nome comparado sem acento e sem diferenca de maiusculas.
 *
 * COMO USAR (uma vez, ou sempre que quiser reconferir):
 *  1. Abra a planilha > Extensoes > Apps Script.
 *  2. Arquivo novo (+ > Script), cole este codigo e salve.
 *  3. Escolha a funcao corrigirCpfEmbarques e clique em Executar.
 *  4. Veja o resumo em "Registro de execucao" (ou no alerta da planilha).
 *  Rode antes simularCpfEmbarques se quiser so ver o que mudaria.
 *******************************************************************/

var URL_CADASTRO_MOTORISTAS =
  'https://script.google.com/macros/s/AKfycbypzKdoWY99DAZxKFhAitZ4gfsaUZr0EqBs56zJWTrsy8XgF3xI4zZ1EtAr6dLTHDZPrQ/exec';

function simularCpfEmbarques() { return executarCorrecaoCpf_(false); }
function corrigirCpfEmbarques() { return executarCorrecaoCpf_(true); }

function normalizarNome_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

function formatarCpf_(c) {
  var d = String(c || '').replace(/\D/g, '');
  if (!d || d.length > 11) return '';
  while (d.length < 11) d = '0' + d;
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}

function executarCorrecaoCpf_(gravar) {
  var resp = UrlFetchApp.fetch(URL_CADASTRO_MOTORISTAS, { muteHttpExceptions: true });
  var dados = JSON.parse(resp.getContentText());
  var base = {};
  (dados.motoristas || []).forEach(function (m) {
    var cpf = formatarCpf_(m.cpf);
    if (m.nome && cpf && m.ativo !== false) base[normalizarNome_(m.nome)] = cpf;
  });

  var linhas = [];
  var total = { preenchidos: 0, corrigidos: 0 };
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (aba) {
    var rng = aba.getDataRange();
    var v = rng.getValues();
    if (v.length < 2) return;
    var cab = v[0].map(function (h) { return String(h).trim(); });
    var iNome = cab.indexOf('Nome do Motorista');
    var iCpf = cab.indexOf('CPF');
    if (iNome < 0 || iCpf < 0) return;

    var col = [], mudou = 0;
    for (var r = 1; r < v.length; r++) {
      var atual = String(v[r][iCpf] || '').trim();
      var certo = base[normalizarNome_(v[r][iNome])];
      var novo = atual;
      if (certo && atual !== certo) {
        novo = certo;
        mudou++;
        if (atual) total.corrigidos++; else total.preenchidos++;
        linhas.push(aba.getName() + ' L' + (r + 1) + ': ' + v[r][iNome] + ' ' + (atual || '(vazio)') + ' -> ' + certo);
      }
      col.push([novo]);
    }
    if (gravar && mudou) {
      var alvo = aba.getRange(2, iCpf + 1, col.length, 1);
      alvo.setNumberFormat('@');
      alvo.setValues(col);
    }
  });

  var resumo = (gravar ? 'CPFs atualizados. ' : 'SIMULACAO (nada gravado). ') +
    'Preenchidos: ' + total.preenchidos + ' | Corrigidos: ' + total.corrigidos;
  Logger.log(resumo + '\n' + linhas.join('\n'));
  try { SpreadsheetApp.getUi().alert(resumo); } catch (e) {}
  return resumo;
}
