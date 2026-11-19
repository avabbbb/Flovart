import { AgentCopyButton } from './AgentCopyButton';
import '../../styles/agentLink.css';

type Lang = 'en' | 'zho';

export interface AgentSetupStep {
  text: string;
  command?: string;
}

interface StepCopy { zho: AgentSetupStep[]; en: AgentSetupStep[] }

/**
 * Per-host connection steps. Commands are the real repo scripts
 * (package.json / dsh-plugin/package.json); keep them in sync when scripts move.
 */
const STEPS: Record<string, StepCopy> = {
  'deepseek-harness': {
    zho: [
      { text: '在 Iris 仓库根目录安装依赖（Node 22.19+ 或 24+）', command: 'npm install' },
      { text: '安装 DSH 插件 Profile（兼容 DeepSeek Harness 0.2.2-rc.1 起的 0.2.x）', command: 'npm run dsh:profile:install' },
      { text: '启动 DSH；启动器会同时拉起本机 Agent 并打开可见画布', command: 'npm run dsh:start' },
      { text: '在 DSH 左侧切到「Iris」，顶部显示「已连接」后直接用对话指挥画布' },
      { text: '连不上时运行诊断，并查看本页「连接状态」给出的原因', command: 'npm --prefix dsh-plugin run profile:doctor' },
    ],
    en: [
      { text: 'Install dependencies in the Iris repo root (Node 22.19+ or 24+)', command: 'npm install' },
      { text: 'Install the DSH plugin profile (DeepSeek Harness 0.2.x, from 0.2.2-rc.1)', command: 'npm run dsh:profile:install' },
      { text: 'Start DSH; the launcher also starts the local agent and opens a visible canvas', command: 'npm run dsh:start' },
      { text: 'Switch to "Iris" in the DSH sidebar; once it shows Connected, drive the canvas from the conversation' },
      { text: 'If it cannot connect, run the doctor and check the reason under Status', command: 'npm --prefix dsh-plugin run profile:doctor' },
    ],
  },
  codex: {
    zho: [
      { text: '启动本机 Agent 并确认画布可见', command: 'npm run iris:cli -- ensure --json' },
      { text: '在上方选择 Codex，点「使用 Codex」让它成为当前操作者' },
      { text: '在 Codex 里先读取画布，再说出要做的事', command: 'npm run iris:cli -- workflow.inspect --summary --json' },
    ],
    en: [
      { text: 'Start the local agent and make sure a canvas is visible', command: 'npm run iris:cli -- ensure --json' },
      { text: 'Pick Codex above and choose "Use Codex" to put it in control' },
      { text: 'In Codex, read the canvas first, then say what to do', command: 'npm run iris:cli -- workflow.inspect --summary --json' },
    ],
  },
  workbuddy: {
    zho: [
      { text: '点 WorkBuddy 的「设置」，下载 iris-workbuddy.zip' },
      { text: '在 WorkBuddy 的技能页导入这个安装包' },
      { text: '回到这里点「使用 WorkBuddy」，在 WorkBuddy 里直接说出要做的事' },
    ],
    en: [
      { text: 'Choose "Set up" on WorkBuddy to download iris-workbuddy.zip' },
      { text: 'Import the package on the WorkBuddy skills page' },
      { text: 'Come back, choose "Use WorkBuddy", then tell WorkBuddy what to do' },
    ],
  },
};

export function agentSetupSteps(hostId: string, language: Lang): AgentSetupStep[] {
  const entry = STEPS[hostId];
  if (!entry) return [];
  return language === 'zho' ? entry.zho : entry.en;
}

interface AgentSetupGuideProps {
  hostId: string;
  hostLabel: string;
  language?: Lang;
  /** Overrides the per-host steps (e.g. the full-page DSH guide). */
  steps?: AgentSetupStep[];
  title?: string;
}

/** Numbered connection steps with copyable commands; wraps and truncates within any panel width. */
export function AgentSetupGuide({ hostId, hostLabel, language = 'zho', steps, title }: AgentSetupGuideProps) {
  const zh = language === 'zho';
  const items = steps || agentSetupSteps(hostId, language);
  if (!items.length) return null;
  const heading = title || (zh ? `${hostLabel} 接入步骤` : `Connect ${hostLabel}`);
  return (
    <section className="agent-steps" aria-label={heading} data-testid="agent-setup-guide">
      <h3 className="agent-steps__title">{heading}</h3>
      <ol className="agent-steps__list">
        {items.map((step, index) => (
          <li key={`${index}-${step.text}`} className="agent-steps__item">
            <span className="agent-steps__index" aria-hidden="true">{index + 1}</span>
            <div className="agent-steps__body">
              <p className="agent-steps__text">{step.text}</p>
              {step.command && (
                <div className="agent-steps__command">
                  <code title={step.command}>{step.command}</code>
                  <AgentCopyButton
                    text={step.command}
                    label={zh ? '复制命令' : 'Copy command'}
                    copiedLabel={zh ? '已复制' : 'Copied'}
                  />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
