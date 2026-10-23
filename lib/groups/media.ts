/**
 * Validação de arquivos enviados pelo painel (foto de grupo, mídia de mensagem).
 *
 * Pura: recebe o tipo declarado, o tamanho e os primeiros bytes, e decide. Fica
 * fora da rota para dar para testar sem subir servidor nem Storage.
 *
 * ⚠️ O servidor NÃO decodifica a imagem para ler dimensões. Decodificar é
 * trabalho pesado de CPU e este roda dentro do Worker que já estourou limite de
 * CPU. O redimensionamento para 640×640 acontece no navegador; aqui só se
 * confere o que é barato (tipo, tamanho e a assinatura do arquivo), e o 413/415
 * da própria uazapiGO fica como rede de segurança.
 */

export type FinalidadeDoArquivo = 'group_image' | 'message_media' | 'export'

/** Os mesmos tipos que o bucket `group-assets` aceita (migration 015). */
export const TIPOS_ACEITOS = [
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4',
  'audio/ogg', 'audio/mpeg',
  'application/pdf',
  'text/csv',
] as const

/** Limite do bucket. */
export const MAX_BYTES_MIDIA = 16 * 1024 * 1024

/**
 * Teto da foto de grupo.
 *
 * O WhatsApp exige JPEG de no máximo 640×640; uma imagem assim, a qualidade
 * 0,9, fica em dezenas de KB. 1 MB já é folga larga — acima disso a imagem não
 * passou pelo redimensionamento do navegador.
 */
export const MAX_BYTES_FOTO_DE_GRUPO = 1_000_000

const POR_FINALIDADE: Record<FinalidadeDoArquivo, readonly string[]> = {
  group_image: ['image/jpeg'],
  message_media: TIPOS_ACEITOS.filter((t) => t !== 'text/csv'),
  export: ['text/csv'],
}

const EXTENSAO: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'application/pdf': 'pdf', 'text/csv': 'csv',
}

export function extensaoDoTipo(mime: string): string {
  return EXTENSAO[mime] ?? 'bin'
}

/** Que tipo de envio da uazapiGO um arquivo vira, ou null se não é enviável como mídia. */
export function tipoDeMidiaPorMime(mime: string): 'image' | 'video' | 'audio' | 'document' | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'video/mp4') return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'document'
  return null
}

const ascii = (b: Uint8Array, de: number, ate: number) =>
  String.fromCharCode(...Array.from(b.slice(de, ate)))

/** A assinatura dos primeiros bytes bate com o tipo declarado? `null` = tipo sem assinatura conferível. */
export function assinaturaConfere(mime: string, inicio: Uint8Array): boolean | null {
  switch (mime) {
    case 'image/jpeg':
      return inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff
    case 'image/png':
      return inicio[0] === 0x89 && ascii(inicio, 1, 4) === 'PNG'
    case 'application/pdf':
      return ascii(inicio, 0, 4) === '%PDF'
    case 'video/mp4':
      return ascii(inicio, 4, 8) === 'ftyp'
    case 'image/webp':
      return ascii(inicio, 0, 4) === 'RIFF' && ascii(inicio, 8, 12) === 'WEBP'
    case 'audio/ogg':
      return ascii(inicio, 0, 4) === 'OggS'
    case 'audio/mpeg':
      // ID3 no começo, ou quadro MPEG (FF Fx).
      return ascii(inicio, 0, 3) === 'ID3' || (inicio[0] === 0xff && (inicio[1] & 0xe0) === 0xe0)
    default:
      return null
  }
}

export type ResultadoDoArquivo = { ok: true } | { ok: false; status: number; erro: string }

export function validarArquivo(
  finalidade: string,
  mime: string,
  bytes: number,
  inicio: Uint8Array
): ResultadoDoArquivo {
  if (!(finalidade in POR_FINALIDADE)) {
    return { ok: false, status: 400, erro: 'Finalidade do arquivo inválida.' }
  }
  const f = finalidade as FinalidadeDoArquivo

  if (bytes <= 0) return { ok: false, status: 400, erro: 'O arquivo está vazio.' }

  if (!POR_FINALIDADE[f].includes(mime)) {
    return {
      ok: false,
      status: 415,
      erro: f === 'group_image'
        ? 'A foto do grupo precisa ser JPEG. O painel converte sozinho — se chegou aqui, o redimensionamento falhou.'
        : 'Tipo de arquivo não aceito.',
    }
  }

  const teto = f === 'group_image' ? MAX_BYTES_FOTO_DE_GRUPO : MAX_BYTES_MIDIA
  if (bytes > teto) {
    return {
      ok: false,
      status: 413,
      erro: f === 'group_image'
        ? 'A foto do grupo passou de 1 MB, então não foi redimensionada para 640×640.'
        : `O arquivo passa de ${Math.round(teto / 1024 / 1024)} MB.`,
    }
  }

  // Declarar um tipo e mandar outro é o que um arquivo malicioso faz. O bucket é
  // público: HTML disfarçado de imagem não deve entrar nele.
  if (assinaturaConfere(mime, inicio) === false) {
    return { ok: false, status: 415, erro: 'O conteúdo do arquivo não bate com o tipo informado.' }
  }

  return { ok: true }
}
