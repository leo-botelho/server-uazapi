'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Download, Loader2, Users } from 'lucide-react'

import { chamarApi, rotaDoGrupo } from '@/components/admin/groups/chamar-api'
import { Button } from '@/components/ui/button'
import {
  CABECALHO_DE_PARTICIPANTES, diaParaArquivo, linhasDeParticipantes, montarCsv,
} from '@/lib/groups/csv'
import type { Participante } from '@/lib/groups/gestao'

/** Entrega um texto ao navegador como arquivo. O `Blob` guarda o BOM do CSV como veio. */
function baixar(nome: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revogar na hora cancelaria o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Pausa entre um grupo e o próximo: só leitura, mas não há motivo para disparar tudo junto. */
const ESPERA_ENTRE_LEITURAS_MS = 1500

/**
 * Exportar em CSV: a lista de grupos (do cache) e os participantes dos grupos
 * selecionados (ao vivo).
 *
 * Os participantes são LIDOS grupo a grupo, um pedido por grupo, e o arquivo é montado aqui no
 * navegador: no plano Free do Cloudflare cada pedido tem 10 ms de CPU, e um grupo grande já
 * custa isso. Assim não há limite de grupos por exportação, e nada de pessoal fica guardado.
 */
export function ExportButtons({
  instanceId, nomes, selecionados,
}: {
  instanceId: string
  nomes: Map<string, string>
  selecionados: string[]
}) {
  const [baixandoGrupos, setBaixandoGrupos] = useState(false)
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null)

  async function exportarGrupos() {
    setBaixandoGrupos(true)
    try {
      const res = await fetch(`/api/instances/${instanceId}/groups/export`)
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(corpo.error ?? `Falha ao exportar (${res.status})`)
      }
      baixar(`grupos-${diaParaArquivo()}.csv`, await res.text())
      toast.success('Lista de grupos baixada.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível exportar.', { duration: 8000 })
    } finally {
      setBaixandoGrupos(false)
    }
  }

  async function exportarParticipantes() {
    const linhas: (string | number | boolean | null)[][] = []
    const falhas: string[] = []

    setProgresso({ feitos: 0, total: selecionados.length })

    for (const [i, jid] of selecionados.entries()) {
      const nome = nomes.get(jid) ?? jid
      const r = await chamarApi<{ participantes: Participante[] }>(rotaDoGrupo(instanceId, 'info'), { groupjid: jid, convite: false })

      if (r.ok) linhas.push(...linhasDeParticipantes(nome, jid, r.dados.participantes))
      else falhas.push(`${nome}: ${r.erro}`)

      setProgresso({ feitos: i + 1, total: selecionados.length })
      if (i < selecionados.length - 1) await new Promise((res) => setTimeout(res, ESPERA_ENTRE_LEITURAS_MS))
    }

    setProgresso(null)

    if (linhas.length === 0) {
      toast.error(falhas[0] ?? 'Nenhum participante encontrado.', { duration: 8000 })
      return
    }

    baixar(`participantes-${diaParaArquivo()}.csv`, montarCsv(CABECALHO_DE_PARTICIPANTES, linhas))
    toast.success(
      `${linhas.length} participantes de ${selecionados.length - falhas.length} grupo(s) baixados.`,
      falhas.length > 0 ? { description: `Não foi possível ler: ${falhas.join(' · ')}`, duration: 12000 } : undefined
    )
  }

  const lendo = progresso !== null

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" disabled={baixandoGrupos || lendo} onClick={() => void exportarGrupos()}>
          {baixandoGrupos ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
          Baixar lista de grupos (CSV)
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={selecionados.length === 0 || baixandoGrupos || lendo}
          onClick={() => void exportarParticipantes()}
        >
          {lendo ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Users className="size-3.5" aria-hidden />}
          {lendo
            ? `Lendo ${progresso.feitos}/${progresso.total}…`
            : `Baixar participantes dos selecionados (${selecionados.length})`}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Telefone é dado pessoal (LGPD): use só para o fim combinado e não compartilhe o arquivo. Em grupos que
        escondem o número, a coluna de telefone fica vazia.
      </p>
    </div>
  )
}
