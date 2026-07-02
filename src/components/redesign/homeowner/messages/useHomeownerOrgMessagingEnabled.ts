'use client';

// The org kill-switch (`homeowner_cleaner_messaging_enabled`) is shared across
// the homeowner and cleaner surfaces; the canonical hook lives in src/hooks so
// both read the same cache. This alias keeps existing homeowner call sites stable.
export { useOrgMessagingEnabled as useHomeownerOrgMessagingEnabled } from '@/hooks/useOrgMessagingEnabled';
