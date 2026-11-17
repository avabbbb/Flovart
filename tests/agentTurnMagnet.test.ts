import { describe, expect, it } from 'vitest';
import { magnetStrength } from '../components/agent/AgentConversationNav';

describe('magnetStrength', () => {
  it('is strongest at the pointer and fades with distance', () => {
    expect(magnetStrength(0)).toBe(1);
    expect(magnetStrength(10)).toBeGreaterThan(magnetStrength(20));
    expect(magnetStrength(15)).toBeGreaterThan(0);
  });
  it('drops to zero far away or for non-finite distances', () => {
    expect(magnetStrength(40)).toBe(0);
    expect(magnetStrength(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
