# WORKLOG — server-uazapi

Histórico de trabalho do projeto. **Entrada mais recente no topo.**
Registrar aqui toda implementação, fix e decisão técnica relevante ao final de cada sessão.

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
- Repositório `https://github.com/leo-botelho/server-uazapi.git` clonado em `C:\Users\raque\dev\server-uazapi` (branch `main`, HEAD `1b988b6`).
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
