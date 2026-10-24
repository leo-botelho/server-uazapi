'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, ExternalLink, Link2, Power, Trash2 } from 'lucide-react'

import { chamarApi } from '@/components/admin/groups/chamar-api'
import { ConfirmDialog } from '@/components/admin/groups/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatarEmBrasilia } from '@/components/ui/datetime-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ROTULO_DO_TIPO_DE_LINK, TIPOS_DE_LINK, validarAlvo, validarSlug, type TipoDeLink,
} from '@/lib/groups/links-curtos'

interface Link {
  id: string
  slug: string
  kind: TipoDeLink
  target_url: string
  label: string | null
  active: boolean
  clicks: number
  last_click_at: string | null
  created_at: string
}

const EXEMPLO: Record<TipoDeLink, string> = {
  youtube: 'https://www.youtube.com/watch?v=…',
  instagram: 'https://www.instagram.com/seu.perfil',
  whatsapp_grupo: 'https://chat.whatsapp.com/…',
  whatsapp_conversa: '21 98765-4321',
}

/**
 * Links curtos (`/l/<slug>`): o que o WhatsApp consegue clicar, com contagem.
 *
 * Servem para YouTube e Instagram (que abrem no app do celular, com queda para o
 * site) e para convites de grupo e conversa (que já abrem o app, mas aqui ganham
 * contagem de cliques e podem ser desligados se o link vazar).
 */
