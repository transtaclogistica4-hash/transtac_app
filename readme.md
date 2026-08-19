# Sistema de Gestão TRANSTAC — pacote unificado (PRODUÇÃO)

Um único deploy no Netlify. O `index.html` da raiz é o portal: login,
listagem de setores e o módulo de Manutenção/Checklists.

## Setores na tela inicial

Estrutura achatada: tudo na mesma pasta, sem subpastas.

| Card | Abre |
|---|---|
| Logística | `logistica.html` |
| Manutenção / Checklists | tela interna do portal |
| Área do Motorista | tela interna, sem login |
| Inventário Içara | `inventario-icara.html` |
| Multas | `multas.html` |
| RH | `rh.html` |
| Compras / Expedição | Em breve |

Telas do módulo de Multas: `multas.html`, `multas-cadastro.html`,
`multas-lista.html`, `multas-indicacao.html`, `multas-dashboard.html`,
mais `multas-app.js` e `multas.css`. O prefixo evita colidir com o
`dashboard.html` da Logística, que já ocupava esse nome.

Faturamento saiu da listagem e o `faturamento.html` foi removido.

## Tela inicial

Ao abrir o site aparece a tela de entrada: `fundo-transtac.jpg` como textura de
fundo (desfocada e rebaixada, para não competir com a marca), `logo-transtac.png`
ao centro e dois botões — **Área Administrativa**, que leva ao login, e
**Área do Motorista**, que entra direto. O botão do motorista saiu da tela de
login e passou a viver aqui.

Sair da sessão, fechar a área do motorista ou fechar o checklist devolve para
esta tela.

A troca é um cruzamento, não uma sequência: a tela escolhida já aparece por
baixo enquanto a inicial desaparece por cima (`entradaOut`, 300 ms, mais
`entra-suave` no destino). `esconderEntrada()` tira a classe `entrada-open` na
hora, então cabeçalho e faixa voltam sem pulo de layout. Cliques repetidos não
travam: se a saída já está em andamento, a chamada seguinte resolve direto. Enquanto ela está aberta, o `body` ganha a classe `entrada-open`, que
esconde cabeçalho, faixa de homologação e barra de usuário.

## Botão voltar

Um único botão `.back-link` no topo de cada tela, no mesmo estilo em todo o app.
No login ele é contextual, ajustado por `modoLogin()`: no painel de entrada
volta para a tela inicial; em "Criar usuário" e "Esqueceu a senha?" volta para o
login. Os links de texto que existiam no rodapé desses dois painéis saíram.

## Ícone e favicon

`icon-192.png` é o ícone da aba, declarado em todas as 26 páginas. Antes cada
módulo fazia diferente: a Logística usava `icon-512.png`, Multas apontava para o
logo, o Inventário trazia o ícone embutido em base64 e o RH não tinha nenhum.
`icon-512.png` ficou para o atalho de tela inicial e para o manifest.

## Área do Motorista e Controle de Ponto

Botão na tela de login, sem exigir usuário e senha. Dá acesso a:

- **Checklist Diário** — o mesmo formulário de sempre.
- **Controle de Ponto** — entrada, saída e vários intervalos por dia. Grava na
  planilha `1w2Q6fw...` via `apps-script/apps-script-ponto.gs`. Sem a URL em
  `SCRIPT_URL_PONTO` o registro fica só no navegador.

Em Relatórios entrou **Relatório de Pontos Motoristas**: filtro por motorista e
período, KPIs, exportação CSV e impressão em PDF.

## Logística

O card vai **direto** para o hub de operações — GAM, JadLog, Cargas Terceiros,
Transferências, WOW-Inglesa e Devoluções, mais Painel Diário, Dashboard e
Programação. Não existe mais tela intermediária.

## Links

Tudo relativo, sem nenhuma barra inicial (`/`) e sem `../`. Como está tudo na
mesma pasta, cada página chama a outra pelo nome. Os cards da tela inicial têm
`href` de verdade e o `abrirModulo()` só valida o perfil — quem navega é o
próprio link.

Resultado: funciona na raiz do domínio, em subpasta e abrindo o `index.html`
direto do disco. O service worker só é registrado em `http(s)`; em `file://`
ele é ignorado de propósito. As chamadas `/api/...` continuam dependendo do
Netlify — localmente as telas abrem, mas gravar exige o site publicado.

## Efeito de carregamento

