# WORKLOG — server-uazapi

Histórico de trabalho do projeto. **Entrada mais recente no topo.**
Registrar aqui toda implementação, fix e decisão técnica relevante ao final de cada sessão.

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
