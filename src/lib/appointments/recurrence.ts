/**
 * Recurrence generation utilities for recurring appointments
 * 
 * This module provides functions to generate appointment occurrences
 * based on recurrence patterns (daily, weekly, monthly).
 */

import { addDays, addWeeks, addMonths, isBefore, isEqual, startOfDay } from 'date-fns';

// Safety caps to prevent generating too many appointments
const MAX_OCCURRENCES_CAP = 50;
const MAX_HORIZON_MONTHS = 6;

export interface OccurrenceInput {
  startDate: string;           // ISO date string (YYYY-MM-DD)
  startTime: string;           // Time string (HH:mm)
  durationMinutes: number;
  recurrenceType: 'daily' | 'weekly' | 'monthly';
  interval: number;            // Every N days/weeks/months
  daysOfWeek?: number[];       // For weekly: 0=Sunday..6=Saturday
  endDate?: string | null;     // ISO date string (YYYY-MM-DD) or null
  maxOccurrences?: number | null;
}

export interface Occurrence {
  scheduled_date: string;      // ISO date string (YYYY-MM-DD)
  scheduled_time: string;      // Time string (HH:mm)
  duration_minutes: number;
}

/**
 * Generate appointment occurrences based on a recurrence pattern.
 * 
 * Safety features:
 * - Maximum horizon of 6 months from start date
 * - Maximum of 50 occurrences
 * - User-specified limits (endDate or maxOccurrences) are respected
 * 
 * @param input - The recurrence pattern configuration
 * @returns Array of occurrence objects with scheduled_date, scheduled_time, duration_minutes
 */
export function generateOccurrences(input: OccurrenceInput): Occurrence[] {
  const {
    startDate,
    startTime,
    durationMinutes,
    recurrenceType,
    interval,
    daysOfWeek,
    endDate,
    maxOccurrences,
  } = input;

  // Parse start date
  const start = startOfDay(new Date(startDate));
  
  // Calculate the hard cap end date (6 months from start)
  const hardCapEnd = addMonths(start, MAX_HORIZON_MONTHS);
  
  // Determine the effective cutoff date
  const userEnd = endDate ? startOfDay(new Date(endDate)) : null;
  const cutoffDate = userEnd 
    ? (isBefore(userEnd, hardCapEnd) ? userEnd : hardCapEnd)
    : hardCapEnd;
  
  // Determine effective max occurrences
  const effectiveMaxOccurrences = maxOccurrences 
    ? Math.min(maxOccurrences, MAX_OCCURRENCES_CAP)
    : MAX_OCCURRENCES_CAP;

  const occurrences: Occurrence[] = [];

  if (recurrenceType === 'daily') {
    let current = start;
    
    while (
      (isBefore(current, cutoffDate) || isEqual(current, cutoffDate)) &&
      occurrences.length < effectiveMaxOccurrences
    ) {
      occurrences.push({
        scheduled_date: formatDate(current),
        scheduled_time: startTime,
        duration_minutes: durationMinutes,
      });
      
      current = addDays(current, interval);
    }
  } else if (recurrenceType === 'monthly') {
    let current = start;
    
    while (
      (isBefore(current, cutoffDate) || isEqual(current, cutoffDate)) &&
      occurrences.length < effectiveMaxOccurrences
    ) {
      occurrences.push({
        scheduled_date: formatDate(current),
        scheduled_time: startTime,
        duration_minutes: durationMinutes,
      });
      
      current = addMonths(current, interval);
    }
  } else if (recurrenceType === 'weekly') {
    // For weekly recurrence, use daysOfWeek if provided,
    // otherwise default to the weekday of the start date
    const activeDays = (daysOfWeek && daysOfWeek.length > 0)
      ? [...daysOfWeek].sort((a, b) => a - b) // Sort days for consistent ordering
      : [start.getDay()];

    let currentWeekStart = start;
    let firstWeek = true;
    
    while (
      (isBefore(currentWeekStart, cutoffDate) || isEqual(currentWeekStart, cutoffDate)) &&
      occurrences.length < effectiveMaxOccurrences
    ) {
      for (const weekday of activeDays) {
        if (occurrences.length >= effectiveMaxOccurrences) break;
        
        // Calculate the date for this weekday in the current week
        const daysDiff = weekday - currentWeekStart.getDay();
        const targetDate = addDays(currentWeekStart, daysDiff);
        
        // Skip if target date is before start date (for first week)
        if (firstWeek && isBefore(targetDate, start)) continue;
        
        // Skip if target date is after cutoff
        if (isBefore(cutoffDate, targetDate)) continue;
        
        occurrences.push({
          scheduled_date: formatDate(targetDate),
          scheduled_time: startTime,
          duration_minutes: durationMinutes,
        });
      }
      
      firstWeek = false;
      currentWeekStart = addWeeks(currentWeekStart, interval);
    }
  }

  return occurrences;
}

