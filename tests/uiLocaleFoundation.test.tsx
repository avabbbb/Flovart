import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentConnectionsPage } from '../components/agent/AgentWorkspace';
import { ProductionSkillDeck } from '../components/agent/ProductionSkillDeck';
import { TableWorkspace } from '../components/table/TableWorkspace';
import { PromptBar } from '../components/PromptBar';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

afterEach(() => useWorkspaceStore.setState({ language: 'zho' }));

describe('foundation surfaces use the active locale', () => {
  it('renders the Agent connection surface in English', async () => {
    render(<AgentConnectionsPage project={null} language="en" />);
    expect(screen.getByRole('heading', { name: 'Connect a local Agent' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Collaborating agent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh connection status' })).toBeInTheDocument();
    expect(screen.queryByText('连接本地 Agent')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByText('Other agents')).toBeInTheDocument());
  });

  it('renders the Table empty state and actions in English', () => {
    render(<TableWorkspace
      project={null}
      userApiKeys={[]}
      language="en"
      onCommit={vi.fn()}
      onSaveAsset={vi.fn()}
      onOpenWorkflow={vi.fn()}
      onOpenSettings={vi.fn()}
    />);
    expect(screen.getByText('Single-asset workspace')).toBeInTheDocument();
    expect(screen.getByText('Choose an input')).toBeInTheDocument();
    expect(screen.getByText(/Table does not create a second node graph/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import local media' })).toBeInTheDocument();
    expect(screen.queryByText('单素材工作台')).not.toBeInTheDocument();
  });

  it('renders the PromptBar model picker in English with viewport-safe dialog labeling', async () => {
    const { container } = render(<PromptBar
      theme="light"
      language="en"
      prompt=""
      setPrompt={() => undefined}
      onGenerate={() => undefined}
      isLoading={false}
      isSelectionActive={false}
      selectedElementCount={0}
      userEffects={[]}
      t={key => key}
      onAddUserEffect={() => undefined}
      onDeleteUserEffect={() => undefined}
      generationMode="image"
      setGenerationMode={() => undefined}
      videoAspectRatio="16:9"
      setVideoAspectRatio={() => undefined}
    />);
    const modelTrigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    expect(modelTrigger).not.toBeNull();
    fireEvent.click(modelTrigger!);
    const dialog = await screen.findByRole('dialog', { name: 'Choose model' });
    expect(dialog.textContent).not.toMatch(/\p{Script=Han}/u);
  });

  it('renders the first-run Skill deck in English', () => {
    useWorkspaceStore.setState({ language: 'en' });
    function SkillDeckFixture() {
      const target = useRef<HTMLDivElement>(null);
      return <div ref={target}><ProductionSkillDeck dropTargetRef={target} onChange={() => undefined} showWelcome /></div>;
    }
    render(<SkillDeckFixture />);
    const section = screen.getByRole('region', { name: 'Recommended production Skills' });
    expect(section).toHaveTextContent('Every Skill opens a new direction');
    expect(section.textContent).not.toMatch(/\p{Script=Han}/u);
  });
});
