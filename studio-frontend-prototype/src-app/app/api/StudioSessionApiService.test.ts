import { describe, expect, it } from 'vitest';
import { STUDIO_SESSION_API_BASE_URL, StudioSessionApiService } from './StudioSessionApiService';

/**
 * The descriptors, and nothing else: the effects suite replaces this service
 * with a mock, so a wrong path or verb here would pass every other test.
 */
describe('StudioSessionApiService', () => {
  const service = new StudioSessionApiService();

  it('is mounted under the gateway prefix', () => {
    expect(STUDIO_SESSION_API_BASE_URL).toBe('/cf/studio-session/v1');
  });

  it('launches with one POST to the collection', () => {
    expect(service.launch.key).toEqual(['/cf/studio-session/v1', 'POST', '/sessions']);
  });

  it('reads one session by id, encoded in the path segment', () => {
    expect(service.session({ sessionId: 's-1' }).key.slice(0, 3)).toEqual([
      '/cf/studio-session/v1',
      'GET',
      '/sessions/s-1',
    ]);
    expect(service.session({ sessionId: 'a/b' }).key[2]).toBe('/sessions/a%2Fb');
  });
});
