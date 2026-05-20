# Plano: server-uazapi — Painel de Gerenciamento uazapiGO

> Atualizado em 2026-05-20 com base no OpenAPI spec real de https://docs.uazapi.com/openapi-bundled.json (v2.1.0)

---

## Contexto

Aplicação Next.js 16 + Supabase + Cloudflare Workers para gerenciar instâncias WhatsApp via uazapiGO v2.  
Deploy automático via GitHub Actions → `wrangler deploy`.

**Repositório:** `D:/repo-local/server-uazapi`  
**URL produção:** configurada no Cloudflare

---

## Stack Tecnológico (implementado)

| Camada | Tecnologia |
|--------|-----------|
| Framework | Next.js 16.2.6 App Router (Turbopack) |
| UI | Tailwind v4 + @base-ui/react + shadcn-style components |
| Banco | Supabase Postgres + Auth + Realtime |
| Deploy | Cloudflare Workers via @opennextjs/cloudflare 1.19.11 |
| CI/CD | GitHub Actions → `wrangler deploy` |
| Auth admin | Supabase Auth (email/senha) |

**Atenção de convenção:**
- `@base-ui/react` usa `render={<Link href="..." />}` — **nunca** `asChild`
- `middleware.ts` deve se chamar assim (não `proxy.ts`) — Edge runtime obrigatório para Cloudflare

---

## Schema do Banco (migrations aplicadas)

```sql
-- 001_initial_schema.sql
clients (id, name, email, phones[], active, created_at, updated_at)
instances (id, client_id FK, uazapi_token, name, status,
           phone_connected, profile_name, profile_picture,
           alert_channel (email|whatsapp|n8n),
           alert_config jsonb,
           silence_start time, silence_end time,
           last_disconnected_at, active, created_at, updated_at)
webhook_events (id, instance_id FK, event_type, payload jsonb, received_at)
reconnect_tokens (id, instance_id FK, token, expires_at, used_at)
notifications_log (id, instance_id FK, channel, status, sent_at, error)

-- 002_servers.sql
servers (id, name, url, admin_token, active, created_at)
-- instances.server_id FK → servers

-- 003_admin_profiles.sql
admin_profiles (id FK auth.users, full_name, uazapi_server_url,
                uazapi_admin_token, created_at, updated_at)

-- 004_admin_profiles_trigger.sql
-- trigger on_auth_user_created → auto-cria linha em admin_profiles
```

---

## Autenticação uazapiGO

```
Header para endpoints admin:   admintoken: <admin_token>
Header para endpoints instância: token: <instance_token>
```

---

## API uazapiGO v2.1 — Referência Completa

### 🔑 Admininstração (8 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/instance/create` | Criar instância — body: `name*`, `adminField01`, `adminField02` |
| `GET` | `/instance/all` | Listar todas as instâncias (retorna token, status, phone, profileInfo) |
| `POST` | `/instance/updateAdminFields` | Atualizar `adminField01`/`adminField02` |
| `GET` | `/globalwebhook` | Ver webhook global configurado |
| `POST` | `/globalwebhook` | Configurar webhook global — body: `url*`, `events*[]`, `excludeMessages`, `addUrlEvents`, `addUrlTypesMessages` |
| `GET` | `/globalwebhook/errors` | Ver últimos erros do webhook global |
| `POST` | `/admin/restart` | Reiniciar a aplicação uazapiGO |
| `POST` | `/admin/token/rotate` | Rotacionar o admin token |

**Eventos disponíveis (webhook):** `connection`, `history`, `messages`, `messages_update`, `newsletter_messages`, `call`, `contacts`, `presence`, `groups`, `labels`, `chats`, `chat_labels`, `blocks`, `sender`

> ⚠️ **Bug no código atual:** `lib/uazapi/client.ts` usa `/instance/init` mas o endpoint correto é `/instance/create`. Precisa corrigir.

---

