# WORKLOG — server-uazapi

Histórico de trabalho do projeto. **Entrada mais recente no topo.**
Registrar aqui toda implementação, fix e decisão técnica relevante ao final de cada sessão.

---

## 2026-10-24 — Exportacoes CSV, criar grupo, entrar por convite e comunidades

Pedido do usuario: "deixar enquete para depois e implementar o restante" (todas as migrations ja aplicadas).
Esta entrega cobre o que a fase 2/6 do plano tinha deixado de fora. Sem migration nova.

### Exportacoes CSV
- **Lista de grupos** (`GET /api/instances/[id]/groups/export`): sai do CACHE, sem chamar a uazapiGO. 409 se o
  cache esta vazio. So metadado do grupo, nenhum participante.
- **Participantes dos selecionados**: lidos AO VIVO, UM PEDIDO POR GRUPO (reaproveita `groups/info`, pausa de 1,5 s
  entre grupos) e o CSV e montado no NAVEGADOR. Motivo: plano Free = 10 ms de CPU por pedido, e um grupo grande ja
  custa isso; assim nao ha limite de grupos por exportacao e nada pessoal fica guardado. Grupo que falha entra no
  aviso e o arquivo sai com os demais.
- `lib/groups/csv.ts`: `;` como separador e BOM UTF-8 (Excel em portugues abre CSV com virgula numa coluna so);
  **neutraliza injecao de formula** — nome de grupo e digitado por qualquer participante, e `=HYPERLINK(...)` roda ao
  abrir no Excel (celula que comeca com `= + - @ tab CR` ganha `'`); telefone formatado ("55 21 98765-4321") para o
  Excel nao mostrar notacao cientifica; grupo em modo LID sem telefone = celula vazia, nunca o ID opaco como numero.
- Aviso de LGPD ao lado dos botoes; a rota registra no log quem exportou e quantos grupos.

### Criar grupo / entrar por convite / comunidades (`/groups/[instanceId]/novo`)
Tres rotas novas (`groups/criar`, `groups/entrar`, `groups/comunidade`), todas exigem `confirmar: true` NO SERVIDOR
(a tela nao e fronteira de seguranca) e registram no log quem fez o que.
- **Criar**: nome ate 100 (o de criar; renomear documenta 25), 1 a 50 telefones, normalizados como na remocao em
  massa (aceita planilha, nono digito etc.). Aviso fixo: adicionar a forca quem nao tem o numero salvo e a maior causa
  de denuncia/banimento; acima de 50, criar com poucos e divulgar o link. O grupo novo entra no cache JA como admin
  (`registrarGrupoNoCache`), senao as edicoes nasceriam travadas.
- **Entrar por convite**: "Ver o grupo" (inviteInfo) mostra nome, tamanho e se exige aprovacao ANTES de confirmar;
  so aceita `chat.whatsapp.com` ou codigo puro (convite de outro dominio e como phishing circula). Entrar NAO faz o
  numero admin.
- **Comunidades**: criar; vincular/desvincular ate 20 grupos por vez. So age em comunidade em que o cache diz que o
  numero e admin (a API recusaria, mas a mensagem daqui e clara); comunidade nao vincula a si mesma. Resultado parcial
  ("1 vinculado, 1 recusado") e mostrado, sem fingir sucesso total.
- A resposta da uazapiGO pode vir como `Group` direto (spec de create/inviteInfo) ou `{ group }` (join/community):
  `grupoDaResposta` aceita os dois. Erro 400 da API agora volta com a mensagem dela.

### Verificado
- Regras: CSV **42**, criar/convite/comunidade **46**; regressao do restante intacta. `tsc` e `eslint` limpos.
- Navegador (dados falsos): exportar lista (nome do arquivo, conteudo), participantes de 3 grupos com o 3o falhando
  (2 no arquivo + aviso), formula neutralizada no arquivo gerado; criar com previa "2 pessoas + 1 trecho ignorado" e
  botao travado sem telefones; convite de outro dominio barrado; ver -> confirmar -> entrar; vincular enviando o corpo
  certo, falha parcial avisada, desvincular, busca.
- NAO verificado contra a uazapiGO real: nenhuma das tres rotas novas (formato exato das respostas, se `create` devolve
  o grupo direto ou em envelope, limites de criacao/entrada do WhatsApp). Testar primeiro com um grupo de teste.

---

## 2026-10-24 — Modulo de grupos: ESTADO ATUAL, PENDENCIAS E LINHA DO TEMPO (leia primeiro)

Resumo para quem abrir o projeto agora. O detalhe tecnico de cada etapa esta nas entradas abaixo.

### Linha do tempo (commits em main)
| Commit | O que |
|---|---|
| 4be19ae | fase 2 — gestao de um grupo |
| cf76e8d | fase 3 — agendador (migration 016, worker `groups-runner`, pagina Agendamentos) |
| fb9f969 | fase 4 — varios passos, varias datas, sequencias |
| 44c34b2 | fase 5 (parcial) — links curtos `/l/<slug>` (migration 017) + amostra do evento `groups` |
| 5cf8bb4 | intervalo entre passos ("logo depois do anterior") + motivo do botao Agendar apagado |
| ea762d9 | pausa em segundos (migration 018) |
| 96a6e0e | motivo do botao Enviar apagado + nome acima de 25 caracteres vira aviso |
| c0098f6 | modo avancado de marcar todos (migration 019) |

### Migrations — o que o usuario aplicou (SQL Editor, a mao)
- **015, 016, 017: aplicadas** (confirmado pelo usuario: "ja rodei as migrations", logo depois da entrega
  da 016/017).
- **019: aplicada** (confirmado pelo usuario em 2026-10-24, depois da entrega).
- **018: NAO confirmada.** Foi criada depois da primeira confirmacao e o usuario so citou a 019. Sem a 018 tudo funciona, mas cada
  passo espera o minuto seguinte (a pausa de segundos so vale com ela). (Sem a 019, marcar todos abaixo de 60 s no modo
  avancado respondia 503 pedindo para aplica-la; agora aplicada, isso nao ocorre.)
- Todas sao idempotentes e trazem `-- rollback:` no cabecalho. Numeracao: as boas-vindas (antes previstas
  como 017) ficam para a **020** em diante.

### Operacional (feito fora do codigo)
- **Secret `GROUPS_RUNNER_SECRET` criado no GitHub** por mim, a pedido e com autorizacao do usuario
  (`openssl rand -hex 32 | gh secret set`; o valor NAO foi exibido nem guardado). Deploy manual disparado
  (workflow `deploy.yml`, run 40084417264) e o passo "Deploy do agendador de grupos" instalou o worker
  `server-uazapi-groups-runner` (cron a cada minuto) e os 3 secrets dele. Antes disso o passo so emitia
  `::warning::` (por desenho, para nunca derrubar o deploy do monitor).
- Verificado depois: `POST /api/groups/scheduler/tick` sem credencial responde 401 (e nao 503, entao o
  secret chegou ao app); `/l/<inexistente>` responde 404.
- Como disparar o agendador na mao para testar: `GET <url do worker>?force=1` (chama o tick sem a consulta
  previa ao banco). A URL `*.workers.dev` do worker nao foi anotada; ver o painel do Cloudflare.

### Decisoes do usuario nesta rodada (para nao serem refeitas)
- "Trava com aviso" (inicio do projeto) continua valendo como principio: protecao ligada por padrao,
  liberavel com confirmacao explicita. Foi assim que marcar todos ganhou o **modo avancado**.
- O usuario opera no **n8n com mais de 10 grupos, marcando todos, a 5 s entre grupos, sem nunca ter tido
  problema**. Isso motivou: pausa entre passos em segundos, modo avancado e nome acima de 25 caracteres.
  E experiencia dele, nao algo que eu tenha verificado.
- Quer poder usar intervalo curto: o piso geral e 5 s (banco) e a variacao de +-20% e fixa.
- Quer ver o MOTIVO quando um botao esta apagado (duas vezes isso travou o uso real): regra para toda tela
  nova — motivo em alerta visivel, nunca so em texto cinza pequeno.

### Pendencias (em ordem de importancia)
1. **Primeiro teste real do agendador** (nunca rodou contra Supabase/uazapi/Cloudflare reais): agendar uma
   mensagem simples para 1 grupo de teste, daqui a ~3 min; conferir que chegou e que a tela de Agendamentos
   mostra "Concluida". Depois testar nome -> descricao -> mensagem com 1 grupo e intervalo de 5 s.
2. Aplicar a **018** no Supabase (a 019 ja foi aplicada).
3. **Medir CPU no plano Free** (Workers metrics) depois do primeiro agendamento: 5 itens por passada e
   estimativa. Se passar de 10 ms, reduzir `MAX_ITENS_POR_PASSADA` em `lib/groups/scheduler-regras.ts`.
4. Testar links curtos em celular real (heuristica de abrir o app) e conferir que a previa do WhatsApp
   NAO conta clique. Aplicar a 017 ja foi feito.
5. **Boas-vindas** (decisao do usuario): assinar `groups` no webhook GLOBAL (Configuracoes; nunca no webhook
   por instancia, que e do n8n), entrar/sair de um grupo de teste e colar a linha "amostra do evento groups"
   do log; so entao escrever o tratador + migration 020 (regras por grupo, anti-duplicata). Atencao: aumenta
   o volume do webhook — assinar numa janela curta e olhar o CPU.
6. Enquetes: acompanhamento do envio ja aparece em Agendamentos; ler votos depende de `POST /message/find`
   (V7, nao verificado) — deixado de lado.
7. Sem edicao de agendamento depois de criado (cancela e cria de novo); sem criar grupo / entrar por convite /
   comunidades / exportar CSV (fase 2 deixou de fora; fase 6 do plano).
8. Nome de grupo acima de 25 caracteres: so aviso; **nao verificado** se a uazapiGO aceita renomear acima de
   25 (a spec documenta 25). Testar num grupo antes de aplicar em varios.

### Lembretes tecnicos que custaram caro
- Toda rota de admin nova precisa entrar em `ADMIN_ROUTES` do `middleware.ts` (`/groups` ja esta).
- Migrations sao aplicadas a mao: codigo que usa coluna/tabela/funcao nova ANTES da migration quebra em
  silencio. Cada recurso novo deve ter guarda que explica (ver `lib/groups/install.ts`).
- Heredoc longo no shell desta maquina falha com "unexpected EOF": escrever o script com a ferramenta de
  arquivo e rodar `python arquivo.py`.
- Servidor de dev (Turbopack) demora ~100 s na primeira rota e, as vezes, nao responde por minutos: aquecer
  com `curl --max-time 90` em laco antes de abrir no navegador. `.env.local` e `app/preview-*` usados para
  conferir telas sao TEMPORARIOS e foram removidos antes de cada commit.

---

## 2026-10-24 — Marcar todos: modo avancado (mais de 10 grupos, intervalo a partir de 5 s) — migration 019

O usuario opera no n8n com mais de 10 grupos, marcando todos, a 5 s entre grupos, "sem nunca ter
problema". Os dois limites de marcar todos (10 grupos e 60 s) eram PALPITES meus, nao regras do
WhatsApp; e travavam o botao dele com 13 grupos.

Em vez de apagar a protecao ("trava com aviso", decidido no inicio), virou um **modo avancado
opt-in**:
- Padrao continua o recomendado: ate 10 grupos e 60 s marcando todos.
- Interruptor "Modo avancado" (so aparece com marcar todos ligado): libera mais de 10 grupos e
  intervalo a partir de 5 s. Os tetos GERAIS continuam (20 grupos no envio direto, 100 agendando,
  piso de 5 s; o piso do banco `spacing_seconds >= 5` nao mudou).
- **O servidor exige a confirmacao** (`aceitoRiscoMarcarTodos === true`, exatamente): a tela nao e
  fronteira de seguranca. Sem ela a recusa traz `exigeModoAvancado` e diz que o modo existe. Valores
  como "true" (texto), 1, null ou objeto NAO valem.
- A confirmacao vale para aquele uso: desligar "Marcar todos" desliga o modo avancado, e ligar de novo
  pede de novo. A confirmacao digitada (quantidade de grupos acima de 3) continua exigida.
- Vale para os dois caminhos (envio direto e agendamento).

### Migration 019 (aplicar a mao)
Remove `group_tasks_mention_all_spacing` (marcar todos exigia 60 s no banco). Sem a 019 o modo avancado
a menos de 60 s falha ao gravar (23514); as duas rotas reconhecem essa violacao e devolvem 503 dizendo
para aplicar a 019, em vez de um 500 generico. Acima de 10 grupos a 60 s funciona sem a 019 (o teto
de 10 nunca esteve no banco).

### Tambem nesta rodada (commit anterior, 96a6e0e)
- Botao "Enviar" apagado com 13 grupos: motivo agora em alerta visivel tambem no envio direto.
- Nome acima de 25 caracteres: a spec documenta 25 para renomear, mas grupos com nomes maiores existem.
  Virou AVISO (trava dura em 100, o limite de criar). Nao verificado se a uazapiGO aceita.

