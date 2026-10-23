'use client'

import { useState, type ReactNode } from 'react'
import { Send } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Quantos nomes de grupo aparecem antes de virar "e mais N". */
const NOMES_VISIVEIS = 8

/**
 * Confirmação antes de uma ação em massa.
 *
 * Quando `exigirDigitar` é verdadeiro, o botão só libera depois de a pessoa
 * digitar a quantidade de grupos. Isso é de propósito: um "OK" clicado no
 * automático é exatamente como se manda marcar-todos para 30 grupos sem querer.
 */
export function ConfirmBulkDialog({
  aberto,
  aoMudar,
  titulo,
  descricao,
  grupos,
  exigirDigitar,
  textoDoBotao = 'Enviar',
  aoConfirmar,
  children,
}: {
  aberto: boolean
  aoMudar: (aberto: boolean) => void
  titulo: string
  descricao: string
  /** Nomes dos grupos que serão afetados. */
  grupos: string[]
  exigirDigitar: boolean
  textoDoBotao?: string
  aoConfirmar: () => void
  /** Avisos específicos desta ação (marcar todos, intervalo, duração…). */
  children?: ReactNode
}) {
  // O texto digitado fica num componente interno com `key`, para zerar toda vez
  // que o diálogo abre — sem precisar de efeito para limpar.
  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      <DialogContent className="sm:max-w-md">
        {aberto && (
          <Conteudo
            key={grupos.join('|')}
            titulo={titulo}
            descricao={descricao}
            grupos={grupos}
            exigirDigitar={exigirDigitar}
            textoDoBotao={textoDoBotao}
            aoConfirmar={aoConfirmar}
            aoCancelar={() => aoMudar(false)}
          >
            {children}
          </Conteudo>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Conteudo({
  titulo, descricao, grupos, exigirDigitar, textoDoBotao, aoConfirmar, aoCancelar, children,
}: {
  titulo: string
  descricao: string
  grupos: string[]
  exigirDigitar: boolean
  textoDoBotao: string
  aoConfirmar: () => void
  aoCancelar: () => void
  children?: ReactNode
}) {
  const [digitado, setDigitado] = useState('')
  const liberado = !exigirDigitar || digitado.trim() === String(grupos.length)

  const visiveis = grupos.slice(0, NOMES_VISIVEIS)
  const restantes = grupos.length - visiveis.length

  return (
    <>
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
        <DialogDescription>{descricao}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="mb-1.5 font-medium">
            {grupos.length} {grupos.length === 1 ? 'grupo' : 'grupos'}
          </p>
          <ul className="max-h-32 space-y-0.5 overflow-y-auto text-muted-foreground">
            {visiveis.map((nome, i) => (
              <li key={i} className="truncate">{nome}</li>
            ))}
            {restantes > 0 && <li>e mais {restantes}…</li>}
          </ul>
        </div>

        {children}

        {exigirDigitar && (
          <div className="space-y-1.5">
            <Label htmlFor="confirma-quantidade">
              Para confirmar, digite a quantidade de grupos ({grupos.length})
            </Label>
            <Input
              id="confirma-quantidade"
              inputMode="numeric"
              autoComplete="off"
              value={digitado}
              onChange={(e) => setDigitado(e.target.value)}
              placeholder={String(grupos.length)}
            />
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={aoCancelar}>Cancelar</Button>
        <Button onClick={aoConfirmar} disabled={!liberado} className="gap-1.5">
          <Send className="size-4" aria-hidden />
          {textoDoBotao}
        </Button>
      </DialogFooter>
    </>
  )
}
