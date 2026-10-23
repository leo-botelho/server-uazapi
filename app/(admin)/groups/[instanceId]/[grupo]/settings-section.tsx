'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import type { GrupoVivo, SecaoProps } from './tipos'
import { chamarApi, rotaDoGrupo } from '@/components/admin/groups/chamar-api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ConfiguracaoDoGrupo } from '@/lib/groups/gestao'

const QUEM_ADICIONA = { admin_add: 'Só admins', all_member_add: 'Todos os participantes' }

const TEMPORARIAS: Record<string, string> = {
  '0': 'Desligado', '1d': '24 horas', '7d': '7 dias', '90d': '90 dias',
}

/** A API devolve a duração em segundos; o seletor trabalha com 0/1d/7d/90d. */
function chaveDaDuracao(segundos: number): string {
  if (segundos <= 0) return '0'
  if (segundos <= 86_400) return '1d'
  if (segundos <= 604_800) return '7d'
  return '90d'
}

/**
 * Configurações do grupo: quem fala, quem edita, aprovação para entrar, quem
 * adiciona gente e mensagens temporárias.
 *
 * Cada mudança vai sozinha e o controle só muda quando a resposta volta com
 * sucesso — nada de interruptor que parece ligado e não está.
 */
export function SettingsSection({
  instanceId, groupjid, podeEditar, aoMudar, grupo,
}: SecaoProps & { grupo: GrupoVivo }) {
  const [pendente, setPendente] = useState<ConfiguracaoDoGrupo | null>(null)

  async function aplicar(configuracao: ConfiguracaoDoGrupo, valor: unknown, rotulo: string) {
    setPendente(configuracao)
    const r = await chamarApi(rotaDoGrupo(instanceId, 'settings'), { groupjid, configuracao, valor })
    setPendente(null)

    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }
    toast.success(`${rotulo} atualizado.`)
    aoMudar()
  }

  const travado = !podeEditar || pendente !== null

  const interruptor = (
    id: string, configuracao: ConfiguracaoDoGrupo, rotulo: string, ajuda: string, valor: boolean | null
  ) => (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{rotulo}</Label>
        <p className="text-xs text-muted-foreground">{ajuda}</p>
      </div>
      <Switch
        id={id}
        checked={valor === true}
        disabled={travado || valor === null}
        onCheckedChange={(v) => void aplicar(configuracao, v, rotulo)}
      />
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configurações</CardTitle>
        <CardDescription>Quem pode fazer o quê dentro do grupo.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {interruptor('c-announce', 'announce', 'Só admins enviam mensagens',
          'Os demais participantes só leem.', grupo.somenteAdminsFalam)}

        {interruptor('c-locked', 'locked', 'Só admins editam o grupo',
          'Nome, foto e descrição ficam travados para os outros.', grupo.somenteAdminsEditam)}

        {interruptor('c-join', 'joinApproval', 'Aprovar quem quer entrar',
          'Quem usa o link de convite só entra depois de um admin aprovar.', grupo.aprovacaoParaEntrar)}

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label>Quem adiciona participantes</Label>
            <p className="text-xs text-muted-foreground">Não controla quem edita o grupo — isso é a chave acima.</p>
          </div>
          <Select
            items={QUEM_ADICIONA}
            value={grupo.quemAdiciona ?? undefined}
            disabled={travado || grupo.quemAdiciona === null}
            onValueChange={(v) => v && void aplicar('memberAddMode', v, 'Quem adiciona')}
          >
            <SelectTrigger className="w-48" aria-label="Quem adiciona participantes"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(QUEM_ADICIONA).map(([v, rotulo]) => (
                <SelectItem key={v} value={v}>{rotulo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label>Mensagens temporárias</Label>
            <p className="text-xs text-muted-foreground">As mensagens somem depois do prazo.</p>
          </div>
          <Select
            items={TEMPORARIAS}
            value={chaveDaDuracao(grupo.mensagensTemporarias)}
            disabled={travado}
            onValueChange={(v) => v && void aplicar('ephemeral', v === '0' ? 0 : v, 'Mensagens temporárias')}
          >
            <SelectTrigger className="w-48" aria-label="Mensagens temporárias"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TEMPORARIAS).map(([v, rotulo]) => (
                <SelectItem key={v} value={v}>{rotulo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}
