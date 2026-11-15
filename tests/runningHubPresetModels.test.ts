import { describe, expect, it } from 'vitest';
import { buildRunningHubPresetModelItems } from '../components/SettingsPanel';
import { BUILTIN_RUNNINGHUB_MODELS } from '../services/runningHubService';

describe('RunningHub preset models', () => {
  it('ships the verified routes and the built-in model table without fetching', () => {
    const items = buildRunningHubPresetModelItems();
    const ids = items.map((item) => item.id);
    expect(ids).toContain('seedream-v5-flash/text-to-image');
    for (const model of BUILTIN_RUNNINGHUB_MODELS) expect(ids).toContain(model.id);
    expect(new Set(ids.map((id) => id.toLowerCase())).size).toBe(ids.length);
    expect(items.every((item) => item.capability === 'image' || item.capability === 'video')).toBe(true);
  });
});