### Verificado
- 31 checagens novas das regras (recusa sem confirmacao, aceita com, tetos gerais mantidos, 4 s
  recusado mesmo com confirmacao, "true" em texto nao vale, direto e agendado) + 11 do banco (a 015 recusa
  5 s marcando todos com 23514; apos a 019 passa; 4 s e jitter > 50 seguem recusados; idempotente).
  Regressao: 83 + 72 + 42 + 53 + 76.
- Navegador, 13 grupos: sem marcar todos o botao libera; com marcar todos trava, com alerta e aviso no
  interruptor; modo avancado libera e baixa o piso do campo para 5 s; desligar/religar marcar todos
  desfaz o modo avancado; confirmacao digitada exigida; corpo enviado traz `aceitoRiscoMarcarTodos: true`.
- NAO verificado: o comportamento do WhatsApp com esse ritmo. A decisao e do usuario, com base na
  experiencia dele no n8n; o painel so deixa de impedir, com confirmacao.

---

## 2026-10-24 — Envio apagado com 13 grupos; nome com mais de 25 caracteres

- **Botao "Enviar" apagado sem explicacao (de novo).** Com 13 grupos e "Marcar todos" ligado o teto de
  10 grupos travava o botao, e no envio imediato o motivo so aparecia numa linha cinza minuscula. Agora
  o motivo e um alerta ambar tambem no envio imediato ("Ainda nao da para enviar: ...") e o interruptor
  de marcar todos avisa na hora quando a selecao passa de 10. (A tela de agendar ja fazia isso.)
- **Nome do grupo com mais de 25 caracteres.** A spec documenta "1 a 25" para RENOMEAR (criar aceita
  100). Eu tratava como trava dura. Mas o usuario tem grupos com nomes maiores, o que mostra que o
  WhatsApp aceita mais, e a trava impedia renomear justamente esses. Agora 25 e so AVISO (ambar,
  explicando que a uazapiGO documenta 25 e que vale testar num grupo antes); a trava dura passa a 100
  (o limite de criar). Se a uazapiGO recusar, o erro aparece na tela (ou no item do agendamento) e nada
  e alterado. NAO verificado contra a uazapiGO real se ela aceita renomear acima de 25.
- Testes: gestao 76/76 (26 caracteres passam com aviso, 100 passam, 101 recusam, emoji vale 1).

---

## 2026-10-24 — Pausa entre passos em segundos (migration 018)

Feedback do usuario: 1 minuto minimo entre passos e muito (nome + descricao + mensagem = 3 min;
foto, mais). Tinha razao: o minimo de 1 min era limite meu, nao necessidade.

### O que limitava de verdade

- O agendador roda a cada minuto, mas cada passada dorme ate 45 s e processa varios itens, entao
  passos a segundos um do outro cabem NA MESMA passada — se o agendador abrir a execucao antes
  de ela vencer. Nao abria: `open_due_group_runs` so abria `run_at <= now()`, empurrando cada
  passo para o minuto seguinte.
- O ritmo real entre duas acoes do numero e o "Intervalo entre grupos" da tarefa (segundos; minimo
  5, ou 60 com marcar todos), imposto pelo banco (`reserve_group_instance_slot`). Vale entre
  QUAISQUER duas acoes, inclusive de passos diferentes.

### Mudancas

- **Migration 018** (aplicar a mao): `open_due_group_runs(p_horizon_seconds)` abre tambem as execucoes
  que vencem dentro do horizonte do claim (40 s); o claim repassa o horizonte. A versao sem argumento
  foi removida (duas daria "function is not unique"). Sem a 018 tudo funciona como antes, so que
  cada passo espera o minuto seguinte (~1 min de pausa efetiva).
- **Pausa em segundos** (`aposAnteriorSeg`, antes `aposAnteriorMin` — nunca gravado, so resolvido na
  criacao). Unidades: segundos/minutos/horas/dias. Vazio = o minimo. Menor que o ritmo do numero
  vira o ritmo (a acao nao sairia antes de qualquer jeito): `piso = max(5 s, ceil(intervalo x (1 - variacao)))`,
  48 s com os padroes (60 s, 20%), 5 s com intervalo de 5 s.
- A folga entre passos de data fixa deixou de ser 60 s fixos: agora e o mesmo piso.
- Cronograma e lista de execucoes mostram SEGUNDOS (antes mostravam "10:00 / 10:00 / 10:00").
- A dica no passo explica o piso e como baixa-lo (diminuir o intervalo entre grupos).

### Resultado (1 grupo, nome -> descricao -> mensagem)

- intervalo 60 s (padrao): 10:00:00 -> 10:00:48 -> 10:01:36 (antes: 10:00 -> 10:01 -> 10:02 no minimo)
- intervalo 5 s: 10:00:00 -> 10:00:05 -> 10:00:10

### Verificado

- Banco: 15 checagens novas (3 passos de poucos segundos saem numa passada so, na ordem, com ~10 s
  entre eles; passo a 5 min nao e aberto; tarefa pausada/cancelada e envio do navegador ativo
  continuam segurando; o ritmo do numero segura a 2a acao mesmo estando no horizonte; so existe UMA
  `open_due_group_runs`) + os 58 da 016 passam tambem com a 018 por cima (60 com as da 018).
- Regras: 53 novas (pausa minima, pausa maior que o piso, invalida, combinacoes proibidas, ultimo
  passo com varias datas, piso, tela) + 42 + 71 + 83 anteriores.
- Navegador: unidade padrao "segundos", placeholder = piso (48 / 5 conforme o intervalo), corpo
  enviado com `aposAnteriorSeg`. `tsc` limpo; eslint limpo nos arquivos tocados (o unico erro e de
  `components/ui/textarea.tsx`, que ja era assim).

### NAO verificado

- Passos a segundos contra o WhatsApp real: depende do cron de 1 min do Cloudflare e da passada
  conseguir dormir ate o horario sem passar dos 45 s. O inicio do 1o passo atrasa ate ~1 min; os
  seguintes seguem o 1o.
- Um item que nao cabe na passada (mais de 5 itens, ou espera acima de 45 s) segue na passada
  seguinte: com muitos grupos o ritmo e o do intervalo, nao o da pausa.

---

## 2026-10-24 — Agendamento: intervalo entre passos ("logo depois do anterior") + botao apagado sem motivo

Primeiro teste do usuario: 3 passos (nome, descricao, mensagem), tudo preenchido, botao "Agendar"
apagado e sem explicacao. Duas causas, as duas minhas.

### O que travava

1. **Regra de sobreposicao com o motivo escondido.** Passos so podem comecar depois que o anterior
   termina de percorrer os grupos (senao os grupos dos dois se intercalam: renomear o grupo 3 antes
   de mandar a mensagem ao grupo 2). Com varios grupos e 60 s de intervalo, isso exige passos
   a ~10 min um do outro; datas iguais ou proximas barravam o botao. O motivo aparecia so numa
   linha cinza minuscula embaixo do botao. **Agora e um alerta ambar** ("Ainda nao da para agendar: ...")
   e a mensagem sugere a solucao.
2. **Defeito na propria regra: ignorava a variacao (jitter) do intervalo.** A duracao usada era
   (n-1) x intervalo; com 20% de variacao a ultima posicao cai ate 20% mais tarde, entao um passo
   podia invadir o seguinte (10 grupos: 540 s + 60 s de folga era menos que os 648 s do pior caso).
   `duracaoDaOcorrenciaMs` agora e de pior caso. Consequencia: pedidos que passavam raspando (10 grupos,
   passos a 10 min) agora sao recusados.

### Intervalo entre passos

Nao existia: cada passo tinha so data fixa ou "depois do inicio". Novo modo, **padrao nos passos
novos**: "Logo depois do passo anterior" + pausa configuravel (minutos/horas/dias, minimo 1 min).
O passo comeca quando o anterior TERMINA (pior caso, com jitter) + a pausa; com varias datas no
anterior conta a ultima. Resolvido no servidor (`aposAnteriorMin`), gravado como `offset` com o atraso
equivalente so para a lista exibir. O primeiro passo continua exigindo data fixa; combinar "logo
depois" com data ou atraso no mesmo passo e recusado (nao ignora em silencio).

**Minimo de 1 min** porque o agendador confere a fila a cada minuto: nao da para prometer segundos.
Entre DUAS acoes quaisquer do numero (inclusive passos diferentes) vale tambem o "Intervalo entre
grupos" da tarefa, imposto pelo banco (`reserve_group_instance_slot`). Esse intervalo e da tarefa
inteira (o mesmo para alteracao e mensagem); nao ha intervalo por passo.

### Verificado

- 43 checagens novas (cenario exato do usuario com 1, 3 e 10 grupos; pausas validas e invalidas;
  combinacoes proibidas; ultima execucao do passo anterior; jitter; tela), mais 42 + 71 + 83 anteriores.
- No navegador, reproduzido: data fixa na mesma hora -> botao apagado + alerta com o motivo;
  "logo depois" -> libera; cronograma 10:00 -> 10:07 -> 10:18 (6 grupos, 60 s, pausas de 1 e 5 min).
- `tsc` e `eslint` limpos. Nada rodou contra Supabase/uazapi reais ainda.

---

## 2026-10-24 — Modulo de grupos, fase 5 (parcial): links curtos e amostra do evento `groups`

Feito: links curtos com contagem de cliques. **Nao feito, de proposito: mensagem de boas-vindas
e acompanhamento de enquetes** (motivo abaixo).

### Links curtos (`/l/<slug>`) — migration **017** (aplicar a mao; idempotente, rollback no cabecalho)

O WhatsApp so deixa clicavel http(s); `instagram://...` colado na mensagem nao funciona. O link
curto e https e, no celular, tenta abrir o app e cai para o site. Tambem da contagem aos convites
de grupo e permite desligar um convite que vazou.

- Tipos: YouTube, Instagram, convite de grupo, conversa (wa.me). **So esses**: um redirecionador
  que aceita qualquer endereco e a ferramenta preferida de phishing. O destino e validado por
  tipo (dominio exato — recusa `youtube.com@evil.com`, `youtube.com.evil.com`, dominio no caminho,
  `javascript:`/`data:`), sempre https, sem porta e sem usuario embutido; o banco ainda recusa
  tudo que nao seja https.
- **Robo nao conta clique.** A previa que o WhatsApp monta busca o link: sem isso cada grupo que
  recebesse a mensagem geraria um clique falso. Robo (WhatsApp, Facebook, Telegram, Google, curl,
  sem User-Agent) resolve SEM contar e e redirecionado ao destino (a previa mostra o cartao do
  video/perfil de verdade).
- Pagina intermediaria so para pessoa no celular com destino que tem app (YouTube video/shorts,
  perfil do Instagram): HTML puro, sem React (e aberta por anonimo e o plano e Free). Tenta o app;
  em ~900 ms cai no https. Android usa `intent://` com `browser_fallback_url`; iOS usa o esquema.
  Post/reel do Instagram precisam de id numerico que nao da para tirar do endereco: vao direto
  ao https. WhatsApp nunca precisa de intermediario.
- `resolve_short_link` resolve e conta em UMA instrucao (20 cliques simultaneos = 20). Slug que
  nao tem a forma valida nem chega ao banco. Fora do `matcher` do middleware (ja estava).
- Tela: dentro de "Links do WhatsApp" — criar, copiar, abrir destino, desativar/reativar, apagar
  (confirmacao), cliques e ultimo clique. `chamarApi` ganhou o parametro de metodo (PATCH/DELETE).

### Amostra do evento `groups` (4 linhas em `app/api/webhook/route.ts`)

Quando o evento `groups` chegar, uma amostra MASCARADA vai para o log (maximo 30 por isolate). O
payload traz o **token da instancia** e telefones: token/qrcode/etc. sao removidos, telefones de
10-15 digitos ficam com os 4 ultimos, e o id do grupo (18 digitos) fica intacto — sem ele nao da
para saber de qual grupo veio. Nao grava no banco, nao muda a resposta, nunca lanca.

**Por que parei aqui nas boas-vindas:** a spec nao traz o formato do evento `groups`. Escrever o
tratador agora seria codigo especulativo no caminho de producao do monitor e dos agentes. A
sequencia certa e: (1) assinar `groups` no webhook GLOBAL (Configuracoes — nunca no webhook por
instancia, que e do n8n); (2) ler a amostra no log; (3) so entao escrever o tratador e a
migration 018 (regras por grupo + log anti-duplicata). **A assinatura e decisao do usuario**:
aumenta o volume que passa pelo webhook (cada evento de grupo de toda instancia do servidor faz
uma invocacao e um upsert de batimento) e foi justamente volume o que gerou os alertas de CPU.
Sugestao: assinar numa janela curta, olhar as metricas do Worker, e so manter se estiver tranquilo.

