/**
 * Smart Skills — Angular S logo (marca 03/04)
 *
 * O "S" angular é traçado como uma polilinha de seis pontos formando
 * a letra S com cantos retos (90°). Dois círculos ciano marcam os
 * terminais da linha, criando o "ponto de sinal" da marca.
 *
 * Props:
 *  size   — tamanho em px do ícone (default 32)
 *  color  — cor da linha do S (default Off-White #F4F1EB)
 *  accent — cor dos pontos terminais (default Cyan #00D4FF)
 *  showWordmark — exibe "SMART / SKILLS" ao lado do ícone
 */

interface LogoProps {
  size?: number
  color?: string
  accent?: string
  showWordmark?: boolean
  wordmarkSize?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Logo({
  size = 32,
  color = '#F4F1EB',
  accent = '#00D4FF',
  showWordmark = false,
  wordmarkSize = 'md',
  className = '',
}: LogoProps) {
  const wordmarkClasses = {
    sm: { top: 'text-xs font-semibold tracking-widest', bottom: 'text-[10px] font-mono tracking-widest' },
    md: { top: 'text-sm font-semibold tracking-widest', bottom: 'text-xs font-mono tracking-widest' },
    lg: { top: 'text-base font-semibold tracking-widest', bottom: 'text-sm font-mono tracking-widest' },
  }

  const wm = wordmarkClasses[wordmarkSize]

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Angular S mark */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Smart Skills"
      >
        <polyline
          points="24,4 8,4 8,20 24,20 24,36 8,36"
          stroke={color}
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        {/* Terminal dots — sinalizam início e fim do traçado */}
        <circle cx="24" cy="4"  r="3.5" fill={accent} />
        <circle cx="8"  cy="36" r="3.5" fill={accent} />
      </svg>

      {showWordmark && (
        <div className="flex flex-col leading-none gap-0.5">
          <span className={`${wm.top} text-foreground`}>SMART</span>
          <span className={`${wm.bottom}`} style={{ color: accent }}>SKILLS</span>
        </div>
      )}
    </div>
  )
}
