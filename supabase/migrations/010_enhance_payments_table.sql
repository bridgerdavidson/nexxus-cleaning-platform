-- Create payment_type enum
CREATE TYPE payment_type AS ENUM ('revenue', 'expense', 'refund');

-- Create payment_method enum
CREATE TYPE payment_method AS ENUM ('card', 'ach', 'manual');

-- Add new columns to payments table
ALTER TABLE payments
ADD COLUMN payment_type payment_type DEFAULT 'revenue',
ADD COLUMN payment_method payment_method DEFAULT 'manual',
ADD COLUMN notes TEXT,
ADD COLUMN reference TEXT;

-- Create index on payment_type for faster filtering
CREATE INDEX idx_payments_payment_type ON payments(payment_type);
CREATE INDEX idx_payments_payment_method ON payments(payment_method);