**Enquetes:** nao ha endpoint que leia votos; so da por `POST /message/find` (V7, nao verificado).
O acompanhamento do ENVIO ja existe na tela de agendamentos. Fica para depois do teste real.

### Verificado (automatico)

- Regras dos links (`links-curtos.ts`): **62** checagens, incluindo 12 destinos de phishing.
- Migration 017 no PGlite: **21** (resolve, conta, robo nao conta, desativado nao resolve,
  20 cliques simultaneos, banco recusa http/javascript:/slug ruim/tipo invalido, grants e RLS).
- Amostra do evento: **25** (token e telefone nao vazam, id do grupo preservado, teto, nao lanca).
- Rota publica `/l/[slug]` rodando de verdade no dev server contra um PostgREST de mentira:
  Android -> pagina com `intent://`, iPhone -> `youtube://`, PC/robo/sem User-Agent -> 302;
  robo e sem UA chamaram o banco com `p_count:false`; slug com injecao e com `../` nem chegaram
  ao banco; Instagram post e convite foram direto ao destino.
- Tela de links no navegador com dados falsos: phishing e slug ruim barram o botao; corpo do
  POST e do PATCH conferidos. `tsc` e `eslint` limpos nos arquivos novos.

### NAO verificado

- O comportamento de abrir o app em celular de verdade (heuristica; o esquema pode ser ignorado
  por um navegador embutido e cair no site depois de 900 ms, que e a falha correta).
- Contra Supabase real: migration 017 e rota. Aplicar a 017 antes de usar a tela de links.

---

## 2026-10-24 — Modulo de grupos, fase 4: varios passos, varias datas, sequencias

Um agendamento agora tem N passos; cada passo tem a propria acao e o proprio quando. Cobre
"alteracoes diferentes e mensagens diferentes em dias e horarios diferentes" e a sequencia
("hoje, daqui a 2 dias, daqui a 5"). Sem migration nova: o modelo da 015 ja tinha
`group_task_steps` com `absolute_ats` e `offset_minutes`.

- **Varias datas num passo** (ate 30): "repetir em outra data".
- **Varios passos** (ate 10, 60 execucoes no total): trocar o nome na segunda, mandar o aviso na quinta.
- **Sequencia**: a partir do 2o passo, "Depois do inicio" (minutos/horas/dias). O 1o passo precisa
  de data fixa — e ele que ancora. A tela mostra "Cai em ..." para cada atraso.
- Cronograma ("O que vai acontecer") antes de confirmar, vindo do mesmo `avaliarAgendamento`
  que a rota usa: a tela nao promete o que o servidor vai recusar. Substituiu a validacao propria
  que a tela tinha na fase 3 (uma regra so, em vez de duas copiadas).

### Decisoes

- **Sobreposicao e conferida sobre o CONJUNTO** de execucoes, nao por passo. Passos diferentes
  na mesma hora disputam o mesmo numero; a cadencia por instancia (016) impediria o ritmo de
  dobrar, mas a tarefa correria atras do proprio rabo. Recusa com a duracao estimada. Atraso 0
  junto da ancora cai aqui tambem.
- **Marcar todos e da tarefa, mas so vale com ao menos uma mensagem**; mistura de mensagem e
  alteracao exige admin E poder enviar em todos os grupos (`exige: 'ambos'`). So alteracoes nao
  exigem poder enviar.
- Erro de um passo aponta qual ("Passo 2: ..."); com um passo so, sem prefixo.
- A rota apaga a tarefa inteira se qualquer passo/ocorrencia falhar ao gravar (ON DELETE CASCADE):
  sequencia pela metade, com um passo sumido sem aviso, seria pior que nenhuma.
- Formato antigo (`kind`/`payload`/`datas`, um passo) continua aceito pela rota.
- `GET /api/groups/tasks` agora devolve `passos[]` e cada ocorrencia traz `step_id`; a lista mostra
  "Passo N · ... (2 dias depois do inicio)".

### Verificado (automatico)

- Regras de agendamento: 71 (fase 3, adaptadas) + **42 novas** (sequencia, mistura de acoes,
  sobreposicao entre passos, limites de passos/execucoes, formato antigo, confirmacao digitada).
- Migration 016 no PGlite: **58** (7 novas: tarefa com 2 passos, claim devolve o tipo do passo da
  ocorrencia, tarefa so fecha quando TODAS as ocorrencias de TODOS os passos terminam, cancelar
  leva todos os passos, banco recusa passo relativo sem `offset_minutes`).
- Regressao do envio imediato: 83/83. `tsc` e `eslint` limpos.
- Tela no navegador com dados de mentira: passo 2 como "depois do inicio" resolve para +2 dias,
  confirmacao digitada trava com alteracao em 2 grupos, corpo enviado conferido (10:00 Brasilia =
  13:00Z, `offsetMinutos: 2880`), lista com 3 passos.

### NAO verificado

- Tudo que a fase 3 ja listava como nao verificado continua valendo (nada rodou contra
  Supabase/uazapiGO/Cloudflare reais). Esta fase so acrescenta regras e tela em cima dela.
- Editar um agendamento depois de criado: nao existe (cancela e cria de novo). Os alvos so sao
  fotografados quando cada ocorrencia abre, entao a base para editar existe, mas a tela nao.

---

## 2026-10-24 — Modulo de grupos, fase 3: agendador

Agenda envio de mensagem (texto, midia, botoes) e alteracao de nome, descricao e foto para uma
data/hora. Roda sozinho, com a aba fechada. Cobre o pedido de "agendar cada tarefa", "rate limit
entre acoes" e "multi-tarefa" (varias tarefas coexistem; varias DATAS no mesmo passo ja sao aceitas
pela API e pelo banco — a tela da fase 3 usa uma; a fase 4 abre a tela de varias).

### Migration 016 (aplicar a mao no SQL Editor — idempotente, com rollback no cabecalho)

Nao e opcional para agendar: a rota `POST /api/groups/tasks` RECUSA (503) enquanto a 016 nao
existir, e a pagina de agendamentos mostra o aviso. Motivo: agendar sem ela criaria tarefas que
nunca rodam, sem aviso nenhum (mesmo tipo de falha silenciosa da migration 009). O envio
imediato continua funcionando so com a 015.

O que a 016 resolve — todos sao modos de falha que so aparecem sem ninguem olhando:
1. **Cadencia por NUMERO, nao por ocorrencia** (`group_instance_pace` +
   `reserve_group_instance_slot`). Duas tarefas na mesma hora na mesma instancia dobrariam o
   ritmo real sem nenhuma violar a propria regra; um atraso do cron geraria rajada. Reserva
   atomica numa instrucao so.
2. **Nada de reenvio as cegas.** A 015 devolvia ao lease um item preso e o reenviaria — se a
   passada morreu DEPOIS de chamar a API e ANTES de gravar, isso duplicaria a mensagem num
   grupo. `begin_group_item_send` grava `executed_at` ANTES de enviar; o lease vencido de um
   item com `executed_at` vira FALHA "pode ter sido entregue" (`response.incerto = true`), nunca
   reenvio. Item so reivindicado e nao enviado volta a fila normalmente.
3. **Horario perdido nao dispara depois.** Ocorrencia > 60 min atrasada vira `failed` com
   motivo; item > 2 h atrasado e descartado. Uma promocao de ontem chegando hoje e pior que nao
   chegar. Tarefa pausada nao perde o horario enquanto pausada.
4. **Convivencia com o envio pelo navegador.** O agendador nao abre ocorrencia numa instancia
   com envio do navegador ativo, e `dispatch/start` recusa (409) se houver ocorrencia agendada
   em andamento. As tarefas agendadas ficam `scheduled` enquanto trabalham (nunca `running`),
   de proposito: a limpeza de "execucao abandonada" do `start` so olha tarefas `running` e
   cancelaria uma campanha agendada com espacamento longo.
5. Funcoes atomicas: pausar/retomar (retomar REESPACA os pendentes a partir de agora, senao tudo
   que venceu na pausa sairia em rajada), cancelar, repetir falhas, bloquear instancia (463),
   fechamento da tarefa quando todas as ocorrencias terminam.

`claim_group_task_items` foi RECRIADA (drop + create) para devolver `instance_status`: evita uma
chamada a uazapiGO so para descobrir que o numero esta desconectado (o monitor ja mantem isso).

### A passada (`POST /api/groups/scheduler/tick`, secret `GROUPS_RUNNER_SECRET`)

Plano Free: ate **5 itens por passada** (~4 idas externas cada + o claim ≈ 25 de 50) e orcamento
de 45 s de sono. Por item, em ordem: portoes de admin/envio reconferidos na hora (entre agendar e
executar podem ter passado dias) → espera o horario previsto → reserva o instante DA INSTANCIA →
portao `begin_group_item_send` (pausado/cancelado enquanto dormia = nao envia) → executa →
grava. Erro 463 do WhatsApp: bloqueia todas as tarefas da instancia, devolve o resto a fila e
encerra a passada (insistir transforma restricao em banimento). Retomar tarefa bloqueada
consulta o pre-voo antes. Timeout vira falha "incerta" (nao entra no "repetir falhas" por padrao).
Responde `etapasMs` como o monitor, para diagnosticar CPU sem acesso ao banco.

### Worker `workers/groups-runner` (cron a cada minuto) — decisao importante

Ele **consulta o banco (PostgREST, 1 request leve) antes de acordar o app**, e so chama o tick
se houver ocorrencia aberta/em andamento/com horario nos proximos 90 s em tarefa ativa. Acordar o
Next.js inteiro 1.440x/dia para descobrir que nao ha nada e a forma de reabrir o problema de CPU
do monitor. Se a consulta falhar, NAO chama o app as cegas. Custo: o worker guarda
`SUPABASE_SERVICE_ROLE_KEY` (mesma conta Cloudflare, ja existe como secret do app). Separado do
monitor de proposito (dominio de falha proprio). `GET <worker>?force=1` chama o tick direto.

### Deploy

`deploy.yml` — passo NOVO, por ultimo (depois do monitor). Se o secret `GROUPS_RUNNER_SECRET`
nao existir no GitHub, so emite `::warning::` e segue: o painel funciona, o agendamento fica
desligado e o tick responde 503. **Acao do usuario:** criar o secret no GitHub (qualquer valor
aleatorio longo) e aplicar a 016; depois disparar o deploy (push ou "Run workflow").

### Interface

- Tela de envio: botoes "Enviar agora" / "Agendar". Agendar acrescenta: o que fazer (mensagem /
  trocar nome / descricao / foto), nome do agendamento e data+hora (Brasilia). Mesmas travas do
  envio (teto de marcar-todos, espacamento minimo, confirmacao digitada acima de 3 grupos com
  marcar-todos ou ao alterar > 1 grupo). Alteracao so entra em grupo onde o numero e admin.
  Marcar-todos e desligado de fato quando a acao nao e mensagem.
- `/groups/[instanceId]/agenda`: tarefas com status, ocorrencias, progresso, detalhe por grupo,
  pausar / retomar / cancelar (com confirmacao) e "Repetir as falhas". Pre-voo ao agendar so AVISA
  (agendar com o numero caido hoje e legitimo); quem bloqueia de verdade e o agendador.
- Refactors: `avaliarAlvosEEspacamento` (travas de alvo/ritmo compartilhadas pelas duas portas,
  para nao divergirem), `lib/groups/executar.ts` (envio e foto compartilhados com as rotas).

### Verificado (automatico)

- Migration 016 no PGlite: **51 checagens** (idempotencia, reserva atomica, claim, portao de
  envio, lease sem reenvio, release, retomar reespacando, repetir falhas, cancelar com item em
  voo, horario perdido, convivencia com o navegador, bloqueio 463, fechamento, permissoes).
- Regras puras (datas, passos, agendamento, decisoes do tick, esperas): **71 checagens**.
- Regressao do envio imediato apos o refactor: 83/83. `tsc` limpo; `eslint` limpo nos arquivos
  novos (os 7 erros restantes sao de arquivos pre-existentes que nao toquei).
- Tela no navegador com dados de mentira: modo agendar, travas (nao-admin, sem nome, sem data),
  corpo enviado (14:30 Brasilia = 17:30Z), lista de agendamentos, detalhe, "incerto".

### NAO verificado (precisa de um teste real)

- **Tudo contra o Supabase e a uazapiGO reais**: o tick de ponta a ponta, o worker no Cloudflare
  e a consulta PostgREST do worker (`group_tasks!inner`) nunca rodaram. Os testes cobrem o SQL e
  a logica, nao a rede.
- **CPU no plano Free.** 5 itens por passada e uma estimativa, nao medida. Ver "Workers metrics"
  depois do primeiro agendamento; se passar de 10 ms, reduzir `MAX_ITENS_POR_PASSADA`.
- Foto agendada (URL vs base64, V8) e botoes agendados.
- Fora do escopo desta fase: varias datas na tela (fase 4), sequencias com offset, boas-vindas.

