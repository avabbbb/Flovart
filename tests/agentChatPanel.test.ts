import { describe, expect, it } from 'vitest';

import { buildAgentAtomicPlan } from '../components/AgentChatPanel';

describe('AgentChatPanel atomic command plan', () => {
  it('builds only canonical element commands for video generation', () => {
    const plan = buildAgentAtomicPlan({
      action: 'video',
      elementId: 'agent-video-1',
      layerName: 'Agent Output 1',
      prompt: 'System prompt\n\nUser request:\nmake a video',
      historyLength: 2,
    });

    expect(plan.map(step => step.command)).toEqual([
      'element.create',
      'element.update-prompt',
      'element.ignite',
    ]);
    expect(plan[0].args).toMatchObject({
      id: 'agent-video-1',
      type: 'video',
      width: 240,
      height: 140,
      x: 184,
      y: 196,
    });
    expect(plan[1].args).toMatchObject({
      elementId: 'agent-video-1',
      textPrompt: expect.stringContaining('make a video'),
    });
    expect(plan[2].args).toEqual({ elementId: 'agent-video-1' });
  });
});