### 📱 Instância (10 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/instance/connect` | Conectar — body: `phone` (pairing code se informado), `browser`, `systemName`, `proxy_managed_country`, `proxy_managed_state`, `proxy_managed_city` |
| `POST` | `/instance/disconnect` | Desconectar |
| `POST` | `/instance/reset` | Reiniciar runtime sem desconectar |
| `GET` | `/instance/status` | Status atual (status, phone, profileInfo, lastDisconnection) |
| `GET` | `/instance/wa_messages_limits` | Limites atuais de novas conversas |
| `POST` | `/instance/updateInstanceName` | Renomear — body: `name*` |
| `DELETE` | `/instance` | Deletar instância |
| `GET` | `/instance/privacy` | Ver configurações de privacidade |
| `POST` | `/instance/privacy` | Alterar privacidade — campos: `groupadd`, `last`, `status`, `profile`, `readreceipts`, `online`, `calladd` (valores: `all\|contacts\|contact_blacklist\|none`) |
| `POST` | `/instance/presence` | Presença — body: `presence: available\|unavailable` |
| `POST` | `/instance/updateDelaySettings` | Delay entre mensagens async |

---

### 🌐 Proxy (3 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `GET` | `/instance/proxy` | Ver proxy ativo |
| `POST` | `/instance/proxy` | Configurar proxy |
| `GET` | `/proxy-managed/cities` | Listar cidades disponíveis (param: `country=br`) |

---

### 👤 Perfil (2 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/profile/name` | Alterar nome do perfil WhatsApp |
| `POST` | `/profile/image` | Alterar foto do perfil WhatsApp |

---

### 📤 Enviar Mensagem (11 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/send/text` | Texto — body: `number*`, `text*`, `linkPreview`, `linkPreviewTitle`, `linkPreviewDescription` |
| `POST` | `/send/media` | Mídia (imagem, vídeo, áudio, documento) |
| `POST` | `/send/contact` | Cartão vCard |
| `POST` | `/send/location` | Localização geográfica |
| `POST` | `/message/presence` | Atualização de presença (digitando…) |
| `POST` | `/send/status` | Status/stories |
| `POST` | `/send/menu` | Menu interativo (botões, carrossel, lista, enquete) |
| `POST` | `/send/carousel` | Carrossel de mídia com botões |
| `POST` | `/send/location-button` | Solicitar localização do usuário |
| `POST` | `/send/request-payment` | Solicitar pagamento |
| `POST` | `/send/pix-button` | Botão PIX |

---

### ⏳ Mensagem Async (3 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `GET` | `/message/async` | Consultar fila async |
| `DELETE` | `/message/async` | Limpar fila async |
| `POST` | `/instance/updateDelaySettings` | Configurar delay entre mensagens |

---

### 🔍 Ações na Mensagem e Buscar (8 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/message/download` | Baixar arquivo de uma mensagem |
| `POST` | `/message/find` | Buscar mensagens em um chat |
| `POST` | `/message/history-sync` | Solicitar histórico sob demanda |
| `POST` | `/message/markread` | Marcar mensagens como lidas |
| `POST` | `/message/react` | Enviar reação |
| `POST` | `/message/delete` | Apagar para todos |
| `POST` | `/message/edit` | Editar mensagem enviada |
| `POST` | `/message/pin` | Fixar/desafixar mensagem |

---

### 💬 Chats (10 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/chat/delete` | Deletar chat |
| `POST` | `/chat/archive` | Arquivar/desarquivar |
| `POST` | `/chat/ephemeral` | Mensagens temporárias |
| `POST` | `/chat/read` | Marcar como lido/não lido |
| `POST` | `/chat/mute` | Silenciar |
| `POST` | `/chat/pin` | Fixar/desafixar |
| `POST` | `/chat/find` | Buscar chats com filtros |
| `POST` | `/chat/notes` | Notas internas |
| `POST` | `/chat/notes/refresh` | Recarregar notas |
| `POST` | `/chat/notes/edit` | Editar notas |

---

