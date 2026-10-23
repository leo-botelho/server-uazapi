import type { Participante } from '@/lib/groups/gestao'

/** O que `POST .../groups/info` devolve sobre o grupo, já em português. */
export interface GrupoVivo {
  jid: string
  nome: string | null
  descricao: string | null
  somenteAdminsFalam: boolean | null
  somenteAdminsEditam: boolean | null
  aprovacaoParaEntrar: boolean | null
  quemAdiciona: 'admin_add' | 'all_member_add' | null
  /** 0 = desligado; senão a duração em segundos (86400, 604800, 7776000). */
  mensagensTemporarias: number
  euSouAdmin: boolean | null
  conviteDoGrupo: string | null
}

export interface InfoViva {
  grupo: GrupoVivo
  participantes: Participante[]
}

/** Props comuns às seções da tela de um grupo. */
export interface SecaoProps {
  instanceId: string
  groupjid: string
  /** Podemos editar? (somos admin). Sem isso os controles ficam travados. */
  podeEditar: boolean
  /** Recarrega o grupo ao vivo depois de uma mudança. */
  aoMudar: () => void
}
