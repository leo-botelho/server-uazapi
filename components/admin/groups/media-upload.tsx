'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText, ImageIcon, Loader2, Paperclip, Video, Volume2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { MidiaAnexada } from '@/lib/groups/rascunho'

const ICONE = {
  image: ImageIcon,
  video: Video,
  audio: Volume2,
  document: FileText,
} as const

/**
 * Anexa um arquivo: sobe para o bucket público e devolve a URL.
 *
 * O arquivo vai para o Storage em vez de seguir direto para a uazapiGO porque a
 * mensagem pode ser agendada — e o servidor da uazapiGO busca a URL na hora do
 * disparo, dias depois. Um arquivo que só existisse na memória desta aba
 * sumiria antes disso.
 */
export function MediaUpload({
  instanceId,
  valor,
  aoMudar,
  aceitar,
  rotulo = 'Anexar arquivo',
  disabled,
}: {
  instanceId: string
  valor: MidiaAnexada | null
  aoMudar: (midia: MidiaAnexada | null) => void
  /** Atributo `accept` do input (ex.: 'image/*'). */
  aceitar?: string
  rotulo?: string
  disabled?: boolean
}) {
  const campo = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)

  async function aoEscolher(arquivo: File | undefined) {
    if (!arquivo) return

    setEnviando(true)
    try {
      const form = new FormData()
      form.set('file', arquivo)
      form.set('purpose', 'message_media')
      form.set('instanceId', instanceId)

      const res = await fetch('/api/groups/media', { method: 'POST', body: form })
      const corpo = (await res.json()) as {
        error?: string
        media?: { url: string; nome: string; mime: string; tipoDeMidia: MidiaAnexada['tipoDeMidia'] | null }
      }

      if (!res.ok || !corpo.media) throw new Error(corpo.error ?? `Falha no envio do arquivo (${res.status})`)

      if (!corpo.media.tipoDeMidia) throw new Error('Este tipo de arquivo não pode ser enviado como mídia.')

      aoMudar({
        url: corpo.media.url,
        nome: corpo.media.nome || arquivo.name,
        mime: corpo.media.mime,
        tipoDeMidia: corpo.media.tipoDeMidia,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível anexar o arquivo.')
    } finally {
      setEnviando(false)
      // Zera o input: escolher o mesmo arquivo de novo precisa disparar o evento.
      if (campo.current) campo.current.value = ''
    }
  }

  if (valor) {
    const Icone = ICONE[valor.tipoDeMidia]
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
        <Icone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{valor.nome}</span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => aoMudar(null)}
          disabled={disabled}
          aria-label="Remover arquivo"
        >
          <X />
        </Button>
      </div>
    )
  }

  return (
    <div>
      <input
        ref={campo}
        type="file"
        accept={aceitar}
        className="sr-only"
        tabIndex={-1}
        disabled={disabled || enviando}
        onChange={(e) => void aoEscolher(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => campo.current?.click()}
        disabled={disabled || enviando}
        className="gap-2"
      >
        {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Paperclip className="size-4" aria-hidden />}
        {enviando ? 'Enviando…' : rotulo}
      </Button>
    </div>
  )
}
