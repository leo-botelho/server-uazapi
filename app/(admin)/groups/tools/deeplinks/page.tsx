import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

import { LinkGenerator } from './link-generator'

export default function DeepLinksPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/groups"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Grupos
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Links do WhatsApp</h1>
        <p className="text-muted-foreground">
          Links que abrem o app do WhatsApp direto, para usar em mensagens, descrições e divulgação.
        </p>
      </div>

      <LinkGenerator />
    </div>
  )
}
