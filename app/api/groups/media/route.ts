import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { tabelaNaoExiste } from '@/lib/groups/install'
import { extensaoDoTipo, tipoDeMidiaPorMime, validarArquivo } from '@/lib/groups/media'

/**
 * POST /api/groups/media — sobe um arquivo para o bucket `group-assets`.
 *
 * multipart/form-data: `file`, `purpose` (`group_image` | `message_media` |
 * `export`) e, opcionalmente, `instanceId`, `width` e `height`.
 *
 * O bucket é PÚBLICO de propósito: a uazapiGO busca a URL do lado dela, e numa
 * tarefa agendada busca dias depois — uma URL assinada que expirasse nesse
 * intervalo falharia calada na hora do disparo. Por isso o caminho é um UUID,
 * nunca derivado do nome do arquivo. Quem tiver a URL vê o arquivo.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Envie o arquivo como multipart/form-data.' }, { status: 400 })
  }

  const arquivo = form.get('file')
  const finalidade = form.get('purpose')
  const instanceId = form.get('instanceId')

  if (!(arquivo instanceof File)) {
    return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 })
  }
  if (typeof finalidade !== 'string') {
    return NextResponse.json({ error: 'Informe a finalidade do arquivo.' }, { status: 400 })
  }

  const mime = arquivo.type
  const conteudo = new Uint8Array(await arquivo.arrayBuffer())

  const veredito = validarArquivo(finalidade, mime, conteudo.byteLength, conteudo.subarray(0, 16))
  if (!veredito.ok) {
    return NextResponse.json({ error: veredito.erro }, { status: veredito.status })
  }

  const db = await createServiceClient()
  const pasta = typeof instanceId === 'string' && instanceId ? instanceId : 'geral'
  const caminho = `${pasta}/${crypto.randomUUID()}.${extensaoDoTipo(mime)}`

  const { error: erroDeUpload } = await db.storage
    .from('group-assets')
    .upload(caminho, conteudo, { contentType: mime, upsert: false })

  if (erroDeUpload) {
    console.error('[groups/media] falha no upload:', erroDeUpload.message)
    return NextResponse.json(
      {
        error: /bucket not found/i.test(erroDeUpload.message)
          ? 'O bucket group-assets não existe. Aplique a migration 015.'
          : 'Não foi possível guardar o arquivo.',
      },
      { status: 502 }
    )
  }

  const { data: publica } = db.storage.from('group-assets').getPublicUrl(caminho)

  const numero = (v: FormDataEntryValue | null) => {
    const n = typeof v === 'string' ? Number(v) : NaN
    return Number.isInteger(n) && n > 0 && n < 20000 ? n : null
  }

  const { data: midia, error: erroDeRegistro } = await db
    .from('group_media')
    .insert({
      instance_id: typeof instanceId === 'string' && instanceId ? instanceId : null,
      path: caminho,
      public_url: publica.publicUrl,
      mime,
      bytes: conteudo.byteLength,
      width: numero(form.get('width')),
      height: numero(form.get('height')),
      purpose: finalidade as 'group_image' | 'message_media' | 'export',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (erroDeRegistro) {
    if (tabelaNaoExiste(erroDeRegistro)) {
      return NextResponse.json(
        { error: 'A migration 015 ainda não foi aplicada no banco.', migracaoPendente: true },
        { status: 503 }
      )
    }
    // O arquivo já está no bucket e funciona; só o registro falhou. Não perde o upload.
    console.error('[groups/media] arquivo enviado, mas o registro falhou:', erroDeRegistro.message)
  }

  return NextResponse.json(
    {
      media: {
        id: midia?.id ?? null,
        url: publica.publicUrl,
        path: caminho,
        mime,
        bytes: conteudo.byteLength,
        nome: arquivo.name,
        tipoDeMidia: tipoDeMidiaPorMime(mime),
      },
    },
    { status: 201 }
  )
}
