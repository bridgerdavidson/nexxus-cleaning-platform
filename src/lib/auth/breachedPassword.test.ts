import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkPasswordNotBreached } from './breachedPassword';

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
//   prefix 5BAA6, suffix 1E4C9B93F3F0682250B6CF8331B7EE68FD8
afterEach(() => vi.restoreAllMocks());

describe('checkPasswordNotBreached', () => {
  it('returns breached:true when the suffix is in the HIBP range response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            '00000000000000000000000000000000000:3\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:99999',
          ),
      }),
    );
    expect(await checkPasswordNotBreached('password')).toEqual({ breached: true });
  });

  it('returns breached:false when the suffix is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            '00000000000000000000000000000000000:3\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1',
          ),
      }),
    );
    expect(await checkPasswordNotBreached('password')).toEqual({ breached: false });
  });

  it('fails open (breached:false) when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await checkPasswordNotBreached('password')).toEqual({ breached: false });
  });

  it('fails open on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve('') }));
    expect(await checkPasswordNotBreached('password')).toEqual({ breached: false });
  });
});
