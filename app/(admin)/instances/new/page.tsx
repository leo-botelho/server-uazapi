import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { NewInstanceForm } from './new-instance-form'

async function getClients() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('clients')
    .select('id, name')
    .eq('active', true)
    .order('name', { ascending: true })
  return data ?? []
}

export default async function NewInstancePage() {
  const clients = await getClients()

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" render={<Link href="/instances" />} className="gap-1">
          <ArrowLeft className="size-4" />
          Voltar
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Nova instância</h1>
        <p className="text-muted-foreground">
          Cria uma nova instância WhatsApp no uazapiGO e vincula ao banco
        </p>
      </div>

      <NewInstanceForm clients={clients} />
    </div>
  )
}
