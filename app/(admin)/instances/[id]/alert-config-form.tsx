'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface SenderInstance {
  id: string
  name: string
  phone_connected: string | null
}

interface AlertConfigFormProps {
  instanceId: string
  current: {
    alertChannel: string
    alertConfig: Record<string, unknown>
    silenceStart: number
    silenceEnd: number
  }
  senderInstances: SenderInstance[]
}

export function AlertConfigForm({
  instanceId,
  current,
  senderInstances,
}: AlertConfigFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Normalise: 'email' was the old DB default but is not implemented in the UI.
  // Treat it as 'none' so the Select never shows a value that isn't in its option list.
  const [channel, setChannel] = useState(
    current.alertChannel === 'email' ? 'none' : (current.alertChannel ?? 'none')
  )
  const [waFromId, setWaFromId] = useState<string>(
    (current.alertConfig['from_instance_id'] as string) ?? ''
  )
  const [waTo, setWaTo] = useState<string>(
    (current.alertConfig['to'] as string) ?? ''
  )
  const [n8nUrl, setN8nUrl] = useState<string>(
    (current.alertConfig['url'] as string) ?? ''
  )
  const [silenceStart, setSilenceStart] = useState(String(current.silenceStart ?? 23))
  const [silenceEnd, setSilenceEnd] = useState(String(current.silenceEnd ?? 7))

  async function handleSave() {
    let alertConfig: Record<string, unknown> = {}

    if (channel === 'whatsapp') {
      if (!waFromId) { toast.error('Selecione a instância remetente'); return }
      if (!waTo.trim()) { toast.error('Informe o telefone de destino'); return }
      alertConfig = { from_instance_id: waFromId, to: waTo.trim() }
    } else if (channel === 'n8n') {
      if (!n8nUrl.trim()) { toast.error('Informe a URL do webhook n8n'); return }
      alertConfig = { url: n8nUrl.trim() }
    }

    startTransition(async () => {
      const res = await fetch(`/api/instances/${instanceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertChannel: channel,
          alertConfig,
          silenceStart: parseInt(silenceStart, 10),
          silenceEnd: parseInt(silenceEnd, 10),
        }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        toast.error(data.error ?? 'Erro ao salvar configuração')
        return
      }

      toast.success('Configuração de alertas salva!')
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      {/* Channel */}
      <div className="space-y-2">
        <Label>Canal de notificação</Label>
        <Select value={channel} onValueChange={(v) => setChannel(v ?? 'none')}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Desativado</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="n8n">n8n Webhook</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Canal usado para notificar quando esta instância desconectar.
          Para envio de e-mail, use o canal <strong>n8n Webhook</strong> e configure o
          disparo no seu fluxo n8n.
        </p>
      </div>

      {/* WhatsApp config */}
      {channel === 'whatsapp' && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Configuração WhatsApp</p>

          <div className="space-y-2">
            <Label>Instância remetente</Label>
            <Select value={waFromId} onValueChange={(v) => setWaFromId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione a instância que vai enviar..." />
              </SelectTrigger>
              <SelectContent>
                {senderInstances.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.name}
                    {inst.phone_connected ? ` — ${inst.phone_connected}` : ' (desconectada)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Instância conectada que vai enviar a mensagem de alerta
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wa-to">Enviar para (telefone)</Label>
            <Input
              id="wa-to"
              placeholder="5511999999999"
              value={waTo}
              onChange={(e) => setWaTo(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Número que receberá a notificação — pode ser o do cliente ou o seu
            </p>
          </div>
        </div>
      )}

      {/* n8n config */}
      {channel === 'n8n' && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Configuração n8n</p>
          <div className="space-y-2">
            <Label htmlFor="n8n-url">URL do webhook</Label>
            <Input
              id="n8n-url"
              type="url"
              placeholder="https://n8n.exemplo.com/webhook/xyz"
              value={n8nUrl}
              onChange={(e) => setN8nUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              O payload enviado inclui: instanceId, instanceName, clientName, reconnectUrl
            </p>
          </div>
        </div>
      )}

      {/* Silence window */}
      {channel !== 'none' && (
        <div className="space-y-2">
          <Label>Janela de silêncio (hora UTC)</Label>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Das</span>
              <Input
                type="number"
                min={0}
                max={23}
                className="w-16"
                value={silenceStart}
                onChange={(e) => setSilenceStart(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">h</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">até</span>
              <Input
                type="number"
                min={0}
                max={23}
                className="w-16"
                value={silenceEnd}
                onChange={(e) => setSilenceEnd(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">h</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Notificações não são enviadas nesse intervalo. Padrão: 23h–7h UTC (20h–4h BRT).
            Para desativar, coloque os dois iguais.
          </p>
        </div>
      )}

      <Button onClick={handleSave} disabled={isPending} className="gap-2">
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        Salvar configuração
      </Button>
    </div>
  )
}