/**
 * Format a Date object as an ISO date string (YYYY-MM-DD)
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Validate recurrence input before generating occurrences
 */
export function validateRecurrenceInput(input: OccurrenceInput): { valid: boolean; error?: string } {
  const { startDate, startTime, durationMinutes, recurrenceType, interval, daysOfWeek, maxOccurrences } = input;

  // Validate start date
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return { valid: false, error: 'Invalid start date format. Expected YYYY-MM-DD.' };
  }

  // Validate start time
  if (!startTime || !/^\d{2}:\d{2}$/.test(startTime)) {
    return { valid: false, error: 'Invalid start time format. Expected HH:mm.' };
  }

  // Validate duration
  if (typeof durationMinutes !== 'number' || durationMinutes <= 0) {
    return { valid: false, error: 'Duration must be a positive number.' };
  }

  // Validate recurrence type
  if (!['daily', 'weekly', 'monthly'].includes(recurrenceType)) {
    return { valid: false, error: 'Invalid recurrence type. Must be daily, weekly, or monthly.' };
  }

  // Validate interval
  if (typeof interval !== 'number' || interval <= 0) {
    return { valid: false, error: 'Interval must be a positive number.' };
  }

  // Validate days of week for weekly recurrence
  if (recurrenceType === 'weekly' && daysOfWeek) {
    if (!Array.isArray(daysOfWeek)) {
      return { valid: false, error: 'Days of week must be an array.' };
    }
    for (const day of daysOfWeek) {
      if (typeof day !== 'number' || day < 0 || day > 6) {
        return { valid: false, error: 'Days of week must contain numbers between 0 (Sunday) and 6 (Saturday).' };
      }
    }
  }

  // Validate max occurrences if provided
  if (maxOccurrences !== undefined && maxOccurrences !== null) {
    if (typeof maxOccurrences !== 'number' || maxOccurrences <= 0) {
      return { valid: false, error: 'Max occurrences must be a positive number.' };
    }
  }

  return { valid: true };
}

/**
 * Get a human-readable description of the recurrence pattern
 */
export function getRecurrenceDescription(input: OccurrenceInput): string {
  const { recurrenceType, interval, daysOfWeek } = input;
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  if (recurrenceType === 'daily') {
    return interval === 1 ? 'Every day' : `Every ${interval} days`;
  }
  
  if (recurrenceType === 'monthly') {
    return interval === 1 ? 'Every month' : `Every ${interval} months`;
  }
  
  if (recurrenceType === 'weekly') {
    const weekText = interval === 1 ? 'Every week' : `Every ${interval} weeks`;
    
    if (daysOfWeek && daysOfWeek.length > 0) {
      const sortedDays = [...daysOfWeek].sort((a, b) => a - b);
      const dayNamesStr = sortedDays.map(d => dayNames[d]).join(', ');
      return `${weekText} on ${dayNamesStr}`;
    }
    
    return weekText;
  }
  
  return 'Unknown pattern';
}

