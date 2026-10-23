/**
 * Links de WhatsApp: conversa direta (`wa.me`) e convite de grupo.
 *
 * Os dois já abrem o app nativo — por isso não precisam de redirecionador nem
 * de banco, ao contrário de YouTube/Instagram (fase 5), que passam por uma
 * página intermediária que tenta o esquema do app.
 */

export type ResultadoDeLink =
  | { ok: true; url: string; aviso?: string }
  | { ok: false; erro: string }

/**
 * Link de conversa: `https://wa.me/<número>?text=<mensagem>`.
 *
 * O `wa.me` exige o número com código do país e SÓ dígitos. Telefone digitado
 * sem DDI (10 ou 11 dígitos, formato brasileiro) ganha o 55 — com aviso, porque
 * é uma suposição e o operador precisa poder corrigi-la.
 */
export function linkDeConversa(telefone: string, mensagem?: string): ResultadoDeLink {
  const digitos = telefone.replace(/\D/g, '')

  if (digitos.length === 0) return { ok: false, erro: 'Informe o telefone.' }

  let numero = digitos
  let aviso: string | undefined

  if (digitos.length === 10 || digitos.length === 11) {
    numero = `55${digitos}`
    aviso = 'Sem o código do país, assumi Brasil (55). Se o número for de outro país, digite com o código.'
  } else if (digitos.length < 10 || digitos.length > 15) {
    return { ok: false, erro: 'O telefone parece incompleto ou grande demais. Use código do país + DDD + número.' }
  }

  const texto = mensagem?.trim()
  const query = texto ? `?text=${encodeURIComponent(texto)}` : ''

  return { ok: true, url: `https://wa.me/${numero}${query}`, ...(aviso ? { aviso } : {}) }
}

const CODIGO_DE_CONVITE = /^[A-Za-z0-9]{10,40}$/

/**
 * Normaliza um convite de grupo: aceita a URL completa ou só o código e devolve
 * sempre `https://chat.whatsapp.com/<código>`.
 */
export function linkDeConvite(entrada: string): ResultadoDeLink {
  const bruto = entrada.trim()
  if (!bruto) return { ok: false, erro: 'Cole o link ou o código do convite.' }

  let codigo = bruto

  if (/^https?:\/\//i.test(bruto) || bruto.includes('/')) {
    let url: URL
    try {
      url = new URL(/^https?:\/\//i.test(bruto) ? bruto : `https://${bruto}`)
    } catch {
      return { ok: false, erro: 'Esse link não é um endereço válido.' }
    }

    // Só o domínio oficial. Um "convite" apontando para outro site é como
    // phishing circula em grupo de WhatsApp.
    if (url.hostname !== 'chat.whatsapp.com') {
      return { ok: false, erro: 'O link precisa ser de chat.whatsapp.com.' }
    }

    codigo = url.pathname.replace(/^\/+/, '').split('/')[0] ?? ''
  }

  if (!CODIGO_DE_CONVITE.test(codigo)) {
    return { ok: false, erro: 'O código do convite parece inválido.' }
  }

  return { ok: true, url: `https://chat.whatsapp.com/${codigo}` }
}