### Numeracao
Boas-vindas passam a ser a migration **017** e enquetes/deeplinks a **018** (a 016 foi usada aqui).

---

## 2026-10-24 — Modulo de grupos, fase 2: gestao de um grupo

Primeiro envio real (fase 1) confirmado pelo usuario: funcionou num grupo de teste.
Usuario esclareceu o uso: ate 10 grupos, numa unica instancia, Cloudflare **Free**.

### Plano Free: o que muda

Free = 10 ms de CPU e 50 chamadas externas por requisicao. Dormir (espera de I/O) continua
gratis, e o envio pelo navegador cai bem nisso: cada grupo e uma requisicao propria, com
orcamento proprio. Tirei a recontagem por grupo de `dispatch/one` (3 idas ao banco por
envio); o `finish` recalcula uma vez. Para a fase 3 (agendador no cron) isso pesa: cada envio
custa CPU, entao a passada devera processar poucos itens, nao 12. Registrado para la.
Correcao: o plano original assumia Workers Paid (30 s de CPU). Nao era verdade.

### Filtro "so os grupos em que sou admin"

Checkbox na lista, com contagem. Combina com a busca; "Selecionar N" respeita o filtro.

### Tela de um grupo (`/groups/[instanceId]/[grupo]`)

Na URL o grupo vai SEM `@g.us` (so digitos e hifen): o `@` precisa de codificacao e e facil
errar. Os dados vem AO VIVO da uazapiGO (`groups/info`), nao do cache — quem abre um grupo
para agir precisa dos participantes de agora, senao remove quem ja saiu. Participantes nunca
vao para o banco.

- **Nome** (25 caracteres, conta pontos de codigo: emoji vale 1) e **descricao** (512).
- **Foto**: redimensionada NO NAVEGADOR (JPEG, ate 640x640) e enviada ao bucket. O servidor
  nao decodifica imagem — seria CPU pesada no Worker. A rota so aceita URL do nosso bucket
  (senao mandaria a uazapiGO buscar qualquer endereco). Tenta a URL e, se a uazapiGO recusar
  por motivo que nao seja permissao/tamanho/formato, reenvia como base64 (V8 nao verificado).
- **Configuracoes**: so admins falam / editam, aprovar entrada, quem adiciona, mensagens
  temporarias. Uma por vez; o controle so muda quando a resposta volta com sucesso.
- **Convite**: ver, copiar, renovar. Renovar INVALIDA o link antigo: confirmacao na tela e
  `confirmar: true` exigido pela rota.
- **Participantes**: promover, rebaixar, remover. Admin nao e removido direto.
- **Sair do grupo**: exige digitar o nome do grupo; avisa que, sendo o unico admin, o grupo e
  dissolvido.

### Remocao em massa de compradores

Cola uma lista, ve exatamente quem sairia, so entao remove. A analise roda no navegador contra
a lista ao vivo; a rota rebusca o grupo antes de cada lote e recusa admins (a tela nao e a
fronteira de seguranca, so a pre-visualizacao).
- Nono digito: o mesmo celular aparece com e sem ele (5521987654321 e 552187654321). Casa nas
  duas formas.
- **Grupos em modo LID**: o JID e um identificador opaco, NAO um telefone. Sem `PhoneNumber`
  o numero fica null e a pessoa nao e reconhecida por telefone — tratar o identificador como
  telefone casaria a pessoa errada. A tela avisa quantos participantes estao nessa situacao.
- Admins que casam ficam de fora e aparecem separados; "nao encontrados" e listado.
- Lotes de 15, 10 s entre eles, para no primeiro erro. O espacamento entre lotes NAO e imposto
  pelo servidor (nao ha registro de execucao como no envio de mensagens). Risco menor — nao
  notifica ninguem —, mas existe.
- O tamanho do lote (15) e prudencia minha: a spec nao documenta o maximo.

### Bug evitado no cache

A resposta de uma mutacao pode nao trazer `OwnerIsAdmin`. O mapeamento da listagem preenche
padrao `false` — gravar isso por cima de um `true` faria a tela achar que o numero deixou de
ser admin logo apos editar o grupo. Mutacoes usam `camposParaAtualizar()`, que so grava o que
veio preenchido.

### Verificado

75 conferencias da logica de gestao (limites, 9o digito, modo LID, plano de remocao, lotes,
cache parcial), 12 das dimensoes da foto, 57 de busca/filtro/links. Tela conferida no
navegador com dados falsos: colar uma lista de 6 trechos produziu o resultado certo (2 saem,
2 admins protegidos, 1 fora do grupo, 1 nome ignorado); confirmacao digitada trava com 3 e
libera com 2; a remocao PARA no primeiro erro. As nove rotas de grupo devolvem 401 sem login.
O servidor de desenvolvimento deu 404 em tudo uma vez (ate /login); reiniciar resolveu —
problema do ambiente, nao de rota.

### NAO verificado

Como na fase 1, as rotas novas nao rodaram contra uazapiGO real: o que `groups/info` devolve
(se traz `PhoneNumber` e `OwnerIsAdmin`), a troca de foto por URL, o limite real de
participantes por chamada. Testar num grupo de teste antes de usar com cliente.

### Ficou de fora desta fase

Criar grupo, entrar por convite, comunidades e exportacao CSV — pelo uso descrito (poucos
grupos ja existentes) nao sao prioridade. Boas-vindas (migration 016) e agendamento seguem
nas fases 5 e 3.

---

## 2026-10-24 — Modulo de grupos, fase 1: disparo de mensagem

Entrega a prioridade declarada: listar os grupos de uma instancia, selecionar, escrever
(texto, midia ou botoes), marcar todos, e enviar com intervalo real entre cada grupo.
Funciona sozinho — nao depende do agendador (fase 3).

### Como o envio funciona

O navegador e quem espera entre um grupo e o proximo (zero tempo de Worker). Mas o
navegador NAO e a fronteira de seguranca. O fluxo tem tres rotas e o servidor decide tudo:

1. `POST /api/groups/dispatch/start` — revalida conteudo, espacamento, teto de marcar todos,
   permissao em cada grupo e pre-voo; grava a campanha. O CONTEUDO fica gravado aqui.
2. `POST /api/groups/dispatch/one` — recebe so `{ runId, groupjid }`. Texto, intervalo e
   modo de marcar todos vem do que foi gravado no passo 1, nunca da requisicao. Uma aba
   adulterada nao consegue mandar outro texto, outro grupo nem ir mais rapido.
3. `POST /api/groups/dispatch/finish` — encerra.

### As travas, e onde cada uma mora

- **Espacamento**: piso de 5 s, 60 s marcando todos. Banco (`check`), rota e tela.
  A rota ainda impoe o intervalo ENTRE requisicoes: `reservarInstante()` grava
  `last_action_at` com um UPDATE condicional ANTES de enviar. Duas requisicoes simultaneas
  disputam a mesma linha e so uma passa. Sem isso a checagem "ja passou tempo?" seria lida e
  gravada em momentos diferentes e as duas passariam.
- **Marcar todos**: maximo de 10 grupos por execucao; acima de 3 exige digitar a quantidade.
- **Portao `owner_can_send`**: grupo so-admin onde o numero nao e admin nao entra na selecao
  e e recusado no servidor com o nome do grupo.
- **Uma execucao por numero**: o espacamento e medido DENTRO de cada execucao; duas ao mesmo
  tempo dobrariam a cadencia real sem nenhuma violar a propria regra. Execucao parada ha
  mais de 10 min (aba fechada) e encerrada pelo proximo `start`.
- **Pre-voo `wa_messages_limits`**: restricao do WhatsApp e instancia desconectada bloqueiam
  sem saida. Cota esgotada bloqueia mas o operador pode liberar ("sei do risco"), porque uma
  mensagem para grupo EXISTENTE provavelmente nao conta como conversa nova — ainda nao
  verificado (V10). Consulta que falhou nao bloqueia: nao saber nao e estar bloqueado.
- **463 do WhatsApp durante o envio**: a execucao vira `blocked_by_wa_limits` e o laco PARA.
  Insistir num numero restrito e o que transforma restricao temporaria em banimento.
- **Sem resposta nao e "nao enviou"**: timeout/queda de conexao marca o grupo como falhou com
  o aviso "a mensagem pode ter sido entregue — confira o grupo", e a execucao para.

### Decisao de desenho que evita mensagem duplicada

Os items do envio pelo navegador nascem JA TERMINAIS (`sent`/`failed`), por INSERT, depois da
chamada. Nunca ficam `pending` nem `running`. Se ficassem, o lease da migration 015
(`reclaim_stale_group_items`) devolveria um item preso a fila e o agendador da fase 3 o
reenviaria — duplicando uma mensagem que o navegador ja mandou. Consequencia: o trigger de
rollup (so UPDATE) nao dispara, entao `recalcularContagem()` atualiza os contadores.

### O cache de grupos

`atualizarCacheDeGrupos()` processa UMA pagina (200) por vez e grava antes de pedir a proxima;
nunca guarda a listagem inteira. Pede `noParticipants: true`. Grupos que sumiram sao removidos
comparando por JID — nao por `fetched_at`, porque o relogio do Worker e o do Postgres podem
divergir e apagaria linhas recem-gravadas. So apaga depois de listagem COMPLETA.
Se a listagem sem participantes nao trouxer `OwnerIsAdmin`, o status de admin e inferido por
`/chat/find { wa_isGroup_admin: true }`. O array de participantes nunca vai para o cache (LGPD).

### Botoes

Ate 3 (resposta rapida, link, copiar). Aviso na tela ao misturar resposta com link/copiar
(o WhatsApp Web nao exibe a mensagem) e nota de que o WhatsApp pode descontinuar botoes.
Dois tetos de tamanho que eu tinha posto (25 no rotulo, 60 no rodape) eram numeros que a spec
NAO traz — troquei por tetos de sanidade sem alegar que vem do WhatsApp.

### Verificado

- 83 conferencias das regras de decisao (iniciar, enviar a um grupo, pre-voo, erros 463),
  34 da validacao de arquivos, 52 de links/busca/rascunho, 28 do cache contra Postgres real
  (o JSON do mapeamento entrando na RPC), 24 da sequencia exata das rotas em SQL — incluindo
  que o agendador nao reivindica nada do envio pelo navegador e que a reserva atomica segura
  o espacamento. `tsc` e `eslint` limpos.
- Tela conferida no navegador com dados falsos: selecao, contador, estimativa de duracao,
  piso de 60 s ao ligar marcar todos, dialogo com confirmacao digitada (botao travado com
  "3", liberado com "4"), caminho de erro (volta ao compositor sem perder nada), aviso da
  mistura de botoes. Achou e corrigiu um defeito: o seletor mostrava `resposta` em vez do
  rotulo.

### NAO verificado — precisa de teste real antes de confiar

As rotas nunca rodaram contra um Supabase nem uma uazapiGO de verdade (sem credenciais
locais). O que isso deixa em aberto:
- forma das consultas PostgREST nas rotas (testei a logica em SQL, nao o cliente);
- **V3**: `mentions: "all"` realmente marcar todos — e uma funcao de vitrine;
- **V4**: a listagem com `noParticipants: true` devolver `OwnerIsAdmin`;
- **V17**: botoes conviverem com `mentions: "all"`;
- o upload `multipart` no Worker e o bucket `group-assets`.
Rodar primeiro numa instancia de teste, com UM grupo so com numeros do operador.

### Pendencia de infraestrutura

O plano do Cloudflare (Free = 10 ms de CPU por invocacao; Paid = 30 s) nunca foi confirmado —
o servidor MCP do Cloudflare precisa de autorizacao. Isso importa: a rota de atualizar a
lista faz parse de JSON de ate 200 grupos por pagina. Se for Free, vale medir.

---

## 2026-10-23 — Modulo de grupos, fase 0 (alicerce)

Inicio do modulo de gerenciamento de grupos: listar, disparar mensagem em massa com
intervalo entre cada grupo, alterar nome/foto/descricao, gerenciar participantes — tudo
por instancia e agendavel. Esta entrada cobre so o alicerce; nenhuma tela de operacao
ainda. O plano completo tem 6 fases, com o disparo de mensagem como fase 1.

### Decisao de arquitetura: o agendador e nosso, nao o `/sender/*` da uazapi

O motor de campanha da uazapiGO parecia servir (tem `scheduled_for` e `delayMin/delayMax`
proprios, e custaria zero de Worker), mas tres pedidos centrais sao estruturalmente
impossiveis nele:
- **marcar todos**: `/sender/advanced` nao tem o campo `mentions`;
- **trocar nome/foto/descricao**: nao existe endpoint de campanha para isso;
- **remover participantes**: idem.
Alem de nao dar para editar nada depois de criada a campanha.

