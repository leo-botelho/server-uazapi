'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { linkDeConversa, linkDeConvite, type ResultadoDeLink } from '@/lib/groups/deeplinks'

function Resultado({ r }: { r: ResultadoDeLink | null }) {
  if (!r) return null

  if (!r.ok) {
    return <p className="text-sm text-destructive">{r.erro}</p>
  }

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copiado.')
    } catch {
      // Sem permissão de área de transferência (ou contexto não seguro).
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.')
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input readOnly value={r.url} onFocus={(e) => e.target.select()} aria-label="Link gerado" />
        <Button type="button" size="icon" variant="outline" onClick={() => void copiar(r.url)} aria-label="Copiar link">
          <Copy />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          render={<a href={r.url} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
          aria-label="Abrir link"
        >
          <ExternalLink />
        </Button>
      </div>
      {r.aviso && <p className="text-xs text-amber-400">{r.aviso}</p>}
    </div>
  )
}

export function LinkGenerator() {
  const [telefone, setTelefone] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [convite, setConvite] = useState('')

  // Calculados a cada digitação: são funções puras e baratas, não precisam de estado.
  const conversa = telefone.trim() ? linkDeConversa(telefone, mensagem) : null
  const grupo = convite.trim() ? linkDeConvite(convite) : null

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Link de conversa</CardTitle>
          <CardDescription>
            Abre uma conversa direto no WhatsApp, com a mensagem já escrita.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dl-telefone">Telefone</Label>
            <Input
              id="dl-telefone"
              inputMode="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="+55 21 99999-8888"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dl-mensagem">Mensagem (opcional)</Label>
            <Textarea
              id="dl-mensagem"
              rows={3}
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
            />
          </div>
          <Resultado r={conversa} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Convite de grupo</CardTitle>
          <CardDescription>
            Cole o link ou o código do convite para conferir e copiar a versão limpa.
            Só aceita endereços de chat.whatsapp.com.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dl-convite">Link ou código</Label>
            <Input
              id="dl-convite"
              value={convite}
              onChange={(e) => setConvite(e.target.value)}
              placeholder="https://chat.whatsapp.com/…"
            />
          </div>
          <Resultado r={grupo} />
        </CardContent>
      </Card>
    </div>
  )
}
