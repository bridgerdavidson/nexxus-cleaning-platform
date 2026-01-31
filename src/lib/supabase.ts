import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client-side Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true, // Re-enabled: handles token expiration automatically
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// Database types
export type Database = {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string
          email: string
          first_name: string | null
          last_name: string | null
          phone: string | null
          role: 'homeowner' | 'cleaner' | 'admin'
          avatar_url: string | null
          stripe_customer_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          role?: 'homeowner' | 'cleaner' | 'admin'
          avatar_url?: string | null
          stripe_customer_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          role?: 'homeowner' | 'cleaner' | 'admin'
          avatar_url?: string | null
          stripe_customer_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      organizations: {
        Row: {
          id: string
          name: string
          logo_url: string | null
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          name: string
          logo_url?: string | null
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          name?: string
          logo_url?: string | null
          created_at?: string
          created_by?: string | null
        }
      }
      organization_members: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          role: 'owner' | 'admin' | 'manager' | 'cleaner' | 'homeowner'
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          role: 'owner' | 'admin' | 'manager' | 'cleaner' | 'homeowner'
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          role?: 'owner' | 'admin' | 'manager' | 'cleaner' | 'homeowner'
          created_at?: string
        }
      }
      properties: {
        Row: {
          id: string
          owner_id: string
          organization_id: string | null
          address: string
          city: string
          state: string
          zip_code: string
          property_type: string
          square_footage: number | null
          bedrooms: number | null
          bathrooms: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          organization_id?: string | null
          address: string
          city: string
          state: string
          zip_code: string
          property_type: string
          square_footage?: number | null
          bedrooms?: number | null
          bathrooms?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          organization_id?: string | null
          address?: string
          city?: string
          state?: string
          zip_code?: string
          property_type?: string
          square_footage?: number | null
          bedrooms?: number | null
          bathrooms?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      service_types: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          base_price: number
          duration_minutes: number
          service_type: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          base_price: number
          duration_minutes: number
          service_type: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          description?: string | null
          base_price?: number
          duration_minutes?: number
          service_type?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      appointments: {
        Row: {
          id: string
          organization_id: string | null
          homeowner_id: string
          cleaner_id: string | null
          property_id: string
          service_type_id: string
          scheduled_date: string
          scheduled_time: string
          status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
          total_price: number
          notes: string | null
          series_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id?: string | null
          homeowner_id: string
          cleaner_id?: string | null
          property_id: string
          service_type_id: string
          scheduled_date: string
          scheduled_time: string
          status?: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
          total_price: number
          notes?: string | null
          series_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string | null
          homeowner_id?: string
          cleaner_id?: string | null
          property_id?: string
          service_type_id?: string
          scheduled_date?: string
          scheduled_time?: string
          status?: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
          total_price?: number
          notes?: string | null
          series_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      recurring_appointment_series: {
        Row: {
          id: string
          organization_id: string
          homeowner_id: string
          cleaner_id: string | null
          property_id: string
          service_type_id: string
          start_date: string
          start_time: string
          duration_minutes: number
          total_price: number
          special_requests: string | null
          recurrence_type: 'daily' | 'weekly' | 'monthly'
          interval: number
          days_of_week: number[] | null
          end_date: string | null
          max_occurrences: number | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          homeowner_id: string
          cleaner_id?: string | null
          property_id: string
          service_type_id: string
          start_date: string
          start_time: string
          duration_minutes: number
          total_price: number
          special_requests?: string | null
          recurrence_type: 'daily' | 'weekly' | 'monthly'
          interval?: number
          days_of_week?: number[] | null
          end_date?: string | null
          max_occurrences?: number | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          homeowner_id?: string
          cleaner_id?: string | null
          property_id?: string
          service_type_id?: string
          start_date?: string
          start_time?: string
          duration_minutes?: number
          total_price?: number
          special_requests?: string | null
          recurrence_type?: 'daily' | 'weekly' | 'monthly'
          interval?: number
          days_of_week?: number[] | null
          end_date?: string | null
          max_occurrences?: number | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      cleaner_profiles: {
        Row: {
          id: string
          organization_id: string | null
          user_id: string
          hourly_rate: number | null
          experience_years: number | null
          bio: string | null
          is_available: boolean
          background_check_verified: boolean
          insurance_verified: boolean
          rating: number | null
          total_jobs: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id?: string | null
          user_id: string
          hourly_rate?: number | null
          experience_years?: number | null
          bio?: string | null
          is_available?: boolean
          background_check_verified?: boolean
          insurance_verified?: boolean
          rating?: number | null
          total_jobs?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string | null
          user_id?: string
          hourly_rate?: number | null
          experience_years?: number | null
          bio?: string | null
          is_available?: boolean
          background_check_verified?: boolean
          insurance_verified?: boolean
          rating?: number | null
          total_jobs?: number
          created_at?: string
          updated_at?: string
        }
      }
      payments: {
        Row: {
          id: string
          organization_id: string | null
          appointment_id: string
          amount: number
          status: 'pending' | 'paid' | 'failed' | 'refunded'
          payment_method: string | null
          stripe_payment_intent_id: string | null
          stripe_setup_intent_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id?: string | null
          appointment_id: string
          amount: number
          status?: 'pending' | 'paid' | 'failed' | 'refunded'
          payment_method?: string | null
          stripe_payment_intent_id?: string | null
          stripe_setup_intent_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string | null
          appointment_id?: string
          amount?: number
          status?: 'pending' | 'paid' | 'failed' | 'refunded'
          payment_method?: string | null
          stripe_payment_intent_id?: string | null
          stripe_setup_intent_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      messages: {
        Row: {
          id: string
          organization_id: string | null
          sender_id: string
          recipient_id: string
          appointment_id: string | null
          subject: string | null
          content: string
          is_read: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id?: string | null
          sender_id: string
          recipient_id: string
          appointment_id?: string | null
          subject?: string | null
          content: string
          is_read?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string | null
          sender_id?: string
          recipient_id?: string
          appointment_id?: string | null
          subject?: string | null
          content?: string
          is_read?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      reviews: {
        Row: {
          id: string
          organization_id: string | null
          appointment_id: string
          reviewer_id: string
          reviewee_id: string
          rating: number
          comment: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id?: string | null
          appointment_id: string
          reviewer_id: string
          reviewee_id: string
          rating: number
          comment?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string | null
          appointment_id?: string
          reviewer_id?: string
          reviewee_id?: string
          rating?: number
          comment?: string | null
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      org_role: 'owner' | 'admin' | 'manager' | 'cleaner' | 'homeowner'
    }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]
