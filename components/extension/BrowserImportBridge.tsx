import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Badge, Button, Empty, Modal, Typography } from 'antd';
import { Inbox } from 'lucide-react';
import { useWorkflowStore } from '../workflow/store';
import {
  approveBrowserImportPairing,
  listPendingBrowserImportPairings,
  listPendingBrowserImports,
  projectBrowserImportToWorkflow,
  rejectBrowserImportPairing,
  routeBrowserImportToProject,
  setBrowserImportDestination,
  type BrowserImportPairing,
  type BrowserImportReceipt,
} from '../../services/browserImports';

function messageOf(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error || '浏览器导入失败');
}

export function BrowserImportBridge() {
  const activeProjectId = useWorkflowStore(state => state.activeProjectId);
  const projects = useWorkflowStore(state => state.projects);
  const hydrated = useWorkflowStore(state => state.hydrated);
  const desktop = typeof window !== 'undefined' && isTauri();
  const [pairings, setPairings] = useState<BrowserImportPairing[]>([]);
  const [imports, setImports] = useState<BrowserImportReceipt[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routingId, setRoutingId] = useState<string | null>(null);
  const projecting = useRef(new Set<string>());
  const projected = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const [nextPairings, nextImports] = await Promise.all([
        listPendingBrowserImportPairings(),
        listPendingBrowserImports(),
      ]);
      setPairings(nextPairings);
      setImports(nextImports);
      setError(null);
      for (const receipt of nextImports) {
        if (!receipt.destinationProjectId
          || projecting.current.has(receipt.importId)
          || projected.current.has(receipt.importId)) continue;
        const project = useWorkflowStore.getState().projects
          .find(item => item.id === receipt.destinationProjectId);
        if (!project) continue;
        projecting.current.add(receipt.importId);
        void projectBrowserImportToWorkflow(receipt, project)
          .then(() => {
            projected.current.add(receipt.importId);
            setImports(current => current.filter(item => item.importId !== receipt.importId));
          })
          .catch(cause => setError(messageOf(cause)))
          .finally(() => projecting.current.delete(receipt.importId));
      }
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 750);
    return () => window.clearInterval(timer);
  }, [desktop, refresh]);

  useEffect(() => {
    if (!desktop || !hydrated) return;
    void setBrowserImportDestination(activeProjectId).catch(cause => setError(messageOf(cause)));
  }, [activeProjectId, desktop, hydrated]);

  const pendingPairing = pairings[0] || null;
  const projectIds = useMemo(() => new Set(projects.map(project => project.id)), [projects]);
  const inbox = imports.filter(receipt => (
    !receipt.destinationProjectId || !projectIds.has(receipt.destinationProjectId)
  ));

  const decidePairing = async (pairing: BrowserImportPairing, approved: boolean) => {
    try {
      if (approved) await approveBrowserImportPairing(pairing.extensionOrigin);
      else await rejectBrowserImportPairing(pairing.extensionOrigin);
      setPairings(current => current.filter(item => item.extensionOrigin !== pairing.extensionOrigin));
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const route = async (receipt: BrowserImportReceipt) => {
    if (!activeProjectId) return;
    setRoutingId(receipt.importId);
    projecting.current.add(receipt.importId);
    try {
      const routed = await routeBrowserImportToProject(receipt.importId, activeProjectId);
      const project = useWorkflowStore.getState().projects.find(item => item.id === activeProjectId);
      if (!project) throw new Error('当前 Workflow 已不存在');
      await projectBrowserImportToWorkflow(routed, project);
      projected.current.add(receipt.importId);
      setImports(current => current.filter(item => item.importId !== receipt.importId));
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      projecting.current.delete(receipt.importId);
      setRoutingId(null);
    }
  };

  if (!desktop) return null;

  return <>
    {inbox.length > 0 && <div className="fixed bottom-5 right-5 z-50">
      <Badge count={inbox.length} size="small">
        <Button
          aria-label={`浏览器导入箱（${inbox.length}）`}
          icon={<Inbox size={15} />}
          onClick={() => setInboxOpen(true)}
        >
          浏览器导入
        </Button>
      </Badge>
    </div>}

    <Modal
      open={Boolean(pendingPairing)}
      title="连接浏览器插件"
      closable={false}
      mask={{ closable: false }}
      cancelText="拒绝"
      okText="允许连接"
      onCancel={() => pendingPairing && void decidePairing(pendingPairing, false)}
      onOk={() => pendingPairing && void decidePairing(pendingPairing, true)}
    >
      <Typography.Paragraph>
        此扩展请求把你明确右键选择的图片传入 Flovart。它不能读取 Desktop Provider Secret，
        也不能直接调用生成服务。
      </Typography.Paragraph>
      <Typography.Text type="secondary" copyable>
        {pendingPairing?.extensionOrigin}
      </Typography.Text>
      {error && <Typography.Paragraph type="danger" className="mt-3 mb-0">{error}</Typography.Paragraph>}
    </Modal>

    <Modal
      open={inboxOpen}
      title="浏览器导入箱"
      footer={null}
      onCancel={() => setInboxOpen(false)}
    >
      {inbox.length === 0
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待处理导入" />
        : <div className="flex flex-col divide-y divide-[var(--ant-color-border-secondary)]">
          {inbox.map(receipt => <div key={receipt.importId} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <Typography.Text className="block truncate">{receipt.name}</Typography.Text>
              <Typography.Text type="secondary" className="block truncate text-xs">
                {receipt.sourceTitle || receipt.sourcePageUrl || '来自浏览器右键导入'}
              </Typography.Text>
            </div>
            <Button
              type="link"
              disabled={!activeProjectId}
              loading={routingId === receipt.importId}
              onClick={() => void route(receipt)}
            >
              导入当前 Workflow
            </Button>
          </div>)}
        </div>}
      {!activeProjectId && <Typography.Text type="secondary">请先创建或打开一个 Workflow 项目。</Typography.Text>}
      {error && <Typography.Paragraph type="danger" className="mt-3 mb-0">{error}</Typography.Paragraph>}
    </Modal>
  </>;
}
