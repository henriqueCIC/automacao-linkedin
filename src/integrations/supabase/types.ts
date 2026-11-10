export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_user_connections: {
        Row: {
          account_login: string | null
          connection_key_ciphertext: string
          connector_id: string
          created_at: string
          id: string
          reconnect_required: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          account_login?: string | null
          connection_key_ciphertext: string
          connector_id: string
          created_at?: string
          id?: string
          reconnect_required?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          account_login?: string | null
          connection_key_ciphertext?: string
          connector_id?: string
          created_at?: string
          id?: string
          reconnect_required?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      automation_settings: {
        Row: {
          created_at: string
          daily_time: string
          default_tone: string
          enabled: boolean
          last_run_date: string | null
          max_commits_per_day: number
          notify_desktop: boolean
          notify_email: boolean
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_time?: string
          default_tone?: string
          enabled?: boolean
          last_run_date?: string | null
          max_commits_per_day?: number
          notify_desktop?: boolean
          notify_email?: boolean
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_time?: string
          default_tone?: string
          enabled?: boolean
          last_run_date?: string | null
          max_commits_per_day?: number
          notify_desktop?: boolean
          notify_email?: boolean
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      collection_runs: {
        Row: {
          commits_found: number
          created_at: string
          day_entry_id: string | null
          id: string
          message: string | null
          post_draft_id: string | null
          repositories: string[]
          since_at: string | null
          status: string
          trigger: string
          until_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          commits_found?: number
          created_at?: string
          day_entry_id?: string | null
          id?: string
          message?: string | null
          post_draft_id?: string | null
          repositories?: string[]
          since_at?: string | null
          status?: string
          trigger?: string
          until_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          commits_found?: number
          created_at?: string
          day_entry_id?: string | null
          id?: string
          message?: string | null
          post_draft_id?: string | null
          repositories?: string[]
          since_at?: string | null
          status?: string
          trigger?: string
          until_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_runs_day_entry_id_fkey"
            columns: ["day_entry_id"]
            isOneToOne: false
            referencedRelation: "day_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_runs_post_draft_id_fkey"
            columns: ["post_draft_id"]
            isOneToOne: false
            referencedRelation: "post_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_secrets: {
        Row: {
          created_at: string
          id: number
          secret: string
        }
        Insert: {
          created_at?: string
          id: number
          secret: string
        }
        Update: {
          created_at?: string
          id?: number
          secret?: string
        }
        Relationships: []
      }
      day_entries: {
        Row: {
          created_at: string
          entry_date: string
          id: string
          raw_notes: string
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_date?: string
          id?: string
          raw_notes: string
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_date?: string
          id?: string
          raw_notes?: string
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      post_drafts: {
        Row: {
          approved_at: string | null
          content: string
          created_at: string
          day_entry_id: string | null
          feedback: string | null
          id: string
          linkedin_post_id: string | null
          published_at: string | null
          status: string
          summary: string
          tone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          content?: string
          created_at?: string
          day_entry_id?: string | null
          feedback?: string | null
          id?: string
          linkedin_post_id?: string | null
          published_at?: string | null
          status?: string
          summary?: string
          tone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          content?: string
          created_at?: string
          day_entry_id?: string | null
          feedback?: string | null
          id?: string
          linkedin_post_id?: string | null
          published_at?: string | null
          status?: string
          summary?: string
          tone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_drafts_day_entry_id_fkey"
            columns: ["day_entry_id"]
            isOneToOne: false
            referencedRelation: "day_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          default_tone: string
          display_name: string | null
          headline: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_tone?: string
          display_name?: string | null
          headline?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_tone?: string
          display_name?: string | null
          headline?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      seen_commits: {
        Row: {
          commit_sha: string
          committed_at: string | null
          created_at: string
          id: string
          repo_full_name: string
          user_id: string
        }
        Insert: {
          commit_sha: string
          committed_at?: string | null
          created_at?: string
          id?: string
          repo_full_name: string
          user_id: string
        }
        Update: {
          commit_sha?: string
          committed_at?: string | null
          created_at?: string
          id?: string
          repo_full_name?: string
          user_id?: string
        }
        Relationships: []
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
