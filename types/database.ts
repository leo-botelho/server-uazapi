// This file is a placeholder for Supabase generated types.
// Run `npx supabase gen types typescript --project-id <your-project-id> > types/database.ts`
// to generate the actual types from your Supabase project.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/**
 * O que um passo de tarefa de grupo faz.
 *
 * Espelha o CHECK de `group_task_steps.kind` na migration 015 — mexer num lado
 * sem mexer no outro faz a escrita falhar calada no PostgREST.
 */
export type GroupTaskKind =
  | 'send_text'
  | 'send_media'
  | 'send_buttons'
  | 'send_poll'
  | 'update_name'
  | 'update_description'
  | 'update_image'
  | 'update_announce'
  | 'update_locked'
  | 'update_join_approval'
  | 'update_member_add_mode'
  | 'update_ephemeral'
  | 'participants_add'
  | 'participants_remove'
  | 'participants_promote'
  | 'participants_demote'
  | 'reset_invite'
  | 'leave'
  | 'export_participants'

export type Database = {
  public: {
    Tables: {
      admin_profiles: {
        Row: {
          id: string
          full_name: string | null
          uazapi_server_url: string
          uazapi_admin_token: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          uazapi_server_url?: string
          uazapi_admin_token?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          uazapi_server_url?: string
          uazapi_admin_token?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      servers: {
        Row: {
          id: string
          name: string
          url: string
          admin_token: string
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          url: string
          admin_token: string
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          url?: string
          admin_token?: string
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          name: string
          email: string | null
          phones: string[]
          proxy_city: string | null
          proxy_state: string | null
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          email?: string | null
          phones?: string[]
          proxy_city?: string | null
          proxy_state?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          email?: string | null
          phones?: string[]
          proxy_city?: string | null
          proxy_state?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      webhook_heartbeat: {
        Row: {
          id: boolean
          last_event_at: string
          last_event_type: string | null
        }
        Insert: {
          id?: boolean
          last_event_at?: string
          last_event_type?: string | null
        }
        Update: {
          id?: boolean
          last_event_at?: string
          last_event_type?: string | null
        }
        Relationships: []
      }
      instances: {
        Row: {
          id: string
          client_id: string | null
          server_id: string | null
          uazapi_token: string
          name: string
          status: 'connected' | 'disconnected' | 'connecting' | 'hibernated'
          phone_connected: string | null
          profile_name: string | null
          profile_picture: string | null
          last_disconnected_at: string | null
          last_seen_at: string | null
          missing_since: string | null
          alert_channel: 'email' | 'whatsapp' | 'n8n' | 'none'
          alert_config: Json
          silence_start: number
          silence_end: number
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id?: string | null
          server_id?: string | null
          uazapi_token: string
          name: string
          status?: 'connected' | 'disconnected' | 'connecting' | 'hibernated'
          phone_connected?: string | null
          profile_name?: string | null
          profile_picture?: string | null
          last_disconnected_at?: string | null
          last_seen_at?: string | null
          missing_since?: string | null
          alert_channel?: 'email' | 'whatsapp' | 'n8n' | 'none'
          alert_config?: Json
          silence_start?: number
          silence_end?: number
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          client_id?: string | null
          server_id?: string | null
          uazapi_token?: string
          name?: string
          status?: 'connected' | 'disconnected' | 'connecting' | 'hibernated'
          phone_connected?: string | null
          profile_name?: string | null
          profile_picture?: string | null
          last_disconnected_at?: string | null
          last_seen_at?: string | null
          missing_since?: string | null
          alert_channel?: 'email' | 'whatsapp' | 'n8n' | 'none'
          alert_config?: Json
          silence_start?: number
          silence_end?: number
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'instances_client_id_fkey'
            columns: ['client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'instances_server_id_fkey'
            columns: ['server_id']
            isOneToOne: false
            referencedRelation: 'servers'
            referencedColumns: ['id']
          }
        ]
      }
      webhook_events: {
        Row: {
          id: string
          instance_id: string | null
          event_type: string
          payload: Json
          received_at: string
        }
        Insert: {
          id?: string
          instance_id?: string | null
          event_type: string
          payload: Json
          received_at?: string
        }
        Update: {
          id?: string
          instance_id?: string | null
          event_type?: string
          payload?: Json
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'webhook_events_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'instances'
            referencedColumns: ['id']
          }
        ]
      }
      reconnect_tokens: {
        Row: {
          id: string
          instance_id: string
          token: string
          expires_at: string
          used_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          instance_id: string
          token?: string
          expires_at?: string
          used_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          instance_id?: string
          token?: string
          expires_at?: string
          used_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'reconnect_tokens_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'instances'
            referencedColumns: ['id']
          }
        ]
      }
      notifications_log: {
        Row: {
          id: string
          instance_id: string | null
          channel: string
          recipient: string | null
          scheduled_for: string | null
          reason: string | null
          status: 'pending' | 'sent' | 'failed'
          error: string | null
          sent_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          instance_id?: string | null
          channel: string
          recipient?: string | null
          scheduled_for?: string | null
          reason?: string | null
          status?: 'pending' | 'sent' | 'failed'
          error?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          instance_id?: string | null
          channel?: string
          recipient?: string | null
          scheduled_for?: string | null
          reason?: string | null
          status?: 'pending' | 'sent' | 'failed'
          error?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_log_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'instances'
            referencedColumns: ['id']
          }
        ]
      }
      // ── Consumo de tokens de IA (migration 011) ─────────────────────────
      token_usage_log: {
        Row: {
          id: number
          execution_id: number
          workflow_id: string
          workflow_name: string
          node_name: string
          node_type: string
          provider: string
          model: string | null
          session_id: string | null
          prompt_tokens: number
          completion_tokens: number
          total_tokens: number
          call_count: number
          collected_at: string
          executed_at: string | null
        }
        Insert: {
          id?: number
          execution_id: number
          workflow_id: string
          workflow_name: string
          node_name: string
          node_type: string
          provider: string
          model?: string | null
          session_id?: string | null
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          call_count?: number
          collected_at?: string
          executed_at?: string | null
        }
        Update: {
          id?: number
          execution_id?: number
          workflow_id?: string
          workflow_name?: string
          node_name?: string
          node_type?: string
          provider?: string
          model?: string | null
          session_id?: string | null
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          call_count?: number
          collected_at?: string
          executed_at?: string | null
        }
        Relationships: []
      }
      model_pricing: {
        Row: {
          model: string
          price_input_per_1m: number
          price_output_per_1m: number
          updated_at: string
        }
        Insert: {
          model: string
          price_input_per_1m?: number
          price_output_per_1m?: number
          updated_at?: string
        }
        Update: {
          model?: string
          price_input_per_1m?: number
          price_output_per_1m?: number
          updated_at?: string
        }
        Relationships: []
      }
      exchange_rate: {
        Row: {
          id: number
          usd_to_brl: number
          updated_at: string
        }
        Insert: {
          id?: number
          usd_to_brl: number
          updated_at?: string
        }
        Update: {
          id?: number
          usd_to_brl?: number
          updated_at?: string
        }
        Relationships: []
      }
      token_usage_sync_state: {
        Row: {
          workflow_id: string
          workflow_name: string | null
          last_execution_id: number
          updated_at: string
        }
        Insert: {
          workflow_id: string
          workflow_name?: string | null
          last_execution_id?: number
          updated_at?: string
        }
        Update: {
          workflow_id?: string
          workflow_name?: string | null
          last_execution_id?: number
          updated_at?: string
        }
        Relationships: []
      }

      // ── Módulo de grupos (migration 015) ──────────────────────────────────

      /**
       * Cache dos grupos de cada instância.
       *
       * ⚠️ Não é alimentado por webhook: o evento `groups` só existe no webhook
       * GLOBAL, e o webhook POR INSTÂNCIA pertence aos agentes de IA no n8n.
       * Atualiza por TTL, por botão, e pelo `group` que toda mutação devolve.
       */
      group_cache: {
        Row: {
          instance_id: string
          group_jid: string
          name: string | null
          topic: string | null
          owner_jid: string | null
          image_url: string | null
          /** Quantidade, nunca a lista: o array de participantes é dado pessoal. */
          participant_count: number | null
          /** Portão de toda edição: somos admin deste grupo? */
          owner_is_admin: boolean
          /** Portão de todo envio: podemos falar neste grupo? */
          owner_can_send: boolean
          is_announce: boolean | null
          is_locked: boolean | null
          is_parent: boolean | null
          is_join_approval_required: boolean | null
          member_add_mode: string | null
          is_ephemeral: boolean | null
          disappearing_timer: number | null
          linked_parent_jid: string | null
          addressing_mode: string | null
          invite_link: string | null
          group_created: string | null
          raw: Json | null
          fetched_at: string
        }
        Insert: {
          instance_id: string
          group_jid: string
          name?: string | null
          topic?: string | null
          owner_jid?: string | null
          image_url?: string | null
          participant_count?: number | null
          owner_is_admin?: boolean
          owner_can_send?: boolean
          is_announce?: boolean | null
          is_locked?: boolean | null
          is_parent?: boolean | null
          is_join_approval_required?: boolean | null
          member_add_mode?: string | null
          is_ephemeral?: boolean | null
          disappearing_timer?: number | null
          linked_parent_jid?: string | null
          addressing_mode?: string | null
          invite_link?: string | null
          group_created?: string | null
          raw?: Json | null
          fetched_at?: string
        }
        Update: {
          name?: string | null
          topic?: string | null
          owner_jid?: string | null
          image_url?: string | null
          participant_count?: number | null
          owner_is_admin?: boolean
          owner_can_send?: boolean
          is_announce?: boolean | null
          is_locked?: boolean | null
          is_parent?: boolean | null
          is_join_approval_required?: boolean | null
          member_add_mode?: string | null
          is_ephemeral?: boolean | null
          disappearing_timer?: number | null
          linked_parent_jid?: string | null
          addressing_mode?: string | null
          invite_link?: string | null
          group_created?: string | null
          raw?: Json | null
          fetched_at?: string
        }
        Relationships: []
      }

      group_media: {
        Row: {
          id: string
          instance_id: string | null
          bucket: string
          path: string
          public_url: string
          mime: string
          bytes: number
          width: number | null
          height: number | null
          purpose: 'group_image' | 'message_media' | 'export'
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          instance_id?: string | null
          bucket?: string
          path: string
          public_url: string
          mime: string
          bytes: number
          width?: number | null
          height?: number | null
          purpose: 'group_image' | 'message_media' | 'export'
          created_by?: string | null
          created_at?: string
        }
        Update: {
          public_url?: string
          width?: number | null
          height?: number | null
        }
        Relationships: []
      }

      group_tasks: {
        Row: {
          id: string
          instance_id: string
          name: string
          target_jids: string[]
          /** Segundos entre um grupo e o próximo. Mínimo 5; 60 quando marca todos. */
          spacing_seconds: number
          spacing_jitter_pct: number
          mention_all: boolean
          starts_at: string | null
          status: 'draft' | 'scheduled' | 'running' | 'paused' | 'done' | 'canceled' | 'blocked'
          blocked_reason: string | null
          wa_limits_snapshot: Json | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          instance_id: string
          name: string
          target_jids: string[]
          spacing_seconds?: number
          spacing_jitter_pct?: number
          mention_all?: boolean
          starts_at?: string | null
          status?: 'draft' | 'scheduled' | 'running' | 'paused' | 'done' | 'canceled' | 'blocked'
          blocked_reason?: string | null
          wa_limits_snapshot?: Json | null
          created_by?: string | null
        }
        Update: {
          name?: string
          target_jids?: string[]
          spacing_seconds?: number
          spacing_jitter_pct?: number
          mention_all?: boolean
          starts_at?: string | null
          status?: 'draft' | 'scheduled' | 'running' | 'paused' | 'done' | 'canceled' | 'blocked'
          blocked_reason?: string | null
          wa_limits_snapshot?: Json | null
          updated_at?: string
        }
        Relationships: []
      }

      group_task_steps: {
        Row: {
          id: string
          task_id: string
          step_order: number
          kind: GroupTaskKind
          payload: Json
          schedule_mode: 'absolute' | 'offset'
          /** Uma ocorrência por data/hora desta lista. */
          absolute_ats: string[] | null
          /** Drip: ocorre em group_tasks.starts_at + offset_minutes. */
          offset_minutes: number | null
          recurrence: Json | null
        }
        Insert: {
          id?: string
          task_id: string
          step_order: number
          kind: GroupTaskKind
          payload: Json
          schedule_mode: 'absolute' | 'offset'
          absolute_ats?: string[] | null
          offset_minutes?: number | null
          recurrence?: Json | null
        }
        Update: {
          step_order?: number
          kind?: GroupTaskKind
          payload?: Json
          schedule_mode?: 'absolute' | 'offset'
          absolute_ats?: string[] | null
          offset_minutes?: number | null
        }
        Relationships: []
      }

      group_task_runs: {
        Row: {
          id: string
          task_id: string
          step_id: string
          run_at: string
          /** Alvos fotografados na abertura: editar a tarefa não reescreve o histórico. */
          resolved_jids: string[] | null
          opened_at: string | null
          status:
            | 'scheduled' | 'open' | 'running' | 'paused'
            | 'done' | 'failed' | 'canceled' | 'blocked_by_wa_limits'
          last_action_at: string | null
          total: number
          succeeded: number
          failed: number
          blocked_reason: string | null
        }
        Insert: {
          id?: string
          task_id: string
          step_id: string
          run_at: string
          resolved_jids?: string[] | null
          opened_at?: string | null
          total?: number
          status?:
            | 'scheduled' | 'open' | 'running' | 'paused'
            | 'done' | 'failed' | 'canceled' | 'blocked_by_wa_limits'
        }
        Update: {
          status?:
            | 'scheduled' | 'open' | 'running' | 'paused'
            | 'done' | 'failed' | 'canceled' | 'blocked_by_wa_limits'
          last_action_at?: string | null
          blocked_reason?: string | null
          resolved_jids?: string[] | null
          total?: number
          succeeded?: number
          failed?: number
        }
        Relationships: []
      }

      /**
       * A fila de trabalho.
       *
       * ⚠️ Não existe flag de "enviado" no nível do lote: cada item é
       * individualmente terminal, com lease próprio (`claimed_at`). É isso que
       * faz uma passada interrompida no meio não duplicar envio.
       */
      group_task_items: {
        Row: {
          id: number
          run_id: string
          group_jid: string
          seq: number
          not_before: string
          status: 'pending' | 'running' | 'sent' | 'failed' | 'skipped' | 'canceled'
          attempts: number
          claimed_at: string | null
          executed_at: string | null
          error: string | null
          response: Json | null
        }
        Insert: {
          run_id: string
          group_jid: string
          seq: number
          not_before: string
          status?: 'pending' | 'running' | 'sent' | 'failed' | 'skipped' | 'canceled'
          attempts?: number
          executed_at?: string | null
          error?: string | null
          response?: Json | null
        }
        Update: {
          status?: 'pending' | 'running' | 'sent' | 'failed' | 'skipped' | 'canceled'
          attempts?: number
          claimed_at?: string | null
          executed_at?: string | null
          error?: string | null
          response?: Json | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      // Limpeza em lotes (migration 013): devolve quantas linhas foram apagadas.
      purge_webhook_events: {
        Args: { p_cutoff: string; p_limit?: number }
        Returns: number
      }
      purge_reconnect_tokens: {
        Args: { p_cutoff: string; p_limit?: number }
        Returns: number
      }
      token_cost_por_agente: {
        Args: { p_desde: string; p_ate: string }
        Returns: {
          workflow_name: string
          custo_usd: number
          prompt_tokens: number
          completion_tokens: number
          total_tokens: number
          chamadas: number
          execucoes: number
          conversas: number
          tokens_sem_preco: number
          modelos: string[]
          modelos_sem_preco: string[]
          ultima_execucao: string | null
        }[]
      }
      token_cost_diario: {
        Args: { p_desde: string; p_ate: string }
        Returns: {
          dia: string
          workflow_name: string
          custo_usd: number
          total_tokens: number
        }[]
      }

      // ── Módulo de grupos (migration 015) ──────────────────────────────────

      /**
       * Materializa as ocorrências vencidas e reivindica até `p_limit` items
       * com lease, já com as credenciais da instância e os portões do grupo.
       *
       * UMA ida ao banco: o Worker não resolve servidor/token por conta própria.
       * `p_horizon_seconds` traz também os items que vencem dentro do orçamento
       * da passada — é assim que um espaçamento curto rende vários envios numa
       * passada só, com a rota dormindo entre eles.
       */
      claim_group_task_items: {
        Args: {
          p_limit?: number
          p_lease_minutes?: number
          p_horizon_seconds?: number
        }
        Returns: {
          item_id: number
          run_id: string
          task_id: string
          group_jid: string
          seq: number
          not_before: string
          kind: GroupTaskKind
          payload: Json
          instance_id: string
          uazapi_token: string
          server_url: string | null
          admin_token: string | null
          spacing_seconds: number
          spacing_jitter_pct: number
          mention_all: boolean
          owner_is_admin: boolean
          owner_can_send: boolean
          group_name: string | null
        }[]
      }
      open_due_group_runs: {
        Args: Record<string, never>
        Returns: number
      }
      /** Devolve à fila os items cujo lease venceu. Após 3 tentativas, falha. */
      reclaim_stale_group_items: {
        Args: { p_minutes?: number }
        Returns: number
      }
      refresh_group_cache_upsert: {
        Args: { p_instance: string; p_rows: Json }
        Returns: number
      }
      purge_group_history: {
        Args: { p_cutoff: string; p_limit?: number }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Helper types
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
export type InsertTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']
export type UpdateTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
