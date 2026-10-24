'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { BoasVindasSection } from './boas-vindas-section'
import { BulkRemove } from './bulk-remove'
import { DangerSection } from './danger-section'
import { InfoSection } from './info-section'
import { InviteSection } from './invite-section'
import { ParticipantsSection } from './participants-section'
import { SettingsSection } from './settings-section'
import { SolicitacoesSection } from './solicitacoes-section'
import type { InfoViva } from './tipos'
import { chamarApi, rotaDoGrupo } from '@/components/admin/groups/chamar-api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * A tela de UM grupo.
 *
 * Os dados vêm AO VIVO da uazapiGO (`groups/info`), não do cache: quem abre um
 * grupo para agir sobre ele precisa da lista de participantes de agora, senão
 * removeria quem já saiu e perderia quem entrou. Os participantes nunca são
 * gravados no banco — ficam só nesta sessão.
 */
export function GroupManager({
  instanceId, groupjid, nomeInicial, souAdminNoCache,
}: {
  instanceId: string
  groupjid: string
  nomeInicial: string
  souAdminNoCache: boolean
}) {
  const [viva, setViva] = useState<InfoViva | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // Incrementar dispara uma nova leitura. `aoMudar` das seções faz isso depois de cada mudança.
  const [versao, setVersao] = useState(0)

  const recarregar = useCallback(() => setVersao((v) => v + 1), [])

  useEffect(() => {
    let ativo = true

    chamarApi<InfoViva>(rotaDoGrupo(instanceId, 'info'), { groupjid, convite: false }).then((r) => {
      if (!ativo) return
      if (r.ok) { setViva(r.dados); setErro(null) }
      else setErro(r.erro)
    })

    return () => { ativo = false }
  }, [instanceId, groupjid, versao])

  // Depois da leitura ao vivo, ela manda; antes, vale o que o cache sabia.
  const podeEditar = (viva?.grupo.euSouAdmin ?? souAdminNoCache) === true

  const comum = { instanceId, groupjid, podeEditar, aoMudar: recarregar }

  return (
    <div className="space-y-6">
      {erro && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível ler o grupo</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{erro}</p>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={recarregar}>
              <RefreshCw className="size-3.5" aria-hidden />
              Tentar de novo
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!viva && !erro && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      )}

      {viva && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <InfoSection
              // Remonta quando o valor salvo muda, para o formulário refletir o que ficou de fato.
              key={`${viva.grupo.nome}|${viva.grupo.descricao}`}
              {...comum}
              grupo={viva.grupo}
            />
            <SettingsSection {...comum} grupo={viva.grupo} />
            <InviteSection {...comum} linkInicial={viva.grupo.conviteDoGrupo} />
          </div>

          <div className="space-y-6">
            <ParticipantsSection {...comum} participantes={viva.participantes} />
            <BulkRemove {...comum} participantes={viva.participantes} />
            <SolicitacoesSection {...comum} exigeAprovacao={viva.grupo.aprovacaoParaEntrar} />
            <BoasVindasSection {...comum} />
            <DangerSection
              instanceId={instanceId}
              groupjid={groupjid}
              nomeDoGrupo={viva.grupo.nome ?? nomeInicial}
              souAdmin={podeEditar}
            />
          </div>
        </div>
      )}
    </div>
  )
}
