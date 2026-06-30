// src/lib/notifications/labels.jobMessage.test.ts
import { describe, it, expect } from 'vitest';
import { describeNotification } from './labels';

describe('describeNotification - job_message', () => {
  it('uses the sender name and snippet from the payload', () => {
    const d = describeNotification('job_message', { sender_name: 'Maria', snippet: 'On my way' });
    expect(d.title).toBe('New message from Maria');
    expect(d.detail).toBe('On my way');
    expect(d.tone).toBe('info');
  });
  it('falls back to a generic title with no sender name', () => {
    const d = describeNotification('job_message', { snippet: 'Hi' });
    expect(d.title).toBe('New message');
  });
  it('is a known type (not the generic fallback)', () => {
    const d = describeNotification('job_message', {});
    expect(d.title).not.toBe('Update');
  });
});
