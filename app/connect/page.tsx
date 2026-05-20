import { PhoneForm } from '@/components/client/phone-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function ConnectPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-muted/50">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Conectar WhatsApp</CardTitle>
          <CardDescription>
            Digite seu número de telefone para encontrar sua instância WhatsApp e conectar
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhoneForm />
        </CardContent>
      </Card>
    </div>
  )
}
