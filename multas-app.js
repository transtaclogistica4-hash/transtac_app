/* ==========================================================
   TRANSTAC - Controle de Multas
   app.js - configuracao, cliente de API, parser e helpers
   ========================================================== */

/* ---------- 1. CONFIGURACAO ----------
   Cole abaixo a URL /exec do Web App do Apps Script.
   Enquanto estiver vazia, o app roda em MODO DEMO (localStorage),
   com OCR feito no proprio navegador (Tesseract.js).            */
const TOKEN_PADRAO = 'transtac-multas';   // nao deixe esta linha em branco

window.MULTAS_CONFIG = {
  // URL /exec do Web App do Apps Script (planilha base_multas):
  API_URL: 'https://script.google.com/macros/s/AKfycbzb_GTyA8d804LVO6ybebDrGwcyEJ-4EKm1g4dISyNMfIQffKh6ejaROyLeV7fifJmP/exec',
  // Deve ser igual ao TOKEN do Codigo.gs. Se ficar vazio, usa o TOKEN_PADRAO acima.
  TOKEN: TOKEN_PADRAO
};

/* Confira a configuracao ativa digitando  multasInfo()  no console do navegador */
window.multasInfo = function () {
  const c = window.MULTAS_CONFIG;
  const info = {
    build: 'v9',
    modo: c.API_URL ? 'PRODUCAO' : 'DEMO',
    apiUrl: c.API_URL || '(vazio)',
    tokenEnviado: String(c.TOKEN || TOKEN_PADRAO).trim() || TOKEN_PADRAO
  };
  console.table(info);
  return info;
};

/* ---------- 2. DOMINIOS ---------- */
const STATUS = [
  { v: 'RECEBIDA',   label: 'Recebida',              cls: 'recebida'  },
  { v: 'INDICACAO',  label: 'Indicação de condutor', cls: 'indicacao' },
  { v: 'RECURSO',    label: 'Em recurso',            cls: 'recurso'   },
  { v: 'A_PAGAR',    label: 'A pagar',               cls: 'apagar'    },
  { v: 'PAGA',       label: 'Paga',                  cls: 'paga'      },
  { v: 'CANCELADA',  label: 'Cancelada',             cls: 'cancelada' }
];
const GRAVIDADES = ['LEVE', 'MEDIA', 'GRAVE', 'GRAVISSIMA'];
const GRAV_LABEL = { LEVE: 'Leve', MEDIA: 'Média', GRAVE: 'Grave', GRAVISSIMA: 'Gravíssima' };
const GRAV_CLS   = { LEVE: 'leve', MEDIA: 'media', GRAVE: 'grave', GRAVISSIMA: 'gravissima' };
const ORGAOS = ['PRF', 'DER', 'DNIT', 'DETRAN', 'CET', 'Prefeitura', 'Polícia Militar', 'ARTESP', 'Outro'];
const STATUS_INDICACAO = [
  { v: 'NAO_APLICA', label: 'Não se aplica' },
  { v: 'PENDENTE',   label: 'Pendente' },
  { v: 'ENVIADA',    label: 'Enviada' },
  { v: 'ACEITA',     label: 'Aceita' },
  { v: 'RECUSADA',   label: 'Recusada' },
  { v: 'PERDIDO',    label: 'Prazo perdido' }
];

const CAMPOS = [
  'id', 'ait', 'renainf', 'placa', 'motorista', 'cnhMotorista', 'orgao',
  'dataInfracao', 'horaInfracao', 'local', 'municipio', 'uf',
  'codigoInfracao', 'descricaoInfracao', 'gravidade', 'pontos',
  'valor', 'valorComDesconto', 'vencimento', 'prazoIndicacao',
  'statusIndicacao', 'status', 'responsavel', 'dataPagamento',
  'observacoes', 'anexoUrl', 'anexoNome', 'criadoEm', 'atualizadoEm'
];

