-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create custom types
CREATE TYPE user_role AS ENUM ('homeowner', 'cleaner', 'admin');
CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled');
CREATE TYPE service_type AS ENUM ('regular', 'deep', 'move_out', 'custom');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');

-- User profiles table (extends Supabase auth.users)
CREATE TABLE user_profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    role user_role NOT NULL DEFAULT 'homeowner',
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Properties table
CREATE TABLE properties (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    owner_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    zip_code TEXT NOT NULL,
    bedrooms INTEGER,
    bathrooms INTEGER,
    square_feet INTEGER,
    special_instructions TEXT,
    access_instructions TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Service types table
CREATE TABLE service_types (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    base_price DECIMAL(10,2) NOT NULL,
    duration_minutes INTEGER NOT NULL,
    service_type service_type NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cleaner profiles table
CREATE TABLE cleaner_profiles (
    id UUID REFERENCES user_profiles(id) ON DELETE CASCADE PRIMARY KEY,
    bio TEXT,
    experience_years INTEGER,
    hourly_rate DECIMAL(10,2),
    rating DECIMAL(3,2) DEFAULT 0.00,
    total_jobs INTEGER DEFAULT 0,
    is_available BOOLEAN DEFAULT true,
    background_check_verified BOOLEAN DEFAULT false,
    insurance_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Appointments table
CREATE TABLE appointments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    homeowner_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
    cleaner_id UUID REFERENCES cleaner_profiles(id) ON DELETE SET NULL,
    property_id UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
    service_type_id UUID REFERENCES service_types(id) ON DELETE RESTRICT NOT NULL,
    scheduled_date DATE NOT NULL,
    scheduled_time TIME NOT NULL,
    duration_minutes INTEGER NOT NULL,
    status appointment_status DEFAULT 'pending',
    total_price DECIMAL(10,2) NOT NULL,
    special_requests TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payments table
CREATE TABLE payments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status payment_status DEFAULT 'pending',
    stripe_payment_intent_id TEXT,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages table
CREATE TABLE messages (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sender_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
    recipient_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
    appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
    subject TEXT,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Reviews table
CREATE TABLE reviews (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE NOT NULL,
    reviewer_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
    reviewee_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5) NOT NULL,
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_user_profiles_role ON user_profiles(role);
CREATE INDEX idx_properties_owner_id ON properties(owner_id);
CREATE INDEX idx_appointments_homeowner_id ON appointments(homeowner_id);
CREATE INDEX idx_appointments_cleaner_id ON appointments(cleaner_id);
CREATE INDEX idx_appointments_scheduled_date ON appointments(scheduled_date);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_recipient_id ON messages(recipient_id);
CREATE INDEX idx_payments_appointment_id ON payments(appointment_id);

-- Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- User profiles policies
CREATE POLICY "Users can view their own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Properties policies
CREATE POLICY "Homeowners can view their own properties" ON properties
    FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Homeowners can manage their own properties" ON properties
    FOR ALL USING (auth.uid() = owner_id);

-- Service types policies (public read)
CREATE POLICY "Anyone can view service types" ON service_types
    FOR SELECT USING (true);

-- Cleaner profiles policies
CREATE POLICY "Cleaners can view their own profile" ON cleaner_profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Cleaners can update their own profile" ON cleaner_profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Anyone can view cleaner profiles" ON cleaner_profiles
    FOR SELECT USING (true);

-- Appointments policies
CREATE POLICY "Homeowners can view their appointments" ON appointments
    FOR SELECT USING (auth.uid() = homeowner_id);

CREATE POLICY "Cleaners can view their appointments" ON appointments
    FOR SELECT USING (auth.uid() = cleaner_id);

CREATE POLICY "Homeowners can create appointments" ON appointments
    FOR INSERT WITH CHECK (auth.uid() = homeowner_id);

CREATE POLICY "Homeowners can update their appointments" ON appointments
    FOR UPDATE USING (auth.uid() = homeowner_id);

CREATE POLICY "Cleaners can update appointment status" ON appointments
    FOR UPDATE USING (auth.uid() = cleaner_id);

-- Payments policies
CREATE POLICY "Users can view payments for their appointments" ON payments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM appointments 
            WHERE appointments.id = payments.appointment_id 
            AND (appointments.homeowner_id = auth.uid() OR appointments.cleaner_id = auth.uid())
        )
    );

-- Messages policies
CREATE POLICY "Users can view their messages" ON messages
    FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "Users can send messages" ON messages
    FOR INSERT WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update their received messages" ON messages
    FOR UPDATE USING (auth.uid() = recipient_id);

-- Reviews policies
CREATE POLICY "Users can view reviews" ON reviews
    FOR SELECT USING (true);

CREATE POLICY "Users can create reviews for their appointments" ON reviews
    FOR INSERT WITH CHECK (
        auth.uid() = reviewer_id AND
        EXISTS (
            SELECT 1 FROM appointments 
            WHERE appointments.id = reviews.appointment_id 
            AND (appointments.homeowner_id = auth.uid() OR appointments.cleaner_id = auth.uid())
        )
    );

-- Functions and triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON properties
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cleaner_profiles_updated_at BEFORE UPDATE ON cleaner_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default service types
INSERT INTO service_types (name, description, base_price, duration_minutes, service_type) VALUES
('Regular Cleaning', 'Weekly, bi-weekly, or monthly cleaning to maintain your home''s cleanliness', 80.00, 120, 'regular'),
('Deep Cleaning', 'Comprehensive cleaning for move-ins, special occasions, or seasonal cleaning', 150.00, 240, 'deep'),
('Move-out Cleaning', 'Thorough cleaning to help you get your security deposit back', 200.00, 300, 'move_out'),
('Custom Service', 'Tailored cleaning service based on specific requirements', 100.00, 180, 'custom');

-- Function to handle new user registration
-- Uses app_metadata for role (secure, only settable by service role)
-- Uses user_metadata for name (user-editable)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, first_name, last_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
        COALESCE(NEW.raw_app_meta_data->>'role', 'homeowner')::user_role
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create user profile on signup
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
