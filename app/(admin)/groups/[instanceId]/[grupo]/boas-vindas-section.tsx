'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { HandHeart } from 'lucide-react'

import type { SecaoProps } from './tipos'
import { chamarApi, rotaDoGrupo } from '@/components/admin/groups/chamar-api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  ESPERA_MAXIMA_S, ESPERA_MINIMA_S, ESPERA_PADRAO_S, MAX_MENSAGEM, previaDaMensagem, validarRegra,
} from '@/lib/groups/boas-vindas'

interface Lida {
  regra: { enabled: boolean; message: string; delaySeconds: number } | null
  padrao: string
  recebidos7dias: number
}

/**
 * Mensagem de boas-vindas deste grupo.
 *
 * Desligada por padrão. Para funcionar, o evento `groups` precisa estar assinado no webhook
 * GLOBAL (Configurações) — o webhook por instância é dos agentes do n8n e nunca é tocado. A
 * mensagem não sai na hora: espera uns segundos (e junta quem entrou junto) e sai pelo
 * agendador, com o ritmo e as travas de sempre. Aparece em Agendamentos como "Boas-vindas: …".
 */
export function BoasVindasSection({ instanceId, groupjid, podeEditar }: SecaoProps) {
  const [lida, setLida] = useState<Lida | null>(null)
  const [pendente, setPendente] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ligada, setLigada] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [espera, setEspera] = useState<number | ''>(ESPERA_PADRAO_S)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(() => {
    let ativo = true

    chamarApi<Lida>(rotaDoGrupo(instanceId, 'boas-vindas'), { groupjid, acao: 'ler' }).then((r) => {
      if (!ativo) return
      if (!r.ok) {
        if (r.status === 503) setPendente(true)
        else setErro(r.erro)
        return
      }
      setLida(r.dados)
      setLigada(r.dados.regra?.enabled ?? false)
      setMensagem(r.dados.regra?.message ?? r.dados.padrao)
      setEspera(r.dados.regra?.delaySeconds ?? ESPERA_PADRAO_S)
    })

    return () => { ativo = false }
  }, [instanceId, groupjid])

  useEffect(() => carregar(), [carregar])

  const validada = validarRegra({ enabled: ligada, message: mensagem, delaySeconds: espera === '' ? Number.NaN : espera })

  const mudou = lida !== null && (
    ligada !== (lida.regra?.enabled ?? false) ||
    mensagem.trim() !== (lida.regra?.message ?? lida.padrao) ||
    espera !== (lida.regra?.delaySeconds ?? ESPERA_PADRAO_S)
  )

  async function salvar() {
    setSalvando(true)
    const r = await chamarApi(rotaDoGrupo(instanceId, 'boas-vindas'), {
      groupjid, acao: 'salvar', enabled: ligada, message: mensagem, delaySeconds: espera,
    })
    setSalvando(false)

    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }
    toast.success(ligada ? 'Boas-vindas ligadas neste grupo.' : 'Regra salva (boas-vindas desligadas).')
    carregar()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><HandHeart className="size-4" aria-hidden />Boas-vindas</CardTitle>
        <CardDescription>Uma mensagem para quem acabou de entrar no grupo. Desligada até você ligar.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {pendente && (
          <Alert className="border-amber-500/40">
            <AlertDescription>
              Falta aplicar a migration <code className="rounded bg-muted px-1.5 py-0.5">021_group_welcome.sql</code> no
              Supabase para usar as boas-vindas.
            </AlertDescription>
          </Alert>
        )}

        {erro && <Alert variant="destructive"><AlertDescription>{erro}</AlertDescription></Alert>}
        {!lida && !pendente && !erro && <Skeleton className="h-32 w-full" />}

        {lida && (
          <>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="bv-ligada">Enviar boas-vindas neste grupo</Label>
              <Switch id="bv-ligada" checked={ligada} disabled={!podeEditar || salvando} onCheckedChange={setLigada} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bv-mensagem">Mensagem</Label>
              <Textarea
                id="bv-mensagem"
                rows={4}
                value={mensagem}
                disabled={!podeEditar || salvando}
                onChange={(e) => setMensagem(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {[...mensagem.trim()].length}/{MAX_MENSAGEM} · <code>{'{{mencao}}'}</code> vira “@telefone” e marca quem
                entrou (ou “pessoal”, se o número estiver oculto ou forem muitos).
              </p>
              {mensagem.trim() && (
                <p className="rounded-md border border-border bg-muted/30 p-2 text-sm">
                  <span className="text-xs text-muted-foreground">Prévia: </span>
                  {previaDaMensagem(mensagem.trim())}
                </p>
              )}
              {!validada.ok && <p className="text-xs text-destructive">{validada.erro}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bv-espera">Esperar antes de enviar (segundos)</Label>
              <Input
                id="bv-espera"
                type="number"
                min={ESPERA_MINIMA_S}
                max={ESPERA_MAXIMA_S}
                className="w-28"
                value={espera}
                disabled={!podeEditar || salvando}
                onChange={(e) => setEspera(e.target.value === '' ? '' : Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                De {ESPERA_MINIMA_S} a {ESPERA_MAXIMA_S} s. Quem entra nesse intervalo recebe a MESMA mensagem, em vez de uma
                para cada pessoa.
              </p>
            </div>

            <Button disabled={!podeEditar || !mudou || !validada.ok || salvando} onClick={() => void salvar()}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>

            <Alert className="border-amber-500/40">
              <AlertDescription className="space-y-1 text-xs">
                <p>
                  <strong>Para funcionar</strong>, o evento <code>groups</code> precisa estar assinado no webhook global
                  (Configurações). O webhook de cada instância é dos agentes do n8n e não é alterado.
                </p>
                <p>
                  O painel só envia quando reconhece o evento como “alguém entrou”; se o formato for outro, nada é enviado.
                  {lida.recebidos7dias > 0
                    ? ` Nos últimos 7 dias, ${lida.recebidos7dias} ${lida.recebidos7dias === 1 ? 'pessoa recebeu' : 'pessoas receberam'} boas-vindas aqui.`
                    : ' Nenhuma boas-vindas enviada neste grupo nos últimos 7 dias.'}
                </p>
              </AlertDescription>
            </Alert>
          </>
        )}
      </CardContent>
    </Card>
  )
}
