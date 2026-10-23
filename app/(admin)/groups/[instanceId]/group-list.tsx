'use client'

import { useMemo } from 'react'
import { Lock, Search, ShieldCheck, UsersRound } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { MAX_GRUPOS_NO_NAVEGADOR } from '@/lib/groups/limits'
import type { GrupoEmCache } from '@/lib/groups/cache'

/** Quantas linhas desenhar. Acima disso a pessoa refina a busca. */
const LIMITE_DE_LINHAS = 200

/** Tira acento e caixa: "Lançamento" casa com "lancamento". */
export function normalizarBusca(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Filtra por nome ou JID e, opcionalmente, só os grupos em que o número
 * conectado é admin. Pura, exportada para teste.
 */
export function filtrarGrupos(
  grupos: GrupoEmCache[],
  busca: string,
  somenteAdmin = false
): GrupoEmCache[] {
  const termo = normalizarBusca(busca)

  return grupos.filter((g) => {
    if (somenteAdmin && !g.owner_is_admin) return false
    if (!termo) return true
    return normalizarBusca(g.name ?? '').includes(termo) || g.group_jid.toLowerCase().includes(termo)
  })
}

export function GroupList({
  grupos,
  selecionados,
  busca,
  aoBuscar,
  somenteAdmin,
  aoMudarSomenteAdmin,
  aoAlternar,
  aoSelecionarVarios,
  aoLimpar,
  disabled,
}: {
  grupos: GrupoEmCache[]
  selecionados: Set<string>
  busca: string
  aoBuscar: (texto: string) => void
  somenteAdmin: boolean
  aoMudarSomenteAdmin: (valor: boolean) => void
  aoAlternar: (jid: string) => void
  /** Marca esses JIDs (substitui a seleção atual). */
  aoSelecionarVarios: (jids: string[]) => void
  aoLimpar: () => void
  disabled?: boolean
}) {
  const filtrados = useMemo(() => filtrarGrupos(grupos, busca, somenteAdmin), [grupos, busca, somenteAdmin])
  const visiveis = filtrados.slice(0, LIMITE_DE_LINHAS)

  // Só entram na seleção em massa os grupos onde o número pode falar.
  const selecionaveis = filtrados.filter((g) => g.owner_can_send)
  const noLimite = selecionados.size >= MAX_GRUPOS_NO_NAVEGADOR

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={busca}
          onChange={(e) => aoBuscar(e.target.value)}
          placeholder="Buscar grupo por nome…"
          className="pl-8"
          aria-label="Buscar grupo"
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="so-admin"
          checked={somenteAdmin}
          onCheckedChange={(v) => aoMudarSomenteAdmin(v === true)}
        />
        <label htmlFor="so-admin" className="cursor-pointer text-sm">
          Só os grupos em que sou admin
          <span className="ml-1 text-xs text-muted-foreground">
            ({grupos.filter((g) => g.owner_is_admin).length})
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {filtrados.length} {filtrados.length === 1 ? 'grupo' : 'grupos'}
          {(busca.trim() || somenteAdmin) && ` de ${grupos.length}`}
          {' · '}
          <strong className="text-foreground">{selecionados.size}</strong> selecionado{selecionados.size === 1 ? '' : 's'}
        </span>

        <span className="flex gap-3">
          <button
            type="button"
            className="hover:text-foreground hover:underline disabled:opacity-50"
            disabled={disabled || selecionaveis.length === 0}
            onClick={() => aoSelecionarVarios(selecionaveis.slice(0, MAX_GRUPOS_NO_NAVEGADOR).map((g) => g.group_jid))}
          >
            Selecionar {Math.min(selecionaveis.length, MAX_GRUPOS_NO_NAVEGADOR)}
          </button>
          <button
            type="button"
            className="hover:text-foreground hover:underline disabled:opacity-50"
            disabled={disabled || selecionados.size === 0}
            onClick={aoLimpar}
          >
            Limpar
          </button>
        </span>
      </div>

      {noLimite && (
        <p className="text-xs text-amber-400">
          O envio direto aceita até {MAX_GRUPOS_NO_NAVEGADOR} grupos por vez. Para mais que isso, use o agendamento.
        </p>
      )}

      <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {visiveis.length === 0 && (
          <li className="px-3 py-8 text-center text-sm text-muted-foreground">
            {grupos.length === 0
              ? 'Nenhum grupo carregado ainda.'
              : somenteAdmin && !grupos.some((g) => g.owner_is_admin)
                ? 'Nenhum grupo em que o número seja admin. Se isso parece errado, clique em Atualizar lista.'
                : 'Nenhum grupo encontrado.'}
          </li>
        )}

        {visiveis.map((g) => {
          const marcado = selecionados.has(g.group_jid)
          const semPermissao = !g.owner_can_send
          // Não deixa passar do teto, mas permite sempre desmarcar.
          const bloqueado = disabled || semPermissao || (!marcado && noLimite)

          return (
            <li key={g.group_jid}>
              <label
                className={`flex items-center gap-3 px-3 py-2 text-sm ${
                  bloqueado ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/40'
                }`}
              >
                <Checkbox
                  checked={marcado}
                  disabled={bloqueado}
                  onCheckedChange={() => aoAlternar(g.group_jid)}
                  aria-label={`Selecionar ${g.name ?? g.group_jid}`}
                />

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{g.name ?? '(sem nome)'}</span>
                  {g.participant_count !== null && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <UsersRound className="size-3" aria-hidden />
                      {g.participant_count}
                    </span>
                  )}
                </span>

                <span className="flex shrink-0 items-center gap-1">
                  {g.is_parent && <Badge variant="outline">comunidade</Badge>}
                  {semPermissao ? (
                    <Badge variant="outline" className="gap-1 text-amber-400" title="Grupo só de admin, e o número não é admin">
                      <Lock className="size-3" aria-hidden />
                      só admin
                    </Badge>
                  ) : g.owner_is_admin ? (
                    <Badge variant="outline" className="gap-1" title="O número conectado é admin deste grupo">
                      <ShieldCheck className="size-3" aria-hidden />
                      admin
                    </Badge>
                  ) : null}
                </span>
              </label>
            </li>
          )
        })}

        {filtrados.length > LIMITE_DE_LINHAS && (
          <li className="px-3 py-2 text-center text-xs text-muted-foreground">
            Mostrando {LIMITE_DE_LINHAS} de {filtrados.length}. Refine a busca para ver os outros.
          </li>
        )}
      </ul>
    </div>
  )
}
