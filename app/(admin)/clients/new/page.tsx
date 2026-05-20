import Link from 'next/link'
import { ArrowLeft, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NewClientForm } from './new-client-form'

export default function NewClientPage() {
  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" render={<Link href="/clients" />} className="gap-1">
          <ArrowLeft className="size-4" />
          Voltar
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Users className="size-6 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Novo cliente</h1>
          <p className="text-muted-foreground">
            Preencha os dados do novo cliente
          </p>
        </div>
      </div>

      <NewClientForm />
    </div>
  )
}
