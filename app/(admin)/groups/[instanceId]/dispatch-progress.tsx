'use client'

import { CheckCircle2, CircleDashed, Loader2, OctagonX, TimerReset, XCircle } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { EstadoDoEnvio, ResultadoDoGrupo } from './use-dispatch'

function Icone({ r }: { r: ResultadoDoGrupo }) {
  switch (r.estado) {
    case 'enviado':  return <CheckCircle2 className="size-4 shrink-0 text-emerald-400" aria-label="Enviado" />
    case 'falhou':   return <XCircle className="size-4 shrink-0 text-destructive" aria-label="Falhou" />
    case 'enviando': return <Loader2 className="size-4 shrink-0 animate-spin text-sky-400" aria-label="Enviando" />
    default:         return <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-label="Aguardando" />
  }
}

/**
 * Progresso por grupo durante e depois do envio.
 */
export function DispatchProgress({
  estado,
  nomes,
  aoParar,
  aoSelecionarFalhas,
  aoNovo,
}: {
  estado: EstadoDoEnvio
  /** JID → nome do grupo. */
  nomes: Map<string, string>
  aoParar: () => void
  /** Seleciona só os grupos que falharam, para reenviar. */
  aoSelecionarFalhas: (jids: string[]) => void
  aoNovo: () => void
}) {
  const entradas = Object.entries(estado.progresso)
  const total = entradas.length
  const enviados = entradas.filter(([, r]) => r.estado === 'enviado').length
  const falhas = entradas.filter(([, r]) => r.estado === 'falhou')
  const processados = enviados + falhas.length

  const enviando = estado.fase === 'enviando'
  const pct = total === 0 ? 0 : Math.round((processados / total) * 100)

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {enviando ? 'Enviando…' : estado.fase === 'concluido' ? 'Envio concluído' : 'Envio interrompido'}
          </span>
          <span className="text-muted-foreground">
            {processados} de {total}
          </span>
        </div>
        <Progress value={pct} />

        {enviando && estado.esperaRestanteMs !== null && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TimerReset className="size-3.5" aria-hidden />
            Próximo grupo em {Math.ceil(estado.esperaRestanteMs / 1000)} s
          </p>
        )}
      </div>

      {estado.aviso && (
        <Alert variant={estado.fase === 'interrompido' ? 'destructive' : 'default'}>
          <OctagonX aria-hidden />
          <AlertDescription>{estado.aviso}</AlertDescription>
        </Alert>
      )}

      <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
        {entradas.map(([jid, r]) => (
          <li key={jid} className="flex items-start gap-2 px-3 py-2">
            <span className="mt-0.5"><Icone r={r} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{nomes.get(jid) ?? jid}</span>
              {r.erro && <span className="block text-xs text-destructive">{r.erro}</span>}
            </span>
          </li>
        ))}
      </ul>

      {enviando ? (
        <div className="space-y-1.5">
          <Button variant="outline" onClick={aoParar} className="w-full">
            Parar após este grupo
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Mantenha esta aba aberta até o fim — fechar interrompe o envio.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={aoNovo}>Nova mensagem</Button>
          {falhas.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                aoSelecionarFalhas(falhas.map(([jid]) => jid))
                aoNovo()
              }}
            >
              Reenviar só os {falhas.length} que falharam
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