### 👥 Contatos (6 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `GET` | `/contacts` | Lista todos os contatos |
| `POST` | `/contacts/list` | Listar com paginação |
| `POST` | `/contact/add` | Adicionar contato |
| `POST` | `/contact/remove` | Remover contato |
| `POST` | `/chat/details` | Detalhes completos do contato/chat |
| `POST` | `/chat/check` | Verificar se número está no WhatsApp |

---

### 🚫 Bloqueios (2 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/chat/block` | Bloquear/desbloquear |
| `GET` | `/chat/blocklist` | Listar bloqueados |

---

### 🏷️ Etiquetas (4 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/chat/labels` | Gerenciar labels de um chat |
| `POST` | `/label/edit` | Criar/editar/deletar etiqueta |
| `GET` | `/labels` | Buscar todas as etiquetas |
| `POST` | `/labels/refresh` | Recarregar etiquetas do WhatsApp |

---

### 👥 Grupos e Comunidades (19 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/group/create` | Criar grupo |
| `POST` | `/group/info` | Info do grupo |
| `POST` | `/group/inviteInfo` | Info por código de convite |
| `POST` | `/group/join` | Entrar por código |
| `POST` | `/group/leave` | Sair |
| `GET/POST` | `/group/list` | Listar grupos (GET simples / POST com filtros) |
| `POST` | `/group/resetInviteCode` | Resetar código de convite |
| `POST` | `/group/updateAnnounce` | Permissões de envio |
| `POST` | `/group/updateJoinApproval` | Aprovação de entrada |
| `POST` | `/group/updateMemberAddMode` | Quem pode adicionar membros |
| `POST` | `/group/updateDescription` | Atualizar descrição |
| `POST` | `/group/ephemeral` | Mensagens temporárias |
| `POST` | `/group/updateImage` | Atualizar imagem |
| `POST` | `/group/updateLocked` | Permissão de edição |
| … + 4 mais | — | Gerência de membros e admins |

---

### 📡 Newsletters e Canais (26 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/newsletter/create` | Criar canal |
| `GET` | `/newsletter/list` | Listar inscritos |
| `POST` | `/newsletter/info` | Info do canal |
| `POST` | `/newsletter/follow` | Seguir |
| `POST` | `/newsletter/unfollow` | Deixar de seguir |
| `POST` | `/newsletter/messages` | Buscar mensagens |
| `POST` | `/newsletter/messages/edit` | Editar mensagem |
| `POST` | `/newsletter/messages/delete` | Deletar mensagem |
| `POST` | `/newsletter/delete` | Deletar canal |
| `POST` | `/newsletter/picture` | Atualizar foto |
| `POST` | `/newsletter/name` | Atualizar nome |
| `POST` | `/newsletter/description` | Atualizar descrição |
| `POST` | `/newsletter/settings` | Configurações |
| `POST` | `/newsletter/search` | Pesquisar canais públicos |
| `POST` | `/newsletter/admin/invite` | Convidar admin |
| `POST` | `/newsletter/admin/accept` | Aceitar convite |
| `POST` | `/newsletter/admin/remove` | Remover admin |
| `POST` | `/newsletter/admin/revoke` | Revogar convite |
| `POST` | `/newsletter/owner/transfer` | Transferir dono |
| … + 7 mais | — | Reações, mute, subscribe, updates |

---

### 🔔 Webhooks e SSE (4 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `GET` | `/webhook` | Ver webhook da instância |
| `POST` | `/webhook` | Configurar — body: `url*`, `events[]`, `id` (update), `enabled`, `excludeMessages`, `addUrlEvents` |
| `GET` | `/webhook/errors` | Ver últimos erros do webhook local |
| `GET` | `/sse` | Server-Sent Events em tempo real |

---