/* ---------- 3. HELPERS ---------- */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function brl(n) {
  const v = Number(n || 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function numero(txt) {
  if (txt === null || txt === undefined || txt === '') return 0;
  if (typeof txt === 'number') return txt;
  const s = String(txt).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
/** 'dd/mm/aaaa' ou 'aaaa-mm-dd' -> Date (meia-noite local) */
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    return new Date(y, +m[2] - 1, +m[1]);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function iso(v) {                     // -> 'aaaa-mm-dd' (para <input type=date>)
  const d = toDate(v); if (!d) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function br(v) {                      // -> 'dd/mm/aaaa'
  const d = toDate(v); if (!d) return '—';
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}
function hoje() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function diasAte(v) {
  const d = toDate(v); if (!d) return null;
  return Math.round((d - hoje()) / 86400000);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid() { return 'M' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(); }

function statusInfo(v) { return STATUS.find(s => s.v === v) || STATUS[0]; }
function badgeStatus(m) {
  const venc = diasAte(m.vencimento);
  if (m.status === 'A_PAGAR' && venc !== null && venc < 0) {
    return '<span class="badge vencida">Vencida (' + Math.abs(venc) + 'd)</span>';
  }
  const s = statusInfo(m.status);
  return '<span class="badge ' + s.cls + '">' + s.label + '</span>';
}
function badgeGravidade(g) {
  if (!g) return '—';
  return '<span class="badge ' + (GRAV_CLS[g] || '') + '">' + (GRAV_LABEL[g] || g) + '</span>';
}
function pillPrazo(data) {
  const d = diasAte(data);
  if (d === null) return '<span class="pill-prazo">—</span>';
  if (d < 0)  return '<span class="pill-prazo late">vencido há ' + Math.abs(d) + 'd</span>';
  if (d <= 7) return '<span class="pill-prazo warn">' + d + 'd restantes</span>';
  return '<span class="pill-prazo ok">' + d + 'd restantes</span>';
}
function toast(msg, ms) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms || 2600);
}

/* ---------- 4. SPLASH DE CARREGAMENTO ---------- */
(function () {
  const MIN_MS = 900;          // tempo minimo com a logo na tela
  const MAX_MS = 4000;         // trava de seguranca
  const inicio = Date.now();
  let fechado = false;

  function fecharSplash() {
    if (fechado) return;
    fechado = true;
    const s = document.getElementById('splash');
    if (!s) return;
    const espera = Math.max(0, MIN_MS - (Date.now() - inicio));
    setTimeout(() => {
      s.classList.add('hide');
      setTimeout(() => s.remove(), 600);
    }, espera);
  }

  window.fecharSplash = fecharSplash;
  window.addEventListener('load', fecharSplash);
  setTimeout(fecharSplash, MAX_MS);
})();

/* ---------- 5. CABECALHO / NAVEGACAO ---------- */
const MARK = '<svg class="brand-mark" viewBox="0 0 48 56" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M24 2 L44 10 V26 C44 40 36 50 24 54 C12 50 4 40 4 26 V10 Z" fill="none" stroke="currentColor" stroke-width="3.5"/>' +
  '<text x="24" y="35" font-size="22" font-weight="800" text-anchor="middle" fill="currentColor" font-family="-apple-system, Arial, sans-serif">T</text></svg>';

/* Logo oficial: coloque logo-transtac.png na mesma pasta do deploy.
   Se o arquivo nao existir, entra automaticamente a marca em SVG. */
const LOGO_ARQUIVO = 'logo-transtac.png';

function montarHeader(titulo, sub, voltar) {
  const h = $('header'); if (!h) return;
  h.innerHTML =
    '<div class="top-left">' +
      '<a class="home-link" href="' + (voltar || 'multas.html') + '">← Voltar</a>' +
    '</div>' +
    '<div class="top-center">' +
      '<img class="logo" id="logoTranstac" src="' + LOGO_ARQUIVO + '" alt="TRANSTAC TRANSPORTES">' +
      '<h1>' + esc(titulo) + '</h1>' +
    '</div>' +
    '<div class="top-right"></div>';

  const img = $('#logoTranstac');
  if (img) {
    img.onerror = function () {
      const marca = document.createElement('div');
      marca.className = 'brand';
      marca.innerHTML = MARK + '<span class="brand-word">TRANSTAC<small>TRANSPORTES</small></span>';
      img.replaceWith(marca);
    };
  }
}
function montarSubnav(ativo) {
  const n = $('#subnav'); if (!n) return;
  const itens = [
    ['multas.html', 'Início'],
    ['multas-cadastro.html', 'Nova multa'],
    ['multas-lista.html', 'Multas'],
    ['multas-indicacao.html', 'Indicação de condutor'],
    ['multas-dashboard.html', 'Dashboard']
  ];
  n.innerHTML = itens.map(([href, txt]) =>
    '<a href="' + href + '"' + (href === ativo ? ' class="active"' : '') + '>' + txt + '</a>'
  ).join('');
}

/* ---------- 6. CLIENTE DE API (Apps Script) ----------
   POST com Content-Type text/plain evita preflight CORS.       */
async function api(action, payload) {
  const url = window.MULTAS_CONFIG.API_URL;
  if (!url) return demoApi(action, payload);
  const token = String(window.MULTAS_CONFIG.TOKEN || TOKEN_PADRAO).trim() || TOKEN_PADRAO;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: token, payload: payload || {} })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Falha na API');
  return data.data;
}
function modoDemo() { return !window.MULTAS_CONFIG.API_URL; }

/* ---------- 7. MODO DEMO (localStorage) ---------- */
const DEMO_KEY = 'transtac_multas_v1';
function demoLer() { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch (e) { return []; } }
function demoGravar(l) { localStorage.setItem(DEMO_KEY, JSON.stringify(l)); }

async function demoApi(action, p) {
  p = p || {};
  const lista = demoLer();
  const agora = new Date().toISOString();
  if (action === 'listar') return lista;
  if (action === 'salvar') {
    const itens = p.itens || [p.item];
    itens.forEach(it => {
      const i = lista.findIndex(x => x.id && x.id === it.id);
      if (i >= 0) lista[i] = Object.assign(lista[i], it, { atualizadoEm: agora });
      else lista.push(Object.assign({ criadoEm: agora, atualizadoEm: agora }, it, { id: it.id || uid() }));
    });
    demoGravar(lista);
    return { gravados: itens.length };
  }
  if (action === 'excluir') {
    demoGravar(lista.filter(x => x.id !== p.id));
    return { ok: true };
  }
  if (action === 'motoristas') return vinculosPlaca();
  if (action === 'ocr') {
    const texto = await ocrLocal(p.arquivo, p.nome, p.mime, p.onProgress);
    return { texto, campos: parseMulta(texto), anexoUrl: '', anexoNome: p.nome };
  }
  throw new Error('Ação desconhecida: ' + action);
}

/* ==========================================================
   LEITURA LOCAL DE PDF E IMAGEM (modo demo)
   - PDF digital  -> texto extraido direto com pdf.js (rapido e exato)
   - PDF escaneado -> paginas viram imagem e passam pelo OCR (Tesseract)
   - JPG / PNG     -> OCR direto
   ========================================================== */
const CDN_PDFJS   = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const CDN_PDFWORK = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const CDN_TESS    = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js';

function carregarScript(src, erro) {
  return new Promise((ok, err) => {
    if (Array.from(document.scripts).some(s => s.src === src)) return ok();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => err(new Error(erro));
    document.head.appendChild(s);
  });
}

let _tessLoaded = null;
function carregarTesseract() {
  if (!_tessLoaded) _tessLoaded = carregarScript(CDN_TESS, 'Não foi possível carregar o OCR (sem internet?).');
  return _tessLoaded;
}
let _pdfLoaded = null;
function carregarPdfJs() {
  if (!_pdfLoaded) {
    _pdfLoaded = carregarScript(CDN_PDFJS, 'Não foi possível carregar o leitor de PDF (sem internet?).')
      .then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN_PDFWORK; });
  }
  return _pdfLoaded;
}

