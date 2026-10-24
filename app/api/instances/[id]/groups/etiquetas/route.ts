import { NextRequest, NextResponse } from 'next/server'

import {
  PAGINAS_MAXIMAS_DA_BUSCA, TAMANHO_DA_PAGINA_DA_BUSCA, gruposDaBusca, idDeEtiquetaValido, lerEtiquetas,
  validarCorDaEtiqueta, validarNomeDaEtiqueta,
} from '@/lib/groups/etiquetas'
import { prepararAcaoDaInstancia, respostaDeErroDaUazapi } from '@/lib/groups/mutacao'

/**
 * POST /api/instances/[id]/groups/etiquetas — as etiquetas do WhatsApp Business.
 *
 * Corpo, por `acao`:
 *  - `listar`                                       → as etiquetas da instância
 *  - `grupos`   `{ labelid }`                       → os JIDs dos GRUPOS que têm a etiqueta
 *  - `aplicar`  `{ labelid, groupjid }`             → põe a etiqueta em UM grupo
 *  - `remover`  `{ labelid, groupjid }`             → tira a etiqueta de UM grupo
 *  - `criar`    `{ name, color }`                   → cria a etiqueta
 *  - `editar`   `{ labelid, name, color }`          → renomeia / recolore
 *  - `apagar`   `{ labelid, confirmar: true }`      → apaga a etiqueta
 *
 * `aplicar` e `remover` são UM grupo por chamada: a tela percorre os selecionados, e cada pedido
 * tem o seu orçamento de CPU no plano Free do Cloudflare.
 *
 * ⚠️ APAGAR tira a etiqueta de TODAS as conversas da instância, não só dos grupos — por isso a
 * rota exige `confirmar: true` por conta própria (a tela não é fronteira de segurança).
 */

const ehJidDeGrupo = (v: unknown): v is string => typeof v === 'string' && /^[0-9][0-9-]*@g\.us$/.test(v)

const SEM_ETIQUETAS =
  'Não foi possível ler as etiquetas. Etiquetas são um recurso do WhatsApp Business: em um número comum a lista não existe.'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const preparo = await prepararAcaoDaInstancia(request, params)
  if (!preparo.ok) return preparo.resposta

  const { client, token, instanceId, corpo, userId } = preparo
  const erro = (mensagem: string, status = 400) => NextResponse.json({ error: mensagem }, { status })

  try {
    switch (corpo.acao) {
      case 'listar': {
        const etiquetas = lerEtiquetas(await client.labels.list(token))
        return NextResponse.json({ etiquetas })
      }

      case 'grupos': {
        if (!idDeEtiquetaValido(corpo.labelid)) return erro('Escolha a etiqueta.')

        // Pagina por `offset` com teto: a busca nunca vira laço infinito, e mil grupos já é mais
        // do que uma instância deste painel tem.
        const jids = new Set<string>()
        let completo = true

        for (let pagina = 0; pagina < PAGINAS_MAXIMAS_DA_BUSCA; pagina++) {
          const r = await client.chat.find(token, {
            wa_isGroup: true,
            wa_label: corpo.labelid,
            limit: TAMANHO_DA_PAGINA_DA_BUSCA,
            offset: pagina * TAMANHO_DA_PAGINA_DA_BUSCA,
          })

          const daPagina = gruposDaBusca(r)
          daPagina.forEach((j) => jids.add(j))

          if ((r.chats?.length ?? 0) < TAMANHO_DA_PAGINA_DA_BUSCA) break
          if (pagina === PAGINAS_MAXIMAS_DA_BUSCA - 1) completo = false
        }

        return NextResponse.json({ grupos: [...jids], completo })
      }

      case 'aplicar':
      case 'remover': {
        if (!idDeEtiquetaValido(corpo.labelid)) return erro('Escolha a etiqueta.')
        if (!ehJidDeGrupo(corpo.groupjid)) return erro('Identificador de grupo inválido.')

        await client.labels.setChat(token, {
          number: corpo.groupjid,
          ...(corpo.acao === 'aplicar' ? { add_labelid: corpo.labelid } : { remove_labelid: corpo.labelid }),
        })
        return NextResponse.json({ ok: true })
      }

      case 'criar':
      case 'editar': {
        const nome = validarNomeDaEtiqueta(corpo.name)
        if (!nome.ok) return erro(nome.erro)
        const cor = validarCorDaEtiqueta(corpo.color)
        if (!cor.ok) return erro(cor.erro)

        if (corpo.acao === 'editar' && !idDeEtiquetaValido(corpo.labelid)) return erro('Escolha a etiqueta.')

        await client.labels.edit(token, {
          // `new` é o marcador de criação da própria API.
          labelid: corpo.acao === 'criar' ? 'new' : (corpo.labelid as string),
          name: nome.valor,
          color: cor.valor,
          delete: false,
        })

        console.log(`[groups/etiquetas] ${userId} ${corpo.acao === 'criar' ? 'criou' : 'editou'} a etiqueta "${nome.valor}" (instância ${instanceId})`)
        return NextResponse.json({ ok: true })
      }

      case 'apagar': {
        if (corpo.confirmar !== true) return erro('Confirme a exclusão da etiqueta.')
        if (!idDeEtiquetaValido(corpo.labelid)) return erro('Escolha a etiqueta.')

        await client.labels.edit(token, { labelid: corpo.labelid, name: '', color: 0, delete: true })

        console.log(`[groups/etiquetas] ${userId} apagou a etiqueta ${corpo.labelid} (instância ${instanceId})`)
        return NextResponse.json({ ok: true })
      }

      default:
        return erro('Ação inválida.')
    }
  } catch (err) {
    // Em número que não é Business, a leitura das etiquetas costuma falhar: explica em vez do 502 seco.
    if (corpo.acao === 'listar') {
      console.warn('[groups/etiquetas] falha ao listar:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: SEM_ETIQUETAS, semEtiquetas: true }, { status: 502 })
    }
    return respostaDeErroDaUazapi(err, 'etiquetas')
  }
}
