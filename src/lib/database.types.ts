
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "activities": {
                  Row: {
                    "activity_date": string,"contact_email": string | null,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"created_by": string,"description": string | null,"end_time": string | null,"ends_at": string | null,"id": string,"include_in_weekly_summary": boolean,"location": string | null,"meeting_url": string | null,"preparation_notes": string | null,"reminders_enabled": boolean,"search": unknown,"start_time": string | null,"starts_at": string,"status": Database["public"]['Enums']["activity_status"],"status_changed_at": string | null,"status_changed_by": string | null,"status_reason": string | null,"timezone": string,"title": string,"updated_at": string,"updated_by": string | null,"version": number,"visibility": Database["public"]['Enums']["activity_visibility"]
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_date": string,"contact_email"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string | null,"end_time"?: string | null,"ends_at"?: string | null,"id"?: string,"include_in_weekly_summary"?: boolean,"location"?: string | null,"meeting_url"?: string | null,"preparation_notes"?: string | null,"reminders_enabled"?: boolean,"search"?: never,"start_time"?: string | null,"starts_at": string,"status"?: Database["public"]['Enums']["activity_status"],"status_changed_at"?: string | null,"status_changed_by"?: string | null,"status_reason"?: string | null,"timezone"?: string,"title": string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number,"visibility"?: Database["public"]['Enums']["activity_visibility"]
                  }
                  Update: {
                    "activity_date"?: string,"contact_email"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string | null,"end_time"?: string | null,"ends_at"?: string | null,"id"?: string,"include_in_weekly_summary"?: boolean,"location"?: string | null,"meeting_url"?: string | null,"preparation_notes"?: string | null,"reminders_enabled"?: boolean,"search"?: never,"start_time"?: string | null,"starts_at"?: string,"status"?: Database["public"]['Enums']["activity_status"],"status_changed_at"?: string | null,"status_changed_by"?: string | null,"status_reason"?: string | null,"timezone"?: string,"title"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number,"visibility"?: Database["public"]['Enums']["activity_visibility"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "activities_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activities_status_changed_by_fkey"
      columns: ["status_changed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activities_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"activity_recipients": {
                  Row: {
                    "activity_id": string,"contact_id": string | null,"created_at": string,"id": string,"notify_email": boolean,"notify_whatsapp": boolean,"profile_id": string | null,"role": Database["public"]['Enums']["recipient_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_id": string,"contact_id"?: string | null,"created_at"?: string,"id"?: string,"notify_email"?: boolean,"notify_whatsapp"?: boolean,"profile_id"?: string | null,"role": Database["public"]['Enums']["recipient_role"]
                  }
                  Update: {
                    "activity_id"?: string,"contact_id"?: string | null,"created_at"?: string,"id"?: string,"notify_email"?: boolean,"notify_whatsapp"?: boolean,"profile_id"?: string | null,"role"?: Database["public"]['Enums']["recipient_role"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_recipients_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_recipients_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_recipients_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"changed_fields": (string)[] | null,"id": number,"new_data": Json | null,"occurred_at": string,"old_data": Json | null,"record_id": string | null,"table_name": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"changed_fields"?: (string)[] | null,"id"?: never,"new_data"?: Json | null,"occurred_at"?: string,"old_data"?: Json | null,"record_id"?: string | null,"table_name"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"changed_fields"?: (string)[] | null,"id"?: never,"new_data"?: Json | null,"occurred_at"?: string,"old_data"?: Json | null,"record_id"?: string | null,"table_name"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"contacts": {
                  Row: {
                    "created_at": string,"created_by": string,"email": string | null,"full_name": string,"id": string,"is_active": boolean,"organisation": string | null,"phone": string | null,"receives_weekly_summary": boolean,"updated_at": string,"whatsapp_opt_in_at": string | null,"whatsapp_opt_out_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string,"email"?: string | null,"full_name": string,"id"?: string,"is_active"?: boolean,"organisation"?: string | null,"phone"?: string | null,"receives_weekly_summary"?: boolean,"updated_at"?: string,"whatsapp_opt_in_at"?: string | null,"whatsapp_opt_out_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"email"?: string | null,"full_name"?: string,"id"?: string,"is_active"?: boolean,"organisation"?: string | null,"phone"?: string | null,"receives_weekly_summary"?: boolean,"updated_at"?: string,"whatsapp_opt_in_at"?: string | null,"whatsapp_opt_out_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_jobs": {
                  Row: {
                    "accepted_at": string | null,"activity_id": string | null,"attempt_count": number,"basis_starts_at": string | null,"channel": Database["public"]['Enums']["notification_channel"],"contact_id": string | null,"created_at": string,"dedupe_key": string,"delivery_status": Database["public"]['Enums']["delivery_status"],"delivery_updated_at": string | null,"destination": string,"expires_at": string | null,"first_attempt_at": string | null,"id": string,"kind": Database["public"]['Enums']["notification_kind"],"last_error_code": string | null,"last_error_message": string | null,"lease_expires_at": string | null,"max_attempts": number,"period_start": string | null,"profile_id": string | null,"provider": string | null,"provider_message_id": string | null,"rendered_html": string | null,"rendered_subject": string | null,"rendered_text": string | null,"run_after": string,"scheduled_for": string,"send_mode": Database["public"]['Enums']["notification_mode"] | null,"status": Database["public"]['Enums']["job_status"],"status_reason": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"activity_id"?: string | null,"attempt_count"?: number,"basis_starts_at"?: string | null,"channel": Database["public"]['Enums']["notification_channel"],"contact_id"?: string | null,"created_at"?: string,"dedupe_key": string,"delivery_status"?: Database["public"]['Enums']["delivery_status"],"delivery_updated_at"?: string | null,"destination": string,"expires_at"?: string | null,"first_attempt_at"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["notification_kind"],"last_error_code"?: string | null,"last_error_message"?: string | null,"lease_expires_at"?: string | null,"max_attempts"?: number,"period_start"?: string | null,"profile_id"?: string | null,"provider"?: string | null,"provider_message_id"?: string | null,"rendered_html"?: string | null,"rendered_subject"?: string | null,"rendered_text"?: string | null,"run_after": string,"scheduled_for": string,"send_mode"?: Database["public"]['Enums']["notification_mode"] | null,"status"?: Database["public"]['Enums']["job_status"],"status_reason"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"activity_id"?: string | null,"attempt_count"?: number,"basis_starts_at"?: string | null,"channel"?: Database["public"]['Enums']["notification_channel"],"contact_id"?: string | null,"created_at"?: string,"dedupe_key"?: string,"delivery_status"?: Database["public"]['Enums']["delivery_status"],"delivery_updated_at"?: string | null,"destination"?: string,"expires_at"?: string | null,"first_attempt_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["notification_kind"],"last_error_code"?: string | null,"last_error_message"?: string | null,"lease_expires_at"?: string | null,"max_attempts"?: number,"period_start"?: string | null,"profile_id"?: string | null,"provider"?: string | null,"provider_message_id"?: string | null,"rendered_html"?: string | null,"rendered_subject"?: string | null,"rendered_text"?: string | null,"run_after"?: string,"scheduled_for"?: string,"send_mode"?: Database["public"]['Enums']["notification_mode"] | null,"status"?: Database["public"]['Enums']["job_status"],"status_reason"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_jobs_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_jobs_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_jobs_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_logs": {
                  Row: {
                    "attempt": number | null,"created_at": string,"details": NonNullable<Json>,"error_code": string | null,"error_message": string | null,"event": string,"http_status": number | null,"id": number,"job_id": string | null,"provider": string | null,"provider_event_id": string | null,"provider_message_id": string | null,"run_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt"?: number | null,"created_at"?: string,"details"?: NonNullable<Json>,"error_code"?: string | null,"error_message"?: string | null,"event": string,"http_status"?: number | null,"id"?: never,"job_id"?: string | null,"provider"?: string | null,"provider_event_id"?: string | null,"provider_message_id"?: string | null,"run_id"?: string | null
                  }
                  Update: {
                    "attempt"?: number | null,"created_at"?: string,"details"?: NonNullable<Json>,"error_code"?: string | null,"error_message"?: string | null,"event"?: string,"http_status"?: number | null,"id"?: never,"job_id"?: string | null,"provider"?: string | null,"provider_event_id"?: string | null,"provider_message_id"?: string | null,"run_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_logs_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "notification_jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string,"id": string,"is_active": boolean,"phone": string | null,"receives_weekly_summary": boolean,"role": Database["public"]['Enums']["app_role"],"updated_at": string,"whatsapp_opt_in_at": string | null,"whatsapp_opt_out_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"full_name": string,"id": string,"is_active"?: boolean,"phone"?: string | null,"receives_weekly_summary"?: boolean,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string,"whatsapp_opt_in_at"?: string | null,"whatsapp_opt_out_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string,"id"?: string,"is_active"?: boolean,"phone"?: string | null,"receives_weekly_summary"?: boolean,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string,"whatsapp_opt_in_at"?: string | null,"whatsapp_opt_out_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"system_settings": {
                  Row: {
                    "date_only_reminder_time": string,"dispatch_batch_size": number,"email_from_name": string,"email_reply_to": string | null,"id": boolean,"notification_mode": Database["public"]['Enums']["notification_mode"],"office_name": string,"reminder_lead": string,"reminder_min_notice": string,"test_redirect_email": string | null,"timezone": string,"updated_at": string,"updated_by": string | null,"weekly_summary_enabled": boolean,"weekly_summary_late_cutoff": string,"weekly_summary_send_if_empty": boolean,"weekly_summary_send_time": string
                  }
                  ComputedFields: never
                  Insert: {
                    "date_only_reminder_time"?: string,"dispatch_batch_size"?: number,"email_from_name"?: string,"email_reply_to"?: string | null,"id"?: boolean,"notification_mode"?: Database["public"]['Enums']["notification_mode"],"office_name"?: string,"reminder_lead"?: string,"reminder_min_notice"?: string,"test_redirect_email"?: string | null,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null,"weekly_summary_enabled"?: boolean,"weekly_summary_late_cutoff"?: string,"weekly_summary_send_if_empty"?: boolean,"weekly_summary_send_time"?: string
                  }
                  Update: {
                    "date_only_reminder_time"?: string,"dispatch_batch_size"?: number,"email_from_name"?: string,"email_reply_to"?: string | null,"id"?: boolean,"notification_mode"?: Database["public"]['Enums']["notification_mode"],"office_name"?: string,"reminder_lead"?: string,"reminder_min_notice"?: string,"test_redirect_email"?: string | null,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null,"weekly_summary_enabled"?: boolean,"weekly_summary_late_cutoff"?: string,"weekly_summary_send_if_empty"?: boolean,"weekly_summary_send_time"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "system_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "can_edit_activity":
{ Args: { "p_activity_id": string }; Returns: boolean
                           },
"can_view_activity":
{ Args: { "p_activity_id": string }; Returns: boolean
                           },
"is_active_staff":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_activity_recipient":
{ Args: { "p_activity_id": string }; Returns: boolean
                           },
"is_activity_responsible":
{ Args: { "p_activity_id": string }; Returns: boolean
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"office_info":
{ Args: Record<PropertyKey, never>; Returns: {
              "office_name": string,"timezone": string
            }[]
                           },
"save_activity":
{ Args: { "p_activity": Json,"p_expected_version"?: number,"p_recipients": Json }; Returns: string
                           },
"set_activity_recipients":
{ Args: { "p_activity_id": string,"p_recipients": Json }; Returns: undefined
                           },
"set_activity_status":
{ Args: { "p_activity_id": string,"p_expected_version"?: number,"p_reason"?: string,"p_status": Database["public"]['Enums']["activity_status"] }; Returns: number
                           }
          }
          Enums: {
            "activity_status": "scheduled"|"completed"|"cancelled","activity_visibility": "office"|"restricted","app_role": "admin"|"staff","delivery_status": "unknown"|"delivered"|"delayed"|"bounced"|"complained"|"failed"|"suppressed","job_status": "pending"|"processing"|"sent"|"failed"|"cancelled"|"skipped","notification_channel": "email"|"whatsapp","notification_kind": "day_before_reminder"|"weekly_summary"|"test","notification_mode": "off"|"test"|"live","recipient_role": "responsible"|"collaborator"|"notify_only"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "activity_status": ["scheduled", "completed", "cancelled"],"activity_visibility": ["office", "restricted"],"app_role": ["admin", "staff"],"delivery_status": ["unknown", "delivered", "delayed", "bounced", "complained", "failed", "suppressed"],"job_status": ["pending", "processing", "sent", "failed", "cancelled", "skipped"],"notification_channel": ["email", "whatsapp"],"notification_kind": ["day_before_reminder", "weekly_summary", "test"],"notification_mode": ["off", "test", "live"],"recipient_role": ["responsible", "collaborator", "notify_only"]
          }
        }
} as const