function ehPdf(nome, mime) {
  return /pdf/i.test(mime || '') || /\.pdf$/i.test(nome || '');
}
/** 'data:...;base64,XXXX' -> Uint8Array */
function dataUrlParaBytes(dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** Monta o texto de uma pagina respeitando as linhas do documento. */
function textoDaPagina(content) {
  const linhas = [];
  let yAtual = null, buf = [];
  content.items.forEach(it => {
    const txt = (it.str || '');
    const y = Math.round(it.transform[5]);
    if (yAtual === null || Math.abs(y - yAtual) <= 2.5) {
      buf.push(txt);
    } else {
      linhas.push(buf.join(' ').replace(/\s{2,}/g, ' ').trim());
      buf = [txt];
    }
    yAtual = y;
  });
  if (buf.length) linhas.push(buf.join(' ').replace(/\s{2,}/g, ' ').trim());
  return linhas.filter(Boolean).join('\n');
}

/** Le um PDF: tenta o texto embutido; se nao houver, rasteriza e roda OCR. */
async function lerPdf(dataUrl, onProgress) {
  await carregarPdfJs();
  const doc = await window.pdfjsLib.getDocument({ data: dataUrlParaBytes(dataUrl) }).promise;
  const total = doc.numPages;
  const partes = [];

  for (let n = 1; n <= total; n++) {
    if (onProgress) onProgress((n - 1) / total * 0.5);
    const page = await doc.getPage(n);
    partes.push(textoDaPagina(await page.getTextContent()));
  }
  let texto = partes.join('\n').trim();

  // PDF digital: ja temos o texto, nem precisa de OCR
  const letras = (texto.match(/[A-Za-zÀ-ú]/g) || []).length;
  if (letras >= 120) { if (onProgress) onProgress(1); return texto; }

  // PDF escaneado: cada pagina vira imagem e passa pelo OCR
  await carregarTesseract();
  const ocr = [];
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const r = await window.Tesseract.recognize(canvas, 'por', {
      logger: m => {
        if (onProgress && m.status === 'recognizing text') {
          onProgress(0.5 + ((n - 1) + m.progress) / total * 0.5);
        }
      }
    });
    ocr.push(r.data.text || '');
  }
  texto = (texto + '\n' + ocr.join('\n')).trim();
  if (!texto) throw new Error('Não foi possível ler nenhum texto deste PDF.');
  return texto;
}