### 📣 Mensagem em Massa / Sender (7 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/sender/simple` | Criar campanha — body: `numbers*[]`, `type*`, `folder`, `delayMin*`, `delayMax*`, `scheduled_for*`, `text`, `linkPreview`, mídia, etc. |
| `POST` | `/sender/advanced` | Campanha avançada (controle fino) |
| `POST` | `/sender/edit` | Controlar campanha (pausar/retomar/cancelar) |
| `POST` | `/sender/cleardone` | Limpar mensagens enviadas |
| `DELETE` | `/sender/clearall` | Limpar toda a fila |
| `GET` | `/sender/listfolders` | Listar campanhas |
| `POST` | `/sender/listmessages` | Listar mensagens de uma campanha |

---

### ⚡ Respostas Rápidas (2 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/quickreply/edit` | Criar/editar/deletar resposta rápida |
| `GET` | `/quickreply/showall` | Listar todas |

---

### 🏢 Business / Catálogo (8 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/business/get/profile` | Obter perfil comercial |
| `GET` | `/business/get/categories` | Categorias de negócios |
| `POST` | `/business/update/profile` | Atualizar perfil comercial |
| `POST` | `/business/catalog/list` | Listar produtos |
| `POST` | `/business/catalog/info` | Info de um produto |
| `POST` | `/business/catalog/delete` | Deletar produto |
| `POST` | `/business/catalog/show` | Mostrar produto |
| `POST` | `/business/catalog/hide` | Ocultar produto |

---

### 📞 Chamadas (2 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/call/make` | Iniciar chamada de voz |
| `POST` | `/call/reject` | Rejeitar chamada recebida |

---

### 🤝 Integração Chatwoot (2 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `GET` | `/chatwoot/config` | Obter configuração |
| `PUT` | `/chatwoot/config` | Atualizar configuração |

---

