import { describe, expect, it } from 'vitest';
import { redactWorkflowAgentSnapshot, validateWorkflowAgentAttachments } from '../services/workflowAgentBridge';

describe('workflow Agent browser bridge', () => {
  it('removes media payloads before sending state to loopback Agent', () => {
    const snapshot = redactWorkflowAgentSnapshot({
      id: 'project',
      nodes: [{ id: 'image', metadata: { href: 'data:image/png;base64,SECRET', poster: 'data:image/jpeg;base64,POSTER', storageKey: 'local/private', localPath: 'C:\\secret\\asset.png' } }],
    });
    expect(JSON.stringify(snapshot)).not.toContain('SECRET');
    expect(JSON.stringify(snapshot)).not.toContain('POSTER');
    expect(JSON.stringify(snapshot)).not.toContain('local/private');
    expect(JSON.stringify(snapshot)).not.toContain('secret\\asset');
  });

  it('accepts bounded image attachments and rejects other payloads', () => {
    expect(() => validateWorkflowAgentAttachments([{ id: '1', name: 'a.png', type: 'image/png', size: 3, dataUrl: 'data:image/png;base64,AAA=' }])).not.toThrow();
    expect(() => validateWorkflowAgentAttachments([{ id: '1', name: 'a.txt', type: 'text/plain', size: 3, dataUrl: 'data:text/plain;base64,AAA=' }])).toThrow('仅支持图片');
  });
});