A duvida era o limite de CPU do Cloudflare, que ja estourou neste projeto. Verificado na
documentacao: **o limite e de CPU, nao de tempo de parede** — espera de I/O nao conta, e
request HTTP nao tem teto de duracao enquanto o cliente estiver conectado (so handler de
cron tem, 15 min). Ou seja, **dormir entre envios e de graca**. O incidente anterior veio
de materializar JSON grande (`delete ... .select('id')`), nao de demorar.

Aritmetica que saiu disso, com cron de 1 min e orcamento de 50 s por passada:
espacamento de 10 s = 5 envios/passada (50 grupos em ~10 min); de 60 s = 1 por passada,
**sem dormir nada** (50 grupos em ~50 min). O espacamento entre passadas vem do
`not_before` gravado em cada item, nao de queimar tempo de parede. Essa lentidao e o
recurso, nao a limitacao.

### Modelo de dados em quatro niveis (migration 015)

```
group_tasks        a campanha (instancia, alvos, espacamento, seguranca)
  group_task_steps     passos ordenados — cada um com seu tipo e agenda
    group_task_runs      uma ocorrencia (passo x data/hora)
      group_task_items     uma linha por (ocorrencia x grupo) — A FILA
```

O nivel de **steps** e o que faz "alteracoes diferentes e mensagens diferentes em dias
diferentes" caber: tres niveis expressariam "a mesma mensagem em N datas", mas nao "N
mensagens diferentes em offsets relativos" (as sequencias automatizadas).
Varias datas = `schedule_mode='absolute'` com `absolute_ats[]`. Sequencia =
`schedule_mode='offset'` com `offset_minutes` a partir de `starts_at`.

Os items sao materializados **tarde**, quando a ocorrencia vence: editar uma tarefa
agendada vira um UPDATE simples, e ocorrencias distantes nao ocupam linha.

### Travas que moram no banco, nao so na tela

- `check (spacing_seconds >= 5)` e `check (not mention_all or spacing_seconds >= 60)`.
  Marcar todos em muitos grupos e a acao com maior risco de banimento; a linha que viole
  isso nao consegue existir, venha de onde vier.
- `unique (run_id, group_jid)` + `unique (step_id, run_at)`: materializar duas vezes e
  impossivel.
- **Nao existe flag de "enviado" no nivel do lote.** Cada item e individualmente terminal,
  com lease proprio (`claimed_at`). E isso que faz uma passada interrompida no meio
  (deploy, abort, eviction) nao duplicar envio. `reclaim_stale_group_items()` devolve o
  que ficou preso, e `attempts >= 3` encerra em vez de reciclar para sempre.
- `claim_group_task_items()` faz UMA ida ao banco e ja devolve credenciais da instancia e
  os portoes `owner_is_admin`/`owner_can_send` — o Worker nao resolve servidor/token nem
  faz segunda consulta.

### Verificado de fato

Migration executada em Postgres real (PGlite) com 65 conferencias, incluindo os casos que
importam: as travas rejeitam mesmo, materializar duas vezes nao duplica, o espacamento sai
nos segundos certos, o lease devolve item preso, tarefa pausada nao e drenada, e uma
listagem sem avatar nao apaga o avatar ja guardado. Helper de botoes com mais 26
conferencias (inclusive recusa de `javascript:` e de `|` no rotulo).

### Botoes na mensagem (ate 3: resposta rapida, link, copiar)

Botoes nao sao campos na API: sao **strings codificadas** em `choices[]` separadas por
`|`. `lib/groups/buttons.ts` faz a codificacao a partir de um formulario tipado, porque um
`|` solto no texto do botao quebra a mensagem sem dar erro.
Dois avisos da propria spec ficaram registrados no codigo: (1) misturar botao de resposta
com link/copiar/ligar faz o WhatsApp Web exibir "Nao e possivel exibir esta mensagem";
(2) "os recursos de botoes interativos e listas podem ser descontinuados a qualquer
momento sem aviso previo" — campanha agendada para semanas a frente nao deve depender so
deles.
O teto de 3 e **trava nossa**, nao da API: a spec nao documenta maximo nenhum e os
exemplos dela chegam a mostrar 4. O limite de 3 e o do WhatsApp para botoes de resposta.

### Seguranca

- `middleware.ts`: `/groups` entrou em `ADMIN_ROUTES`. **Sem essa linha o modulo inteiro
  ficaria acessivel sem login.**
- Ganho de brinde no mesmo arquivo: `api/monitor/tick` nao estava excluido do `matcher`,
  entao o cron sem cookie pagava a construcao do cliente SSR e um `auth.getUser()` 720x por
  dia a toa — justamente na rota que disparava os alarmes de CPU. Excluido junto com
  `api/groups/scheduler` e `l/`.
- `lib/groups/install.ts` + banner na tela: migration nao aplicada vira aviso explicando o
  que fazer, em vez de 500. `withMissingColumnFallback` NAO cobre este caso — ele trata
  coluna faltando (PGRST204); tabela faltando e outro codigo.

### Nota sobre o `shadcn add`

O CLI gerou os cinco primitivos importando `from "cn"` em vez do alias do projeto, e
**instalou um pacote npm chamado `cn`** que nada aqui usa. Imports corrigidos para
`@/lib/utils` e o pacote removido. Vale conferir isso sempre que rodar o CLI.

Tambem nao foi adicionado o `calendar` do shadcn: ele traz o `react-day-picker` como
dependencia nova so para um formulario onde a pessoa digita a data.
`components/ui/datetime-field.tsx` faz o mesmo com `<input type=date>` + `<input type=time>`
e cuida da conversao hora local <-> ISO UTC, que e onde normalmente se erra.

### Pendencias

- **Aplicar a migration 015 no Supabase** (alem da 013 e 014, que seguem pendentes).
  Nada do modulo funciona antes disso — a tela avisa.
- Verificacao de interacao na tela ficou por fazer: o dev server local trava com o
  `write EOF` do Turbopack nesta maquina Windows (problema pre-existente, ja reproduzido
  no commit original). A renderizacao foi conferida; o clique nao.
- O proprio Next 16 avisa que o arquivo `middleware` esta descontinuado em favor de
  `proxy`. Nao mexi: e mudanca de convencao que afeta o arquivo inteiro.

---

## 2026-10-23 — Instancias excluidas no uazapiGO deixavam cadastro orfao no painel

Sintoma: duas instancias foram excluidas no painel do uazapiGO e continuaram aparecendo no sistema,
com status congelado, sem nenhuma forma de tirar da lista.

Causa: a reconciliacao do monitor so sabia comparar o que EXISTE nos dois lados. Um cadastro que
sumia da listagem do uazapiGO simplesmente nao era visitado — nenhum erro, nenhum aviso, ele
ficava para sempre.

### O que foi feito

**Migration 014** — coluna `instances.missing_since timestamptz` (NULL = presente na listagem).

**Deteccao automatica no monitor** (`app/api/monitor/tick/route.ts`)
- `reconcileServer` passou a devolver `matchedIds`: quais cadastros o servidor confirmou.
- `marcarSumidas()` carimba `missing_since` em quem nao foi confirmado por servidor NENHUM, e
  limpa a marca de quem reapareceu.
- **So roda quando `errors.length === 0`**: com uma consulta de servidor falhando, a listagem esta
  incompleta e marcar sumida seria falso positivo em cima de instancia boa.
- O resumo do tick ganhou `missing: [{ nome, desde }]` ao lado de `orphans` (que e o caso inverso:
  existe no uazapiGO e nao no painel).

**Exclusao e deliberada, nunca automatica** (`POST /api/instances/[id]/purge`)
- Apagar a linha leva junto `webhook_events`, `notifications_log` e `reconnect_tokens`
  (ON DELETE CASCADE). Por isso o monitor so marca; quem apaga e o operador.
- Antes de apagar, a rota reconfirma na hora via `listInstances()`:
  - ainda existe la → **409** (apagar o cadastro deixaria a instancia viva e cobrando, invisivel);
  - nao deu para confirmar → **503** (tente de novo);
  - `{ force: true }` passa por cima dos dois, para o caso de o servidor estar fora do ar de vez.
- Diferente do `DELETE /api/instances/[id]`, que e soft-delete + exclusao no uazapiGO.

**UI** (`components/admin/instance-table.tsx`, `components/admin/remove-missing-instance.tsx`)
- Badge ambar "sumiu do uazapiGO" ao lado do nome, com a data no title.
- Na coluna de acoes, quem sumiu troca Conectar/Desconectar por **Remover** — conectar uma
  instancia que nao existe mais nao faz sentido.
- Dialog de confirmacao lista o que vai junto sem volta e avisa que cliente e demais cadastros
  nao sao afetados.

### Verificacao
Pagina temporaria com 4 linhas falsas (2 marcadas como sumidas) no dev server: badge, botao e
dialog conferidos em tela. `tsc --noEmit` e `eslint` limpos nos arquivos tocados. Pagina e
`.env.local` temporarios removidos.

### Pendencias do lado do usuario
- Aplicar **migration 013** (purge limitado) e **014** no Supabase — sem a 014, `missing_since`
  nao existe e o `withMissingColumnFallback` descarta a marcacao silenciosamente.
- Depois da 014 aplicada, esperar um tick (2 min) para as duas instancias excluidas aparecerem
  marcadas, e entao remover pelo botao.

### Observacao fora do escopo (nao mexi)
O console do painel ja registrava, antes desta mudanca, um aviso do Base UI em toda linha da
tabela: `Button render={<Link/>}` (botoes "Ver" e "Conectar") monta um `<a>` onde o Base UI
espera um `<button>` nativo. Resolve-se com `nativeButton={false}` nesses dois pontos. E codigo
pre-existente e nao tem relacao com esta entrega — fica registrado para decisao.

---

## 2026-10-06 — Aviso de "webhook mudo" era falso alarme repetido a cada 2 min

Sintoma: `[monitor] ⚠️ Nenhuma entrega de webhook ha 1114 min` no log do Worker, a cada tick.

### Diagnostico (dados reais de producao)
O tick passou a reportar de ONDE vem a medicao e quais eventos o webhook assina:
```
"webhook": { "fonte": "batimento", "lastDeliveryMinutesAgo": 1128,
             "autofix": { "action": "ok", "eventos": ["leads", "connection"] } }
```
- `fonte: batimento` → migration 010 aplicada, medicao real (qualquer tipo de evento), nao o
  fallback ambiguo que so enxerga eventos de conexao.
- O webhook global assina **so `leads` e `connection`**. `connection` so dispara quando uma
  instancia muda de estado. Com as 6 instancias estaveis, zero entrega e o comportamento correto —
  o canal nao esta morto (entregou algo 18,8 h antes).

Ou seja: o limite de 1 h estava errado para uma assinatura que so cobre mudanca de estado.

### Correcoes
- **Sinal preciso novo (`missedChange`)**: se o monitor acabou de detectar mudanca de estado, havia
  um evento para o webhook entregar; se nada chegou nos ultimos 15 min, a entrega quebrou de fato.
  Vai como `error` no log. Esse e o detector confiavel — nao da falso positivo por ociosidade.
- Sinal por silencio puro virou dica de ultimo caso: limite de 1 h → 48 h, e o texto avisa que o
  silencio pode ser normal.
- O aviso fraco sai no maximo uma vez por hora (era a cada 2 min, 720x/dia).
- `webhook.fonte` e `autofix.eventos` passaram a sair no resumo do tick — foi o que permitiu fechar
  o diagnostico sem acesso ao banco.

### Efeito medido no mesmo tick
`healthy` voltou a `true`, a auto-correcao deixou de rodar em todo tick (`skipped_this_tick`),
a etapa `watchdog` caiu de 1012 ms para 66 ms e o tick inteiro de 2787 ms para 1438 ms.

### Observacoes
- `supabase/functions/notify-disconnect/` (codigo morto que reapareceu na copia para o D:) foi
  apagado do disco; no Git ja estava removido desde 27/08.
- Continua pendente aplicar `013_purge_limitado.sql`.

---

## 2026-10-05 — Cloudflare acusando estouro de CPU a cada 2 minutos

Sintoma: e-mails constantes do Cloudflare ("Worker exceeded CPU time limit", 100+ vezes em 24 h),
sempre em `POST /api/monitor/tick` — o endpoint que o cron chama a cada 2 min. Nos logs, 2 linhas de
erro de CPU por execucao do tick.

### O que estava caro no tick (todo tick, a cada 2 min)
1. **Limpeza devolvendo os ids apagados.** `purgeOldRecords` fazia
   `delete ... .select('id')` em `webhook_events` e `reconnect_tokens`: o banco devolvia a lista
   inteira de ids e o Worker gastava CPU montando e descartando esse JSON. Com a tabela crescendo,
   o custo cresce junto — bate com os alertas terem comecado semanas depois do cron entrar no ar.
   Pior: com backlog grande o DELETE podia estourar o statement_timeout do Supabase, nunca terminar
   e ser repetido a cada 2 minutos para sempre.
2. **`count: 'exact'` em `webhook_events`** a cada tick, so para alimentar um aviso, varrendo a
   tabela inteira (sem indice por `received_at`).