/** Le uma imagem via OCR. */
async function lerImagem(dataUrl, onProgress) {
  await carregarTesseract();
  const r = await window.Tesseract.recognize(dataUrl, 'por', {
    logger: m => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); }
  });
  return r.data.text || '';
}

async function ocrLocal(dataUrl, nome, mime, onProgress) {
  return ehPdf(nome, mime) ? lerPdf(dataUrl, onProgress) : lerImagem(dataUrl, onProgress);
}

/* ---------- 8. CONDUTOR: NOME E VINCULO PLACA -> MOTORISTA ---------- */
const NOME_LIXO = /(N[ÃA]O IDENTIFICAD|N[ÃA]O INFORMAD|NAO CONSTA|IDENTIFICA[ÇC][ÃA]O|INDICA[ÇC][ÃA]O|CONDUTOR|MOTORISTA|INFRATOR|PROPRIET[ÁA]RI|VE[ÍI]CULO|MARCA|MODELO|PLACA|[ÓO]RG[ÃA]O|AUTUADOR|MUNIC[ÍI]PIO|ENDERE[ÇC]O|LOGRADOURO|TRANSTAC|LTDA|EIRELI|\bS\/?A\b|CNPJ|CPF|CNH|RG\b|RENAVAM|CATEGORIA|A INDICAR|PENDENTE)/;

