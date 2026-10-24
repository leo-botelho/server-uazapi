'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { DoorOpen, Network, TriangleAlert, UsersRound } from 'lucide-react'

import { chamarApi, rotaDoGrupo } from '@/components/admin/groups/chamar-api'
import { ConfirmDialog } from '@/components/admin/groups/confirm-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  MAX_GRUPOS_POR_VINCULO, MAX_NOME_AO_CRIAR, MAX_PARTICIPANTES_AO_CRIAR,
  validarConvite, validarNomeDeComunidade, validarNovoGrupo,
} from '@/lib/groups/criar'

export interface GrupoSimples {
  jid: string
  nome: string
}

const paraRota = (instanceId: string, jid: string) => `/groups/${instanceId}/${jid.replace('@g.us', '')}`

// ─────────────────────────────────────────────────────────────────────────────
// Criar grupo
// ─────────────────────────────────────────────────────────────────────────────

function CriarGrupo({ instanceId }: { instanceId: string }) {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [telefones, setTelefones] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [criado, setCriado] = useState<{ jid: string | null; nome: string; participantes: number | null; pedidos: number } | null>(null)

  const v = nome.trim() || telefones.trim() ? validarNovoGrupo(nome, telefones) : null

  async function criar() {
    setOcupado(true)
    const r = await chamarApi<{
      grupo: { jid: string; nome: string; participantes: number | null } | null
      pedidos: number
    }>(rotaDoGrupo(instanceId, 'criar'), { nome, telefones, confirmar: true })
    setOcupado(false)
    setConfirmando(false)

    if (!r.ok) { toast.error(r.erro, { duration: 9000 }); return }

    setCriado({
      jid: r.dados.grupo?.jid ?? null,
      nome: r.dados.grupo?.nome ?? nome.trim(),
      participantes: r.dados.grupo?.participantes ?? null,
      pedidos: r.dados.pedidos,
    })
    setNome(''); setTelefones('')
    toast.success('Grupo criado.')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><UsersRound className="size-4" aria-hidden />Criar grupo</CardTitle>
        <CardDescription>Cria o grupo no WhatsApp com as pessoas que você colar. O número conectado vira admin.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Alert className="border-amber-500/40">
          <TriangleAlert className="text-amber-400" aria-hidden />
          <AlertTitle>Cuidado com quem você adiciona</AlertTitle>
          <AlertDescription>
            Adicionar à força quem não tem o seu número salvo é uma das maiores causas de denúncia e de banimento.
            Para muita gente, crie o grupo só com poucas pessoas e divulgue o link de convite.
          </AlertDescription>
        </Alert>

        <div className="space-y-1.5">
          <Label htmlFor="cg-nome">Nome do grupo</Label>
          <Input id="cg-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <p className="text-xs text-muted-foreground">{[...nome.trim()].length}/{MAX_NOME_AO_CRIAR}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cg-tel">Telefones (um por linha, ou copiados de uma planilha)</Label>
          <Textarea
            id="cg-tel"
            rows={6}
            value={telefones}
            onChange={(e) => setTelefones(e.target.value)}
            placeholder={'21 98765-4321\n(11) 99999-0000'}
          />
          <p className={`text-xs ${v && !v.ok ? 'text-destructive' : 'text-muted-foreground'}`}>
            {v === null
              ? `De 1 a ${MAX_PARTICIPANTES_AO_CRIAR} pessoas. Sem código do país, assumo Brasil (55).`
              : v.ok
                ? `${v.valor.participantes.length} ${v.valor.participantes.length === 1 ? 'pessoa reconhecida' : 'pessoas reconhecidas'}` +
                  (v.valor.ignorados.length > 0 ? ` · ${v.valor.ignorados.length} trecho(s) ignorado(s) por tamanho inválido` : '')
                : v.erro}
          </p>
        </div>

        <Button className="gap-2" disabled={!v || !v.ok || ocupado} onClick={() => setConfirmando(true)}>
          <UsersRound className="size-4" aria-hidden />
          Criar grupo
        </Button>

        {criado && (
          <Alert>
            <AlertTitle>“{criado.nome}” foi criado</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                {criado.participantes !== null
                  ? `${criado.participantes} participantes no grupo (você pediu ${criado.pedidos}).`
                  : `Você pediu ${criado.pedidos} participantes.`}
                {criado.participantes !== null && criado.participantes < criado.pedidos + 1 &&
                  ' Quem tem a privacidade fechada pode não ter sido adicionado: envie o link de convite a essas pessoas.'}
              </p>
              {criado.jid
                ? <Button size="sm" variant="outline" render={<Link href={paraRota(instanceId, criado.jid)} />} nativeButton={false}>Gerenciar o grupo</Button>
                : <p className="text-xs text-muted-foreground">Clique em “Atualizar lista” na tela de grupos para ele aparecer.</p>}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      <ConfirmDialog
        aberto={confirmando}
        aoMudar={setConfirmando}
        titulo="Criar este grupo?"
        descricao={`“${nome.trim()}”, com ${v && v.ok ? v.valor.participantes.length : 0} pessoas adicionadas de uma vez.`}
        confirmar="Criar grupo"
        ocupado={ocupado}
        aoConfirmar={() => void criar()}
      />
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrar por convite
// ─────────────────────────────────────────────────────────────────────────────

interface PrevaDoConvite {
  jid: string
  nome: string | null
  descricao: string | null
  participantes: number | null
  aprovacaoParaEntrar: boolean | null
}

function EntrarPorConvite({ instanceId }: { instanceId: string }) {
  const router = useRouter()
  const [convite, setConvite] = useState('')
  const [previa, setPrevia] = useState<PrevaDoConvite | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const v = convite.trim() ? validarConvite(convite) : null

  async function ver() {
    setBuscando(true)
    const r = await chamarApi<{ grupo: PrevaDoConvite }>(rotaDoGrupo(instanceId, 'entrar'), { convite, acao: 'ver' })
    setBuscando(false)
    if (!r.ok) { setPrevia(null); toast.error(r.erro, { duration: 9000 }); return }
    setPrevia(r.dados.grupo)
  }

  async function entrar() {
    setOcupado(true)
    const r = await chamarApi<{ grupo: { jid: string } | null }>(rotaDoGrupo(instanceId, 'entrar'), { convite, acao: 'entrar', confirmar: true })
    setOcupado(false)
    setConfirmando(false)
    if (!r.ok) { toast.error(r.erro, { duration: 9000 }); return }

    toast.success('O número entrou no grupo.')
    setConvite(''); setPrevia(null)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><DoorOpen className="size-4" aria-hidden />Entrar por convite</CardTitle>
        <CardDescription>Faz o número conectado entrar num grupo a partir do link. Você vê o grupo antes de confirmar.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ei-convite">Link ou código do convite</Label>
          <Input
            id="ei-convite"
            value={convite}
            placeholder="https://chat.whatsapp.com/…"
            onChange={(e) => { setConvite(e.target.value); setPrevia(null) }}
          />
          {v && !v.ok && <p className="text-xs text-destructive">{v.erro}</p>}
        </div>

        <Button variant="outline" disabled={!v || !v.ok || buscando} onClick={() => void ver()}>
          {buscando ? 'Consultando…' : 'Ver o grupo'}
        </Button>

        {previa && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <p className="font-semibold">{previa.nome ?? 'Grupo sem nome'}</p>
              <p className="text-sm text-muted-foreground">
                {previa.participantes !== null ? `${previa.participantes} participantes` : 'Número de participantes não informado'}
                {previa.aprovacaoParaEntrar && ' · entrada precisa de aprovação de um admin'}
              </p>
            </div>
            {previa.descricao && <p className="line-clamp-4 text-sm">{previa.descricao}</p>}
            <Button className="gap-2" onClick={() => setConfirmando(true)}>
              <DoorOpen className="size-4" aria-hidden />
              Entrar neste grupo
            </Button>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        aberto={confirmando}
        aoMudar={setConfirmando}
        titulo={`Entrar em “${previa?.nome ?? 'este grupo'}”?`}
        descricao="O número conectado passa a fazer parte do grupo e todos lá dentro podem ver o telefone dele. Sair depois também aparece para o grupo."
        confirmar="Entrar no grupo"
        ocupado={ocupado}
        aoConfirmar={() => void entrar()}
      />
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Comunidades
// ─────────────────────────────────────────────────────────────────────────────

function Comunidades({
  instanceId, comunidades, grupos,
}: {
  instanceId: string
  comunidades: GrupoSimples[]
  grupos: GrupoSimples[]
}) {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [comunidade, setComunidade] = useState('')
  const [acao, setAcao] = useState<'vincular' | 'desvincular'>('vincular')
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set())
  const [busca, setBusca] = useState('')
  const [confirmando, setConfirmando] = useState<'criar' | 'vinculo' | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const nomeV = nome.trim() ? validarNomeDeComunidade(nome) : null
  const visiveis = grupos.filter((g) => g.jid !== comunidade && g.nome.toLowerCase().includes(busca.trim().toLowerCase()))

  const alternar = (jid: string) =>
    setEscolhidos((atual) => {
      const novo = new Set(atual)
      if (novo.has(jid)) novo.delete(jid)
      else novo.add(jid)
      return novo
    })

  async function criar() {
    setOcupado(true)
    const r = await chamarApi(rotaDoGrupo(instanceId, 'comunidade'), { acao: 'criar', nome, confirmar: true })
    setOcupado(false); setConfirmando(null)
    if (!r.ok) { toast.error(r.erro, { duration: 9000 }); return }
    toast.success('Comunidade criada.')
    setNome('')
    router.refresh()
  }

  async function vincular() {
    setOcupado(true)
    const r = await chamarApi<{ mensagem: string; falhas: number }>(rotaDoGrupo(instanceId, 'comunidade'), {
      acao, comunidade, grupos: [...escolhidos], confirmar: true,
    })
    setOcupado(false); setConfirmando(null)
    if (!r.ok) { toast.error(r.erro, { duration: 9000 }); return }
    if (r.dados.falhas > 0) toast.warning(r.dados.mensagem, { duration: 9000 })
    else toast.success(r.dados.mensagem)
    setEscolhidos(new Set())
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Network className="size-4" aria-hidden />Comunidades</CardTitle>
        <CardDescription>Uma comunidade reúne grupos relacionados sob uma administração só. Só admin da comunidade vincula e desvincula.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Criar comunidade</h3>
          <div className="flex gap-2">
            <Input aria-label="Nome da comunidade" value={nome} placeholder="Nome da comunidade" onChange={(e) => setNome(e.target.value)} />
            <Button disabled={!nomeV || !nomeV.ok} onClick={() => setConfirmando('criar')}>
              Criar
            </Button>
          </div>
          {nomeV && !nomeV.ok && <p className="text-xs text-destructive">{nomeV.erro}</p>}
        </div>

        <div className="space-y-3 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Vincular ou desvincular grupos</h3>

          {comunidades.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma comunidade na lista deste número. Crie uma acima ou use “Atualizar lista” na tela de grupos.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="co-comunidade">Comunidade</Label>
                <select
                  id="co-comunidade"
                  value={comunidade}
                  onChange={(e) => { setComunidade(e.target.value); setEscolhidos(new Set()) }}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                >
                  <option value="">Escolha…</option>
                  {comunidades.map((c) => <option key={c.jid} value={c.jid}>{c.nome}</option>)}
                </select>
              </div>

              <div className="flex gap-1.5" role="group" aria-label="Ação">
                {(['vincular', 'desvincular'] as const).map((a) => (
                  <Button key={a} size="sm" variant={acao === a ? 'default' : 'outline'} aria-pressed={acao === a} onClick={() => setAcao(a)}>
                    {a === 'vincular' ? 'Vincular' : 'Desvincular'}
                  </Button>
                ))}
              </div>

              <Input aria-label="Buscar grupo" placeholder="Buscar grupo…" value={busca} onChange={(e) => setBusca(e.target.value)} />

              <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
                {visiveis.map((g) => (
                  <li key={g.jid}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                      <Checkbox checked={escolhidos.has(g.jid)} onCheckedChange={() => alternar(g.jid)} aria-label={g.nome} />
                      <span className="truncate">{g.nome}</span>
                    </label>
                  </li>
                ))}
                {visiveis.length === 0 && <li className="px-3 py-2 text-muted-foreground">Nenhum grupo.</li>}
              </ul>

              <p className={`text-xs ${escolhidos.size > MAX_GRUPOS_POR_VINCULO ? 'text-destructive' : 'text-muted-foreground'}`}>
                {escolhidos.size} selecionado(s) · até {MAX_GRUPOS_POR_VINCULO} por vez
              </p>

              <Button
                variant={acao === 'desvincular' ? 'destructive' : 'default'}
                disabled={!comunidade || escolhidos.size === 0 || escolhidos.size > MAX_GRUPOS_POR_VINCULO}
                onClick={() => setConfirmando('vinculo')}
              >
                {acao === 'vincular' ? 'Vincular' : 'Desvincular'} {escolhidos.size} {escolhidos.size === 1 ? 'grupo' : 'grupos'}
              </Button>
            </>
          )}
        </div>
      </CardContent>

      <ConfirmDialog
        aberto={confirmando === 'criar'}
        aoMudar={(v) => { if (!v) setConfirmando(null) }}
        titulo="Criar esta comunidade?"
        descricao={`“${nome.trim()}”. O número conectado vira o administrador.`}
        confirmar="Criar comunidade"
        ocupado={ocupado}
        aoConfirmar={() => void criar()}
      />

      <ConfirmDialog
        aberto={confirmando === 'vinculo'}
        aoMudar={(v) => { if (!v) setConfirmando(null) }}
        titulo={`${acao === 'vincular' ? 'Vincular' : 'Desvincular'} ${escolhidos.size} ${escolhidos.size === 1 ? 'grupo' : 'grupos'}?`}
        descricao={
          acao === 'vincular'
            ? 'Os grupos passam a fazer parte da comunidade e os participantes veem isso.'
            : 'Os grupos deixam a comunidade. Os participantes continuam nos grupos.'
        }
        confirmar={acao === 'vincular' ? 'Vincular' : 'Desvincular'}
        destrutivo={acao === 'desvincular'}
        ocupado={ocupado}
        aoConfirmar={() => void vincular()}
      />
    </Card>
  )
}

export function NovoGrupo({
  instanceId, comunidades, grupos,
}: {
  instanceId: string
  comunidades: GrupoSimples[]
  grupos: GrupoSimples[]
}) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <CriarGrupo instanceId={instanceId} />
        <EntrarPorConvite instanceId={instanceId} />
      </div>
      <Comunidades instanceId={instanceId} comunidades={comunidades} grupos={grupos} />
    </div>
  )
}