3. **Um UPDATE por instancia** so para carimbar `last_seen_at`, mesmo sem nada ter mudado.
   O campo de perfil entrava no UPDATE mesmo quando igual ao que ja estava gravado.
4. **Duas chamadas ao uazapiGO a cada tick** (`ensureGlobalWebhook`) para reconferir uma config que
   quase nunca muda.

### Correcoes
- **Migration 013**: funcoes `purge_webhook_events` / `purge_reconnect_tokens` apagam em lotes
  (teto de 2000) e devolvem **so a quantidade**; indices novos em `webhook_events (received_at)` e
  parcial para eventos sem instancia dona.
- Limpeza e auto-correcao do webhook passam a rodar **uma vez por hora** (primeira rodada da hora),
  nao a cada 2 min. Quando o webhook esta mudo, a auto-correcao roda assim mesmo.
- Contagem de orfaos virou **amostra de ate 25 linhas** (o aviso mostra "25+" no teto).
- Instancias sem novidade sao carimbadas em **uma unica gravacao em lote**; perfil e nome so entram
  no UPDATE quando realmente mudaram (a consulta passou a trazer `profile_name`/`profile_picture`
  para permitir a comparacao).
- Resumo do tick agora traz `etapasMs` (tempo por etapa): sem isso, "durationMs: 6000" nao diz qual
  parte custou.

### Pendente
- Aplicar `013_purge_limitado.sql` no Supabase. Ate la a limpeza horaria falha com PGRST202
  (funcao inexistente), registrado no log e **sem derrubar o tick** — o gasto alto de CPU ja sai do ar
  de qualquer forma, porque o `delete ... select` foi removido.
- **Confirmar o plano do Worker.** No plano gratuito o limite e de 10 ms de CPU por requisicao, e ai
  quase qualquer renderizacao do Next.js estoura; no plano pago sao 30 s. Se os e-mails continuarem
  depois desta mudanca, a saida e subir para o Workers Paid ou mover a reconciliacao para dentro do
  worker de cron (`workers/monitor-cron`), que e JS puro e nao carrega o Next.js.
- `supabase/functions/notify-disconnect/index.ts` reapareceu sem versionamento na copia para o D:
  (era codigo morto removido em 27/08). Nao commitado — confirmar se pode apagar.

---

## 2026-09-17 — Workflow "Coleta de Tokens" corrigido (pendencias de 2026-09-16)

Arquivo: `D:/repo-local/Agentes de IA/Coleta de Tokens.json` (backup do original em
`Agentes de IA/_backup-20260917/`). Historico detalhado no `WORKLOG.md` daquela pasta.

Resolve as 4 pendencias registradas em 2026-09-16 e mais uma encontrada ao ler o workflow:
1. **Bancos cruzados:** watermark passou a morar so no Supabase. No novo "Le Watermark" (Supabase)
   devolve a lista em JSON e "Busca Pendentes" (banco do n8n) usa via `jsonb_to_recordset`. Nenhuma
   query precisa enxergar os dois bancos; nenhuma tabela nossa fica no banco interno do n8n.
2. **Watermark pulando execucoes:** agora avanca ate o maior id DO LOTE (com `GREATEST`, nunca volta)
   e nao passa de execucao ainda em andamento do mesmo workflow.
3. **Execucoes com erro** (`error`/`crashed`/`canceled`) passam a ser contadas.
4. **`executed_at`** preenchido com `startedAt` da execucao.
5. **Erro da API mascarado:** "Busca Execucao" tem `onError: continueRegularOutput` — correto para
   404, mas fazia chave de API invalida parecer "execucao nao encontrada" e o coletor seguia sem
   gravar nada. Novo no "Confere Falha": 404 segue, qualquer outro erro interrompe a rodada.

Validado simulando rodadas contra bancos falsos do n8n e do Supabase (PGlite), com as queries e o
codigo reais do JSON: 21 checagens. Nao foi executado num n8n real.

Dashboard: instrucao de instalacao atualizada para os 3 nos que usam a credencial do Supabase.

---

## 2026-09-16 (2) — Gastos em reais e dolar + acesso aos dados de custo fechado para a API

Pedido: exibir os gastos de IA em R$ e US$. A cotacao vem da tabela `exchange_rate` (linha unica),
criada manualmente e atualizada por um fluxo do n8n que grava no Supabase.

### Mudanca de modelo de acesso (importante)
Apareceu `Agentes de IA/token-usage-schema-supabase-rls.sql`: RLS ligada SEM policy e grants revogados
de `anon` E `authenticated` — decisao explicita de que custo de tokens e dado interno, fora da API.
A primeira versao do dashboard lia com a sessao do admin (`authenticated`), entao **quebraria com
"permission denied"** assim que esse arquivo rodasse. Em vez de reabrir o acesso, alinhei com a decisao:
- **011 editada:** sem a policy `admins_select`, grants revogados de anon e authenticated em tabelas e
  views, funcoes executaveis so pela `service_role`. Remove a policy caso a versao anterior da 011
  ja tenha sido aplicada.
- **`lib/ai-costs.ts`** confere o login do admin e so entao le com `createServiceClient()`. O login e
  checado no codigo porque a service role ignora RLS.
- Testado no PGlite nas duas ordens (seu RLS antes e depois das migrations): anon e authenticated
  negados em tabelas, views, funcoes e `exchange_rate`; service_role le e executa; n8n grava a cotacao
  tanto pela credencial Supabase (service role) quanto pela Postgres (dono). 34 checagens.

### Migration 012 (`supabase/migrations/012_exchange_rate.sql`)
Registra a tabela identica a criada (`create table if not exists`, nao toca na cotacao gravada),
RLS sem policy e grants revogados. Sem isso a chave anon podia GRAVAR uma cotacao falsa.
**Se o fluxo de cotacao grava via HTTP Request na API REST com a chave anon, ele para depois da 012**
— trocar pela service role. O aviso de cotacao velha no painel denuncia isso.

### Cotacao (`lib/ai-costs-fx.ts`, puro, 11 testes)
- Faixa plausivel 1 a 20 reais por dolar. Fora dela NAO converte: abaixo de 1 e quase sempre a cotacao
  invertida (~0,19), que mostraria os gastos cinco vezes menores.
- Velha acima de 96 h (folga para fim de semana/feriado, quando a PTAX nao sai): converte, mas avisa.
- Tabela ausente ou erro de leitura: nunca derruba a secao; valores so em dolar.

### Interface
- Com cotacao valida, **real e o valor principal** e o dolar aparece embaixo (KPIs, tabela, custo por
  execucao); eixo do grafico em reais; tooltip e leitor de tela com as duas moedas.
- Avisos: cotacao desatualizada; cotacao fora do esperado (texto especifico quando parece invertida).
- Rodape informa a cotacao usada e que periodos passados usam a cotacao ATUAL, nao a do dia do gasto
  (a tabela guarda so a ultima cotacao).
- Verificado com dados ficticios nos 5 cenarios (ok, velha, invertida, absurda, sem cotacao) e em 375px.

### Para funcionar em producao
1. SQL Editor do Supabase: `011_token_usage.sql` e depois `012_exchange_rate.sql`.
2. Conferir se o fluxo de cotacao do n8n usa a service role ou a conexao Postgres.

---

## 2026-09-16 — Gastos com IA por agente no dashboard

Origem: `D:/repo-local/Agentes de IA/token-usage-schema-supabase.sql` + workflow
`Coleta de Tokens.json` (o escritor dessas tabelas).

### Migration 011 (`supabase/migrations/011_token_usage.sql`)
Mantem as 3 tabelas e os nomes das 3 views do script original, com correcoes:
1. **RLS ligada.** O original criava as tabelas sem RLS: no Supabase isso deixa leitura E escrita
   abertas para a chave anon via PostgREST — telefones dos clientes finais (`session_id`) e
   `model_pricing` regravavel. Agora so admin autenticado le; ninguem escreve via API.
   O coletor grava como dono das tabelas por conexao Postgres direta, entao nao e afetado.
2. **Views com `security_invoker`.** View comum roda com privilegio do dono e ignora RLS.
3. **Dia no fuso de Brasilia.** `date_trunc('day')` usava UTC: gasto das 21h-0h caia no dia seguinte.
4. **`executed_at`** (nova, opcional): tudo usa `coalesce(executed_at, collected_at)`. Ate o coletor
   preencher, o dia e o da coleta, nao o da execucao.
5. **Precos nao sao sobrescritos** ao reexecutar: so preenche modelo novo ou zerado.
6. **Funcoes `token_cost_por_agente` e `token_cost_diario`** para agregar no banco (somar no Next
   bateria no limite de 1000 linhas do PostgREST e mostraria total menor, sem erro).

Verificada no PGlite (Postgres 17 em WASM) com 27 checagens: idempotencia, custo exato, fuso,
intervalo semiaberto, modelo sem preco, anon bloqueado, UPDATE/INSERT via API bloqueados, view
respeitando RLS. O teste ficou no scratchpad da sessao, nao no repo.

### Dashboard
- `lib/ai-costs-period.ts` (puro, 19 testes) — periodos em Brasilia: mes atual (compara com o mesmo
  trecho do mes anterior, limitado em meses curtos), 7d e 30d (comparam com janela igual anterior).
- `lib/ai-costs.ts` — 3 RPCs em paralelo; detecta migration ausente (PGRST202/42883/42P01) e devolve
  `not_installed` em vez de quebrar o dashboard.
- `components/admin/ai-costs-section.tsx` — Server Component sem JS no cliente; filtro por link
  (`?gastos=mes|7d|30d`). KPIs (gasto + variacao, projecao do mes a partir do 3o dia ou media diaria,
  custo por execucao, tokens), grafico diario empilhado (top 5; acima disso top 4 + "Outros"), tabela
  por agente, alerta de **modelo sem preco** (total subestimado) e de **agente que parou de consumir**
  (gastou no periodo anterior e zero agora — costuma ser agente fora do ar).
- Verificado visualmente com dados ficticios (pagina temporaria, removida antes do commit) em 1024px
  e 375px: sem rolagem horizontal na pagina, tabela rola dentro do card, rotulos do eixo dentro do
  grafico. Estados vazio, erro e nao instalado conferidos.

### Fix colateral: recarga em rajada do dashboard
`components/admin/instance-status-live.tsx` chamava `router.refresh()` em TODO update de `instances`
(o comentario dizia "so status", mas o filtro era `undefined`). Com o monitor gravando todas as
instancias a cada 2 min, cada aba aberta recarregava a pagina inteira ~7 vezes seguidas. Agora so
recarrega se mudar coluna visivel (status, nome, telefone, cliente, ativo) e agrupa a rajada (800 ms).

### PENDENTE — problemas no workflow "Coleta de Tokens" (nao alterado, decisao do usuario)
1. **O cabecalho do SQL original manda mover "Atualiza Watermark" para o Supabase — isso quebra o
   coletor.** Essa query le `execution_entity`/`workflow_entity` e grava `token_usage_sync_state` no
   mesmo comando, e "Busca Pendentes" faz JOIN com `token_usage_sync_state`. As duas precisam do banco
   do n8n. So "Grava Uso" pode apontar para o Supabase; o watermark fica no banco do n8n.
2. **Watermark pula execucoes (subcontagem).** "Atualiza Watermark" grava `MAX(e.id)` de TODAS as
   execucoes finalizadas, nao do lote processado. Com o `LIMIT` de "Busca Pendentes", tudo alem do lote
   e pulado para sempre; execucoes que terminam entre as duas queries tambem. Correcao: limitar ao
   maior id do lote (`AND e.id <= <max id processado>`).
3. **`finished = true` ignora execucoes com erro** que ja tinham chamado o modelo: token gasto e nunca
   contado. Considerar `status in ('success','error')`.
4. **`executed_at` nao e preenchido.** Passar `startedAt` da execucao em "Extrai Tokens"/"Grava Uso".

### Para funcionar em producao
- Aplicar `011_token_usage.sql` no SQL Editor do Supabase (e 009/010, se ainda nao aplicadas).
- No n8n, apontar **apenas** "Grava Uso" para a connection string do Supabase.

---

## 2026-08-27 (2) — CAUSA RAIZ: migration 009 pendente quebrava TODA gravacao de status

Sintomas relatados: (a) conectou o WhatsApp numa instancia e o painel nao mudou; (b) renomeou uma
instancia no painel do uazapiGO e o nome nao mudou aqui.

**Causa raiz — uma so para os dois:**
```
Could not find the 'last_seen_at' column of 'instances' in the schema cache
```
A migration 009 nunca foi aplicada no Supabase. O PostgREST recusa a operacao INTEIRA quando um
campo do payload nao existe — e `last_seen_at` tinha entrado em TODOS os caminhos de escrita de
status: webhook, monitor e portal do cliente. Os tres falhavam.
O "Sincronizar" seguia funcionando por ser o unico caminho que nao toca nessa coluna.
Isso explica com precisao o padrao "so atualiza quando clico em Sincronizar".