/** Recebe um trecho de texto e devolve um nome de pessoa valido, ou null. */
function nomePessoa(bruto) {
  if (!bruto) return null;
  let t = String(bruto).replace(/[|;_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // corta no primeiro campo seguinte (CPF, CNH, data, numero...)
  t = t.split(/\s+(?:CPF|CNH|RG|RENACH|REGISTRO|N[ºO°]|DATA|NASC|UF|CEP)\b/i)[0];
  t = t.replace(/[:\-–.,]+$/, '').trim();
  if (/\d/.test(t)) return null;
  if (t.length < 6 || t.length > 60) return null;
  if (NOME_LIXO.test(t.toUpperCase())) return null;
  const palavras = t.split(/\s+/).filter(w => /^[A-Za-zÀ-ú']{2,}$/.test(w));
  if (palavras.length < 2) return null;
  return palavras.join(' ');
}

/* De-para placa -> motorista aprendido automaticamente a cada salvamento */
const VINCULO_KEY = 'transtac_multas_placas_v1';
function normPlaca(p) { return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function vinculosPlaca() { try { return JSON.parse(localStorage.getItem(VINCULO_KEY) || '{}'); } catch (e) { return {}; } }
function motoristaDaPlaca(placa) { return vinculosPlaca()[normPlaca(placa)] || ''; }
function lembrarMotorista(placa, motorista) {
  const p = normPlaca(placa), m = String(motorista || '').trim();
  if (!p || !m) return;
  const v = vinculosPlaca(); v[p] = m;
  try { localStorage.setItem(VINCULO_KEY, JSON.stringify(v)); } catch (e) {}
}
/** Traz o de-para PLACA -> MOTORISTA da planilha para o navegador. */
async function sincronizarMotoristas() {
  try {
    const mapa = await api('motoristas');
    if (!mapa || typeof mapa !== 'object') return {};
    const atual = vinculosPlaca();
    Object.keys(mapa).forEach(function (p) {
      const chave = normPlaca(p);
      if (chave && mapa[p]) atual[chave] = String(mapa[p]).trim();
    });
    localStorage.setItem(VINCULO_KEY, JSON.stringify(atual));
    return atual;
  } catch (e) {
    return vinculosPlaca();   // sem conexao: segue com o que ja esta salvo
  }
}

/** Completa o motorista pela placa quando a notificacao nao traz o condutor. */
function completarMotorista(campos) {
  if (!campos || campos.motorista || !campos.placa) return campos;
  const m = motoristaDaPlaca(campos.placa);
  if (m) {
    campos.motorista = m;
    campos._guessed = (campos._guessed || []).concat('motorista');
  }
  return campos;
}

/* ---------- 9. PARSER DA NOTIFICACAO ----------
   Le o texto do OCR e devolve os campos da multa.
   Tudo que for deduzido vem marcado em _guessed.               */
function parseMulta(textoBruto) {
  const texto = String(textoBruto || '').replace(/\r/g, '');
  const T = texto.toUpperCase();
  const out = { _guessed: [] };
  const set = (k, v) => { if (v !== null && v !== undefined && v !== '' && !out[k]) { out[k] = v; out._guessed.push(k); } };

  // valor logo apos um rotulo (testa TODAS as ocorrencias do rotulo no documento)
  const aposRotulo = (rotulos, regex, janela, valida) => {
    for (const r of rotulos) {
      let i = T.indexOf(r);
      while (i >= 0) {
        const trecho = texto.slice(i + r.length, i + r.length + (janela || 90));
        const m = trecho.match(regex);
        if (m && (!valida || valida(m[1]))) return m[1];
        i = T.indexOf(r, i + 1);
      }
    }
    return null;
  };

  // AIT / numero do auto
  set('ait', aposRotulo(
    ['AUTO DE INFRAÇÃO', 'AUTO DE INFRACAO', 'N° DO AUTO', 'Nº DO AUTO', 'NUMERO DO AUTO', 'NÚMERO DO AUTO', 'AIT'],
    /([A-Z0-9][A-Z0-9\-\.\/]{5,24})/
  ));
  if (!out.ait) {
    const m = T.match(/\b([A-Z]{1,3}\d{6,12})\b/);
    if (m) set('ait', m[1]);
  }

  set('renainf', aposRotulo(['RENAINF'], /([A-Z0-9\-\.\/]{6,24})/));

  // Placa (Mercosul LLLNLNN e antiga LLLNNNN)
  let placa = aposRotulo(['PLACA'], /([A-Z]{3}[\s\-]?\d[A-Z0-9]\d{2})/, 40);
  if (!placa) { const m = T.match(/\b([A-Z]{3}[\s\-]?\d[A-Z0-9]\d{2})\b/); if (m) placa = m[1]; }
  if (placa) set('placa', placa.replace(/[\s\-]/g, '').toUpperCase());

  // Datas e horas
  const datas = (texto.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || []);
  set('dataInfracao', aposRotulo(
    ['DATA DA INFRAÇÃO', 'DATA DA INFRACAO', 'DATA/HORA DA INFRAÇÃO', 'DATA/HORA DA INFRACAO', 'DATA DO COMETIMENTO', 'DATA'],
    /(\d{2}\/\d{2}\/\d{4})/, 60
  ) || datas[0] || null);
  set('horaInfracao', aposRotulo(['HORA', 'HORÁRIO', 'HORARIO'], /(\d{2}[:hH]\d{2})/, 60));
  if (out.horaInfracao) out.horaInfracao = out.horaInfracao.replace(/[hH]/, ':');

  set('vencimento', aposRotulo(
    ['VENCIMENTO', 'DATA DE VENCIMENTO', 'PAGAR ATÉ', 'PAGAR ATE', 'VENCE EM'],
    /(\d{2}\/\d{2}\/\d{4})/, 60
  ));
  set('prazoIndicacao', aposRotulo(
    ['INDICAÇÃO DO CONDUTOR', 'INDICACAO DO CONDUTOR', 'INDICAÇÃO DE CONDUTOR', 'INDICACAO DE CONDUTOR',
     'IDENTIFICAÇÃO DO CONDUTOR', 'IDENTIFICACAO DO CONDUTOR', 'PRAZO PARA INDICAÇÃO', 'PRAZO PARA INDICACAO'],
    /(\d{2}\/\d{2}\/\d{4})/, 220
  ));

  // Valores
  const valores = (texto.match(/R\$\s*[\d.]{1,12},\d{2}/g) || []).map(numero);
  set('valor', numero(aposRotulo(
    ['VALOR DA MULTA', 'VALOR DA INFRAÇÃO', 'VALOR DA INFRACAO', 'VALOR TOTAL', 'VALOR'],
    /(R\$\s*[\d.]{1,12},\d{2})/, 60
  )) || (valores.length ? Math.max.apply(null, valores) : null));
  set('valorComDesconto', numero(aposRotulo(
    ['COM DESCONTO', 'DESCONTO DE 20', 'VALOR COM DESCONTO'],
    /(R\$\s*[\d.]{1,12},\d{2})/, 80
  )) || null);

  // Codigo da infracao (ex.: 745-50 / 7455-0)
  let cod = aposRotulo(['CÓDIGO DA INFRAÇÃO', 'CODIGO DA INFRACAO', 'CÓDIGO', 'CODIGO', 'ENQUADRAMENTO'], /(\d{3,5}[\-–\/]\d{1,2})/, 70);
  if (!cod) { const m = T.match(/\b(\d{4}[\-–]\d)\b|\b(\d{3}[\-–]\d{2})\b/); if (m) cod = m[0]; }
  if (cod) set('codigoInfracao', cod.replace('–', '-'));

  // Descricao da infracao (descarta capturas que sao datas/horas/valores)
  const descValida = s => {
    if (!s) return false;
    const t = s.trim();
    if (/^\W*\d{1,2}[\/:]/.test(t)) return false;                 // comeca com data ou hora
    if (/^\W*(R\$|\d{2}\/\d{2}\/\d{4})/.test(t)) return false;
    return (t.match(/[A-Za-zÀ-ú]/g) || []).length >= 10;
  };
  let desc = ['DESCRIÇÃO DA INFRAÇÃO', 'DESCRICAO DA INFRACAO', 'INFRAÇÃO:', 'INFRACAO:', 'DESCRIÇÃO', 'DESCRICAO']
    .map(r => aposRotulo([r], /\s*[:\-]?\s*([^\n]{8,120})/, 140))
    .find(descValida);
  if (desc) set('descricaoInfracao', desc.trim().replace(/\s{2,}/g, ' '));

  // Condutor / motorista
  const ROT_CONDUTOR = [
    'CONDUTOR IDENTIFICADO', 'NOME DO CONDUTOR', 'NOME DO MOTORISTA', 'NOME DO INFRATOR',
    'CONDUTOR INFRATOR', 'CONDUTOR RESPONSÁVEL', 'CONDUTOR RESPONSAVEL',
    'CONDUTOR', 'MOTORISTA', 'NOME DO CONDUTOR INFRATOR'
  ];
  const condutor = aposRotulo(ROT_CONDUTOR, /\s*[:\-]?\s*([^\n]{5,70})/, 100, v => !!nomePessoa(v));
  if (condutor) set('motorista', nomePessoa(condutor));

  // Gravidade e pontos
  if (/GRAV[IÍ]SSIM/.test(T)) set('gravidade', 'GRAVISSIMA');
  else if (/\bGRAVE\b/.test(T)) set('gravidade', 'GRAVE');
  else if (/\bM[EÉ]DIA\b/.test(T)) set('gravidade', 'MEDIA');
  else if (/\bLEVE\b/.test(T)) set('gravidade', 'LEVE');
  const pts = aposRotulo(['PONTOS', 'PONTUAÇÃO', 'PONTUACAO'], /(\d{1,2})/, 30);
  if (pts) set('pontos', +pts);
  if (!out.pontos && out.gravidade) set('pontos', { LEVE: 3, MEDIA: 4, GRAVE: 5, GRAVISSIMA: 7 }[out.gravidade]);

  // Orgao autuador (palavra inteira, para nao casar dentro de outra palavra)
  const orgao = ORGAOS.filter(o => o !== 'Outro')
    .find(o => new RegExp('(^|[^A-ZÀ-Ú])' + o.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-ZÀ-Ú]|$)').test(T));
  if (orgao) set('orgao', orgao);
  else if (/POL[IÍ]CIA RODOVI[AÁ]RIA FEDERAL/.test(T)) set('orgao', 'PRF');

  // Local / municipio / UF
  let local = aposRotulo(['LOCAL DA INFRAÇÃO', 'LOCAL DA INFRACAO', 'LOCAL:', 'LOCAL'], /\s*[:\-]?\s*([^\n]{6,120})/, 150);
  if (local) set('local', local.trim().replace(/\s{2,}/g, ' '));
  let mun = aposRotulo(['MUNICÍPIO', 'MUNICIPIO', 'CIDADE'], /\s*[:\-]?\s*([A-ZÀ-Ú][A-ZÀ-Úa-zà-ú\s\.']{2,40})/, 80);
  if (mun) set('municipio', mun.split(/\s{2,}|\s+UF\b|\s+ESTADO\b|\s+-\s+/)[0].trim());
  const uf = aposRotulo(['UF', 'ESTADO'], /\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/, 30);
  if (uf) set('uf', uf);

  // Regras de negocio
  if (!out.status) out.status = out.prazoIndicacao ? 'INDICACAO' : 'RECEBIDA';
  if (!out.statusIndicacao) out.statusIndicacao = out.prazoIndicacao ? 'PENDENTE' : 'NAO_APLICA';
  return out;
}

/* ---------- 10. FILTRO/ORDENACAO REAPROVEITAVEIS ---------- */
function aplicarFiltros(lista, f) {
  const q = (f.q || '').trim().toLowerCase();
  return lista.filter(m => {
    if (f.status && m.status !== f.status) return false;
    if (f.orgao && m.orgao !== f.orgao) return false;
    if (f.statusIndicacao && m.statusIndicacao !== f.statusIndicacao) return false;
    if (f.de && toDate(m.dataInfracao) && toDate(m.dataInfracao) < toDate(f.de)) return false;
    if (f.ate && toDate(m.dataInfracao) && toDate(m.dataInfracao) > toDate(f.ate)) return false;
    if (q) {
      const alvo = [m.ait, m.placa, m.motorista, m.descricaoInfracao, m.local, m.municipio, m.codigoInfracao]
        .join(' ').toLowerCase();
      if (!alvo.includes(q)) return false;
    }
    return true;
  });
}

/* ---------- 11. EXPORTACAO CSV ---------- */
function exportarCSV(lista, nome) {
  const cols = ['ait', 'placa', 'motorista', 'orgao', 'dataInfracao', 'horaInfracao', 'codigoInfracao',
    'descricaoInfracao', 'gravidade', 'pontos', 'valor', 'vencimento', 'prazoIndicacao',
    'statusIndicacao', 'status', 'local', 'municipio', 'uf', 'observacoes'];
  const linhas = [cols.join(';')].concat(lista.map(m =>
    cols.map(c => {
      let v = m[c] == null ? '' : m[c];
      if (c === 'valor') v = String(numero(v)).replace('.', ',');
      if (c === 'dataInfracao' || c === 'vencimento' || c === 'prazoIndicacao') v = v ? br(v) : '';
      return '"' + String(v).replace(/"/g, '""') + '"';
    }).join(';')
  ));
  const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (nome || 'multas') + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
