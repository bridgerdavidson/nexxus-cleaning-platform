// ==========================================
// DATABASE TYPES - MUST MATCH DB SCHEMA
// See DB-SCHEMA-REFERENCE.md for details
// ==========================================

// ENUMS (must match database)
export type UserRole = 'homeowner' | 'cleaner' | 'admin';
export type AppointmentStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
export type ServiceType = 'regular' | 'deep' | 'move_out' | 'custom';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

// USER PROFILES
export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

// CLEANER PROFILES
export interface CleanerProfile {
  id: string; // References user_profiles(id) - NOT a separate user_id field!
  bio: string | null;
  experience_years: number | null;
  hourly_rate: number | null;
  rating: number; // numeric(3,2), default 0.00
  total_jobs: number; // default 0
  is_available: boolean; // default true
  background_check_verified: boolean; // default false
  insurance_verified: boolean; // default false
  created_at: string;
  updated_at: string;
}

// PROPERTIES
export interface Property {
  id: string;
  owner_id: string; // References user_profiles(id)
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  special_instructions: string | null;
  access_instructions: string | null;
  created_at: string;
  updated_at: string;
}

// SERVICE TYPES
export interface ServiceTypeRecord {
  id: string;
  name: string;
  description: string | null;
  base_price: number; // numeric(10,2)
  duration_minutes: number; // NOT estimated_duration!
  service_type: ServiceType;
  is_active: boolean; // default true
  created_at: string;
}

// APPOINTMENTS
export interface Appointment {
  id: string;
  homeowner_id: string; // References user_profiles(id)
  cleaner_id: string | null; // References cleaner_profiles(id)
  property_id: string;
  service_type_id: string;
  scheduled_date: string; // date
  scheduled_time: string; // time
  duration_minutes: number;
  status: AppointmentStatus;
  total_price: number; // numeric(10,2)
  special_requests: string | null; // NOT special_instructions!
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// PAYMENTS
export interface Payment {
  id: string;
  appointment_id: string;
  amount: number; // numeric(10,2)
  status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
  created_at: string;
}

// MESSAGES
export interface Message {
  id: string;
  sender_id: string; // References user_profiles(id)
  recipient_id: string; // References user_profiles(id)
  appointment_id: string | null;
  subject: string | null;
  content: string;
  is_read: boolean; // default false
  created_at: string;
}

// REVIEWS
export interface Review {
  id: string;
  appointment_id: string;
  reviewer_id: string; // References user_profiles(id)
  reviewee_id: string; // References user_profiles(id)
  rating: number; // integer, 1-5
  comment: string | null;
  created_at: string;
}

// ==========================================
// LEGACY TYPES (For backward compatibility)
// TODO: Gradually migrate these to use database types above
// ==========================================

export interface User {
  id: string;
  email: string;
  role: UserRole;
  profile: {
    firstName: string;
    lastName: string;
    phone: string;
    avatarUrl?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AuthContextType {
  user: User | null;
  login: (email: string, password: string, role: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

export interface BookingFormData {
  propertyId?: string;
  address: string;
  dateTime: string;
  notes?: string;
  recurringWeekly?: boolean;
  recurringBiweekly?: boolean;
}

export interface CleanerStats {
  totalJobs: number;
  completedJobs: number;
  totalEarnings: number;
  pendingPayouts: number;
  rating: number;
}

export interface AdminStats {
  totalBookings: number;
  activeCleaners: number;
  totalRevenue: number;
  pendingApprovals: number;
  monthlyGrowth: number;
}

export interface ChatRoom {
  id: string;
  bookingId: string;
  participants: User[];
  lastMessage?: Message;
  unreadCount: number;
}

export interface ServiceArea {
  zipCode: string;
  city: string;
  state: string;
  isActive: boolean;
}

export interface PricingTier {
  id: string;
  name: string;
  basePrice: number;
  description: string;
  features: string[];
}

// ==========================================
// IMPORTANT REMINDERS
// ==========================================
// 
// When querying Supabase:
// - Use `duration_minutes` NOT `estimated_duration`
// - Use `special_requests` NOT `special_instructions` (in appointments table)
// - cleaner_profiles.id IS the user's id (no separate user_id column)
// - All column names are snake_case in database
// 
// See DB-SCHEMA-REFERENCE.md for complete schema documentation.
