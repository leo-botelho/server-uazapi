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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
