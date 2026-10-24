"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/**
 * Campo de data e hora.
 *
 * Feito de `<input type="date">` + `<input type="time">` de propósito, em vez
 * do calendário do shadcn: aquele traz o `react-day-picker` como dependência
 * nova só para um formulário onde a pessoa digita a data. Isto é teclado-
 * amigável, funciona bem no celular e não acrescenta nada ao bundle.
 *
 * O valor entra e sai como **ISO em UTC** (o que vai para o banco), mas a
 * pessoa lê e escreve em hora local. A conversão nos dois sentidos mora aqui,
 * para nenhuma tela ter que lembrar de fazê-la.
 */

/** ISO UTC → os dois pedaços que os inputs nativos entendem (hora local). */
function paraLocal(iso: string | null | undefined): { data: string; hora: string } {
  if (!iso) return { data: "", hora: "" }

  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { data: "", hora: "" }

  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    data: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hora: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/** Os dois pedaços (hora local) → ISO UTC, ou null enquanto faltar um deles. */
function paraIso(data: string, hora: string): string | null {
  if (!data || !hora) return null

  // `new Date('2026-01-02T15:00')` sem sufixo é interpretado como hora LOCAL,
  // que é exatamente o que a pessoa digitou. O toISOString converte para UTC.
  const d = new Date(`${data}T${hora}`)
  if (Number.isNaN(d.getTime())) return null

  return d.toISOString()
}

export interface DateTimeFieldProps {
  /** ISO em UTC, ou null quando ainda não há data escolhida. */
  value: string | null
  onChange: (isoUtc: string | null) => void
  disabled?: boolean
  className?: string
  /** Impede escolher uma data passada. Padrão: true. */
  minNow?: boolean
  "aria-label"?: string
}

export function DateTimeField({
  value,
  onChange,
  disabled,
  className,
  minNow = true,
  "aria-label": ariaLabel,
}: DateTimeFieldProps) {
  const { data, hora } = paraLocal(value)

  // Enquanto só um dos dois está preenchido não há instante nenhum para
  // informar — guardamos o pedaço digitado aqui para o campo não "apagar" o
  // que a pessoa acabou de escrever.
  const [rascunho, setRascunho] = React.useState({ data, hora })

  // Quando o valor muda por fora (carregou do banco, outro campo reposicionou
  // a tarefa), o rascunho tem que acompanhar. Ajustar durante o render é o
  // padrão recomendado para isso — um `useEffect` com `setState` provoca uma
  // renderização em cascata e o lint reclama com razão.
  const [valorAnterior, setValorAnterior] = React.useState(value)
  if (value !== valorAnterior) {
    setValorAnterior(value)
    setRascunho({ data, hora })
  }

  function atualizar(parcial: Partial<{ data: string; hora: string }>) {
    const proximo = { ...rascunho, ...parcial }
    setRascunho(proximo)
    onChange(paraIso(proximo.data, proximo.hora))
  }

  const hoje = React.useMemo(() => paraLocal(new Date().toISOString()).data, [])

  return (
    <div className={cn("flex items-center gap-2", className)} aria-label={ariaLabel}>
      <Input
        type="date"
        value={rascunho.data}
        min={minNow ? hoje : undefined}
        disabled={disabled}
        onChange={(e) => atualizar({ data: e.target.value })}
        className="w-[9.5rem]"
        aria-label="Data"
      />
      <Input
        type="time"
        value={rascunho.hora}
        disabled={disabled}
        onChange={(e) => atualizar({ hora: e.target.value })}
        className="w-[6.5rem]"
        aria-label="Hora"
      />
    </div>
  )
}

/**
 * Formata um instante para leitura, sempre no fuso de Brasília.
 *
 * O `date-fns` instalado é a v4, que move o suporte a fuso para o pacote
 * separado `@date-fns/tz` — que não está instalado. O `Intl` nativo resolve
 * sem dependência nenhuma.
 */
export function formatarEmBrasilia(iso: string | null | undefined, comSegundos = false): string {
  if (!iso) return "—"

  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: comSegundos ? "medium" : "short",
  }).format(d)
}

export { paraIso as dateTimeParaIso, paraLocal as dateTimeParaLocal }
