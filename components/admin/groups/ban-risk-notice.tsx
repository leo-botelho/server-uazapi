'use client'

import { useSyncExternalStore } from 'react'
import { ShieldAlert } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/** Hora cheia atual em Brasília, ou null no servidor (para não divergir na hidratação). */
function horaEmBrasilia(): number | null {
  const h = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    hour12: false,
  }).format(new Date())
  const n = Number(h)
  return Number.isFinite(n) ? n % 24 : null
}

const semAssinatura = () => () => {}

/**
 * Aviso fixo de risco de banimento. Não dá para dispensar de propósito: o
 * operador que já viu mil vezes é justamente quem para de ler.
 *
 * A hora vem de `useSyncExternalStore` com snapshot nulo no servidor, que é o
 * jeito de ler o relógio sem causar divergência entre o HTML do servidor e o do
 * navegador.
 */
export function BanRiskNotice({ marcarTodos }: { marcarTodos: boolean }) {
  const hora = useSyncExternalStore(semAssinatura, horaEmBrasilia, () => null)
  const foraDoHorario = hora !== null && (hora < 8 || hora >= 20)

  return (
    <Alert className="border-amber-500/40">
      <ShieldAlert className="text-amber-400" aria-hidden />
      <AlertTitle className="text-amber-400">Proteja o número</AlertTitle>
      <AlertDescription className="space-y-1.5">
        <p>
          {marcarTodos
            ? 'Marcar todos notifica todos os participantes de cada grupo — é o que mais leva ao banimento. Por isso o intervalo mínimo sobe para 60 s e há um teto de grupos por envio.'
            : 'Mensagens iguais em muitos grupos, em sequência rápida, são o padrão que o WhatsApp mais bloqueia. Quanto maior o intervalo, mais seguro.'}
        </p>
        <p>
          Número conectado há pouco tempo (menos de 7 dias) não deveria disparar em massa.
          Um número banido custa o WhatsApp do cliente, não só a campanha.
        </p>
        {foraDoHorario && (
          <p className="font-medium text-amber-400">
            Agora são {String(hora).padStart(2, '0')}h em Brasília. Envio em massa fora de 8h–20h
            chama atenção — considere agendar para o horário comercial.
          </p>
        )}
      </AlertDescription>
    </Alert>
  )
}
