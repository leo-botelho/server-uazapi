'use client'

import { useState } from 'react'
import { Clock } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { espacamentoMinimo, mensagemDeEspacamentoBaixo } from '@/lib/groups/limits'

/** "12 min", "1 h 05", "45 s" — para o operador sentir quanto vai demorar. */
export function formatarDuracao(segundos: number): string {
  if (segundos < 60) return `${Math.round(segundos)} s`

  const minutos = Math.round(segundos / 60)
  if (minutos < 60) return `${minutos} min`

  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
}

/**
 * Intervalo entre um grupo e o próximo, em segundos.
 *
 * O piso aqui é conforto — a rota e o banco recusam abaixo dele de qualquer
 * jeito. Marcando todos o piso sobe para 60 s, e o campo acompanha na hora.
 */
export function SpacingField({
  value,
  onChange,
  marcarTodos,
  aceitouRisco = false,
  quantidadeDeGrupos,
  disabled,
}: {
  value: number
  onChange: (segundos: number) => void
  marcarTodos: boolean
  /** Modo avançado de marcar todos: o piso volta a ser o geral (5 s). */
  aceitouRisco?: boolean
  quantidadeDeGrupos: number
  disabled?: boolean
}) {
  const piso = espacamentoMinimo(marcarTodos, aceitouRisco)

  // O que a pessoa está digitando, que pode estar vazio ou abaixo do piso por um
  // instante. O valor oficial só muda quando o texto vira um número válido.
  const [rascunho, setRascunho] = useState<string | null>(null)

  const digitado = rascunho !== null ? Number(rascunho) : value
  const abaixo = !Number.isFinite(digitado) || digitado < piso

  function aoDigitar(texto: string) {
    setRascunho(texto)
    const n = Number(texto)
    if (texto !== '' && Number.isInteger(n) && n >= piso) onChange(n)
  }

  // Ao sair do campo, devolve para o piso em vez de deixar um valor inválido.
  function aoSair() {
    const n = Number(rascunho ?? value)
    if (rascunho !== null && (!Number.isInteger(n) || n < piso)) onChange(piso)
    setRascunho(null)
  }

  // Sem o rascunho, o campo tem de acompanhar quando o piso sobe (marcar todos).
  const exibido = rascunho ?? String(Math.max(value, piso))
  const efetivo = Math.max(value, piso)

  // O tempo total é o intervalo entre os grupos: o último não tem espera depois.
  const total = Math.max(0, quantidadeDeGrupos - 1) * efetivo

  return (
    <div className="space-y-1.5">
      <Label htmlFor="intervalo">Intervalo entre grupos</Label>

      <div className="flex items-center gap-2">
        <Input
          id="intervalo"
          type="number"
          inputMode="numeric"
          min={piso}
          step={1}
          value={exibido}
          disabled={disabled}
          onChange={(e) => aoDigitar(e.target.value)}
          onBlur={aoSair}
          aria-invalid={abaixo}
          aria-describedby="intervalo-ajuda"
          className="w-24"
        />
        <span className="text-sm text-muted-foreground">segundos</span>
      </div>

      <p
        id="intervalo-ajuda"
        className={`flex items-start gap-1.5 text-xs ${abaixo ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        <Clock className="mt-0.5 size-3 shrink-0" aria-hidden />
        <span>
          {abaixo
            ? mensagemDeEspacamentoBaixo(marcarTodos, aceitouRisco)
            : quantidadeDeGrupos > 1
              ? `Mínimo ${piso} s. Com ${quantidadeDeGrupos} grupos, o envio leva cerca de ${formatarDuracao(total)}. Devagar é o que protege o número.`
              : `Mínimo ${piso} s${marcarTodos && !aceitouRisco ? ' marcando todos' : ''}.`}
        </span>
      </p>
    </div>
  )
}