O erro estava invisivel porque o update do caminho sem mudanca de status nao checava o retorno.
Dois ticks seguidos reportando `renamed: 2` foram a pista: se a gravacao tivesse funcionado, o
segundo tick mostraria zero.

**Correcoes desta rodada:**
- `lib/db-resilient.ts` — detecta a coluna ausente pela mensagem do PostgREST, remove do payload e
  repete, logando alto. Gravar o status sem o campo novo e muito melhor que nao gravar nada.
  Aplicado no webhook, monitor (status, drift, reparo de token), portal do cliente e
  `notifications_log` (onde `reason`/`scheduled_for` sofriam do mesmo mal).
- **Nome da instancia passa a ser sincronizado.** Sem mudanca de status o monitor so carimbava
  `last_seen_at`, entao renomear no uazapiGO nunca chegava. Perfil e foto idem.
  Confirmado em producao: `renamed: 2` -> `renamed: 0` no tick seguinte.
- **Reparo de token divergente no monitor**, igual ao que o sync ja fazia. O monitor casava
  instancia SO por token; se o token guardado divergia, a instancia ficava invisivel para o monitor
  E para o webhook (que tambem busca por token). Agora recupera pelo nome — apenas quando o nome e
  inequivoco dos dois lados — e corrige o token.
- **Novos sinais no tick:** `repaired`, `renamed`, `orphans` (existem no uazapiGO e nao no painel),
  `driftErrors` e `webhook.orphanEvents` (eventos que chegam e nao encontram dono — assinatura de
  token divergente).

**Licao:** nunca usar coluna nova em caminho critico sem fallback enquanto a migration for um passo
manual pendente. O modo de falha foi silencioso e total.

**AINDA PENDENTE — aplicar no Supabase:**
- `009_hibernated_and_alert_reliability.sql` — sem ela `hibernated` continua REJEITADO (falso
  verde) e `last_seen_at` segue sendo descartado a cada gravacao.
- `010_webhook_heartbeat.sql` — watchdog nao distingue canal morto de canal ocioso.

---

## 2026-08-27 — Instancia reconectou e o painel so atualizou no sync manual

**Sintoma:** cliente reconectou; o painel so refletiu quando o operador clicou em "Sincronizar".

**Causa 1 — o agendamento nao cumpria os 5 minutos.**
Os runs do GitHub Actions saiam de hora em hora, com lacunas de ate 7h30
(2026-08-26T23:51 -> 2026-08-27T07:22). O cron do GitHub e best-effort e descarta execucoes
sob carga; `*/5` na pratica nunca foi respeitado. A reconexao caiu numa lacuna.

**Correcao:** `workers/monitor-cron/` — worker dedicado com Cron Trigger do Cloudflare a cada
2 min, que so chama `POST /api/monitor/tick`. Cloudflare confirmou no deploy:
`Deployed server-uazapi-monitor-cron triggers / schedule: */2 * * * *`.
URL de disparo manual: https://server-uazapi-monitor-cron.leonardo-fce.workers.dev
O `monitor.yml` do GitHub virou backup de 30 em 30 min.
(O worker principal nao aceita cron porque o OpenNext exporta apenas o handler `fetch`.)

**Causa 2 — o webhook global segue sem entregar.**
`lastEventMinutesAgo` chegou a 2872 (47h). Mas o autofix novo reporta `action: "ok"`, ou seja,
a config esta correta: aponta para o receptor do painel, `enabled: true`, com o evento
`connection`. E `GET /globalwebhook/errors` volta vazio — o servidor nao registra falha de
entrega. Conclusao: ou o uazapiGO nao esta emitindo, ou simplesmente nao houve evento desde que
a config ficou correta. **O numero 2872 e retroativo e nao prova nada sobre o estado atual.**

**Melhorias implementadas nesta rodada:**
- **Auto-correcao do webhook global** no monitor: se estiver ausente, desativado, sem o evento
  `connection`, ou apontando para outro destino enquanto nada chega ha muito tempo, o monitor
  reconfigura e reconfere relendo do servidor. Preserva os eventos existentes e NAO sequestra
  config de terceiro que esteja saudavel. Mexe so no webhook GLOBAL — os por instancia
  continuam intocados. Desligavel com `MONITOR_AUTOFIX_WEBHOOK=false`.
- **Batimento do webhook** (migration 010 + tabela `webhook_heartbeat`): o watchdog media
  "tempo desde o ultimo evento connection", o que confunde canal morto com canal saudavel sem
  mudanca de estado. Agora o receptor registra a ultima entrega de QUALQUER tipo antes de
  filtrar, e o monitor reporta `lastDeliveryMinutesAgo` e `lastConnectionEventMinutesAgo`
  separados. Se a migration nao estiver aplicada, cai para o sinal antigo sem quebrar.
- Quando o webhook esta mudo, o monitor anexa os 5 erros mais recentes de
  `GET /globalwebhook/errors` ao resultado — responde POR QUE nao chega.

**Impacto pratico:** o pior caso de atraso caiu de "horas ate alguem clicar em Sincronizar"
para **2 minutos**, mesmo com o webhook completamente fora do ar.

**PENDENTE — as duas migrations ainda nao foram aplicadas no Supabase:**
- `009_hibernated_and_alert_reliability.sql` — sem ela o status `hibernated` continua sendo
  REJEITADO pelo banco e o painel mostra "conectado" para instancia parada (falso verde).
- `010_webhook_heartbeat.sql` — sem ela o watchdog nao distingue canal morto de canal ocioso.

---

## 2026-08-24 — Monitor ativo no ar (e a saga do 401)

**Estado final: funcionando.** Run manual retornou
`{"ok":true,"servers":1,"checked":7,"changed":0,"alerted":0,"webhook":{"healthy":true,
"lastEventMinutesAgo":31},"durationMs":6352}` — 7 instancias reconciliadas contra o uazapiGO
em 6,3s. Agendado a cada 5 min.

**Duas causas encadeadas, ambas invisiveis sem instrumentacao:**

1. `curl: (43) Failed sending HTTP request` — o valor do secret tinha espaco/quebra de linha,
   o que produz header HTTP invalido e o curl aborta antes de conectar. Workflow passou a
   limpar com `tr -d '[:space:]'`.
2. `HTTP 401` persistente — o passo de deploy usava `echo "$secret" | wrangler secret put`, e o
   `echo` acrescenta 
. Corrigido para `printf '%s'`. **Mas o 401 continuou.**
   Um diagnostico temporario por impressao digital (SHA-256 truncado dos dois lados) revelou:
   Worker esperava `3d729808`, agendador enviava `ee49b0ab`, ambos lendo o MESMO secret do
   GitHub. Causa real: o valor tem uma **quebra de linha no MEIO** — hex de 64 caracteres
   copiado de um terminal que quebrou a linha na exibicao. O workflow removia todo espaco
   (`tr`), o app so as pontas (`.trim()`), entao nunca coincidiam.

**Licao aplicada ao codigo:** `cleanSecret()` no monitor e `normalizeSecret()` no client uazapi
removem TODO espaco em branco, nao so das pontas. Secrets validos nao contem espaco, entao e
seguro — e torna o sistema tolerante a um erro de copia trivial de cometer e dificil de ver.
Aplicado tambem a UAZAPI_BASE_URL, UAZAPI_ADMIN_TOKEN e NEXT_PUBLIC_APP_URL, que estavam
sujeitos ao mesmo problema (URL malformada e header admintoken invalido — pode ter sido causa
de erros anteriores nao explicados).

O diagnostico por impressao digital foi removido apos cumprir o papel.

**Ainda pendente (acao manual):**
- Aplicar a migration 009 no Supabase — sem ela o status `hibernated` continua sendo rejeitado.
- Salvar o webhook global em /settings apontando para /api/webhook com o evento `connection`.
  O watchdog ja reporta `lastEventMinutesAgo: 31`, ou seja, o webhook ainda nao esta entregando.

---

## 2026-08-24 — Implementacao das melhorias da auditoria

Todos os itens levantados na auditoria (entrada abaixo) foram implementados em dois commits.

### Confiabilidade (commit 757f0c0)
- **hibernated**: migration 009 amplia o CHECK; `InstanceStatus` ganha o estado; badge laranja
  "Hibernada" na UI. Tipos duplicados de status em 4 arquivos foram unificados em `lib/uazapi/types`.
- **Monitor ativo** (`app/api/monitor/tick`): reconcilia via `/instance/all` em todos os servidores,
  alerta nas transicoes, reenvia pendentes, faz watchdog do webhook e aplica retencao.
  Protegido por `MONITOR_SECRET` (header `x-monitor-secret` ou query `?secret=`).
  Agendado por `.github/workflows/monitor.yml` a cada 5 min — Cron Trigger do Cloudflare NAO
  funciona porque o worker do OpenNext so exporta `fetch`
  (`node_modules/@opennextjs/cloudflare/dist/cli/templates/worker.js:15`).
- **lib/notifications.ts**: modulo compartilhado entre webhook e monitor. `after()` do next/server
  (equivalente a waitUntil), janela de silencio que ADIA em vez de descartar, cooldown de 30min,
  guarda de transicao correta, `recipient` gravado, remetente WhatsApp validado, token de
  reconexao reaproveitado.
- **Webhook**: valida status antes de gravar, compare-and-set contra corrida, 500 em erro de banco
  (para o uazapiGO fazer retry).
- **Portal do cliente**: `/api/connect/status` confirma na API quando o dado esta velho; queima os
  tokens ao conectar; `uazapi_token` nao vaza mais para client components.
- Timeout de 15s no client uazapi; contagem honesta no sync; multi-servidor em disconnect/delete/
  rename; canal `email` removido da API; Edge Function `notify-disconnect` deletada.

### Diagnostico (commit desta entrada)
- `GET /api/instances/[id]/health` — agrega 5 leituras em paralelo, cada secao isolada em
  `{data,error}` para que uma falha nao derrube o resto.
- Aba **Diagnostico** na pagina da instancia: cota de novas conversas (bloqueio 463), webhook do
  agente (somente leitura), proxy (intencao vs realidade + botao rotacionar IP) e fila de envio.
- Card **Saude do webhook global** em `/settings` (`GET /globalwebhook/errors`).
- `POST /api/instances/[id]/proxy` — unica escrita nova, e nao toca em webhook algum.

### Verificacao feita
- `npx tsc --noEmit` limpo. Lint mantido nos 12 erros pre-existentes (nenhum novo).
- Dev server: `/connect` renderiza sem erro de console apos as mudancas de props.
- `POST /api/monitor/tick` testado: 401 sem secret, 401 com secret errado, e com secret correto
  retorna o resumo estruturado degradando com elegancia quando o servidor uazapi esta inacessivel.
- Webhook testado: 400 em JSON invalido, 200 em evento nao-connection, 200 sem token.
- ⚠️ `npm run build` local falha com `write EOF` (Turbopack no Windows). **Pre-existente**:
  reproduzido identico no commit 1b988b6, sem nenhuma mudanca. O deploy roda no Ubuntu e passa.

### Acao manual necessaria antes de tudo funcionar
1. Aplicar a migration 009 no Supabase.
2. Criar os secrets no GitHub: `MONITOR_SECRET` (valor novo, aleatorio) e `MONITOR_URL`
   (`https://server.smartskillshub.com.br/api/monitor/tick`). Conferir que `NEXT_PUBLIC_APP_URL`
   existe — o deploy agora a envia como runtime secret.
3. Em `/settings`, salvar o webhook global apontando para
   `https://server.smartskillshub.com.br/api/webhook` com o evento `connection`.

---

## 2026-08-24 — Auditoria completa: backlog priorizado

Levantamento feito sobre o código + spec uazapiGO v2.1.1. Detalhe de cada item com arquivo:linha
está no historico da sessao; resumo priorizado abaixo.

### BUG CRITICO — status `hibernated` e rejeitado pelo banco (falso verde)
A spec define 4 estados: `disconnected | connecting | connected | hibernated`
("Sessao pausada, com credenciais preservadas"). Mas:
- `supabase/migrations/001_initial_schema.sql:22` — CHECK aceita so 3 estados.
- `lib/uazapi/types.ts:1` — `InstanceStatus` idem.
Quando uma instancia hiberna, o UPDATE do webhook E do sync falham por violacao de constraint.
O erro so vai para `console.error` → o painel continua mostrando "conectado" enquanto o agente
esta morto. Nem o botao Sincronizar corrige. Fix: migration alterando o CHECK + tipo TS + label na UI.

