import { PhoneForm } from '@/components/client/phone-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function ConnectPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-muted/50">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Connect WhatsApp</CardTitle>
          <CardDescription>
            Enter your phone number to find your WhatsApp instance and connect
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhoneForm />
        </CardContent>
      </Card>
    </div>
  )
}
