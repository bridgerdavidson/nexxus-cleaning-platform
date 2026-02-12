import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateOccurrences, validateRecurrenceInput } from '@/lib/appointments/recurrence';

// Create admin client for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

interface CreateRecurringAppointmentInput {
  organizationId: string;
  homeownerId: string;
  cleanerId?: string | null;
  propertyId: string;
  serviceTypeId: string;
  startDate: string;
  startTime: string;
  durationMinutes: number;
  totalPrice: number;
  recurrenceType: 'daily' | 'weekly' | 'monthly';
  interval: number;
  daysOfWeek?: number[];
  endDate?: string | null;
  maxOccurrences?: number | null;
  specialRequests?: string | null;
  status?: string; // Optional status - defaults to 'pending' if not provided
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateRecurringAppointmentInput = await request.json();

    // Validate required fields
    const {
      organizationId,
      homeownerId,
      cleanerId,
      propertyId,
      serviceTypeId,
      startDate,
      startTime,
      durationMinutes,
      totalPrice,
      recurrenceType,
      interval,
      daysOfWeek,
      endDate,
      maxOccurrences,
      specialRequests,
      status,
    } = body;

    if (!organizationId || !homeownerId || !propertyId || !serviceTypeId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: organizationId, homeownerId, propertyId, serviceTypeId' },
        { status: 400 }
      );
    }

    if (!startDate || !startTime || !durationMinutes || !recurrenceType || !interval) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: startDate, startTime, durationMinutes, recurrenceType, interval' },
        { status: 400 }
      );
    }

    // Validate recurrence input
    const validation = validateRecurrenceInput({
      startDate,
      startTime,
      durationMinutes,
      recurrenceType,
      interval,
      daysOfWeek,
      maxOccurrences,
    });

    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    // 1. Insert the recurring series
    const { data: series, error: seriesError } = await supabaseAdmin
      .from('recurring_appointment_series')
      .insert({
        organization_id: organizationId,
        homeowner_id: homeownerId,
        cleaner_id: cleanerId ?? null,
        property_id: propertyId,
        service_type_id: serviceTypeId,
        start_date: startDate,
        start_time: startTime,
        duration_minutes: durationMinutes,
        total_price: totalPrice,
        special_requests: specialRequests ?? null,
        recurrence_type: recurrenceType,
        interval: interval,
        days_of_week: daysOfWeek ?? null,
        end_date: endDate ?? null,
        max_occurrences: maxOccurrences ?? null,
        is_active: true,
      })
      .select()
      .single();

    if (seriesError || !series) {
      console.error('Error creating recurring series:', seriesError);
      return NextResponse.json(
        { success: false, error: seriesError?.message || 'Failed to create recurring series' },
        { status: 500 }
      );
    }

    // 2. Generate occurrences
    const occurrences = generateOccurrences({
      startDate,
      startTime,
      durationMinutes,
      recurrenceType,
      interval,
      daysOfWeek,
      endDate,
      maxOccurrences,
    });

    if (occurrences.length === 0) {
      // If no occurrences were generated, return the series but note there are no appointments
      return NextResponse.json({
        success: true,
        data: {
          series,
          appointmentsCreated: 0,
          message: 'Series created but no appointments were generated (check date range and settings)',
        },
      });
    }

    // 3. Bulk insert appointments
    // Use provided status or default to 'pending' for backward compatibility
    const appointmentStatus: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' = (status as 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled') || 'pending';
    const appointmentRows = occurrences.map((occ) => ({
      organization_id: organizationId,
      homeowner_id: homeownerId,
      cleaner_id: cleanerId ?? null,
      property_id: propertyId,
      service_type_id: serviceTypeId,
      scheduled_date: occ.scheduled_date,
      scheduled_time: occ.scheduled_time,
      duration_minutes: occ.duration_minutes,
      total_price: totalPrice,
      special_requests: specialRequests ?? null,
      status: appointmentStatus,
      series_id: series.id,
      cleaner_confirmation_status: 'awaiting',
    }));

    const { data: appointments, error: appointmentsError } = await supabaseAdmin
      .from('appointments')
      .insert(appointmentRows)
      .select();

    if (appointmentsError) {
      console.error('Error creating appointments:', appointmentsError);
      
      // If appointments failed, we should consider cleaning up the series
      // For now, we'll return an error but keep the series
      return NextResponse.json(
        { 
          success: false, 
          error: appointmentsError.message || 'Failed to create appointments',
          seriesId: series.id,
          message: 'Series was created but appointments failed. Manual cleanup may be needed.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        series,
        appointmentsCreated: appointments?.length || 0,
        appointments,
      },
    });

  } catch (error) {
    console.error('Error in recurring-appointments POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint to fetch recurring series for an organization
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json(
        { success: false, error: 'Missing organizationId parameter' },
        { status: 400 }
      );
    }

    const { data: series, error } = await supabaseAdmin
      .from('recurring_appointment_series')
      .select(`
        *,
        homeowner:user_profiles!homeowner_id(first_name, last_name, email),
        cleaner:cleaner_profiles!cleaner_id(
          user_profile:user_profiles!id(first_name, last_name)
        ),
        property:properties!property_id(name, address),
        service_type:service_types!service_type_id(name)
      `)
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching recurring series:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: series,
    });

  } catch (error) {
    console.error('Error in recurring-appointments GET:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

