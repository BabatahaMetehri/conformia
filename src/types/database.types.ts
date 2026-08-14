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
          allow_self_validation: boolean
          id: boolean
          updated_at: string
          updated_by: string | null
          validation_fallback_business_days: number
          weekend_days: number[]
        }
        Insert: {
          allow_self_validation?: boolean
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          validation_fallback_business_days?: number
          weekend_days?: number[]
        }
        Update: {
          allow_self_validation?: boolean
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          validation_fallback_business_days?: number
          weekend_days?: number[]
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
          holiday_date: string
          id: string
          is_recurring: boolean
          label: string
          source: string | null
        }
        Insert: {
          created_at?: string
          holiday_date: string
          id?: string
          is_recurring?: boolean
          label: string
          source?: string | null
        }
        Update: {
          created_at?: string
          holiday_date?: string
          id?: string
          is_recurring?: boolean
          label?: string
          source?: string | null
        }
        Relationships: []
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
            referencedRelation: "obligation_types"
            referencedColumns: ["id"]
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
    }
    Functions: {
      accessible_domains: { Args: never; Returns: string[] }
      add_business_days: {
        Args: { day_count: number; from_date: string }
        Returns: string
      }
      app_actor_id: { Args: never; Returns: string }
      app_transition_reason: { Args: never; Returns: string }
      can_validate_occurrence: {
        Args: { occurrence_id: string }
        Returns: boolean
      }
      current_profile_id: { Args: never; Returns: string }
      effective_principals: { Args: never; Returns: string[] }
      has_permission: { Args: { perm: string }; Returns: boolean }
      has_permission_in_domain: {
        Args: { perm: string; target_domain: string }
        Returns: boolean
      }
      is_active_user: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_valid_due_rule: {
        Args: { p: Database["public"]["Enums"]["periodicity"]; rule: Json }
        Returns: boolean
      }
      obligation_domain_of_occurrence: {
        Args: { occurrence_id: string }
        Returns: string
      }
      obligation_domain_of_type: { Args: { type_id: string }; Returns: string }
    }
    Enums: {
      criticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
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

