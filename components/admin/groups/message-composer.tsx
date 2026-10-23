'use client'

import { Plus, TriangleAlert, Trash2 } from 'lucide-react'

import { MediaUpload } from './media-upload'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { MAX_BOTOES, misturaQuebraWhatsappWeb, type BotaoDeMensagem, type TipoDeBotao } from '@/lib/groups/buttons'
import type { AbaDaMensagem, RascunhoDaMensagem } from '@/lib/groups/rascunho'

const MAX_TEXTO = 4096

const ROTULO_DO_TIPO: Record<Exclude<TipoDeBotao, 'ligar'>, string> = {
  resposta: 'Resposta rápida',
  link: 'Link',
  copiar: 'Copiar texto',
}

const DICA_DO_VALOR: Record<Exclude<TipoDeBotao, 'ligar'>, string> = {
  resposta: 'Identificador (opcional)',
  link: 'https://…',
  copiar: 'Texto que será copiado',
}

/**
 * O compositor da mensagem: texto, mídia ou botões.
 *
 * Só edita o rascunho — quem valida e envia é o painel de disparo. A validação
 * de verdade acontece na rota; o que aparece aqui é para a pessoa ver o
 * problema antes de tentar.
 */
export function MessageComposer({
  instanceId,
  rascunho,
  aoMudar,
  disabled,
}: {
  instanceId: string
  rascunho: RascunhoDaMensagem
  aoMudar: (novo: RascunhoDaMensagem) => void
  disabled?: boolean
}) {
  const atualiza = (parcial: Partial<RascunhoDaMensagem>) => aoMudar({ ...rascunho, ...parcial })

  const preenchidos = rascunho.botoes.filter((b) => b.texto.trim() !== '')
  const mistura = misturaQuebraWhatsappWeb(preenchidos)

  function mudaBotao(indice: number, parcial: Partial<BotaoDeMensagem>) {
    atualiza({ botoes: rascunho.botoes.map((b, i) => (i === indice ? { ...b, ...parcial } : b)) })
  }

  return (
    <Tabs
      value={rascunho.aba}
      onValueChange={(v) => atualiza({ aba: v as AbaDaMensagem })}
    >
      <TabsList>
        <TabsTrigger value="texto" disabled={disabled}>Texto</TabsTrigger>
        <TabsTrigger value="midia" disabled={disabled}>Mídia</TabsTrigger>
        <TabsTrigger value="botoes" disabled={disabled}>Botões</TabsTrigger>
      </TabsList>

      {/* ── Texto ───────────────────────────────────────────────────────── */}
      <TabsContent value="texto" className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="msg-texto">Mensagem</Label>
          <Textarea
            id="msg-texto"
            rows={7}
            maxLength={MAX_TEXTO}
            value={rascunho.texto}
            disabled={disabled}
            onChange={(e) => atualiza({ texto: e.target.value })}
            placeholder="Escreva a mensagem. Use {{name}} para o nome do contato, quando houver."
          />
          <p className="text-right text-xs text-muted-foreground">
            {rascunho.texto.length}/{MAX_TEXTO}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="msg-preview"
            checked={rascunho.linkPreview}
            disabled={disabled}
            onCheckedChange={(v) => atualiza({ linkPreview: v === true })}
          />
          <Label htmlFor="msg-preview" className="font-normal">
            Mostrar prévia do primeiro link
          </Label>
        </div>
      </TabsContent>

      {/* ── Mídia ───────────────────────────────────────────────────────── */}
      <TabsContent value="midia" className="space-y-3">
        <div className="space-y-1.5">
          <Label>Arquivo</Label>
          <MediaUpload
            instanceId={instanceId}
            valor={rascunho.midia}
            aoMudar={(midia) => atualiza({ midia })}
            aceitar="image/jpeg,image/png,image/webp,video/mp4,audio/ogg,audio/mpeg,application/pdf"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            Imagem, vídeo MP4, áudio ou PDF, até 16 MB. O arquivo fica guardado no painel
            para o envio funcionar mesmo se for agendado.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="msg-legenda">Legenda (opcional)</Label>
          <Textarea
            id="msg-legenda"
            rows={4}
            maxLength={MAX_TEXTO}
            value={rascunho.legenda}
            disabled={disabled}
            onChange={(e) => atualiza({ legenda: e.target.value })}
          />
        </div>
      </TabsContent>

      {/* ── Botões ──────────────────────────────────────────────────────── */}
      <TabsContent value="botoes" className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="btn-texto">Mensagem</Label>
          <Textarea
            id="btn-texto"
            rows={4}
            maxLength={MAX_TEXTO}
            value={rascunho.texto}
            disabled={disabled}
            onChange={(e) => atualiza({ texto: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label>Botões (até {MAX_BOTOES})</Label>

          {rascunho.botoes.map((botao, i) => {
            const tipo = botao.tipo === 'ligar' ? 'resposta' : botao.tipo
            return (
              <div key={i} className="grid grid-cols-[9.5rem_1fr_auto] items-start gap-2">
                <Select
                  // Sem `items`, o campo exibiria o valor cru ("resposta") em vez do rótulo.
                  items={ROTULO_DO_TIPO}
                  value={tipo}
                  onValueChange={(v) => mudaBotao(i, { tipo: (v ?? 'resposta') as TipoDeBotao, valor: '' })}
                  disabled={disabled}
                >
                  <SelectTrigger aria-label={`Tipo do botão ${i + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROTULO_DO_TIPO) as (keyof typeof ROTULO_DO_TIPO)[]).map((t) => (
                      <SelectItem key={t} value={t}>{ROTULO_DO_TIPO[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="space-y-1.5">
                  <Input
                    value={botao.texto}
                    disabled={disabled}
                    onChange={(e) => mudaBotao(i, { texto: e.target.value })}
                    placeholder="Texto do botão"
                    aria-label={`Texto do botão ${i + 1}`}
                  />
                  <Input
                    value={botao.valor ?? ''}
                    disabled={disabled}
                    onChange={(e) => mudaBotao(i, { valor: e.target.value })}
                    placeholder={DICA_DO_VALOR[tipo]}
                    aria-label={`Valor do botão ${i + 1}`}
                  />
                </div>

                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={disabled || rascunho.botoes.length === 1}
                  onClick={() => atualiza({ botoes: rascunho.botoes.filter((_, j) => j !== i) })}
                  aria-label={`Remover botão ${i + 1}`}
                >
                  <Trash2 />
                </Button>
              </div>
            )
          })}

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={disabled || rascunho.botoes.length >= MAX_BOTOES}
            onClick={() => atualiza({ botoes: [...rascunho.botoes, { tipo: 'resposta', texto: '' }] })}
          >
            <Plus className="size-3.5" aria-hidden />
            Adicionar botão
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="btn-rodape">Rodapé (opcional)</Label>
          <Input
            id="btn-rodape"
            value={rascunho.rodape}
            disabled={disabled}
            onChange={(e) => atualiza({ rodape: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Imagem acima dos botões (opcional)</Label>
          <MediaUpload
            instanceId={instanceId}
            valor={rascunho.imagemDosBotoes}
            aoMudar={(imagemDosBotoes) => atualiza({ imagemDosBotoes })}
            aceitar="image/jpeg,image/png,image/webp"
            rotulo="Anexar imagem"
            disabled={disabled}
          />
        </div>

        {mistura && (
          <Alert className="border-amber-500/40">
            <TriangleAlert className="text-amber-400" aria-hidden />
            <AlertDescription>
              Misturar botão de resposta com link ou copiar faz o <strong>WhatsApp Web</strong> exibir
              “Não é possível exibir esta mensagem”. Quem abrir no computador não vê nada.
              Funciona normalmente no celular.
            </AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-muted-foreground">
          O WhatsApp pode descontinuar botões interativos a qualquer momento, sem aviso.
          Se a mensagem importa, tenha um plano B em texto simples.
        </p>
      </TabsContent>
    </Tabs>
  )
}
