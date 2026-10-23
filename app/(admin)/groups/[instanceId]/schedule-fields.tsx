'use client'

import { useRef, useState } from 'react'
import { ImageIcon, Loader2, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DateTimeField, formatarEmBrasilia } from '@/components/ui/datetime-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MAX_DESCRICAO_DO_GRUPO, MAX_NOME_DO_GRUPO } from '@/lib/groups/gestao'
import { prepararFotoDeGrupo } from '@/lib/image-client'
import { toast } from 'sonner'

export type AcaoAgendada = 'mensagem' | 'nome' | 'descricao' | 'foto'

export const ROTULO_DA_ACAO: Record<AcaoAgendada, string> = {
  mensagem: 'Enviar mensagem',
  nome: 'Trocar o nome',
  descricao: 'Trocar a descrição',
  foto: 'Trocar a foto',
}

export interface CamposDoAgendamento {
  acao: AcaoAgendada
  nome: string
  /** ISO em UTC, ou null enquanto não escolhida. */
  quando: string | null
  novoNome: string
  novaDescricao: string
  /** URL da foto já guardada no bucket. */
  fotoUrl: string | null
}

export const CAMPOS_VAZIOS: CamposDoAgendamento = {
  acao: 'mensagem', nome: '', quando: null, novoNome: '', novaDescricao: '', fotoUrl: null,
}

/**
 * Os campos que só existem ao agendar: o que fazer, o nome do agendamento e
 * quando. O conteúdo da MENSAGEM continua sendo o compositor de sempre — este
 * componente só cuida das alterações (nome, descrição, foto) e da data.
 */
export function ScheduleFields({
  instanceId,
  valor,
  aoMudar,
  disabled,
}: {
  instanceId: string
  valor: CamposDoAgendamento
  aoMudar: (v: CamposDoAgendamento) => void
  disabled?: boolean
}) {
  const arquivo = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)

  const mudar = (parcial: Partial<CamposDoAgendamento>) => aoMudar({ ...valor, ...parcial })

  async function escolherFoto(arq: File | undefined) {
    if (!arq) return
    setEnviando(true)
    try {
      // Mesmo caminho da tela do grupo: reduz no navegador (JPEG ≤ 640×640) e guarda
      // no bucket — a foto é aplicada DIAS depois, então não pode viver só nesta aba.
      const foto = await prepararFotoDeGrupo(arq)

      const form = new FormData()
      form.set('file', new File([foto.blob], 'foto.jpg', { type: 'image/jpeg' }))
      form.set('purpose', 'group_image')
      form.set('instanceId', instanceId)
      form.set('width', String(foto.largura))
      form.set('height', String(foto.altura))

      const up = await fetch('/api/groups/media', { method: 'POST', body: form })
      const corpo = (await up.json()) as { error?: string; media?: { url: string } }
      if (!up.ok || !corpo.media) throw new Error(corpo.error ?? 'Não foi possível guardar a foto.')

      mudar({ fotoUrl: corpo.media.url })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível preparar a foto.', { duration: 8000 })
    } finally {
      setEnviando(false)
      if (arquivo.current) arquivo.current.value = ''
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="space-y-1.5">
        <Label>O que fazer</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="O que fazer">
          {(Object.keys(ROTULO_DA_ACAO) as AcaoAgendada[]).map((a) => (
            <Button
              key={a}
              type="button"
              size="sm"
              variant={valor.acao === a ? 'default' : 'outline'}
              aria-pressed={valor.acao === a}
              disabled={disabled}
              onClick={() => mudar({ acao: a })}
            >
              {ROTULO_DA_ACAO[a]}
            </Button>
          ))}
        </div>
        {valor.acao !== 'mensagem' && (
          <p className="text-xs text-muted-foreground">
            Alterações exigem que o número seja admin do grupo. O mesmo valor vale para todos os grupos selecionados.
          </p>
        )}
      </div>

      {valor.acao === 'nome' && (
        <div className="space-y-1.5">
          <Label htmlFor="ag-nome-grupo">Novo nome do grupo</Label>
          <Input
            id="ag-nome-grupo"
            value={valor.novoNome}
            disabled={disabled}
            onChange={(e) => mudar({ novoNome: e.target.value })}
          />
          <p className={`text-xs ${[...valor.novoNome.trim()].length > MAX_NOME_DO_GRUPO ? 'text-destructive' : 'text-muted-foreground'}`}>
            {[...valor.novoNome.trim()].length}/{MAX_NOME_DO_GRUPO}
          </p>
        </div>
      )}

      {valor.acao === 'descricao' && (
        <div className="space-y-1.5">
          <Label htmlFor="ag-desc-grupo">Nova descrição</Label>
          <Textarea
            id="ag-desc-grupo"
            rows={4}
            value={valor.novaDescricao}
            disabled={disabled}
            onChange={(e) => mudar({ novaDescricao: e.target.value })}
          />
          <p className={`text-xs ${[...valor.novaDescricao.trim()].length > MAX_DESCRICAO_DO_GRUPO ? 'text-destructive' : 'text-muted-foreground'}`}>
            {[...valor.novaDescricao.trim()].length}/{MAX_DESCRICAO_DO_GRUPO} · deixe vazio para apagar a descrição
          </p>
        </div>
      )}

      {valor.acao === 'foto' && (
        <div className="space-y-1.5">
          <Label>Nova foto</Label>
          <input
            ref={arquivo}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void escolherFoto(e.target.files?.[0])}
          />
          {valor.fotoUrl ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- prévia de um arquivo do bucket; next/image não agrega aqui */}
              <img src={valor.fotoUrl} alt="Prévia da nova foto" className="size-16 rounded-lg border border-border object-cover" />
              <Button type="button" size="sm" variant="ghost" className="gap-1.5" disabled={disabled} onClick={() => mudar({ fotoUrl: null })}>
                <Trash2 className="size-3.5" aria-hidden />
                Trocar
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={disabled || enviando}
              onClick={() => arquivo.current?.click()}
            >
              {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImageIcon className="size-4" aria-hidden />}
              {enviando ? 'Preparando…' : 'Escolher imagem'}
            </Button>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="ag-nome">Nome do agendamento</Label>
        <Input
          id="ag-nome"
          value={valor.nome}
          placeholder="Ex.: Aviso da aula de quinta"
          maxLength={120}
          disabled={disabled}
          onChange={(e) => mudar({ nome: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Quando</Label>
        <DateTimeField value={valor.quando} onChange={(quando) => mudar({ quando })} disabled={disabled} aria-label="Data e hora" />
        <p className="text-xs text-muted-foreground">
          {valor.quando
            ? `Começa às ${formatarEmBrasilia(valor.quando)} (horário de Brasília). Os grupos seguintes saem respeitando o intervalo.`
            : 'Com pelo menos 1 minuto de antecedência. Horário de Brasília.'}
        </p>
      </div>
    </div>
  )
}
