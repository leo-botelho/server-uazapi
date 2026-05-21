import { PhoneForm } from '@/components/client/phone-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Logo } from '@/components/brand/logo'

export default function ConnectPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-4 bg-background">
      {/* Logo centralizado acima do card */}
      <Logo size={40} showWordmark wordmarkSize="lg" />

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Conectar WhatsApp</CardTitle>
          <CardDescription>
            Digite seu número de telefone para encontrar sua instância e conectar
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhoneForm />
        </CardContent>
      </Card>
    </div>
  )
}
