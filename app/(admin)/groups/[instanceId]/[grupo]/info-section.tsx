'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImageIcon, Loader2, Trash2 } from 'lucide-react'

import type { GrupoVivo, SecaoProps } from './tipos'
import { chamarApi, rotaDoGrupo } from '@/components/admin/groups/chamar-api'
import { ConfirmDialog } from '@/components/admin/groups/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  MAX_DESCRICAO_DO_GRUPO, MAX_NOME_DO_GRUPO,
  validarDescricaoDoGrupo, validarNomeDoGrupo,
} from '@/lib/groups/gestao'
import { prepararFotoDeGrupo } from '@/lib/image-client'

const tamanho = (s: string) => [...s].length

/**
 * Nome, descrição e foto.
 *
 * O formulário é remontado (via `key` no pai) quando o grupo ao vivo muda, e
 * assim volta a refletir o valor que ficou de fato salvo.
 */
export function InfoSection({
  instanceId, groupjid, podeEditar, aoMudar, grupo,
}: SecaoProps & { grupo: GrupoVivo }) {
  const [nome, setNome] = useState(grupo.nome ?? '')
  const [descricao, setDescricao] = useState(grupo.descricao ?? '')
  const [salvando, setSalvando] = useState<'name' | 'description' | 'foto' | null>(null)
  const [confirmaRemover, setConfirmaRemover] = useState(false)
  const arquivo = useRef<HTMLInputElement>(null)

  const nomeV = validarNomeDoGrupo(nome)
  const descV = validarDescricaoDoGrupo(descricao)
  const nomeMudou = nome.trim() !== (grupo.nome ?? '')
  const descMudou = descricao.trim() !== (grupo.descricao ?? '')

  async function salvar(campo: 'name' | 'description') {
    const valor = campo === 'name' ? nome : descricao
    setSalvando(campo)

    const r = await chamarApi(rotaDoGrupo(instanceId, 'edit'), { groupjid, campo, valor })
    setSalvando(null)

    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }
    toast.success(campo === 'name' ? 'Nome do grupo atualizado.' : 'Descrição atualizada.')
    aoMudar()
  }

  async function trocarFoto(arq: File | undefined) {
    if (!arq) return
    setSalvando('foto')

    try {
      // 1. Reduz no navegador: JPEG, até 640x640.
      const foto = await prepararFotoDeGrupo(arq)

      // 2. Guarda no bucket (a uazapiGO busca a URL do lado dela).
      const form = new FormData()
      form.set('file', new File([foto.blob], 'foto.jpg', { type: 'image/jpeg' }))
      form.set('purpose', 'group_image')
      form.set('instanceId', instanceId)
      form.set('width', String(foto.largura))
      form.set('height', String(foto.altura))

      const up = await fetch('/api/groups/media', { method: 'POST', body: form })
      const corpo = (await up.json()) as { error?: string; media?: { url: string } }
      if (!up.ok || !corpo.media) throw new Error(corpo.error ?? 'Não foi possível guardar a foto.')

      // 3. Troca no WhatsApp.
      const r = await chamarApi(rotaDoGrupo(instanceId, 'image'), { groupjid, image: corpo.media.url })
      if (!r.ok) throw new Error(r.erro)

      toast.success('Foto do grupo atualizada.')
      aoMudar()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível trocar a foto.', { duration: 8000 })
    } finally {
      setSalvando(null)
      if (arquivo.current) arquivo.current.value = ''
    }
  }

  async function removerFoto() {
    setSalvando('foto')
    const r = await chamarApi(rotaDoGrupo(instanceId, 'image'), { groupjid, image: 'remove' })
    setSalvando(null)
    setConfirmaRemover(false)

    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }
    toast.success('Foto removida.')
    aoMudar()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informações</CardTitle>
        <CardDescription>
          {podeEditar ? 'Nome, descrição e foto do grupo.' : 'Somente leitura: o número conectado não é admin deste grupo.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Nome */}
        <div className="space-y-1.5">
          <Label htmlFor="g-nome">Nome</Label>
          <div className="flex gap-2">
            <Input
              id="g-nome"
              value={nome}
              disabled={!podeEditar || salvando !== null}
              onChange={(e) => setNome(e.target.value)}
              aria-invalid={!nomeV.ok}
            />
            <Button
              onClick={() => void salvar('name')}
              disabled={!podeEditar || !nomeMudou || !nomeV.ok || salvando !== null}
            >
              {salvando === 'name' ? <Loader2 className="animate-spin" /> : 'Salvar'}
            </Button>
          </div>
          <p className={`text-xs ${!nomeV.ok && nome.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {!nomeV.ok && nome.length > 0 ? nomeV.erro : `${tamanho(nome)}/${MAX_NOME_DO_GRUPO}`}
          </p>
        </div>

        {/* Descrição */}
        <div className="space-y-1.5">
          <Label htmlFor="g-descricao">Descrição</Label>
          <Textarea
            id="g-descricao"
            rows={5}
            value={descricao}
            disabled={!podeEditar || salvando !== null}
            onChange={(e) => setDescricao(e.target.value)}
            aria-invalid={!descV.ok}
          />
          <div className="flex items-center justify-between gap-2">
            <p className={`text-xs ${!descV.ok ? 'text-destructive' : 'text-muted-foreground'}`}>
              {!descV.ok ? descV.erro : `${tamanho(descricao)}/${MAX_DESCRICAO_DO_GRUPO}`}
            </p>
            <Button
              size="sm"
              onClick={() => void salvar('description')}
              disabled={!podeEditar || !descMudou || !descV.ok || salvando !== null}
            >
              {salvando === 'description' ? <Loader2 className="animate-spin" /> : 'Salvar descrição'}
            </Button>
          </div>
        </div>

        {/* Foto */}
        <div className="space-y-1.5">
          <Label>Foto</Label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={arquivo}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              disabled={!podeEditar || salvando !== null}
              onChange={(e) => void trocarFoto(e.target.files?.[0])}
            />
            <Button
              variant="outline"
              className="gap-2"
              disabled={!podeEditar || salvando !== null}
              onClick={() => arquivo.current?.click()}
            >
              {salvando === 'foto' ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" aria-hidden />}
              {salvando === 'foto' ? 'Enviando…' : 'Trocar foto'}
            </Button>
            <Button
              variant="ghost"
              className="gap-2 text-destructive"
              disabled={!podeEditar || salvando !== null}
              onClick={() => setConfirmaRemover(true)}
            >
              <Trash2 className="size-4" aria-hidden />
              Remover foto
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Qualquer imagem serve: o painel converte para JPEG de até 640×640, que é o que o WhatsApp aceita.
          </p>
        </div>
      </CardContent>

      <ConfirmDialog
        aberto={confirmaRemover}
        aoMudar={setConfirmaRemover}
        titulo="Remover a foto do grupo?"
        descricao="O grupo fica sem foto para todos os participantes."
        confirmar="Remover foto"
        destrutivo
        ocupado={salvando === 'foto'}
        aoConfirmar={() => void removerFoto()}
      />
    </Card>
  )
}