Todas as 26 telas abrem com o splash da marca (logo, barra e "Carregando").
Some sozinho no `load`, com trava de segurança de 6s. Respeita
`prefers-reduced-motion`. Multas já tinha o seu e foi mantido.

## Funções (`/api/...`)

Ficam só em `netlify/functions/` da raiz e valem para o site inteiro:
`routes`, `finalize`, `ae-trigger`, `delete-embarque`, `whatsapp-link`,
`devolucoes`, `wow`, `terceiros2`.

O `finalize.mts` é a versão de homologação (simula gravação quando falta
`GSHEET_WEBHOOK_URL`) já com `categoria`/`campos` e os CPFs novos.

## Publicar

O zip já vem com os arquivos na raiz, do jeito que o Netlify espera. Não
precisa descompactar nem criar pasta.

1. Netlify > o site de produção > aba **Deploys**
2. Arraste o zip na área de *Drag and drop your project output folder here*
3. Confira as variáveis de ambiente abaixo (só na primeira vez)
4. Publica em ~20s

Nada de build: é deploy manual, sem etapa de compilação. As funções em
`netlify/functions/` são empacotadas pelo esbuild, conforme o `netlify.toml`.

Rollback: **Deploys** > escolher um deploy anterior > *Publish deploy*.

Depois de publicar, abra uma aba anônima na primeira visita. O cache do service
worker passou a se chamar `transtac-portal-prod-v1` e o antigo só sai depois que
a aba velha é fechada.

### O que mudou de homologação para produção

- **O checklist do motorista voltou a gravar.** Em homologação o
  `submitChecklist()` tinha um envio simulado (`var HOMOLOG = true`) que
  mostrava "enviado" sem chamar o Apps Script. O bloco saiu.
- `Origem` da validação por placa passou de `HOMOLOG` para `PRODUCAO`.
- Saíram a faixa listrada, o selo da tela inicial e o `[HOMOLOG]` do título.
- `env.mts`: sem `APP_ENV`, o padrão agora é **produção**. Antes era o inverso,
  o que aqui seria pior — uma variável esquecida faria a gravação ser simulada
  em silêncio.
- `shared.css` foi removido: nenhuma página o referenciava.

### Pontos que ficaram para você decidir

- **Busca:** `robots.txt` e o `X-Robots-Tag` do `netlify.toml` mantêm o site
  fora do Google. É sistema interno com login, então mantive. Para indexar,
  apague o bloco do `netlify.toml` e o `robots.txt`.
- **Login provisório:** `fazerLogin()` ainda aceita `admin` / `transtac123`
  quando `SCRIPT_URL_LOGIN` está vazia. Como a URL está preenchida, o trecho
  não roda. Ainda assim é uma senha fixa no código: se preferir, dá para apagar.
- **Chaves de armazenamento local** (`transtac_sessao_homolog_v1`,
  `transtac_chk_motoristas_homolog_v3` e outras) mantiveram o nome com
  "homolog". Renomear apagaria o cadastro de motoristas e o status de viagens
  de quem já usa o sistema no mesmo domínio, então preferi não mexer.

## Variáveis de ambiente (Netlify)

| Variável | Serve para |
|---|---|
| `GSHEET_WEBHOOK_URL` | planilha do controle de embarque |
| `WOW_WEBHOOK_URL` | planilhas do módulo WOW/Inglesa |
| `APP_ENV` | ambiente; sem ela o código assume homologação |

Inventário, Multas e RH falam direto com os próprios Apps Script — não usam
variável de ambiente.

## Pontos de atenção

- `netlify/functions/lib/` usa **camelCase** (`dateKey.mts`, `assignmentsStore.mts`).
  Em minúsculo o build quebra no Linux.
- Logo e fundo existem uma vez só, na raiz, e agora são arquivos de verdade:
  os logos que antes vinham embutidos em base64 no `index.html` foram trocados
  por `logo-transtac.png`, e a marca d'água do `body` por `fundo-transtac.jpg`.
  Só isso tirou cerca de 200 KB do arquivo. Trocar a identidade visual agora é
  substituir as duas imagens.
- Service worker em `transtac-portal-prod-v1`. As telas dinâmicas e as de Inventário, Multas e RH
  sempre passam pela rede.
- Ao renomear qualquer tela de Multas, lembrar dos três pontos: o `href` do card,
  o `montarSubnav()` no fim da página e a lista de itens dentro de
  `multas-app.js`.
- CSS é embutido em cada página. Mudou o visual? Replicar nas telas afetadas.
