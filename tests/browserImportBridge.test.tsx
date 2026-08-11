import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { BrowserImportBridge } from '../components/extension/BrowserImportBridge';

const mocks = vi.hoisted(() => ({
  listPairings: vi.fn(),
  approvePairing: vi.fn(),
  rejectPairing: vi.fn(),
  setDestination: vi.fn(),
  listImports: vi.fn(),
  routeImport: vi.fn(),
  projectImport: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock('../services/browserImports', () => ({
  listPendingBrowserImportPairings: mocks.listPairings,
  approveBrowserImportPairing: mocks.approvePairing,
  rejectBrowserImportPairing: mocks.rejectPairing,
  setBrowserImportDestination: mocks.setDestination,
  listPendingBrowserImports: mocks.listImports,
  routeBrowserImportToProject: mocks.routeImport,
  projectBrowserImportToWorkflow: mocks.projectImport,
}));

const pairing = {
  extensionOrigin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/',
  status: 'pending',
  protocolVersion: '1',
  capabilities: ['browser.import.image'],
  createdAt: 1,
  updatedAt: 1,
};

const importReceipt = {
  importId: 'browser-import-1',
  artifactId: `sha256:${'a'.repeat(64)}`,
  contentHash: 'a'.repeat(64),
  kind: 'image',
  name: 'reference.png',
  mimeType: 'image/png',
  byteSize: 2048,
  status: 'pending',
  destinationProjectId: 'workflow-1',
  createdAt: 1,
};

describe('BrowserImportBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const project = { ...createWorkflowProject('Browser Import'), id: 'workflow-1' };
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id, hydrated: true });
    mocks.listPairings.mockResolvedValue([pairing]);
    mocks.listImports.mockResolvedValue([importReceipt]);
    mocks.approvePairing.mockResolvedValue(undefined);
    mocks.rejectPairing.mockResolvedValue(undefined);
    mocks.setDestination.mockResolvedValue(undefined);
    mocks.projectImport.mockResolvedValue({ nodeId: 'node-browser-import-1', alreadyProjected: false });
  });

  afterEach(cleanup);

  it('asks for explicit Desktop approval and projects routed imports into the active Workflow', async () => {
    render(<BrowserImportBridge />);

    expect(await screen.findByText('连接浏览器插件')).toBeInTheDocument();
    await waitFor(() => expect(mocks.projectImport).toHaveBeenCalledWith(
      importReceipt,
      expect.objectContaining({ id: 'workflow-1' }),
    ));
    fireEvent.click(screen.getByRole('button', { name: '允许连接' }));
    await waitFor(() => expect(mocks.approvePairing).toHaveBeenCalledWith(pairing.extensionOrigin));
    expect(mocks.setDestination).toHaveBeenCalledWith('workflow-1');
  });

  it('keeps imports without a destination in a visible inbox until the user routes them', async () => {
    const inboxReceipt = { ...importReceipt, destinationProjectId: null };
    mocks.listPairings.mockResolvedValue([]);
    mocks.listImports.mockResolvedValue([inboxReceipt]);
    mocks.routeImport.mockResolvedValue({ ...inboxReceipt, destinationProjectId: 'workflow-1' });

    render(<BrowserImportBridge />);
    fireEvent.click(await screen.findByRole('button', { name: '浏览器导入箱（1）' }));
    fireEvent.click(screen.getByRole('button', { name: '导入当前 Workflow' }));

    await waitFor(() => expect(mocks.routeImport).toHaveBeenCalledWith('browser-import-1', 'workflow-1'));
    await waitFor(() => expect(mocks.projectImport).toHaveBeenCalledWith(
      expect.objectContaining({ destinationProjectId: 'workflow-1' }),
      expect.objectContaining({ id: 'workflow-1' }),
    ));
  });
});
