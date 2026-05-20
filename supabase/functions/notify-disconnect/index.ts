// Supabase Edge Function: notify-disconnect
// Triggered when a WhatsApp instance disconnects
// Sends notification via configured channel (email, WhatsApp, n8n webhook)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface NotifyRequest {
  instance_id: string
  reason?: string
}

interface Instance {
  id: string
  name: string
  phone_connected: string | null
  alert_channel: 'email' | 'whatsapp' | 'n8n' | 'none'
  alert_config: {
    email?: string
    whatsapp_number?: string
    n8n_webhook_url?: string
  }
  silence_start: number
  silence_end: number
  client: {
    name: string
    email: string | null
    phones: string[]
  } | null
}

Deno.serve(async (req) => {
  try {
    const { instance_id, reason } = await req.json() as NotifyRequest

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get instance with client info
    const { data: instance, error } = await supabase
      .from('instances')
      .select(`
        id,
        name,
        phone_connected,
        alert_channel,
        alert_config,
        silence_start,
        silence_end,
        client:clients(name, email, phones)
      `)
      .eq('id', instance_id)
      .single()

    if (error || !instance) {
      return new Response(
        JSON.stringify({ error: 'Instance not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const typedInstance = instance as unknown as Instance

    // Check silence hours
    const now = new Date()
    const currentHour = now.getHours()
    const { silence_start, silence_end } = typedInstance

    const isInSilenceHours = silence_start <= silence_end
      ? currentHour >= silence_start && currentHour < silence_end
      : currentHour >= silence_start || currentHour < silence_end

    if (isInSilenceHours) {
      return new Response(
        JSON.stringify({ status: 'skipped', reason: 'silence_hours' }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Skip if no alert channel configured
    if (typedInstance.alert_channel === 'none') {
      return new Response(
        JSON.stringify({ status: 'skipped', reason: 'alerts_disabled' }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Create notification log entry
    const { data: notification } = await supabase
      .from('notifications_log')
      .insert({
        instance_id,
        channel: typedInstance.alert_channel,
        recipient: getRecipient(typedInstance),
        status: 'pending',
      })
      .select()
      .single()

    // Send notification based on channel
    let result: { success: boolean; error?: string }

    switch (typedInstance.alert_channel) {
      case 'email':
        result = await sendEmailNotification(typedInstance, reason)
        break
      case 'whatsapp':
        result = await sendWhatsAppNotification(typedInstance, reason)
        break
      case 'n8n':
        result = await sendN8nWebhook(typedInstance, reason)
        break
      default:
        result = { success: false, error: 'Unknown channel' }
    }

    // Update notification log
    if (notification) {
      await supabase
        .from('notifications_log')
        .update({
          status: result.success ? 'sent' : 'failed',
          error: result.error,
          sent_at: result.success ? new Date().toISOString() : null,
        })
        .eq('id', notification.id)
    }

    return new Response(
      JSON.stringify({ status: result.success ? 'sent' : 'failed', ...result }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

function getRecipient(instance: Instance): string | null {
  const config = instance.alert_config
  switch (instance.alert_channel) {
    case 'email':
      return config.email || instance.client?.email || null
    case 'whatsapp':
      return config.whatsapp_number || instance.client?.phones?.[0] || null
    case 'n8n':
      return config.n8n_webhook_url || null
    default:
      return null
  }
}

async function sendEmailNotification(
  instance: Instance,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  // TODO: Implement email sending via Resend, SendGrid, or similar
  // For now, just log and return success
  console.log('Sending email notification for instance:', instance.name, 'reason:', reason)
  return { success: true }
}

async function sendWhatsAppNotification(
  instance: Instance,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  // TODO: Implement WhatsApp notification via uazapiGO
  console.log('Sending WhatsApp notification for instance:', instance.name, 'reason:', reason)
  return { success: true }
}

async function sendN8nWebhook(
  instance: Instance,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const webhookUrl = instance.alert_config.n8n_webhook_url
  if (!webhookUrl) {
    return { success: false, error: 'No webhook URL configured' }
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'instance_disconnected',
        instance: {
          id: instance.id,
          name: instance.name,
          phone: instance.phone_connected,
        },
        client: instance.client,
        reason,
        timestamp: new Date().toISOString(),
      }),
    })

    if (!response.ok) {
      return { success: false, error: `Webhook returned ${response.status}` }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
