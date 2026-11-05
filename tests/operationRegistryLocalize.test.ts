import { describe, expect, it } from 'vitest';
import { getWorkflowOperationCapability, localizeOperationLabel, localizeParameterControl, WORKFLOW_OPERATION_CAPABILITIES } from '../components/workflow/operationRegistry';

const HAN = /[\u4e00-\u9fff]/;

describe('operation registry localization', () => {
  it('keeps Chinese controls untouched', () => {
    const control = getWorkflowOperationCapability('video.trim@1')!.parameterControls![0];
    expect(localizeParameterControl(control, 'zho')).toBe(control);
  });

  it('translates labels, options and suffixes in English', () => {
    const trim = localizeParameterControl(getWorkflowOperationCapability('video.trim@1')!.parameterControls![0], 'en');
    expect(trim).toMatchObject({ label: 'Start', suffix: 's' });
    const layer = getWorkflowOperationCapability('image.layer@1')!;
    const style = localizeParameterControl(layer.parameterControls![0], 'en');
    expect(style.label).toBe('Style');
    expect(style.kind === 'select' && style.options.map(option => option.label)).toEqual(['Doodle', 'Glow', 'Title', 'Sticker']);
    expect(localizeOperationLabel(layer, 'en')).toBe('Overlay layer');
  });

  it('leaves no Chinese in any English control or capability label', () => {
    for (const capability of Object.values(WORKFLOW_OPERATION_CAPABILITIES)) {
      expect(localizeOperationLabel(capability, 'en')).not.toMatch(HAN);
      for (const control of capability.parameterControls || []) {
        const localized = localizeParameterControl(control, 'en');
        expect(localized.label).not.toMatch(HAN);
        if (localized.kind === 'select') for (const option of localized.options) expect(option.label).not.toMatch(HAN);
        else expect(localized.suffix || '').not.toMatch(HAN);
      }
    }
  });
});
