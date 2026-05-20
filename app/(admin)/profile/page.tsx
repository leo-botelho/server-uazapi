import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { UserCircle } from 'lucide-react'
import { ProfileForm } from './profile-form'

export default async function ProfilePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('admin_profiles')
    .select('full_name, uazapi_server_url, uazapi_admin_token')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UserCircle className="size-6 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Perfil</h1>
          <p className="text-muted-foreground">
            Configure seu servidor uazapiGO pessoal
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dados da conta</CardTitle>
            <CardDescription>
              Informações da sua conta de administrador
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm font-medium">Email</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Servidor uazapiGO</CardTitle>
            <CardDescription>
              {profile
                ? 'Edite as configurações do seu servidor uazapiGO.'
                : 'Nenhum servidor configurado ainda. Preencha os campos abaixo para usar um servidor dedicado.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              profile={
                profile
                  ? {
                      full_name: profile.full_name,
                      uazapi_server_url: profile.uazapi_server_url,
                      uazapi_admin_token: profile.uazapi_admin_token,
                    }
                  : null
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
