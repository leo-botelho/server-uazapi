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
      instances: {
        Row: {
          id: string
          client_id: string | null
          server_id: string | null
          uazapi_token: string
          name: string
          status: 'connected' | 'disconnected' | 'connecting'
          phone_connected: string | null
          profile_name: string | null
          profile_picture: string | null
          last_disconnected_at: string | null
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
          status?: 'connected' | 'disconnected' | 'connecting'
          phone_connected?: string | null
          profile_name?: string | null
          profile_picture?: string | null
          last_disconnected_at?: string | null
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
          status?: 'connected' | 'disconnected' | 'connecting'
          phone_connected?: string | null
          profile_name?: string | null
          profile_picture?: string | null
          last_disconnected_at?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
