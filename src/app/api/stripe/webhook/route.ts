import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { constructWebhookEvent } from '@/lib/stripe';
import Stripe from 'stripe';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Disable body parsing - we need the raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(request: NextRequest) {
  try {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      console.error('Missing stripe-signature header');
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET not configured');
      return NextResponse.json(
        { error: 'Webhook secret not configured' },
        { status: 500 }
      );
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = constructWebhookEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      );
    }

    console.log('Received Stripe webhook event:', event.type);

    // Handle different event types
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentSucceeded(supabaseAdmin, paymentIntent);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentFailed(supabaseAdmin, paymentIntent);
        break;
      }

      case 'setup_intent.succeeded': {
        const setupIntent = event.data.object as Stripe.SetupIntent;
        console.log('SetupIntent succeeded:', setupIntent.id);
        // No action needed - we handle this during confirmation
        break;
      }

      case 'setup_intent.setup_failed': {
        const setupIntent = event.data.object as Stripe.SetupIntent;
        console.log('SetupIntent failed:', setupIntent.id, setupIntent.last_setup_error?.message);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

async function handlePaymentIntentSucceeded(
  supabaseAdmin: ReturnType<typeof createClient>,
  paymentIntent: Stripe.PaymentIntent
) {
  console.log('PaymentIntent succeeded:', paymentIntent.id);

  const appointmentId = paymentIntent.metadata?.appointment_id;

  if (!appointmentId) {
    console.log('No appointment_id in PaymentIntent metadata, skipping');
    return;
  }

  // Update payment record
  const { error: updateError } = await supabaseAdmin
    .from('payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
    })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (updateError) {
    console.error('Error updating payment record:', updateError);
    
    // Try to find and update by appointment_id as fallback
    const { error: fallbackError } = await supabaseAdmin
      .from('payments')
      .update({
        status: 'paid',
        stripe_payment_intent_id: paymentIntent.id,
        paid_at: new Date().toISOString(),
      })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending');

    if (fallbackError) {
      console.error('Fallback update also failed:', fallbackError);
    }
  }

  console.log('Payment record updated for appointment:', appointmentId);
}

async function handlePaymentIntentFailed(
  supabaseAdmin: ReturnType<typeof createClient>,
  paymentIntent: Stripe.PaymentIntent
) {
  console.log('PaymentIntent failed:', paymentIntent.id);
  console.log('Failure reason:', paymentIntent.last_payment_error?.message);

  const appointmentId = paymentIntent.metadata?.appointment_id;

  if (!appointmentId) {
    console.log('No appointment_id in PaymentIntent metadata, skipping');
    return;
  }

  // Update payment record to failed
  const { error: updateError } = await supabaseAdmin
    .from('payments')
    .update({
      status: 'failed',
    })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (updateError) {
    console.error('Error updating payment record:', updateError);
    
    // Try to find and update by appointment_id as fallback
    const { error: fallbackError } = await supabaseAdmin
      .from('payments')
      .update({
        status: 'failed',
        stripe_payment_intent_id: paymentIntent.id,
      })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending');

    if (fallbackError) {
      console.error('Fallback update also failed:', fallbackError);
    }
  }

  console.log('Payment marked as failed for appointment:', appointmentId);
}

