// Cut 页（顶层视图 'reverse'）：主内容是视频编辑器；原来的 Iris 故事版（逆向 / 素材 + Agent 对话）
// 作为第二个子页保留，一键切换。两个子页都是懒加载 chunk；编辑器卸载即释放解码资源。
import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import { Clapperboard, LayoutGrid } from 'lucide-react';
import type { WorkflowProject } from '../workflow/types';
import { detectCutSupport } from '../../services/cut/support';
import '../../styles/irisStoryboard.css';
import '../../styles/cut.css';

type Lang = 'zho' | 'en';
export type CutSubView = 'editor' | 'storyboard';

export const loadCutEditor = () => import('./CutEditor');
const CutEditor = lazy(loadCutEditor);
const IrisStoryboardPage = lazy(() => import('../reverse/IrisStoryboardPage').then(m => ({ default: m.IrisStoryboardPage })));

export interface CutPageProps {
  language: Lang;
  project: WorkflowProject | null;
  onCreateProject: () => string;
  onFocusNode: (nodeId: string) => void;
  chat: ReactNode;
  onNotify?: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => void;
  /** 测试 / 嵌入时指定初始子页。 */
  initialView?: CutSubView;
}

const SUB_VIEW_KEY = 'iris.cut.subview';

function readSubView(): CutSubView {
  try { return sessionStorage.getItem(SUB_VIEW_KEY) === 'storyboard' ? 'storyboard' : 'editor'; } catch { return 'editor'; }
}

async function sendToCanvas(projectId: string, file: File) {
  const { addStoryboardMedia } = await import('../reverse/irisStoryboardActions');
  return addStoryboardMedia(projectId, [file], 'final');
}

export function CutUnsupported({ language, missing }: { language: Lang; missing: string[] }) {
  const zh = language === 'zho';
  return (
    <div className="cut-unsupported" role="alert" data-testid="cut-unsupported">
      <Clapperboard size={22} />
      <h2>{zh ? '这个浏览器不支持视频编辑' : 'Video editing isn’t supported in this browser'}</h2>
      <p>{zh
        ? 'Cut 编辑器需要 WebCodecs（Chrome / Edge 94+、Safari 16.4+ 或 Iris 桌面版）。故事版仍然可以使用。'
        : 'The Cut editor needs WebCodecs (Chrome / Edge 94+, Safari 16.4+, or the Iris desktop app). The storyboard still works.'}</p>
      <code>{missing.join(', ')}</code>
    </div>
  );
}

/** 编辑器出错时只降级这一块，不让整个 Cut 页白屏。 */
class CutErrorBoundary extends Component<{ language: Lang; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    const zh = this.props.language === 'zho';
    return (
      <div className="cut-unsupported" role="alert">
        <Clapperboard size={22} />
        <h2>{zh ? '编辑器出错了' : 'The editor hit an error'}</h2>
        <p>{this.state.error.message}</p>
        <button type="button" className="iris-ghost-pill cut-pill" onClick={() => this.setState({ error: null })}>{zh ? '重新加载编辑器' : 'Reload editor'}</button>
      </div>
    );
  }
}

export function CutPage({ language, project, onCreateProject, onFocusNode, chat, onNotify, initialView }: CutPageProps) {
  const zh = language === 'zho';
  const [view, setView] = useState<CutSubView>(() => initialView ?? readSubView());
  const [support] = useState(() => detectCutSupport());
  const choose = (next: CutSubView) => {
    setView(next);
    try { sessionStorage.setItem(SUB_VIEW_KEY, next); } catch { /* ignore */ }
  };
  const loading = <div className="grid h-full place-content-center text-sm opacity-40">{zh ? '正在加载…' : 'Loading…'}</div>;
  const tabs: Array<{ id: CutSubView; label: string; icon: ReactNode }> = [
    { id: 'editor', label: zh ? '剪辑' : 'Editor', icon: <Clapperboard size={12} /> },
    { id: 'storyboard', label: zh ? '故事版 · 逆向' : 'Storyboard · Reverse', icon: <LayoutGrid size={12} /> },
  ];
  return (
    <div className="cut-page" data-testid="cut-page" data-cut-view={view}>
      <div className="cut-page__bar">
        <div className="iris-segments cut-page__tabs" role="tablist" aria-label="Cut">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={view === tab.id}
              className={`iris-segments__item${view === tab.id ? ' is-active' : ''}`}
              onClick={() => choose(tab.id)}
              data-testid={`cut-subtab-${tab.id}`}
            >
              {view === tab.id && <span className="iris-segments__pill" aria-hidden />}
              <span className="iris-segments__text cut-page__tab">{tab.icon}{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="cut-page__body">
        {view === 'storyboard' ? (
          <Suspense fallback={loading}>
            <IrisStoryboardPage language={language} project={project} onCreateProject={onCreateProject} onFocusNode={onFocusNode} chat={chat} onNotify={onNotify} />
          </Suspense>
        ) : !support.supported ? (
          <div className="iris-page cut-page__editor"><div className="iris-page__backdrop" aria-hidden /><CutUnsupported language={language} missing={support.missing} /></div>
        ) : (
          <div className="iris-page cut-page__editor">
            <div className="iris-page__backdrop" aria-hidden><span className="iris-page__bloom" /></div>
            <CutErrorBoundary language={language}>
              <Suspense fallback={loading}>
                <CutEditor
                  language={language}
                  project={project}
                  onNotify={onNotify}
                  onSendToCanvas={project ? file => sendToCanvas(project.id, file) : undefined}
                  onFocusNode={onFocusNode}
                />
              </Suspense>
            </CutErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}
