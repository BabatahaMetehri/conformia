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
      app_settings: {
        Row: {
          description: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
          value_type: string
        }
        Insert: {
          description: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
          value_type: string
        }
        Update: {
          description?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
          value_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2026m08: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2026m09: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2026m10: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2026m11: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2026m12: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2027m01: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2027m02: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2027m03: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2027m04: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2027m05: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2027m06: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2027m07: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2027m08: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2027m09: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2027m10: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2027m11: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2027m12: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2028m01: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2028m02: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2028m03: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2028m04: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2028m05: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2028m06: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2028m07: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2028m08: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2028m09: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_log_2028m10: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_id_ref: string | null
          entity_table: string
          id: number
          ip_address: unknown
          occurred_at: string
          on_behalf_of_id: string | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          changed_fields?: string[] | null
          entity_id?: string | null
          entity_id_ref?: string | null
          entity_table?: string
          id?: number
          ip_address?: unknown
          occurred_at?: string
          on_behalf_of_id?: string | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      audit_redacted_columns: {
        Row: {
          column_name: string
          reason: string
          table_name: string
        }
        Insert: {
          column_name: string
          reason: string
          table_name: string
        }
        Update: {
          column_name?: string
          reason?: string
          table_name?: string
        }
        Relationships: []
      }
      auth_attempts: {
        Row: {
          attempted_at: string
          email: string
          id: number
          ip_address: unknown
          succeeded: boolean
          user_agent: string | null
        }
        Insert: {
          attempted_at?: string
          email: string
          id?: number
          ip_address?: unknown
          succeeded?: boolean
          user_agent?: string | null
        }
        Update: {
          attempted_at?: string
          email?: string
          id?: number
          ip_address?: unknown
          succeeded?: boolean
          user_agent?: string | null
        }
        Relationships: []
      }
      authorities: {
        Row: {
          code: string
          contact_info: Json
          id: string
          name: string
          notes: string | null
          portal_url: string | null
        }
        Insert: {
          code: string
          contact_info?: Json
          id?: string
          name: string
          notes?: string | null
          portal_url?: string | null
        }
        Update: {
          code?: string
          contact_info?: Json
          id?: string
          name?: string
          notes?: string | null
          portal_url?: string | null
        }
        Relationships: []
      }
      backup_runs: {
        Row: {
          detail: string | null
          finished_at: string | null
          id: number
          size_bytes: number | null
          started_at: string
          status: string
        }
        Insert: {
          detail?: string | null
          finished_at?: string | null
          id?: number
          size_bytes?: number | null
          started_at?: string
          status: string
        }
        Update: {
          detail?: string | null
          finished_at?: string | null
          id?: number
          size_bytes?: number | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      departments: {
        Row: {
          code: string
          created_at: string
          entity_id: string
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          entity_id?: string
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          entity_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      document_access_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2026m08: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2026m09: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2026m10: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2026m11: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2026m12: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2027m01: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2027m02: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2027m03: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2027m04: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2027m05: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2027m06: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2027m07: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2027m08: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2027m09: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2027m10: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2027m11: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2027m12: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2028m01: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2028m02: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2028m03: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2028m04: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2028m05: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2028m06: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2028m07: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2028m08: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2028m09: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_access_log_2028m10: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          document_id: string
          id: number
          ip_address: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          document_id: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          document_id?: string
          id?: number
          ip_address?: unknown
          user_agent?: string | null
        }
        Relationships: []
      }
      document_integrity_checks: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          acknowledgement_note: string | null
          actual_sha256: string | null
          checked_at: string
          document_id: string
          expected_sha256: string
          id: number
          observed_size_bytes: number | null
          run_id: string
          status: Database["public"]["Enums"]["document_integrity_status"]
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledgement_note?: string | null
          actual_sha256?: string | null
          checked_at?: string
          document_id: string
          expected_sha256: string
          id?: number
          observed_size_bytes?: number | null
          run_id: string
          status: Database["public"]["Enums"]["document_integrity_status"]
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledgement_note?: string | null
          actual_sha256?: string | null
          checked_at?: string
          document_id?: string
          expected_sha256?: string
          id?: number
          observed_size_bytes?: number | null
          run_id?: string
          status?: Database["public"]["Enums"]["document_integrity_status"]
        }
        Relationships: [
          {
            foreignKeyName: "document_integrity_checks_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_integrity_checks_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_integrity_checks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_integrity_checks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents_pending_purge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_integrity_checks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["id"]
          },
        ]
      }
      document_upload_tickets: {
        Row: {
          bucket: string
          checklist_item_id: string | null
          consumed_at: string | null
          consumed_document_id: string | null
          created_at: string
          created_by: string
          declared_mime_type: string
          declared_size_bytes: number
          document_kind: string | null
          entity_id: string
          expires_at: string
          id: string
          normalized_filename: string
          occurrence_id: string
          original_filename: string
          rejected_at: string | null
          rejection_reason: string | null
          storage_path: string
          supersedes_id: string | null
          version: number
        }
        Insert: {
          bucket?: string
          checklist_item_id?: string | null
          consumed_at?: string | null
          consumed_document_id?: string | null
          created_at?: string
          created_by: string
          declared_mime_type: string
          declared_size_bytes: number
          document_kind?: string | null
          entity_id: string
          expires_at: string
          id?: string
          normalized_filename: string
          occurrence_id: string
          original_filename: string
          rejected_at?: string | null
          rejection_reason?: string | null
          storage_path: string
          supersedes_id?: string | null
          version: number
        }
        Update: {
          bucket?: string
          checklist_item_id?: string | null
          consumed_at?: string | null
          consumed_document_id?: string | null
          created_at?: string
          created_by?: string
          declared_mime_type?: string
          declared_size_bytes?: number
          document_kind?: string | null
          entity_id?: string
          expires_at?: string
          id?: string
          normalized_filename?: string
          occurrence_id?: string
          original_filename?: string
          rejected_at?: string | null
          rejection_reason?: string | null
          storage_path?: string
          supersedes_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_upload_tickets_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "occurrence_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_tickets_consumed_document_id_fkey"
            columns: ["consumed_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_tickets_consumed_document_id_fkey"
            columns: ["consumed_document_id"]
            isOneToOne: false
            referencedRelation: "documents_pending_purge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_tickets_consumed_document_id_fkey"
            columns: ["consumed_document_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_tickets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_tickets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_tickets_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_tickets_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "obligation_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_tickets_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrence_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_tickets_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "validation_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_tickets_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_tickets_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "documents_pending_purge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_tickets_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          bucket: string
          checklist_item_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          detected_mime_type: string | null
          document_kind: string | null
          entity_id: string
          id: string
          integrity_checked_at: string | null
          integrity_status: Database["public"]["Enums"]["document_integrity_status"]
          mime_type: string
          normalized_filename: string
          occurrence_id: string
          original_filename: string
          sha256: string
          size_bytes: number
          storage_path: string
          supersedes_id: string | null
          uploaded_at: string
          uploaded_by: string
          version: number
        }
        Insert: {
          bucket?: string
          checklist_item_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          detected_mime_type?: string | null
          document_kind?: string | null
          entity_id?: string
          id?: string
          integrity_checked_at?: string | null
          integrity_status?: Database["public"]["Enums"]["document_integrity_status"]
          mime_type: string
          normalized_filename: string
          occurrence_id: string
          original_filename: string
          sha256: string
          size_bytes: number
          storage_path: string
          supersedes_id?: string | null
          uploaded_at?: string
          uploaded_by: string
          version?: number
        }
        Update: {
          bucket?: string
          checklist_item_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          detected_mime_type?: string | null
          document_kind?: string | null
          entity_id?: string
          id?: string
          integrity_checked_at?: string | null
          integrity_status?: Database["public"]["Enums"]["document_integrity_status"]
          mime_type?: string
          normalized_filename?: string
          occurrence_id?: string
          original_filename?: string
          sha256?: string
          size_bytes?: number
          storage_path?: string
          supersedes_id?: string | null
          uploaded_at?: string
          uploaded_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "occurrence_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "obligation_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrence_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "validation_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "documents_pending_purge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      domains: {
        Row: {
          code: string
          id: string
          label: string
        }
        Insert: {
          code: string
          id?: string
          label: string
        }
        Update: {
          code?: string
          id?: string
          label?: string
        }
        Relationships: []
      }
      entities: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      holidays: {
        Row: {
          created_at: string
          created_by: string | null
          holiday_date: string
          id: string
          is_recurring: boolean
          label: string
          source: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          holiday_date: string
          id?: string
          is_recurring?: boolean
          label: string
          source?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          holiday_date?: string
          id?: string
          is_recurring?: boolean
          label?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "holidays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holidays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          id: number
          kind: string
          occurrence_id: string | null
          read_at: string | null
          reason: string | null
          recipient_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: number
          kind: string
          occurrence_id?: string | null
          read_at?: string | null
          reason?: string | null
          recipient_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: number
          kind?: string
          occurrence_id?: string | null
          read_at?: string | null
          reason?: string | null
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "obligation_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrence_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "validation_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      obligation_occurrences: {
        Row: {
          created_at: string
          deleted_at: string | null
          entity_id: string
          event_date: string | null
          expiry_date: string | null
          id: string
          internal_due_date: string
          is_locked: boolean
          late_reason: string | null
          late_reason_code:
            | Database["public"]["Enums"]["late_reason_code"]
            | null
          legal_due_date: string
          locked_at: string | null
          locked_by: string | null
          na_reason: string | null
          obligation_type_id: string
          owner_id: string | null
          penalty_incurred: boolean
          penalty_note: string | null
          period_end: string
          period_key: string
          period_start: string
          rectification_index: number
          rectifies_occurrence_id: string | null
          reference_number: string | null
          rejection_reason: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["occurrence_status"]
          submitted_at: string | null
          submitted_by: string | null
          submitted_for_validation_at: string | null
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          validator_id: string | null
          version: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          entity_id?: string
          event_date?: string | null
          expiry_date?: string | null
          id?: string
          internal_due_date: string
          is_locked?: boolean
          late_reason?: string | null
          late_reason_code?:
            | Database["public"]["Enums"]["late_reason_code"]
            | null
          legal_due_date: string
          locked_at?: string | null
          locked_by?: string | null
          na_reason?: string | null
          obligation_type_id: string
          owner_id?: string | null
          penalty_incurred?: boolean
          penalty_note?: string | null
          period_end: string
          period_key: string
          period_start: string
          rectification_index?: number
          rectifies_occurrence_id?: string | null
          reference_number?: string | null
          rejection_reason?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["occurrence_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          submitted_for_validation_at?: string | null
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          validator_id?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          entity_id?: string
          event_date?: string | null
          expiry_date?: string | null
          id?: string
          internal_due_date?: string
          is_locked?: boolean
          late_reason?: string | null
          late_reason_code?:
            | Database["public"]["Enums"]["late_reason_code"]
            | null
          legal_due_date?: string
          locked_at?: string | null
          locked_by?: string | null
          na_reason?: string | null
          obligation_type_id?: string
          owner_id?: string | null
          penalty_incurred?: boolean
          penalty_note?: string | null
          period_end?: string
          period_key?: string
          period_start?: string
          rectification_index?: number
          rectifies_occurrence_id?: string | null
          reference_number?: string | null
          rejection_reason?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["occurrence_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          submitted_for_validation_at?: string | null
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          validator_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "obligation_occurrences_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_obligation_type_id_fkey"
            columns: ["obligation_type_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["obligation_type_id"]
          },
          {
            foreignKeyName: "obligation_occurrences_obligation_type_id_fkey"
            columns: ["obligation_type_id"]
            isOneToOne: false
            referencedRelation: "obligation_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_rectifies_occurrence_id_fkey"
            columns: ["rectifies_occurrence_id"]
            isOneToOne: false
            referencedRelation: "obligation_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_rectifies_occurrence_id_fkey"
            columns: ["rectifies_occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrence_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_rectifies_occurrence_id_fkey"
            columns: ["rectifies_occurrence_id"]
            isOneToOne: false
            referencedRelation: "validation_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_validator_id_fkey"
            columns: ["validator_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_validator_id_fkey"
            columns: ["validator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      obligation_required_documents: {
        Row: {
          accepted_mime_types: string[] | null
          created_at: string
          description: string | null
          document_kind: string | null
          id: string
          is_mandatory: boolean
          label: string
          max_size_mb: number
          obligation_type_id: string
          order_index: number
        }
        Insert: {
          accepted_mime_types?: string[] | null
          created_at?: string
          description?: string | null
          document_kind?: string | null
          id?: string
          is_mandatory?: boolean
          label: string
          max_size_mb?: number
          obligation_type_id: string
          order_index: number
        }
        Update: {
          accepted_mime_types?: string[] | null
          created_at?: string
          description?: string | null
          document_kind?: string | null
          id?: string
          is_mandatory?: boolean
          label?: string
          max_size_mb?: number
          obligation_type_id?: string
          order_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "obligation_required_documents_obligation_type_id_fkey"
            columns: ["obligation_type_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["obligation_type_id"]
          },
          {
            foreignKeyName: "obligation_required_documents_obligation_type_id_fkey"
            columns: ["obligation_type_id"]
            isOneToOne: false
            referencedRelation: "obligation_types"
            referencedColumns: ["id"]
          },
        ]
      }
      obligation_types: {
        Row: {
          allow_self_validation: boolean
          authority_id: string | null
          code: string
          created_at: string
          created_by: string | null
          criticality: Database["public"]["Enums"]["criticality"]
          default_owner_id: string | null
          default_validator_id: string | null
          deleted_at: string | null
          depends_on_obligation_type_id: string | null
          domain_id: string | null
          due_rule: Json
          effective_from: string
          effective_to: string | null
          entity_id: string
          generation_horizon_months: number
          id: string
          internal_lead_days: number
          is_active: boolean
          legal_basis: string | null
          name: string
          periodicity: Database["public"]["Enums"]["periodicity"]
          portal_url: string | null
          procedure_md: string | null
          requires_proof: boolean
          requires_validation: boolean
          retention_years: number
          updated_at: string
          updated_by: string | null
          validation_levels: number
        }
        Insert: {
          allow_self_validation?: boolean
          authority_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          criticality?: Database["public"]["Enums"]["criticality"]
          default_owner_id?: string | null
          default_validator_id?: string | null
          deleted_at?: string | null
          depends_on_obligation_type_id?: string | null
          domain_id?: string | null
          due_rule: Json
          effective_from: string
          effective_to?: string | null
          entity_id?: string
          generation_horizon_months?: number
          id?: string
          internal_lead_days?: number
          is_active?: boolean
          legal_basis?: string | null
          name: string
          periodicity: Database["public"]["Enums"]["periodicity"]
          portal_url?: string | null
          procedure_md?: string | null
          requires_proof?: boolean
          requires_validation?: boolean
          retention_years?: number
          updated_at?: string
          updated_by?: string | null
          validation_levels?: number
        }
        Update: {
          allow_self_validation?: boolean
          authority_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          criticality?: Database["public"]["Enums"]["criticality"]
          default_owner_id?: string | null
          default_validator_id?: string | null
          deleted_at?: string | null
          depends_on_obligation_type_id?: string | null
          domain_id?: string | null
          due_rule?: Json
          effective_from?: string
          effective_to?: string | null
          entity_id?: string
          generation_horizon_months?: number
          id?: string
          internal_lead_days?: number
          is_active?: boolean
          legal_basis?: string | null
          name?: string
          periodicity?: Database["public"]["Enums"]["periodicity"]
          portal_url?: string | null
          procedure_md?: string | null
          requires_proof?: boolean
          requires_validation?: boolean
          retention_years?: number
          updated_at?: string
          updated_by?: string | null
          validation_levels?: number
        }
        Relationships: [
          {
            foreignKeyName: "obligation_types_authority_id_fkey"
            columns: ["authority_id"]
            isOneToOne: false
            referencedRelation: "authorities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_authority_id_fkey"
            columns: ["authority_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["authority_id"]
          },
          {
            foreignKeyName: "obligation_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_default_validator_id_fkey"
            columns: ["default_validator_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_default_validator_id_fkey"
            columns: ["default_validator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_depends_on_obligation_type_id_fkey"
            columns: ["depends_on_obligation_type_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["obligation_type_id"]
          },
          {
            foreignKeyName: "obligation_types_depends_on_obligation_type_id_fkey"
            columns: ["depends_on_obligation_type_id"]
            isOneToOne: false
            referencedRelation: "obligation_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["domain_id"]
          },
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_checklist_items: {
        Row: {
          checked_at: string | null
          checked_by: string | null
          created_at: string
          document_kind: string | null
          id: string
          is_checked: boolean
          is_mandatory: boolean
          label: string
          occurrence_id: string
          order_index: number
          required_document_id: string | null
        }
        Insert: {
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          document_kind?: string | null
          id?: string
          is_checked?: boolean
          is_mandatory?: boolean
          label: string
          occurrence_id: string
          order_index: number
          required_document_id?: string | null
        }
        Update: {
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          document_kind?: string | null
          id?: string
          is_checked?: boolean
          is_mandatory?: boolean
          label?: string
          occurrence_id?: string
          order_index?: number
          required_document_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_checklist_items_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_checklist_items_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_checklist_items_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "obligation_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_checklist_items_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrence_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_checklist_items_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "validation_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_checklist_items_required_document_id_fkey"
            columns: ["required_document_id"]
            isOneToOne: false
            referencedRelation: "obligation_required_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          mentioned_user_ids: string[]
          occurrence_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          mentioned_user_ids?: string[]
          occurrence_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          mentioned_user_ids?: string[]
          occurrence_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_comments_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "obligation_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_comments_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrence_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_comments_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "validation_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_transitions: {
        Row: {
          actor_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["occurrence_status"] | null
          id: number
          metadata: Json
          occurrence_id: string
          on_behalf_of_id: string | null
          reason: string | null
          to_status: Database["public"]["Enums"]["occurrence_status"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["occurrence_status"] | null
          id?: number
          metadata?: Json
          occurrence_id: string
          on_behalf_of_id?: string | null
          reason?: string | null
          to_status: Database["public"]["Enums"]["occurrence_status"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["occurrence_status"] | null
          id?: number
          metadata?: Json
          occurrence_id?: string
          on_behalf_of_id?: string | null
          reason?: string | null
          to_status?: Database["public"]["Enums"]["occurrence_status"]
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_transitions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_transitions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_transitions_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "obligation_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_transitions_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrence_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_transitions_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "validation_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_transitions_on_behalf_of_id_fkey"
            columns: ["on_behalf_of_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_transitions_on_behalf_of_id_fkey"
            columns: ["on_behalf_of_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string
          code: string
          id: string
          label: string
        }
        Insert: {
          category: string
          code: string
          id?: string
          label: string
        }
        Update: {
          category?: string
          code?: string
          id?: string
          label?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          deactivated_at: string | null
          deactivated_by: string | null
          deleted_at: string | null
          department_id: string | null
          email: string | null
          entity_id: string
          full_name: string | null
          ics_token: string
          id: string
          is_active: boolean
          job_title: string | null
          last_login_at: string | null
          mfa_enrolled: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          deleted_at?: string | null
          department_id?: string | null
          email?: string | null
          entity_id?: string
          full_name?: string | null
          ics_token?: string
          id: string
          is_active?: boolean
          job_title?: string | null
          last_login_at?: string | null
          mfa_enrolled?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          deleted_at?: string | null
          department_id?: string | null
          email?: string | null
          entity_id?: string
          full_name?: string | null
          ics_token?: string
          id?: string
          is_active?: boolean
          job_title?: string | null
          last_login_at?: string | null
          mfa_enrolled?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_deactivated_by_fkey"
            columns: ["deactivated_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_deactivated_by_fkey"
            columns: ["deactivated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          default_domain_code: string | null
          description: string | null
          id: string
          is_system: boolean
          label: string
          max_duration_days: number | null
        }
        Insert: {
          code: string
          created_at?: string
          default_domain_code?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          label: string
          max_duration_days?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          default_domain_code?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          label?: string
          max_duration_days?: number | null
        }
        Relationships: []
      }
      status_transition_rules: {
        Row: {
          from_status: Database["public"]["Enums"]["occurrence_status"]
          id: string
          label: string
          locks_occurrence: boolean
          required_permission: string
          requires_reason: boolean
          to_status: Database["public"]["Enums"]["occurrence_status"]
        }
        Insert: {
          from_status: Database["public"]["Enums"]["occurrence_status"]
          id?: string
          label: string
          locks_occurrence?: boolean
          required_permission: string
          requires_reason?: boolean
          to_status: Database["public"]["Enums"]["occurrence_status"]
        }
        Update: {
          from_status?: Database["public"]["Enums"]["occurrence_status"]
          id?: string
          label?: string
          locks_occurrence?: boolean
          required_permission?: string
          requires_reason?: boolean
          to_status?: Database["public"]["Enums"]["occurrence_status"]
        }
        Relationships: []
      }
      transition_notifications: {
        Row: {
          from_status: Database["public"]["Enums"]["occurrence_status"]
          id: string
          include_reason: boolean
          kind: string
          recipient: string
          to_status: Database["public"]["Enums"]["occurrence_status"]
        }
        Insert: {
          from_status: Database["public"]["Enums"]["occurrence_status"]
          id?: string
          include_reason?: boolean
          kind: string
          recipient: string
          to_status: Database["public"]["Enums"]["occurrence_status"]
        }
        Update: {
          from_status?: Database["public"]["Enums"]["occurrence_status"]
          id?: string
          include_reason?: boolean
          kind?: string
          recipient?: string
          to_status?: Database["public"]["Enums"]["occurrence_status"]
        }
        Relationships: []
      }
      user_invitations: {
        Row: {
          accepted_at: string | null
          cancelled_at: string | null
          created_at: string
          department_id: string | null
          dispatched_at: string | null
          domain_id: string | null
          email: string
          expires_at: string
          full_name: string
          id: string
          invited_by: string
          role_expires_at: string | null
          role_id: string
        }
        Insert: {
          accepted_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          department_id?: string | null
          dispatched_at?: string | null
          domain_id?: string | null
          email: string
          expires_at?: string
          full_name: string
          id?: string
          invited_by: string
          role_expires_at?: string | null
          role_id: string
        }
        Update: {
          accepted_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          department_id?: string | null
          dispatched_at?: string | null
          domain_id?: string | null
          email?: string
          expires_at?: string
          full_name?: string
          id?: string
          invited_by?: string
          role_expires_at?: string | null
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_invitations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_invitations_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["domain_id"]
          },
          {
            foreignKeyName: "user_invitations_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_invitations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          domain_id: string | null
          expires_at: string | null
          grant_reason: string | null
          granted_at: string
          granted_by: string | null
          id: string
          revoked_at: string | null
          revoked_by: string | null
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          domain_id?: string | null
          expires_at?: string | null
          grant_reason?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          domain_id?: string | null
          expires_at?: string | null
          grant_reason?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["domain_id"]
          },
          {
            foreignKeyName: "user_roles_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_view_preferences: {
        Row: {
          filters: Json
          updated_at: string
          user_id: string
          view_key: string
        }
        Insert: {
          filters?: Json
          updated_at?: string
          user_id: string
          view_key: string
        }
        Update: {
          filters?: Json
          updated_at?: string
          user_id?: string
          view_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_view_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_view_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_delegations: {
        Row: {
          created_at: string
          created_by: string | null
          delegate_id: string
          delegator_id: string
          domain_id: string | null
          ends_at: string
          entity_id: string
          id: string
          reason: string
          revoked_at: string | null
          revoked_by: string | null
          starts_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delegate_id: string
          delegator_id: string
          domain_id?: string | null
          ends_at: string
          entity_id?: string
          id?: string
          reason: string
          revoked_at?: string | null
          revoked_by?: string | null
          starts_at: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delegate_id?: string
          delegator_id?: string
          domain_id?: string | null
          ends_at?: string
          entity_id?: string
          id?: string
          reason?: string
          revoked_at?: string | null
          revoked_by?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_delegations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_delegations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_delegations_delegate_id_fkey"
            columns: ["delegate_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_delegations_delegate_id_fkey"
            columns: ["delegate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_delegations_delegator_id_fkey"
            columns: ["delegator_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_delegations_delegator_id_fkey"
            columns: ["delegator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_delegations_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["domain_id"]
          },
          {
            foreignKeyName: "validation_delegations_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_delegations_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_delegations_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_delegations_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      dashboard_compliance_monthly: {
        Row: {
          domain_id: string | null
          due_count: number | null
          month: string | null
          on_time_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["domain_id"]
          },
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_health: {
        Row: {
          documents_provided: number | null
          documents_required: number | null
          domain_id: string | null
          pending_avg_days: number | null
          pending_validation: number | null
        }
        Relationships: [
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["domain_id"]
          },
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_late_reasons: {
        Row: {
          domain_id: string | null
          late_reason_code:
            | Database["public"]["Enums"]["late_reason_code"]
            | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["domain_id"]
          },
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_upcoming_load: {
        Row: {
          domain_id: string | null
          not_started: number | null
          total: number | null
          week_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["domain_id"]
          },
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_workload: {
        Row: {
          department_id: string | null
          domain_id: string | null
          late_total: number | null
          open_total: number | null
          owner_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "obligation_occurrences_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["domain_id"]
          },
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      document_integrity_alerts: {
        Row: {
          actual_sha256: string | null
          checked_at: string | null
          document_id: string | null
          expected_sha256: string | null
          id: number | null
          normalized_filename: string | null
          obligation_code: string | null
          occurrence_id: string | null
          original_filename: string | null
          period_key: string | null
          run_id: string | null
          status:
            | Database["public"]["Enums"]["document_integrity_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "document_integrity_checks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_integrity_checks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents_pending_purge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_integrity_checks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "obligation_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrence_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "validation_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      documents_pending_purge: {
        Row: {
          id: string | null
          normalized_filename: string | null
          obligation_code: string | null
          occurrence_id: string | null
          original_filename: string | null
          period_key: string | null
          purge_eligible_on: string | null
          retention_years: number | null
          uploaded_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "obligation_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrence_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "validation_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      documents_search: {
        Row: {
          authority_id: string | null
          authority_name: string | null
          checklist_item_id: string | null
          document_kind: string | null
          domain_code: string | null
          domain_id: string | null
          id: string | null
          integrity_checked_at: string | null
          integrity_status:
            | Database["public"]["Enums"]["document_integrity_status"]
            | null
          is_current_version: boolean | null
          legal_due_date: string | null
          mime_type: string | null
          normalized_filename: string | null
          obligation_code: string | null
          obligation_name: string | null
          obligation_type_id: string | null
          occurrence_id: string | null
          occurrence_status:
            | Database["public"]["Enums"]["occurrence_status"]
            | null
          original_filename: string | null
          period_key: string | null
          period_start: string | null
          search_text: string | null
          sha256: string | null
          size_bytes: number | null
          supersedes_id: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          uploader_name: string | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "occurrence_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "obligation_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrence_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "validation_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "documents_pending_purge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_list: {
        Row: {
          authority_id: string | null
          authority_name: string | null
          created_at: string | null
          criticality: Database["public"]["Enums"]["criticality"] | null
          days_to_internal: number | null
          days_to_legal: number | null
          documents_provided: number | null
          documents_required: number | null
          domain_code: string | null
          domain_id: string | null
          domain_label: string | null
          entity_id: string | null
          event_date: string | null
          expiry_date: string | null
          id: string | null
          internal_due_date: string | null
          is_internally_late: boolean | null
          is_locked: boolean | null
          is_overdue: boolean | null
          legal_due_date: string | null
          obligation_code: string | null
          obligation_name: string | null
          obligation_type_id: string | null
          owner_id: string | null
          owner_name: string | null
          penalty_incurred: boolean | null
          period_end: string | null
          period_key: string | null
          period_start: string | null
          periodicity: Database["public"]["Enums"]["periodicity"] | null
          rectification_index: number | null
          rectifies_occurrence_id: string | null
          reference_number: string | null
          requires_proof: boolean | null
          status: Database["public"]["Enums"]["occurrence_status"] | null
          updated_at: string | null
          validator_id: string | null
          validator_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "obligation_occurrences_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_obligation_type_id_fkey"
            columns: ["obligation_type_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["obligation_type_id"]
          },
          {
            foreignKeyName: "obligation_occurrences_obligation_type_id_fkey"
            columns: ["obligation_type_id"]
            isOneToOne: false
            referencedRelation: "obligation_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_rectifies_occurrence_id_fkey"
            columns: ["rectifies_occurrence_id"]
            isOneToOne: false
            referencedRelation: "obligation_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_rectifies_occurrence_id_fkey"
            columns: ["rectifies_occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrence_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_rectifies_occurrence_id_fkey"
            columns: ["rectifies_occurrence_id"]
            isOneToOne: false
            referencedRelation: "validation_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_validator_id_fkey"
            columns: ["validator_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_validator_id_fkey"
            columns: ["validator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_authority_id_fkey"
            columns: ["authority_id"]
            isOneToOne: false
            referencedRelation: "authorities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_types_authority_id_fkey"
            columns: ["authority_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["authority_id"]
          },
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["domain_id"]
          },
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_stats: {
        Row: {
          domain_id: string | null
          due_within_month: number | null
          due_within_week: number | null
          internally_late: number | null
          last_activity_at: string | null
          overdue: number | null
          status: Database["public"]["Enums"]["occurrence_status"] | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["domain_id"]
          },
          {
            foreignKeyName: "obligation_types_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_directory: {
        Row: {
          department_id: string | null
          full_name: string | null
          id: string | null
          job_title: string | null
        }
        Insert: {
          department_id?: string | null
          full_name?: string | null
          id?: string | null
          job_title?: string | null
        }
        Update: {
          department_id?: string | null
          full_name?: string | null
          id?: string | null
          job_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_queue: {
        Row: {
          authority_name: string | null
          criticality: Database["public"]["Enums"]["criticality"] | null
          days_to_internal: number | null
          domain_code: string | null
          id: string | null
          internal_due_date: string | null
          legal_due_date: string | null
          obligation_code: string | null
          obligation_name: string | null
          obligation_type_id: string | null
          owner_id: string | null
          owner_name: string | null
          period_key: string | null
          period_start: string | null
          status: Database["public"]["Enums"]["occurrence_status"] | null
          submitted_for_validation_at: string | null
          validation_levels: number | null
          validations_obtained: number | null
          validator_id: string | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "obligation_occurrences_obligation_type_id_fkey"
            columns: ["obligation_type_id"]
            isOneToOne: false
            referencedRelation: "documents_search"
            referencedColumns: ["obligation_type_id"]
          },
          {
            foreignKeyName: "obligation_occurrences_obligation_type_id_fkey"
            columns: ["obligation_type_id"]
            isOneToOne: false
            referencedRelation: "obligation_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_validator_id_fkey"
            columns: ["validator_id"]
            isOneToOne: false
            referencedRelation: "profile_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligation_occurrences_validator_id_fkey"
            columns: ["validator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      abandoned_upload_objects: {
        Args: { p_older_than_hours?: number }
        Returns: {
          bucket: string
          reason: string
          storage_path: string
          ticket_id: string
        }[]
      }
      accessible_domains: { Args: never; Returns: string[] }
      acknowledge_integrity_alert: {
        Args: { p_check_id: number; p_note: string }
        Returns: boolean
      }
      add_business_days: {
        Args: { day_count: number; from_date: string }
        Returns: string
      }
      app_actor_id: { Args: never; Returns: string }
      app_transition_reason: { Args: never; Returns: string }
      apply_due_date_updates: {
        Args: { p_reason: string; p_updates: Json }
        Returns: number
      }
      apply_occurrence_transition: {
        Args: {
          p_expected_version: number
          p_late_reason?: string
          p_late_reason_code?: Database["public"]["Enums"]["late_reason_code"]
          p_occurrence_id: string
          p_reason?: string
          p_reference_number?: string
          p_to_status: Database["public"]["Enums"]["occurrence_status"]
        }
        Returns: Json
      }
      can_see_occurrence: {
        Args: { p_occurrence_id: string }
        Returns: boolean
      }
      can_validate_occurrence: {
        Args: { occurrence_id: string }
        Returns: boolean
      }
      confirm_document_upload: {
        Args: {
          p_actual_size: number
          p_detected_mime_type?: string
          p_sha256: string
          p_ticket_id: string
        }
        Returns: Json
      }
      create_document_upload_ticket: {
        Args: {
          p_checklist_item_id?: string
          p_document_kind?: string
          p_extension?: string
          p_mime_type: string
          p_name_stem: string
          p_occurrence_id: string
          p_original_filename: string
          p_size_bytes: number
          p_slug: string
        }
        Returns: Json
      }
      create_occurrence_rectification: {
        Args: { p_occurrence_id: string; p_reason: string }
        Returns: string
      }
      create_upcoming_partitions: {
        Args: { months_ahead?: number }
        Returns: undefined
      }
      current_profile_id: { Args: never; Returns: string }
      dashboard_alerts: {
        Args: never
        Returns: {
          code: string
          detail: Json
          severity: string
          total: number
        }[]
      }
      dashboard_compliance_for_caller: {
        Args: never
        Returns: {
          domain_id: string
          due_count: number
          month: string
          on_time_count: number
        }[]
      }
      dashboard_health_for_caller: {
        Args: never
        Returns: {
          documents_provided: number
          documents_required: number
          domain_id: string
          pending_avg_days: number
          pending_validation: number
        }[]
      }
      dashboard_late_reasons_for_caller: {
        Args: never
        Returns: {
          domain_id: string
          late_reason_code: Database["public"]["Enums"]["late_reason_code"]
          total: number
        }[]
      }
      dashboard_upcoming_for_caller: {
        Args: never
        Returns: {
          domain_id: string
          not_started: number
          total: number
          week_start: string
        }[]
      }
      dashboard_workload_for_caller: {
        Args: never
        Returns: {
          department_id: string
          domain_id: string
          late_total: number
          open_total: number
          owner_id: string
        }[]
      }
      deactivate_user: {
        Args: { p_handover_to?: string; p_reason: string; p_user_id: string }
        Returns: number
      }
      dispatch_transition_notifications: {
        Args: {
          p_from: Database["public"]["Enums"]["occurrence_status"]
          p_occurrence: Database["public"]["Tables"]["obligation_occurrences"]["Row"]
          p_reason: string
          p_to: Database["public"]["Enums"]["occurrence_status"]
        }
        Returns: undefined
      }
      document_search_vector: {
        Args: { p_normalized_filename: string; p_original_filename: string }
        Returns: unknown
      }
      effective_principals: { Args: never; Returns: string[] }
      ensure_month_partition: {
        Args: { base_table: string; month_start: string }
        Returns: undefined
      }
      evaluate_transition: {
        Args: {
          p_late_reason_code?: Database["public"]["Enums"]["late_reason_code"]
          p_occurrence_id: string
          p_reason?: string
          p_reference_number?: string
          p_to_status: Database["public"]["Enums"]["occurrence_status"]
        }
        Returns: Json
      }
      global_search: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          kind: string
          rank: number
          result_id: string
          subtitle: string
          title: string
        }[]
      }
      has_permission: { Args: { perm: string }; Returns: boolean }
      has_permission_in_domain: {
        Args: { perm: string; target_domain: string }
        Returns: boolean
      }
      has_verified_mfa: { Args: { p_user_id: string }; Returns: boolean }
      is_active_user: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_auth_throttled: {
        Args: { p_email: string; p_ip?: unknown }
        Returns: boolean
      }
      is_direction: { Args: { p_user_id: string }; Returns: boolean }
      is_ip_allowed_for_admin: { Args: { p_ip: unknown }; Returns: boolean }
      is_valid_due_rule: {
        Args: { p: Database["public"]["Enums"]["periodicity"]; rule: Json }
        Returns: boolean
      }
      log_audit_export: {
        Args: { p_filters: Json; p_row_count: number }
        Returns: undefined
      }
      log_auth_event: {
        Args: {
          p_action: string
          p_actor_id?: string
          p_email: string
          p_ip?: unknown
          p_user_agent?: string
        }
        Returns: undefined
      }
      log_document_access: {
        Args: {
          p_action: string
          p_document_id: string
          p_ip?: unknown
          p_user_agent?: string
        }
        Returns: undefined
      }
      mfa_required_for: { Args: { p_user_id: string }; Returns: boolean }
      navigation_counters: {
        Args: never
        Returns: {
          my_tasks: number
          overdue: number
          pending_validation: number
        }[]
      }
      obligation_domain_of_occurrence: {
        Args: { occurrence_id: string }
        Returns: string
      }
      obligation_domain_of_type: { Args: { type_id: string }; Returns: string }
      obligation_type_search_vector: {
        Args: {
          p_code: string
          p_legal_basis: string
          p_name: string
          p_procedure_md: string
        }
        Returns: unknown
      }
      occurrence_dependency_state: {
        Args: { p_occurrence_id: string }
        Returns: {
          dependency_occurrence_id: string
          obligation_code: string
          obligation_name: string
          obligation_type_id: string
          period_key: string
          status: Database["public"]["Enums"]["occurrence_status"]
        }[]
      }
      occurrence_missing_items: {
        Args: { p_occurrence_id: string }
        Returns: string[]
      }
      occurrence_search_vector: {
        Args: {
          p_period_key: string
          p_reference_number: string
          p_type_code: string
          p_type_name: string
        }
        Returns: unknown
      }
      occurrence_stats_for_caller: {
        Args: never
        Returns: {
          domain_id: string
          due_within_month: number
          due_within_week: number
          internally_late: number
          overdue: number
          status: Database["public"]["Enums"]["occurrence_status"]
          total: number
        }[]
      }
      open_occurrence_count: { Args: { p_user_id: string }; Returns: number }
      open_task_count: { Args: { p_user_id: string }; Returns: number }
      overdue_exempt_statuses: {
        Args: never
        Returns: Database["public"]["Enums"]["occurrence_status"][]
      }
      pending_validation_count: { Args: never; Returns: number }
      purge_auth_attempts: { Args: never; Returns: undefined }
      reassign_occurrences: {
        Args: { p_occurrence_ids: string[]; p_owner_id: string }
        Returns: number
      }
      recalculate_todo_due_dates: {
        Args: { p_obligation_type_id: string; p_updates: Json }
        Returns: number
      }
      record_auth_attempt: {
        Args: {
          p_email: string
          p_ip?: unknown
          p_succeeded?: boolean
          p_user_agent?: string
        }
        Returns: undefined
      }
      record_document_integrity_check: {
        Args: {
          p_actual_sha256?: string
          p_document_id: string
          p_observed_size?: number
          p_run_id: string
          p_status: Database["public"]["Enums"]["document_integrity_status"]
        }
        Returns: number
      }
      record_validation_step: {
        Args: { p_occurrence_id: string }
        Returns: number
      }
      refresh_dashboard_views: { Args: never; Returns: undefined }
      refresh_occurrence_stats: { Args: never; Returns: undefined }
      reject_document_upload_ticket: {
        Args: { p_reason: string; p_ticket_id: string }
        Returns: boolean
      }
      reset_user_mfa: {
        Args: { p_reason: string; p_user_id: string }
        Returns: boolean
      }
      revoke_validation_delegation: {
        Args: { p_delegation_id: string; p_reason: string }
        Returns: boolean
      }
      role_holder_count: { Args: { p_role_id: string }; Returns: number }
      sample_documents_for_integrity: {
        Args: { p_sample_size: number }
        Returns: {
          bucket: string
          id: string
          sha256: string
          size_bytes: number
          storage_path: string
        }[]
      }
      search_tsquery: { Args: { p_text: string }; Returns: unknown }
      searchable_text: { Args: { p_text: string }; Returns: string }
      self_validation_blocked: {
        Args: {
          p_actor_id: string
          p_occurrence_type_id: string
          p_owner_id: string
        }
        Returns: boolean
      }
      self_validation_blocked_for: {
        Args: { p_occurrence_id: string }
        Returns: boolean
      }
      session_gates: { Args: { p_ip?: unknown }; Returns: Json }
      setting_bool: {
        Args: { fallback: boolean; setting_key: string }
        Returns: boolean
      }
      setting_int: {
        Args: { fallback: number; setting_key: string }
        Returns: number
      }
      soft_delete_comment: { Args: { p_comment_id: string }; Returns: boolean }
      soft_delete_document: {
        Args: { p_document_id: string; p_reason: string }
        Returns: boolean
      }
      storage_path_segment: { Args: { p_value: string }; Returns: string }
      validation_levels_required: {
        Args: { p_occurrence_id: string }
        Returns: number
      }
      validation_steps_obtained: {
        Args: { p_occurrence_id: string }
        Returns: number
      }
    }
    Enums: {
      criticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
      document_integrity_status: "PENDING" | "VERIFIED" | "MISMATCH" | "MISSING"
      late_reason_code:
        | "MISSING_DOCUMENT"
        | "VALIDATOR_UNAVAILABLE"
        | "LATE_EXTERNAL_INFORMATION"
        | "OVERSIGHT"
        | "OTHER"
      occurrence_status:
        | "TODO"
        | "IN_PROGRESS"
        | "PENDING_VALIDATION"
        | "REJECTED"
        | "VALIDATED"
        | "SUBMITTED"
        | "ARCHIVED"
        | "NOT_APPLICABLE"
      periodicity:
        | "MONTHLY"
        | "QUARTERLY"
        | "SEMIANNUAL"
        | "ANNUAL"
        | "BIENNIAL"
        | "ON_EVENT"
        | "CUSTOM"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      criticality: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      document_integrity_status: ["PENDING", "VERIFIED", "MISMATCH", "MISSING"],
      late_reason_code: [
        "MISSING_DOCUMENT",
        "VALIDATOR_UNAVAILABLE",
        "LATE_EXTERNAL_INFORMATION",
        "OVERSIGHT",
        "OTHER",
      ],
      occurrence_status: [
        "TODO",
        "IN_PROGRESS",
        "PENDING_VALIDATION",
        "REJECTED",
        "VALIDATED",
        "SUBMITTED",
        "ARCHIVED",
        "NOT_APPLICABLE",
      ],
      periodicity: [
        "MONTHLY",
        "QUARTERLY",
        "SEMIANNUAL",
        "ANNUAL",
        "BIENNIAL",
        "ON_EVENT",
        "CUSTOM",
      ],
    },
  },
} as const