export function ShortLinks({ baseUrl }: { baseUrl: string }) {
  const [links, setLinks] = useState<Link[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, setPendente] = useState(false)
  const [versao, setVersao] = useState(0)

  const [tipo, setTipo] = useState<TipoDeLink>('youtube')
  const [alvo, setAlvo] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [rotulo, setRotulo] = useState('')
  const [slug, setSlug] = useState('')
  const [criando, setCriando] = useState(false)
  const [apagando, setApagando] = useState<Link | null>(null)

  const recarregar = useCallback(() => setVersao((v) => v + 1), [])

  useEffect(() => {
    let ativo = true

    fetch('/api/groups/links')
      .then(async (res) => {
        const corpo = (await res.json()) as { links?: Link[]; error?: string; migracaoPendente?: boolean }
        if (res.status === 503 && corpo.migracaoPendente) {
          if (ativo) setPendente(true)
          return []
        }
        if (!res.ok) throw new Error(corpo.error ?? `Falha (${res.status})`)
        return corpo.links ?? []
      })
      .then((lista) => { if (ativo) { setLinks(lista); setErro(null) } })
      .catch((e: unknown) => { if (ativo) setErro(e instanceof Error ? e.message : 'Não foi possível carregar.') })

    return () => { ativo = false }
  }, [versao])

  const enderecoDoLink = (s: string) => `${baseUrl}/l/${s}`
  const enderecoParaCopiar = (s: string) => `${baseUrl || window.location.origin}/l/${s}`

  // Conferência na hora, só para dar o motivo; a rota valida de novo.
  const problemaDoAlvo = alvo.trim() ? validarAlvo(tipo, alvo, mensagem) : null
  const problemaDoSlug = slug.trim() ? validarSlug(slug) : null
  const bloqueado = !alvo.trim() || (problemaDoAlvo !== null && !problemaDoAlvo.ok) || (problemaDoSlug !== null && !problemaDoSlug.ok)

  async function copiar(s: string) {
    try {
      await navigator.clipboard.writeText(enderecoParaCopiar(s))
      toast.success('Link copiado.')
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.')
    }
  }

  async function criar() {
    setCriando(true)
    const r = await chamarApi<{ link: { slug: string } }>('/api/groups/links', {
      tipo, alvo, mensagem, rotulo, slug,
    })
    setCriando(false)

    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }

    toast.success('Link criado.')
    setAlvo(''); setMensagem(''); setRotulo(''); setSlug('')
    recarregar()
  }

  async function alternar(l: Link) {
    const r = await chamarApi(`/api/groups/links/${l.id}`, { ativo: !l.active }, 'PATCH')
    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }
    toast.success(l.active ? 'Link desativado: já não abre.' : 'Link reativado.')
    recarregar()
  }

  async function apagar(l: Link) {
    const r = await chamarApi(`/api/groups/links/${l.id}`, {}, 'DELETE')
    setApagando(null)
    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }
    toast.success('Link apagado.')
    recarregar()
  }

  if (pendente) {
    return (
      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle>Links curtos</CardTitle>
          <CardDescription>
            Falta aplicar a migration <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">017_short_links.sql</code>{' '}
            no SQL Editor do Supabase. Ela é idempotente.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-4" aria-hidden />
          Links curtos com contagem de cliques
        </CardTitle>
        <CardDescription>
          Um endereço https curto para colar na mensagem. No celular, YouTube e Instagram tentam abrir o app;
          se não abrir, vai para o site. A prévia que o WhatsApp monta não conta como clique.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo do link">
            {TIPOS_DE_LINK.map((t) => (
              <Button key={t} type="button" size="sm" variant={tipo === t ? 'default' : 'outline'} aria-pressed={tipo === t} onClick={() => setTipo(t)}>
                {ROTULO_DO_TIPO_DE_LINK[t]}
              </Button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sl-alvo">{tipo === 'whatsapp_conversa' ? 'Telefone' : 'Endereço de destino'}</Label>
            <Input id="sl-alvo" value={alvo} placeholder={EXEMPLO[tipo]} onChange={(e) => setAlvo(e.target.value)} />
            {problemaDoAlvo && !problemaDoAlvo.ok && <p className="text-xs text-destructive">{problemaDoAlvo.erro}</p>}
            {problemaDoAlvo?.ok && tipo === 'whatsapp_conversa' && (
              <p className="text-xs text-muted-foreground">Vai para {problemaDoAlvo.url}</p>
            )}
          </div>

          {tipo === 'whatsapp_conversa' && (
            <div className="space-y-1.5">
              <Label htmlFor="sl-msg">Mensagem inicial (opcional)</Label>
              <Input id="sl-msg" value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sl-rotulo">Nome para você (opcional)</Label>
              <Input id="sl-rotulo" value={rotulo} maxLength={120} placeholder="Ex.: Aula 3 — turma de março" onChange={(e) => setRotulo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sl-slug">Final do link (opcional)</Label>
              <Input id="sl-slug" value={slug} maxLength={40} placeholder="aula3" onChange={(e) => setSlug(e.target.value)} />
              {problemaDoSlug && !problemaDoSlug.ok
                ? <p className="text-xs text-destructive">{problemaDoSlug.erro}</p>
                : <p className="text-xs text-muted-foreground">Vazio: o painel sorteia um.</p>}
            </div>
          </div>

          <Button className="gap-2" disabled={bloqueado || criando} onClick={() => void criar()}>
            <Link2 className="size-4" aria-hidden />
            {criando ? 'Criando…' : 'Criar link curto'}
          </Button>
        </div>

        {erro && !links && (
          <Alert variant="destructive"><AlertDescription>{erro}</AlertDescription></Alert>
        )}

        {!links && !erro && <Skeleton className="h-24 w-full" />}

        {links && links.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum link curto ainda.</p>
        )}

        {links && links.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {links.map((l) => (
              <li key={l.id} className="space-y-1.5 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.label ?? `/l/${l.slug}`}</span>
                  <Badge variant="outline">{ROTULO_DO_TIPO_DE_LINK[l.kind]}</Badge>
                  {!l.active && <Badge variant="destructive">Desativado</Badge>}
                  <span className="ml-auto text-sm">
                    <strong>{l.clicks}</strong> {l.clicks === 1 ? 'clique' : 'cliques'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Input readOnly value={enderecoDoLink(l.slug)} onFocus={(e) => e.target.select()} aria-label="Link curto" className="h-8" />
                  <Button type="button" size="icon-sm" variant="outline" aria-label="Copiar link" onClick={() => void copiar(l.slug)}><Copy /></Button>
                  <Button type="button" size="icon-sm" variant="outline" aria-label="Abrir o destino" render={<a href={l.target_url} target="_blank" rel="noopener noreferrer" />} nativeButton={false}><ExternalLink /></Button>
                  <Button type="button" size="icon-sm" variant="outline" aria-label={l.active ? 'Desativar link' : 'Reativar link'} aria-pressed={!l.active} onClick={() => void alternar(l)}><Power /></Button>
                  <Button type="button" size="icon-sm" variant="ghost" className="text-destructive" aria-label="Apagar link" onClick={() => setApagando(l)}><Trash2 /></Button>
                </div>

                <p className="truncate text-xs text-muted-foreground">
                  → {l.target_url}
                  {l.last_click_at && ` · último clique em ${formatarEmBrasilia(l.last_click_at)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ConfirmDialog
        aberto={apagando !== null}
        aoMudar={(v) => { if (!v) setApagando(null) }}
        titulo="Apagar este link curto?"
        descricao="Quem ainda tiver o link passa a cair em “link não encontrado”, e a contagem de cliques se perde. Para só desligar, use Desativar."
        confirmar="Apagar"
        destrutivo
        aoConfirmar={() => { if (apagando) void apagar(apagando) }}
      />
    </Card>
  )
}
