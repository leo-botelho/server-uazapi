import { Database, TriangleAlert } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Aviso de que a migration 015 ainda não foi aplicada.
 *
 * Existe porque as migrations deste projeto são aplicadas à mão no SQL Editor
 * do Supabase. Sem este aviso a tela quebraria com um 500 e ninguém saberia o
 * motivo — e o modo de falha pior já aconteceu aqui: escrita recusada em
 * silêncio, sem erro na tela.
 */
export function MigrationPending({ detalhe }: { detalhe?: string }) {
  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-400">
          <TriangleAlert className="size-4" aria-hidden />
          Falta aplicar a migration do módulo de grupos
        </CardTitle>
        <CardDescription>
          As tabelas ainda não existem no banco. Nada aqui funciona até isso ser feito —
          e, por segurança, o painel prefere avisar a gravar pela metade.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
          <li>Abra o SQL Editor do Supabase deste projeto.</li>
          <li>
            Cole o conteúdo de{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
              supabase/migrations/015_group_management.sql
            </code>
            .
          </li>
          <li>Execute e recarregue esta página.</li>
        </ol>

        <p className="flex items-start gap-2 text-muted-foreground">
          <Database className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            A migration cria seis tabelas, o bucket <code>group-assets</code> e as funções do
            agendador. Ela é idempotente: rodar duas vezes não causa problema, e o cabeçalho
            do arquivo traz o <code>rollback</code> caso você queira desfazer.
          </span>
        </p>

        {detalhe && (
          <p className="text-xs text-muted-foreground/80">
            Resposta do banco: <span className="font-mono">{detalhe}</span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
