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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      account_daily_metrics: {
        Row: {
          account_id: string
          comments: number
          engagement_rate_percent: number | null
          engagements: number
          follower_count: number
          follower_delta: number
          impressions: number
          ingested_at: string
          likes: number
          metadata: Json
          metric_date: string
          posts_published: number
          profile_views: number
          reach: number
          saves: number
          shares: number
          source_updated_at: string | null
          views: number
          watch_time_seconds: number
        }
        Insert: {
          account_id: string
          comments?: number
          engagement_rate_percent?: number | null
          engagements?: number
          follower_count?: number
          follower_delta?: number
          impressions?: number
          ingested_at?: string
          likes?: number
          metadata?: Json
          metric_date: string
          posts_published?: number
          profile_views?: number
          reach?: number
          saves?: number
          shares?: number
          source_updated_at?: string | null
          views?: number
          watch_time_seconds?: number
        }
        Update: {
          account_id?: string
          comments?: number
          engagement_rate_percent?: number | null
          engagements?: number
          follower_count?: number
          follower_delta?: number
          impressions?: number
          ingested_at?: string
          likes?: number
          metadata?: Json
          metric_date?: string
          posts_published?: number
          profile_views?: number
          reach?: number
          saves?: number
          shares?: number
          source_updated_at?: string | null
          views?: number
          watch_time_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_daily_metrics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_metric_snapshots: {
        Row: {
          account_id: string
          captured_at: string
          follower_count: number
          following_count: number
          metadata: Json
          post_count: number
          snapshot_date: string
          total_comments: number
          total_likes: number
          total_shares: number
          total_views: number
        }
        Insert: {
          account_id: string
          captured_at?: string
          follower_count?: number
          following_count?: number
          metadata?: Json
          post_count?: number
          snapshot_date: string
          total_comments?: number
          total_likes?: number
          total_shares?: number
          total_views?: number
        }
        Update: {
          account_id?: string
          captured_at?: string
          follower_count?: number
          following_count?: number
          metadata?: Json
          post_count?: number
          snapshot_date?: string
          total_comments?: number
          total_likes?: number
          total_shares?: number
          total_views?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_metric_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_sync_runs: {
        Row: {
          account_id: string
          created_at: string
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          metadata: Json
          next_cursor: string | null
          range_end: string | null
          range_start: string | null
          records_upserted: number
          started_at: string
          status: Database["public"]["Enums"]["analytics_sync_status"]
          trigger: Database["public"]["Enums"]["analytics_sync_trigger"]
        }
        Insert: {
          account_id: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json
          next_cursor?: string | null
          range_end?: string | null
          range_start?: string | null
          records_upserted?: number
          started_at?: string
          status?: Database["public"]["Enums"]["analytics_sync_status"]
          trigger?: Database["public"]["Enums"]["analytics_sync_trigger"]
        }
        Update: {
          account_id?: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json
          next_cursor?: string | null
          range_end?: string | null
          range_start?: string | null
          records_upserted?: number
          started_at?: string
          status?: Database["public"]["Enums"]["analytics_sync_status"]
          trigger?: Database["public"]["Enums"]["analytics_sync_trigger"]
        }
        Relationships: [
          {
            foreignKeyName: "analytics_sync_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_posts: {
        Row: {
          account_id: string
          caption: string | null
          content_type: string | null
          created_at: string
          duration_seconds: number | null
          external_post_id: string
          id: string
          metadata: Json
          permalink: string | null
          pillar: string | null
          published_at: string
          thumbnail_url: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          caption?: string | null
          content_type?: string | null
          created_at?: string
          duration_seconds?: number | null
          external_post_id: string
          id?: string
          metadata?: Json
          permalink?: string | null
          pillar?: string | null
          published_at: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          caption?: string | null
          content_type?: string | null
          created_at?: string
          duration_seconds?: number | null
          external_post_id?: string
          id?: string
          metadata?: Json
          permalink?: string | null
          pillar?: string | null
          published_at?: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      oauth_connection_states: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          owner_id: string
          platform: Database["public"]["Enums"]["social_platform"]
          return_path: string
          state_hash: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          owner_id: string
          platform: Database["public"]["Enums"]["social_platform"]
          return_path?: string
          state_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          owner_id?: string
          platform?: Database["public"]["Enums"]["social_platform"]
          return_path?: string
          state_hash?: string
        }
        Relationships: []
      }
      post_daily_metrics: {
        Row: {
          average_watch_time_seconds: number | null
          comments: number
          completion_rate_percent: number | null
          engagement_rate_percent: number | null
          engagements: number
          impressions: number
          ingested_at: string
          likes: number
          metadata: Json
          metric_date: string
          post_id: string
          reach: number
          saves: number
          shares: number
          source_updated_at: string | null
          views: number
          watch_time_seconds: number
        }
        Insert: {
          average_watch_time_seconds?: number | null
          comments?: number
          completion_rate_percent?: number | null
          engagement_rate_percent?: number | null
          engagements?: number
          impressions?: number
          ingested_at?: string
          likes?: number
          metadata?: Json
          metric_date: string
          post_id: string
          reach?: number
          saves?: number
          shares?: number
          source_updated_at?: string | null
          views?: number
          watch_time_seconds?: number
        }
        Update: {
          average_watch_time_seconds?: number | null
          comments?: number
          completion_rate_percent?: number | null
          engagement_rate_percent?: number | null
          engagements?: number
          impressions?: number
          ingested_at?: string
          likes?: number
          metadata?: Json
          metric_date?: string
          post_id?: string
          reach?: number
          saves?: number
          shares?: number
          source_updated_at?: string | null
          views?: number
          watch_time_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_daily_metrics_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_metric_snapshots: {
        Row: {
          captured_at: string
          comments: number
          impressions: number
          likes: number
          metadata: Json
          post_id: string
          reach: number
          saves: number
          shares: number
          snapshot_date: string
          views: number
        }
        Insert: {
          captured_at?: string
          comments?: number
          impressions?: number
          likes?: number
          metadata?: Json
          post_id: string
          reach?: number
          saves?: number
          shares?: number
          snapshot_date: string
          views?: number
        }
        Update: {
          captured_at?: string
          comments?: number
          impressions?: number
          likes?: number
          metadata?: Json
          post_id?: string
          reach?: number
          saves?: number
          shares?: number
          snapshot_date?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_metric_snapshots_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_accounts: {
        Row: {
          avatar_url: string | null
          connected_at: string | null
          created_at: string
          display_name: string | null
          external_account_id: string
          handle: string | null
          id: string
          last_synced_at: string | null
          metadata: Json
          owner_id: string
          platform: Database["public"]["Enums"]["social_platform"]
          profile_url: string | null
          scopes: string[]
          status: Database["public"]["Enums"]["social_account_status"]
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          connected_at?: string | null
          created_at?: string
          display_name?: string | null
          external_account_id: string
          handle?: string | null
          id?: string
          last_synced_at?: string | null
          metadata?: Json
          owner_id: string
          platform: Database["public"]["Enums"]["social_platform"]
          profile_url?: string | null
          scopes?: string[]
          status?: Database["public"]["Enums"]["social_account_status"]
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          connected_at?: string | null
          created_at?: string
          display_name?: string | null
          external_account_id?: string
          handle?: string | null
          id?: string
          last_synced_at?: string | null
          metadata?: Json
          owner_id?: string
          platform?: Database["public"]["Enums"]["social_platform"]
          profile_url?: string | null
          scopes?: string[]
          status?: Database["public"]["Enums"]["social_account_status"]
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_social_account_tokens: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      get_social_account_tokens: {
        Args: { p_account_id: string }
        Returns: {
          access_token: string
          expires_at: string
          provider_metadata: Json
          refresh_token: string
          scopes: string[]
          token_type: string
        }[]
      }
      store_social_account_tokens: {
        Args: {
          p_access_token: string
          p_account_id: string
          p_expires_at: string
          p_provider_metadata: Json
          p_refresh_token: string
          p_scopes: string[]
          p_token_type: string
        }
        Returns: undefined
      }
    }
    Enums: {
      analytics_sync_status:
        | "pending"
        | "running"
        | "succeeded"
        | "partial"
        | "failed"
      analytics_sync_trigger:
        | "oauth"
        | "manual"
        | "scheduled"
        | "webhook"
        | "backfill"
      social_account_status:
        | "pending"
        | "connected"
        | "expired"
        | "error"
        | "disconnected"
      social_platform: "youtube" | "instagram" | "facebook" | "tiktok"
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
      analytics_sync_status: [
        "pending",
        "running",
        "succeeded",
        "partial",
        "failed",
      ],
      analytics_sync_trigger: [
        "oauth",
        "manual",
        "scheduled",
        "webhook",
        "backfill",
      ],
      social_account_status: [
        "pending",
        "connected",
        "expired",
        "error",
        "disconnected",
      ],
      social_platform: ["youtube", "instagram", "facebook", "tiktok"],
    },
  },
} as const

