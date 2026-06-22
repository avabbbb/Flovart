import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ElementToolbar } from '../components/ElementToolbar';
import type { Element } from '../types';

const elements: Element[] = [
  {
    id: 'image_1',
    type: 'image',
    x: 10,
    y: 10,
    width: 100,
    height: 80,
    href: 'data:image/png;base64,a',
    mimeType: 'image/png',
  },
  {
    id: 'image_2',
    type: 'image',
    x: 140,
    y: 20,
    width: 100,
    height: 80,
    href: 'data:image/png;base64,b',
    mimeType: 'image/png',
  },
];

function renderToolbar(handleGroupSelection = vi.fn(), handleExportSelection = vi.fn()) {
  render(
    <svg>
      <ElementToolbar
        selectedElementIds={['image_1', 'image_2']}
        singleSelectedElement={null}
        elements={elements}
        zoom={1}
        resolvedTheme="light"
        isLoading={false}
        language="en"
        filterPanelElementId={null}
        outpaintMenuId={null}
        maskEditingId={null}
        reversePromptLoading={false}
        t={(key) => key}
        getSelectionBounds={() => ({ x: 10, y: 10, width: 230, height: 90 })}
        getElementBounds={(element) => ({ x: element.x, y: element.y, width: 'width' in element ? element.width : 0, height: 'height' in element ? element.height : 0 })}
        handleAlignSelection={() => undefined}
        handleGroupSelection={handleGroupSelection}
        handleExportSelection={handleExportSelection}
        handleCopyElement={() => undefined}
        handleDownloadImage={() => undefined}
        handleDeleteElement={() => undefined}
        handlePropertyChange={() => undefined}
        handleStartCrop={() => undefined}
        handleReversePrompt={() => undefined}
        cancelReversePrompt={() => undefined}
        handleSplitImageLayers={() => undefined}
        handleUpscaleImage={() => undefined}
        handleRemoveImageBackground={() => undefined}
        handleOutpaint={() => undefined}
        setFilterPanelElementId={() => undefined}
        setOutpaintMenuId={() => undefined}
        setAddAssetModal={() => undefined}
        startMaskEditing={() => undefined}
      />
    </svg>,
  );
  return { handleGroupSelection, handleExportSelection };
}

describe('ElementToolbar', () => {
  it('shows an icon-only Group action for multi-selected canvas layers', () => {
    const { handleGroupSelection } = renderToolbar();

    const groupButton = screen.getByLabelText('Group selected canvas layers');
    expect(groupButton.textContent).toBe('');
    fireEvent.click(groupButton);
    expect(handleGroupSelection).toHaveBeenCalled();
  });

  it('exports media from a multi-selection through the canvas toolbar', () => {
    const { handleExportSelection } = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: '批量导出所选媒体' }));
    expect(handleExportSelection).toHaveBeenCalledTimes(1);
  });
});