### P0 — Sem rede de segurança: 100% dependente do webhook
Nao existe cron/polling (`wrangler.toml` sem `[triggers]`). Se o webhook falhar (foi o que
aconteceu: `enabled:false`), o painel fica cego ate alguem clicar Sincronizar.
Agravante: `app/api/instances/sync/route.ts` atualiza status mas NAO dispara notificacao — nenhum
import de `sendDisconnectNotification`. O sync e cosmetico: cliente nunca recebe link de reconexao.
Detalhe tecnico: o worker do OpenNext exporta so `fetch` (ver
`node_modules/@opennextjs/cloudflare/dist/cli/templates/worker.js:15`), entao Cron Trigger do
Cloudflare nao chega no app. Caminho: endpoint protegido `/api/monitor/tick` + agendador externo
(GitHub Actions schedule, Supabase pg_cron ou cron-job.org).

### P0 — Notificacao pode ser morta no meio (sem waitUntil)
`app/api/webhook/route.ts:165` — `sendDisconnectNotification(...)` sem await e sem `ctx.waitUntil()`.
Faz 4 I/O depois da resposta. No Workers a promise pode ser cancelada: token de reconexao criado,
mensagem nao enviada, e sem registro em `notifications_log`. Falha 100% invisivel.

### P1 — Janela de silencio engole o alerta para sempre
`app/api/webhook/route.ts:195-202` — se cai na janela (default 23-7 UTC = 20h-04h BRT), faz `return`
antes do log. Sem fila, sem reprocessamento (nao ha cron). Desconectou 20:05 → ninguem sabe, nunca.
Justamente o horario mais comum de queda.

### P1 — Portal do cliente mostra status errado
`app/api/connect/status/route.ts` le so o banco. Com o webhook quebrado: cliente escaneia o QR,
conecta de verdade, e a tela continua "Desconectado". Ele reescaneia e abre chamado.
Fix: consultar `client.getStatus(token)` como fallback quando o registro esta velho.

### P1 — Outros bugs confirmados
- `sync/route.ts:146,167` — `Promise.allSettled` + filtro por `fulfilled` conta erro do banco como
  sucesso (query builder do supabase-js resolve com `{error}`, nao rejeita). O toast mente.
- `webhook/route.ts:163` — guarda de transicao usa `!== 'disconnected'`, entao `connecting →
  disconnected` (QR expirado) dispara alerta novo a cada tentativa frustrada. Spam no cliente.
- `webhook/route.ts:268` — insert em `notifications_log` nao preenche `recipient`; a coluna
  "Destinatario" em `/alerts` fica sempre vazia. Casos suprimidos nao geram log nenhum.
- Canal `email` retorna cedo sem enviar nem logar (`webhook/route.ts:192`), mas a API ainda aceita
  gravar `email` via PATCH (`instances/[id]/route.ts:146`). UI ja nao oferece.
- `supabase/functions/notify-disconnect/index.ts` e CODIGO MORTO e perigoso: ninguem o invoca, e os
  senders sao stubs com TODO que retornam `success: true` → marcaria entregas fantasma como enviadas.
- Multi-servidor quebrado em 3 rotas que usam o client global em vez de `getInstanceClient(id)`:
  `instances/[id]/disconnect/route.ts:39`, `instances/[id]/route.ts:100` (delete) e `:193` (rename).
- Alerta por WhatsApp usa outra instancia como remetente, sem filtrar por status conectado
  (`instances/[id]/page.tsx:70`). Se o servidor cai inteiro, o alerta tambem morre.
- Sem timeout em nenhuma chamada uazapi (`lib/uazapi/client.ts:24`).
- `reconnect_tokens.used_at` nunca e gravado; tokens seguem validos apos uso e nada limpa a tabela.
- Sem retention em `webhook_events` (cresce para sempre).
- Sem testes automatizados e sem Sentry.

### Features novas de maior valor (endpoints da spec ainda nao usados)
O painel usa 12 dos 132 paths. Prioridade:
1. `GET /instance/wa_messages_limits` (token) — detecta bloqueio de novas conversas (erro 463), a
   causa nº1 de "o agente parou" SEM desconexao. Retorna `can_send_new_messages`,
   `new_chat_message_capping{used_quota,total_quota,cycle_end}`, `reachout_timelock{active,until}`.
2. `GET /webhook/errors` (token) — SOMENTE LEITURA, nao viola a regra dos webhooks dos agentes.
   Mostra se o n8n do cliente esta devolvendo erro (`status_code`, `attempts`, `error`).
3. `GET /globalwebhook/errors` (admintoken) — health do proprio painel; teria pego o incidente atual.
4. `GET /webhook` (token, so GET) — exibir qual URL do n8n esta registrada e alertar se
   `enabled:false` ou se falta o evento que o agente precisa.
5. `GET /instance/proxy` — `mode` vs `effective_mode` + `fallback.active` revela instancia rodando
   fora do proxy contratado. `POST /instance/proxy` com `rotate_now:true` = recuperacao barata.
6. `GET /message/async` — fila do agente (`queue.pending`, `sessionReady`) detecta travamento.
7. `GET /instance/all` (JA chamado) traz de graca `isBusiness`, `plataform`, `current_presence`,
   `adminField01/02` — indicadores de saude sem nenhuma chamada nova.
8. `POST /instance/updateAdminFields` — carimbar client_id/workflow n8n na propria uazapi.
9. `POST /profile/name` e `/profile/image` — cliente arruma nome/foto sem pedir o celular.
10. `GET /chat/blocklist` + `POST /chat/block` — "o agente nao responde o fulano" costuma ser bloqueio.

---

## 2026-08-24 — Diagnóstico + fix: status de desconexão não atualizava sem sync manual

**Causa raiz (confirmada em produção)**
O webhook global no uazapiGO está com `enabled: false` e com a URL apontando para
`https://webhook-uaz.smartskillshub.com.br/uazapi` (receptor n8n dos agentes de IA), e não para o
receptor do painel (`https://server.smartskillshub.com.br/api/webhook`). Resultado: o uazapiGO não
entrega nenhum evento `connection` → o status só muda quando se clica "Sincronizar".

**Descobertas na spec (local e docs.uazapi.com v2.1.1 — idênticas neste ponto)**
- `POST /globalwebhook` NÃO aceita `enabled` no request (só `url`, `events`, `excludeMessages`,
  `addUrlEvents`, `addUrlTypesMessages`); o schema `Webhook` tem `enabled` default **false**.
  O app envia `enabled: true` fora do contrato — sem garantia de efeito.
- `POST /webhook` (por instância) SIM aceita `enabled` (e `action: add/update/delete`).
- O servidor em produção retorna **array** no `GET /globalwebhook` (a spec documenta objeto único)
  e tem o evento `leads`, ausente da spec → o build do servidor é mais novo que a doc.

**Implementado**
- `lib/uazapi/client.ts`: `getGlobalWebhook`/`setGlobalWebhook` normalizam resposta objeto|array
  para `GlobalWebhookResponse[]`; `setWebhook` (por instância) agora envia `enabled: true`.
- `app/api/webhook/global/route.ts`: GET retorna o primeiro webhook do array (a UI esperava objeto
  e mostrava "Não configurado"); POST agora **verifica após salvar** (re-GET) e devolve
  `{ config, warning }` — com aviso quando o servidor persistiu `enabled: false`.
- `app/(admin)/settings/global-webhook-form.tsx`: consome `{ config, warning }` (toast de alerta
  quando o webhook ficou desativado) e badge "Ativo" só com `enabled === true` explícito.
- Verificação: `npx tsc --noEmit` limpo; erros de lint restantes são pré-existentes.

**Arquitetura de webhooks (decisão do usuário, 2026-08-24 — REGRA PERMANENTE)**
- Os webhooks POR INSTÂNCIA pertencem aos agentes de IA no n8n: cada instância tem uma URL única
  cadastrada lá. O painel JAMAIS pode escrevê-los/sobrescrevê-los (já houve incidente: o sync
  antigo substituía todos pelos eventos `connection` — removido no commit 283523d).
  Blindagem aplicada: método `setWebhook` removido de `lib/uazapi/client.ts` (era código morto)
  com comentário de aviso; doc do sync corrigida.
- Os agentes de IA NÃO usam o webhook global. Ele fica livre para o painel:
  webhook global → `https://server.smartskillshub.com.br/api/webhook` só com evento `connection`.
- Hipótese para o `enabled: false` atual: desativação automática após falhas de entrega —
  conferir `GET /globalwebhook/errors`.
- Alertas de desconexão (`sendDisconnectNotification`) são fire-and-forget sem `waitUntil` — no
  Cloudflare Workers podem ser mortos após a resposta. Não afeta o update de status (que é awaited).
- ~~Deploy pendente~~ — commit `6cf788f` deployado com sucesso (run 32718182106, 1m42s).
  Receptor publico verificado ao vivo: `POST https://server.smartskillshub.com.br/api/webhook`
  responde 200 sem auth (evento != connection retorna cedo, sem escrita no banco).
- **Acao manual restante:** em `/settings`, salvar o webhook global apontando para
  `https://server.smartskillshub.com.br/api/webhook` com o evento `connection`.
  Se o toast avisar que ficou `enabled: false`, o servidor ignora o campo via API →
  plano B: ativar manualmente no servidor ou checar `GET /globalwebhook/errors`.

---

## 2026-08-24 — Clone do repositório no workspace

**O que foi feito**
- Repositório `https://github.com/leo-botelho/server-uazapi.git` clonado em `D:\repo-local\server-uazapi` (branch `main`, HEAD `1b988b6`).
- Criado este `WORKLOG.md` (não existia no repo).

**Estado do ambiente**
- `node_modules` ainda **não instalado**. Usar `npm install` (o repo tem `package-lock.json`, e o `postinstall` roda `scripts/patch-lockfile.js` que depende do lockfile npm — não usar pnpm aqui).
- Nenhum `.env.local` presente; variáveis listadas na seção "Configuração de Variáveis de Ambiente" do [PLANO.md](PLANO.md).

**Observações / pendências levantadas**
- `PLANO.md` está **desatualizado** (cabeçalho diz 2026-05-20; o repo tem commits até 2026-06-09). Ele ainda aponta como pendentes itens que já foram entregues — ver seção abaixo. Vale reconciliar o PLANO.md antes de puxar tarefas dele.
- `README.md` ainda é o boilerplate do `create-next-app`.
- `AGENTS.md` avisa: esta versão do Next.js (16.2.6) tem breaking changes em relação ao conhecimento pré-treinado — **ler `node_modules/next/dist/docs/` antes de escrever código**.

---

## Estado atual do projeto (levantado em 2026-08-24)

### Stack
Next.js 16.2.6 (App Router, Turbopack) · React 19.2.4 · TypeScript · Tailwind v4 · `@base-ui/react` (shadcn-style) · Supabase (Auth + Postgres + Realtime) · TanStack Query v5 · React Hook Form + Zod · Sonner.
Deploy: **Cloudflare Workers** via `@opennextjs/cloudflare` + `wrangler` (não Vercel), CI/CD por GitHub Actions (`.github/workflows/`).

### Convenções do projeto (do PLANO.md — respeitar)
- `@base-ui/react` usa `render={<Link href="..." />}` — **nunca** `asChild`.
- O arquivo precisa se chamar `middleware.ts` (não `proxy.ts`) — Edge runtime obrigatório no Cloudflare.
- Auth uazapiGO: header `admintoken: <admin_token>` para endpoints admin; `token: <instance_token>` para endpoints de instância.

### Estrutura
```
app/(admin)/   dashboard, clients, instances, servers, profile
app/(auth)/    login
app/api/       clients, instances, connect, webhook
app/connect/   portal público do cliente (+ /connect/[token])
lib/uazapi/    client.ts, types.ts — wrapper da API uazapiGO
supabase/      migrations/ (001..004) + functions/
uazapi-openapi-spec.yaml   spec completa da API uazapiGO v2.1 (610KB)
```

### Já entregue (por histórico de commits, além do MVP listado no PLANO.md)
- **P1 corrigido** — `lib/uazapi/client.ts` já usa `/instance/create` (commit `32f1c63`); o PLANO.md ainda lista esse bug como pendente. **Item obsoleto.**
- **P2 parcial** — alertas de desconexão e canal de alerta (`017088b`, `59ead9b`, `0e873b8`).
- **P3 feito** — Realtime de status no dashboard (`ba0ad99`).
- **P9 parcial** — webhook global implementado (`59ead9b`), com dois fixes depois: `enabled:false` nunca era enviado (`e4b4630`) e parser do webhook ajustado ao formato real do uazapiGO (`1b988b6`).
- Proxy automático por cidade do cliente, renomeado na UI para "cidade de conexão" (`3f61eca`, `6850f33`).
- Identidade visual Smart Skills aplicada (`0248d62`).

### Pendências principais (do PLANO.md, ainda válidas)
P4 abas da instância (webhook, proxy, privacidade, perfil WA, reset, limites) · P5 campanhas de disparo · P6 respostas rápidas · P7 logs e auditoria · P8 business/catálogo · P9 restante (reiniciar app, rotacionar admin token) · P10 Chatwoot · portal do cliente: página de status simples e email automático com link de reconexão.

---
