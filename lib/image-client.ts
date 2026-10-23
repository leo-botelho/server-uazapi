/**
 * Prepara a foto de um grupo NO NAVEGADOR: JPEG, no máximo 640x640.
 *
 * O WhatsApp exige exatamente isso e recusa o resto (413 se grande demais, 415
 * se não for JPEG). Fazer aqui, e não no servidor, é decisão de custo: o Worker
 * não roda `sharp`, e decodificar imagem por WASM seria trabalho pesado de CPU
 * justamente no Worker que já estourou limite de CPU. No navegador a conta é da
 * máquina de quem está usando e não custa nada ao painel.
 */

/** Maior lado aceito pelo WhatsApp para a foto de grupo. */
export const LADO_MAXIMO_DA_FOTO = 640

/** Teto do arquivo final. O servidor recusa acima de 1 MB (`MAX_BYTES_FOTO_DE_GRUPO`). */
const BYTES_MAXIMOS = 900_000

/**
 * Dimensões finais: cabe em 640x640 mantendo a proporção, sem nunca ampliar.
 * Pura — é a única parte desta conta que dá para testar fora do navegador.
 */
export function dimensoesDaFoto(largura: number, altura: number): { largura: number; altura: number } {
  if (!(largura > 0) || !(altura > 0)) return { largura: 0, altura: 0 }

  const escala = Math.min(1, LADO_MAXIMO_DA_FOTO / largura, LADO_MAXIMO_DA_FOTO / altura)
  return {
    largura: Math.max(1, Math.round(largura * escala)),
    altura: Math.max(1, Math.round(altura * escala)),
  }
}

export interface FotoPreparada {
  blob: Blob
  largura: number
  altura: number
}

function paraBlob(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualidade))
}

/** Lê o arquivo como imagem. Lança com mensagem pronta para a tela se não for uma. */
async function lerImagem(arquivo: File): Promise<ImageBitmap | HTMLImageElement> {
  if (!arquivo.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo de imagem (JPG, PNG ou WebP).')
  }

  try {
    return await createImageBitmap(arquivo)
  } catch {
    // Navegadores sem createImageBitmap para esse formato: tenta pelo elemento <img>.
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(arquivo)
      const img = new Image()
      img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir essa imagem.')) }
      img.src = url
    })
  }
}

export async function prepararFotoDeGrupo(arquivo: File): Promise<FotoPreparada> {
  const imagem = await lerImagem(arquivo)

  const origemL = 'naturalWidth' in imagem ? imagem.naturalWidth : imagem.width
  const origemA = 'naturalHeight' in imagem ? imagem.naturalHeight : imagem.height
  const { largura, altura } = dimensoesDaFoto(origemL, origemA)

  if (largura === 0) throw new Error('A imagem está vazia ou corrompida.')

  const canvas = document.createElement('canvas')
  canvas.width = largura
  canvas.height = altura

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('O navegador não conseguiu preparar a imagem.')

  // JPEG não tem transparência: um PNG com fundo transparente viraria preto.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, largura, altura)
  ctx.drawImage(imagem, 0, 0, largura, altura)

  if ('close' in imagem) imagem.close()

  // Qualidade 0,9 primeiro; se ainda passar do teto, desce até caber.
  for (const qualidade of [0.9, 0.8, 0.7, 0.6]) {
    const blob = await paraBlob(canvas, qualidade)
    if (blob && blob.size <= BYTES_MAXIMOS) return { blob, largura, altura }
  }

  throw new Error('Não foi possível reduzir a imagem o bastante. Tente outra foto.')
}