### 🧩 CRM (2 endpoints)

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/instance/updateFieldsMap` | Atualizar campos personalizados de leads |
| `POST` | `/chat/editLead` | Editar informações de lead |

---

## Status do Projeto

### ✅ Implementado (MVP)

| Feature | Rota/Arquivo |
|---------|-------------|
| Auth admin (Supabase Auth) | `app/(auth)/login/` + middleware |
| CRUD Clientes | `app/(admin)/clients/` + `/api/clients/` |
| CRUD Instâncias | `app/(admin)/instances/` + `/api/instances/` |
| Sincronizar instâncias do uazapiGO | `POST /api/instances/sync` + botão na UI |
| Dashboard com status | `app/(admin)/dashboard/` |
| Webhook receptor (`connection`) | `POST /api/webhook` |
| Perfil admin (URL + token servidor) | `app/(admin)/profile/` |
| Servers management | `app/(admin)/servers/` |
| Portal cliente (busca por telefone) | `app/connect/` |
| QR code / pairing code | `app/api/connect/qr|pair|status` |
| Link de reconexão com token | `app/api/instances/[id]/reconnect-token` |
| Deploy CI/CD | `.github/workflows/deploy.yml` |
| Runtime secrets Cloudflare | `wrangler secret put` no deploy |
| Auto-create admin_profiles | trigger `004` + auto-upsert no GET |

---

### 🔴 Pendente — Próximas Features

#### P1 — Correção crítica
- [ ] **Bug:** `lib/uazapi/client.ts` usa `/instance/init` mas o endpoint correto é `/instance/create`
  - Arquivo: `lib/uazapi/client.ts` linha `createInstance`
  - Fix: mudar `/instance/init` → `/instance/create`

#### P2 — Alertas de desconexão (impacto alto)
- [ ] Disparar alerta quando `webhook_events.event_type = 'connection'` e `status = 'disconnected'`
- [ ] Canal: email (Supabase Edge Function ou n8n)
- [ ] Canal: WhatsApp (`POST /send/text` via instância master)
- [ ] Canal: n8n webhook (URL configurável por instância)
- [ ] Template: nome do cliente + link de reconexão
- [ ] Janela de silêncio configurável (ex: 23h–7h)
- [ ] Tabela `notifications_log` para rastrear envios

#### P3 — Realtime no Dashboard
- [ ] Supabase Realtime na tabela `instances` → atualizar status sem refresh
- [ ] Cards animados: connected/disconnected/connecting

#### P4 — Instância detalhe completo
- [ ] Página `/instances/[id]` já existe — adicionar:
  - [ ] Aba "Webhook" — ver + configurar via `GET/POST /webhook`
  - [ ] Aba "Proxy" — ver + configurar via `GET/POST /instance/proxy`
  - [ ] Aba "Privacidade" — `GET/POST /instance/privacy`
  - [ ] Aba "Perfil WA" — `POST /profile/name` + `POST /profile/image`
  - [ ] Botão "Reset runtime" → `POST /instance/reset`
  - [ ] Ver limites de conversas → `GET /instance/wa_messages_limits`

#### P5 — Campanhas de Disparo
- [ ] Interface para criar campanha simples (`POST /sender/simple`)
- [ ] Painel de controle de campanhas (pausar/retomar/cancelar via `POST /sender/edit`)
- [ ] Listar campanhas (`GET /sender/listfolders`) e mensagens (`POST /sender/listmessages`)
- [ ] Limpar filas

#### P6 — Respostas Rápidas
- [ ] CRUD de respostas rápidas (`POST /quickreply/edit`, `GET /quickreply/showall`)
- [ ] Interface em `/instances/[id]` ou seção própria

#### P7 — Logs e Auditoria
- [ ] Tabela de eventos (`webhook_events`) com filtros: instância, tipo, período
- [ ] Ver erros de webhook (`GET /globalwebhook/errors`, `GET /webhook/errors`)

#### P8 — Business / Catálogo
- [ ] Ver/editar perfil de negócios por instância
- [ ] Gerenciar produtos do catálogo

#### P9 — Configurações Globais
- [ ] Interface para configurar webhook global (`GET/POST /globalwebhook`)
- [ ] Selecionar quais eventos monitorar
- [ ] Botão "Reiniciar aplicação" (`POST /admin/restart`)
- [ ] Rotacionar admin token (`POST /admin/token/rotate`)

#### P10 — Integração Chatwoot
- [ ] Configurar Chatwoot por instância (`GET/PUT /chatwoot/config`)

---

## Área do Cliente (Portal Público) — Status

### ✅ Implementado
- Busca instância por telefone → `GET /api/connect/lookup`
- QR code → `POST /api/connect/qr`
- Pairing code → `POST /api/connect/pair`
- Status polling → `GET /api/connect/status`
- Link de reconexão direto via token → `app/connect/[token]/`

### 🔴 Pendente
- [ ] Página de status simples (sem reconexão) para o cliente acompanhar
- [ ] Email automático com link de reconexão ao desconectar (depende de P2)

---

## Configuração de Variáveis de Ambiente

### Build-time (GitHub Actions `env:`)
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_APP_URL
SUPABASE_SERVICE_ROLE_KEY   ← também precisa ser runtime secret
UAZAPI_BASE_URL              ← também precisa ser runtime secret
UAZAPI_ADMIN_TOKEN           ← também precisa ser runtime secret
```

### Runtime (Cloudflare Worker secrets — `wrangler secret put`)
```
SUPABASE_SERVICE_ROLE_KEY
UAZAPI_BASE_URL
UAZAPI_ADMIN_TOKEN
```
> O deploy.yml já configura os secrets automaticamente após cada deploy.

---

## Verificação / Como Testar

1. **Configurar perfil:** `/profile` → URL + Admin Token do servidor uazapiGO → Salvar
2. **Sincronizar instâncias:** `/instances` → "Sincronizar uazapiGO" → instâncias existentes importadas
3. **Nova instância:** `/instances/new` → nome + cliente → cria no uazapiGO + salva no banco
4. **Portal cliente:** `/connect` → digitar telefone → QR ou pairing code → escanear
5. **Desconexão manual:** desconectar no painel → webhook `connection` chega → status atualiza
6. **Link reconexão:** `/api/instances/[id]/reconnect-token` → URL com token → `/connect/[token]`
