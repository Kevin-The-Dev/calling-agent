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
      agent_settings: {
        Row: {
          afternoon_window: string
          agent_display_name: string | null
          barge_in_enabled: boolean
          booking_horizon_days: number
          company_name: string | null
          consultant_name: string | null
          created_at: string
          id: string
          is_active: boolean
          llm_model: string
          max_tokens: number
          morning_window: string
          name: string
          service_area: string | null
          silence_timeout_ms: number
          slot_minutes: number
          stage_prompts: Json
          stt_language: string
          stt_provider: string
          system_prompt: string
          temperature: number
          tts_provider: string
          tts_speed: number
          tts_voice_id: string | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          afternoon_window?: string
          agent_display_name?: string | null
          barge_in_enabled?: boolean
          booking_horizon_days?: number
          company_name?: string | null
          consultant_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          llm_model?: string
          max_tokens?: number
          morning_window?: string
          name: string
          service_area?: string | null
          silence_timeout_ms?: number
          slot_minutes?: number
          stage_prompts?: Json
          stt_language?: string
          stt_provider?: string
          system_prompt: string
          temperature?: number
          tts_provider?: string
          tts_speed?: number
          tts_voice_id?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          afternoon_window?: string
          agent_display_name?: string | null
          barge_in_enabled?: boolean
          booking_horizon_days?: number
          company_name?: string | null
          consultant_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          llm_model?: string
          max_tokens?: number
          morning_window?: string
          name?: string
          service_area?: string | null
          silence_timeout_ms?: number
          slot_minutes?: number
          stage_prompts?: Json
          stt_language?: string
          stt_provider?: string
          system_prompt?: string
          temperature?: number
          tts_provider?: string
          tts_speed?: number
          tts_voice_id?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          address: string
          appointment_type: Database["public"]["Enums"]["appointment_type"]
          call_id: string | null
          confirmation_phone: string | null
          conflict_checked: boolean
          consultant_name: string | null
          created_at: string
          decision_makers: Json
          decision_makers_present: boolean
          id: string
          language: string
          lead_id: string
          notes: string | null
          recap_details_given: boolean
          reminded_confirmation_call: boolean
          reminded_decision_makers: boolean
          reminded_no_cost: boolean
          reminded_utility_bill: boolean
          scheduled_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          timezone: string
          updated_at: string
        }
        Insert: {
          address: string
          appointment_type?: Database["public"]["Enums"]["appointment_type"]
          call_id?: string | null
          confirmation_phone?: string | null
          conflict_checked?: boolean
          consultant_name?: string | null
          created_at?: string
          decision_makers?: Json
          decision_makers_present?: boolean
          id?: string
          language?: string
          lead_id: string
          notes?: string | null
          recap_details_given?: boolean
          reminded_confirmation_call?: boolean
          reminded_decision_makers?: boolean
          reminded_no_cost?: boolean
          reminded_utility_bill?: boolean
          scheduled_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          timezone: string
          updated_at?: string
        }
        Update: {
          address?: string
          appointment_type?: Database["public"]["Enums"]["appointment_type"]
          call_id?: string | null
          confirmation_phone?: string | null
          conflict_checked?: boolean
          consultant_name?: string | null
          created_at?: string
          decision_makers?: Json
          decision_makers_present?: boolean
          id?: string
          language?: string
          lead_id?: string
          notes?: string | null
          recap_details_given?: boolean
          reminded_confirmation_call?: boolean
          reminded_decision_makers?: boolean
          reminded_no_cost?: boolean
          reminded_utility_bill?: boolean
          scheduled_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          diff: Json | null
          entity: string
          entity_id: string | null
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          diff?: Json | null
          entity: string
          entity_id?: string | null
          id?: number
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          diff?: Json | null
          entity?: string
          entity_id?: string | null
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      call_events: {
        Row: {
          call_id: string
          created_at: string
          id: number
          payload: Json
          type: string
        }
        Insert: {
          call_id: string
          created_at?: string
          id?: number
          payload?: Json
          type: string
        }
        Update: {
          call_id?: string
          created_at?: string
          id?: number
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_events_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          agent_settings_id: string | null
          buying_intent: Database["public"]["Enums"]["buying_intent"]
          campaign_id: string | null
          consent_at: string | null
          consent_given: boolean
          created_at: string
          duration_seconds: number | null
          early_objection_count: number
          ended_at: string | null
          error: string | null
          id: string
          late_objection_count: number
          lead_id: string
          llm_model: string | null
          outcome: Database["public"]["Enums"]["call_outcome"] | null
          qualification_score: number
          return_stage: Database["public"]["Enums"]["conversation_stage"] | null
          stage: Database["public"]["Enums"]["conversation_stage"]
          started_at: string
          status: Database["public"]["Enums"]["call_status"]
          stt_provider: string | null
          summary: string | null
          tts_provider: string | null
          turn_count: number
        }
        Insert: {
          agent_settings_id?: string | null
          buying_intent?: Database["public"]["Enums"]["buying_intent"]
          campaign_id?: string | null
          consent_at?: string | null
          consent_given?: boolean
          created_at?: string
          duration_seconds?: number | null
          early_objection_count?: number
          ended_at?: string | null
          error?: string | null
          id?: string
          late_objection_count?: number
          lead_id: string
          llm_model?: string | null
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          qualification_score?: number
          return_stage?:
            | Database["public"]["Enums"]["conversation_stage"]
            | null
          stage?: Database["public"]["Enums"]["conversation_stage"]
          started_at?: string
          status?: Database["public"]["Enums"]["call_status"]
          stt_provider?: string | null
          summary?: string | null
          tts_provider?: string | null
          turn_count?: number
        }
        Update: {
          agent_settings_id?: string | null
          buying_intent?: Database["public"]["Enums"]["buying_intent"]
          campaign_id?: string | null
          consent_at?: string | null
          consent_given?: boolean
          created_at?: string
          duration_seconds?: number | null
          early_objection_count?: number
          ended_at?: string | null
          error?: string | null
          id?: string
          late_objection_count?: number
          lead_id?: string
          llm_model?: string | null
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          qualification_score?: number
          return_stage?:
            | Database["public"]["Enums"]["conversation_stage"]
            | null
          stage?: Database["public"]["Enums"]["conversation_stage"]
          started_at?: string
          status?: Database["public"]["Enums"]["call_status"]
          stt_provider?: string | null
          summary?: string | null
          tts_provider?: string | null
          turn_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "calls_agent_settings_id_fkey"
            columns: ["agent_settings_id"]
            isOneToOne: false
            referencedRelation: "agent_settings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      knowledge_document_versions: {
        Row: {
          content: string
          created_at: string
          document_id: string
          id: number
          updated_by: string | null
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          document_id: string
          id?: number
          updated_by?: string | null
          version: number
        }
        Update: {
          content?: string
          created_at?: string
          document_id?: string
          id?: number
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_document_versions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          content: string
          created_at: string
          id: string
          is_active: boolean
          slug: string
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_active?: boolean
          slug: string
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          slug?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string | null
          already_has_solar: boolean | null
          bill_over_150: boolean | null
          buying_intent: Database["public"]["Enums"]["buying_intent"]
          campaign_id: string | null
          created_at: string
          credit_score_band: Database["public"]["Enums"]["credit_band"]
          decision_makers: Json
          disqualified_reason: Database["public"]["Enums"]["dq_reason"] | null
          do_not_contact: boolean
          email: string | null
          has_tenant: boolean | null
          home_type: Database["public"]["Enums"]["home_type"]
          homeowner_confirmed: boolean | null
          id: string
          language: string
          monthly_bill: number | null
          moving_timeline_months: number | null
          name: string | null
          notes: string | null
          owns_roof: boolean | null
          pain_points: Json
          phone: string | null
          qualification_band: Database["public"]["Enums"]["qualification_band"]
          qualification_score: number
          roof_condition: string | null
          roof_type: string | null
          shading: Database["public"]["Enums"]["shading_level"]
          status: Database["public"]["Enums"]["lead_status"]
          summary: string | null
          taxable_income_over_45k: boolean | null
          timezone: string | null
          updated_at: string
          utility_provider: string | null
        }
        Insert: {
          address?: string | null
          already_has_solar?: boolean | null
          bill_over_150?: boolean | null
          buying_intent?: Database["public"]["Enums"]["buying_intent"]
          campaign_id?: string | null
          created_at?: string
          credit_score_band?: Database["public"]["Enums"]["credit_band"]
          decision_makers?: Json
          disqualified_reason?: Database["public"]["Enums"]["dq_reason"] | null
          do_not_contact?: boolean
          email?: string | null
          has_tenant?: boolean | null
          home_type?: Database["public"]["Enums"]["home_type"]
          homeowner_confirmed?: boolean | null
          id?: string
          language?: string
          monthly_bill?: number | null
          moving_timeline_months?: number | null
          name?: string | null
          notes?: string | null
          owns_roof?: boolean | null
          pain_points?: Json
          phone?: string | null
          qualification_band?: Database["public"]["Enums"]["qualification_band"]
          qualification_score?: number
          roof_condition?: string | null
          roof_type?: string | null
          shading?: Database["public"]["Enums"]["shading_level"]
          status?: Database["public"]["Enums"]["lead_status"]
          summary?: string | null
          taxable_income_over_45k?: boolean | null
          timezone?: string | null
          updated_at?: string
          utility_provider?: string | null
        }
        Update: {
          address?: string | null
          already_has_solar?: boolean | null
          bill_over_150?: boolean | null
          buying_intent?: Database["public"]["Enums"]["buying_intent"]
          campaign_id?: string | null
          created_at?: string
          credit_score_band?: Database["public"]["Enums"]["credit_band"]
          decision_makers?: Json
          disqualified_reason?: Database["public"]["Enums"]["dq_reason"] | null
          do_not_contact?: boolean
          email?: string | null
          has_tenant?: boolean | null
          home_type?: Database["public"]["Enums"]["home_type"]
          homeowner_confirmed?: boolean | null
          id?: string
          language?: string
          monthly_bill?: number | null
          moving_timeline_months?: number | null
          name?: string | null
          notes?: string | null
          owns_roof?: boolean | null
          pain_points?: Json
          phone?: string | null
          qualification_band?: Database["public"]["Enums"]["qualification_band"]
          qualification_score?: number
          roof_condition?: string | null
          roof_type?: string | null
          shading?: Database["public"]["Enums"]["shading_level"]
          status?: Database["public"]["Enums"]["lead_status"]
          summary?: string | null
          taxable_income_over_45k?: boolean | null
          timezone?: string | null
          updated_at?: string
          utility_provider?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      objection_events: {
        Row: {
          call_id: string
          created_at: string
          id: number
          lead_id: string
          objection_class: Database["public"]["Enums"]["objection_class"]
          objection_id: string
          quote: string
          resolved: boolean
          stage_at: Database["public"]["Enums"]["conversation_stage"]
        }
        Insert: {
          call_id: string
          created_at?: string
          id?: number
          lead_id: string
          objection_class: Database["public"]["Enums"]["objection_class"]
          objection_id: string
          quote: string
          resolved?: boolean
          stage_at: Database["public"]["Enums"]["conversation_stage"]
        }
        Update: {
          call_id?: string
          created_at?: string
          id?: number
          lead_id?: string
          objection_class?: Database["public"]["Enums"]["objection_class"]
          objection_id?: string
          quote?: string
          resolved?: boolean
          stage_at?: Database["public"]["Enums"]["conversation_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "objection_events_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "objection_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      recordings: {
        Row: {
          call_id: string
          channels: string
          created_at: string
          duration_seconds: number | null
          id: string
          mime_type: string
          size_bytes: number | null
          storage_path: string
          upload_status: string
        }
        Insert: {
          call_id: string
          channels?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          mime_type?: string
          size_bytes?: number | null
          storage_path: string
          upload_status?: string
        }
        Update: {
          call_id?: string
          channels?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          mime_type?: string
          size_bytes?: number | null
          storage_path?: string
          upload_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "recordings_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_turns: {
        Row: {
          audio_end_ms: number | null
          audio_start_ms: number | null
          call_id: string
          content: string
          created_at: string
          id: number
          latency_ms: number | null
          llm_tokens_in: number | null
          llm_tokens_out: number | null
          speaker: Database["public"]["Enums"]["speaker"]
          stage: Database["public"]["Enums"]["conversation_stage"]
          stt_confidence: number | null
          turn_index: number
        }
        Insert: {
          audio_end_ms?: number | null
          audio_start_ms?: number | null
          call_id: string
          content: string
          created_at?: string
          id?: number
          latency_ms?: number | null
          llm_tokens_in?: number | null
          llm_tokens_out?: number | null
          speaker: Database["public"]["Enums"]["speaker"]
          stage: Database["public"]["Enums"]["conversation_stage"]
          stt_confidence?: number | null
          turn_index: number
        }
        Update: {
          audio_end_ms?: number | null
          audio_start_ms?: number | null
          call_id?: string
          content?: string
          created_at?: string
          id?: number
          latency_ms?: number | null
          llm_tokens_in?: number | null
          llm_tokens_out?: number | null
          speaker?: Database["public"]["Enums"]["speaker"]
          stage?: Database["public"]["Enums"]["conversation_stage"]
          stt_confidence?: number | null
          turn_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "transcript_turns_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_call_funnel: {
        Row: {
          avg_duration_s: number | null
          avg_score: number | null
          booked: number | null
          calls: number | null
          day: string | null
          disqualified: number | null
          not_interested: number | null
        }
        Relationships: []
      }
      v_stage_dropoff: {
        Row: {
          reached: number | null
          stage: Database["public"]["Enums"]["conversation_stage"] | null
        }
        Relationships: []
      }
      v_top_objections: {
        Row: {
          hits: number | null
          objection_class: Database["public"]["Enums"]["objection_class"] | null
          objection_id: string | null
          resolved: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
      is_dashboard_user: { Args: never; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "viewer"
      appointment_status:
        | "booked"
        | "rescheduled"
        | "cancelled"
        | "no_show"
        | "held"
      appointment_type: "in_home" | "virtual"
      buying_intent: "low" | "medium" | "high"
      call_outcome:
        | "booked"
        | "partial"
        | "callback"
        | "disqualified"
        | "not_interested"
        | "abandoned"
      call_status: "active" | "completed" | "failed" | "abandoned"
      conversation_stage:
        | "opening"
        | "rapport"
        | "qualification"
        | "need_discovery"
        | "value_pitch"
        | "objection_handling"
        | "appointment"
        | "confirmation"
        | "closing"
        | "disqualified"
        | "ended"
      credit_band: "above_650" | "below_650" | "unsure" | "declined"
      dq_reason:
        | "not_homeowner"
        | "no_roof_ownership"
        | "bill_under_60"
        | "moving_under_6_months"
        | "minor"
        | "do_not_contact"
        | "wrong_number"
        | "other"
      home_type:
        | "single_family"
        | "condo"
        | "townhome"
        | "mobile"
        | "other"
        | "unknown"
      lead_status:
        | "new"
        | "qualifying"
        | "qualified"
        | "booked"
        | "disqualified"
        | "do_not_contact"
      objection_class: "early" | "late"
      qualification_band: "hot" | "warm" | "cold" | "unqualified"
      shading_level: "none" | "partial" | "major" | "unknown"
      speaker: "agent" | "prospect" | "system"
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
      app_role: ["admin", "viewer"],
      appointment_status: [
        "booked",
        "rescheduled",
        "cancelled",
        "no_show",
        "held",
      ],
      appointment_type: ["in_home", "virtual"],
      buying_intent: ["low", "medium", "high"],
      call_outcome: [
        "booked",
        "partial",
        "callback",
        "disqualified",
        "not_interested",
        "abandoned",
      ],
      call_status: ["active", "completed", "failed", "abandoned"],
      conversation_stage: [
        "opening",
        "rapport",
        "qualification",
        "need_discovery",
        "value_pitch",
        "objection_handling",
        "appointment",
        "confirmation",
        "closing",
        "disqualified",
        "ended",
      ],
      credit_band: ["above_650", "below_650", "unsure", "declined"],
      dq_reason: [
        "not_homeowner",
        "no_roof_ownership",
        "bill_under_60",
        "moving_under_6_months",
        "minor",
        "do_not_contact",
        "wrong_number",
        "other",
      ],
      home_type: [
        "single_family",
        "condo",
        "townhome",
        "mobile",
        "other",
        "unknown",
      ],
      lead_status: [
        "new",
        "qualifying",
        "qualified",
        "booked",
        "disqualified",
        "do_not_contact",
      ],
      objection_class: ["early", "late"],
      qualification_band: ["hot", "warm", "cold", "unqualified"],
      shading_level: ["none", "partial", "major", "unknown"],
      speaker: ["agent", "prospect", "system"],
    },
  },
} as const

