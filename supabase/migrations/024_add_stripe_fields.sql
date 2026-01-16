-- Migration: Add Stripe fields for payment integration
-- This migration adds stripe_customer_id to user_profiles and stripe_setup_intent_id to payments

-- Add stripe_customer_id to user_profiles table
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Add index for faster lookups by stripe_customer_id
CREATE INDEX IF NOT EXISTS idx_user_profiles_stripe_customer_id 
ON user_profiles(stripe_customer_id) 
WHERE stripe_customer_id IS NOT NULL;

-- Add stripe_setup_intent_id to payments table for tracking payment method collection
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS stripe_setup_intent_id TEXT;

-- Add index for payments stripe_payment_intent_id for webhook lookups
CREATE INDEX IF NOT EXISTS idx_payments_stripe_payment_intent_id 
ON payments(stripe_payment_intent_id) 
WHERE stripe_payment_intent_id IS NOT NULL;

-- Comment explaining the fields
COMMENT ON COLUMN user_profiles.stripe_customer_id IS 'Stripe Customer ID for payment processing';
COMMENT ON COLUMN payments.stripe_setup_intent_id IS 'Stripe SetupIntent ID used for collecting payment method';

