'use client'

import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Confirmação de UMA ação (sair do grupo, renovar convite, remover alguém).
 *
 * `exigirTexto` faz a pessoa digitar algo — o nome do grupo, por exemplo — antes
 * de o botão liberar. Reservado para o que não tem volta.
 */
export function ConfirmDialog({
  aberto,
  aoMudar,
  titulo,
  descricao,
  confirmar,
  destrutivo = false,
  exigirTexto,
  ocupado = false,
  aoConfirmar,
  children,
}: {
  aberto: boolean
  aoMudar: (aberto: boolean) => void
  titulo: string
  descricao: string
  confirmar: string
  destrutivo?: boolean
  exigirTexto?: string
  ocupado?: boolean
  aoConfirmar: () => void
  children?: ReactNode
}) {
  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      <DialogContent className="sm:max-w-md">
        {aberto && (
          <Corpo
            titulo={titulo}
            descricao={descricao}
            confirmar={confirmar}
            destrutivo={destrutivo}
            exigirTexto={exigirTexto}
            ocupado={ocupado}
            aoConfirmar={aoConfirmar}
            aoCancelar={() => aoMudar(false)}
          >
            {children}
          </Corpo>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Corpo({
  titulo, descricao, confirmar, destrutivo, exigirTexto, ocupado, aoConfirmar, aoCancelar, children,
}: {
  titulo: string
  descricao: string
  confirmar: string
  destrutivo: boolean
  exigirTexto?: string
  ocupado: boolean
  aoConfirmar: () => void
  aoCancelar: () => void
  children?: ReactNode
}) {
  // Vive aqui dentro para zerar toda vez que o diálogo abre, sem efeito para limpar.
  const [digitado, setDigitado] = useState('')
  const liberado = !exigirTexto || digitado.trim() === exigirTexto.trim()

  return (
    <>
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
        <DialogDescription>{descricao}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3 text-sm">
        {children}
        {exigirTexto && (
          <div className="space-y-1.5">
            <Label htmlFor="confirma-texto">Para confirmar, digite: <strong>{exigirTexto}</strong></Label>
            <Input
              id="confirma-texto"
              autoComplete="off"
              value={digitado}
              onChange={(e) => setDigitado(e.target.value)}
            />
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={aoCancelar} disabled={ocupado}>Cancelar</Button>
        <Button
          variant={destrutivo ? 'destructive' : 'default'}
          onClick={aoConfirmar}
          disabled={!liberado || ocupado}
        >
          {ocupado ? 'Aguarde…' : confirmar}
        </Button>
      </DialogFooter>
    </>
  )
}
