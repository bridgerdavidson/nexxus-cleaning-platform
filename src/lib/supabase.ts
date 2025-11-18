import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client-side Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Avoid clever background refresh that may hook into visibilitychange
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

/** Generic timeout helper so no async call can hang the UI forever */
export async function withTimeout<T>(
  fn: () => Promise<T> | T,
  ms: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  console.log('[withTimeout] starting', { ms, errorMessage });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      console.warn('[withTimeout] timeout fired', { ms, errorMessage });
      reject(new Error(errorMessage));
    }, ms);
  });

  try {
    const op = Promise.resolve(fn() as unknown as T);
    const result = (await Promise.race([op, timeout])) as T;
    console.log('[withTimeout] operation resolved before timeout');
    return result;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    console.log('[withTimeout] cleanup done');
  }
}

/** Safe session getter with a timeout, so it can't hang either */
export async function getSessionSafe(timeoutMs = 5000) {
  const { data, error } = await withTimeout(
    () => supabase.auth.getSession(),
    timeoutMs,
    'Session check timed out'
  );

  if (error) {
    throw error;
  }

  return data.session ?? null;
}

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
          created_at?: string
          updated_at?: string
        }
      }
      properties: {
        Row: {
          id: string
          owner_id: string
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
          name: string
          description: string | null
          base_price: number
          price_per_sqft: number | null
          duration_hours: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          base_price: number
          price_per_sqft?: number | null
          duration_hours: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          base_price?: number
          price_per_sqft?: number | null
          duration_hours?: number
          created_at?: string
          updated_at?: string
        }
      }
      appointments: {
        Row: {
          id: string
          homeowner_id: string
          cleaner_id: string | null
          property_id: string
          service_type_id: string
          scheduled_date: string
          scheduled_time: string
          status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
          total_price: number
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          homeowner_id: string
          cleaner_id?: string | null
          property_id: string
          service_type_id: string
          scheduled_date: string
          scheduled_time: string
          status?: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
          total_price: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          homeowner_id?: string
          cleaner_id?: string | null
          property_id?: string
          service_type_id?: string
          scheduled_date?: string
          scheduled_time?: string
          status?: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
          total_price?: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      cleaner_profiles: {
        Row: {
          id: string
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
          appointment_id: string
          amount: number
          status: 'pending' | 'paid' | 'failed' | 'refunded'
          payment_method: string | null
          stripe_payment_intent_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          appointment_id: string
          amount: number
          status?: 'pending' | 'paid' | 'failed' | 'refunded'
          payment_method?: string | null
          stripe_payment_intent_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          appointment_id?: string
          amount?: number
          status?: 'pending' | 'paid' | 'failed' | 'refunded'
          payment_method?: string | null
          stripe_payment_intent_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      messages: {
        Row: {
          id: string
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
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]
