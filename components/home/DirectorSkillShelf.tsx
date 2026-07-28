import { Button, Modal, Tag } from 'antd';
import { BookOpen, Check, Copy, ExternalLink, Newspaper, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';

import {
  listBundledDirectorSkills,
  type BundledDirectorSkill,
} from '../../services/directorSkillCatalog';
import {
  buildDirectorSkillStarterPrompt,
  directorSkillHandle,
} from '../../services/directorSkillLaunch';

export function DirectorSkillShelf({
  onUse,
}: {
  onUse: (skill: BundledDirectorSkill) => void;
}) {
  const skills = listBundledDirectorSkills();
  const [selected, setSelected] = useState<BundledDirectorSkill | null>(null);
  const [copiedSkillId, setCopiedSkillId] = useState<string | null>(null);
  const starterPrompt = selected ? buildDirectorSkillStarterPrompt(selected) : '';

  const copyStarterPrompt = async () => {
    if (!selected || !navigator.clipboard) return;
    await navigator.clipboard.writeText(starterPrompt);
    setCopiedSkillId(selected.id);
  };

  return (
    <section id="skill-hub" className="px-10 py-6">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: '#f5f5f0' }}>选择一个导演 Skill</h2>
          <p className="mt-1 text-sm" style={{ color: '#a8a49c' }}>
            不用学习命令。选择后，我们会新建项目并把推荐调用词填进 Agent，你只需要改主题并发送。
          </p>
        </div>
        <a
          href="https://github.com/avabbbb/Flovart/blob/main/docs/overview/skill-guide.md"
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs hover:underline"
          style={{ color: '#a8a49c' }}
        >
          <BookOpen size={13} /> 使用手册
        </a>
      </div>

      <div
        className="mb-4 grid gap-2 rounded-xl px-4 py-3 text-xs sm:grid-cols-3"
        style={{ border: '1px solid var(--isl-line)', color: 'var(--isl-ink-soft)' }}
      >
        {[
          ['1', '选方法', '挑选适合成片风格的 Skill'],
          ['2', '改主题', '调用词会自动填入 Agent'],
          ['3', '先确认再执行', '未确认前不会产生生成费用'],
        ].map(([step, title, description]) => (
          <div key={step} className="flex items-start gap-2">
            <span
              className="grid h-5 w-5 shrink-0 place-content-center rounded-full text-[10px] font-bold"
              style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)' }}
            >
              {step}
            </span>
            <span>
              <strong className="block" style={{ color: 'var(--isl-ink)' }}>{title}</strong>
              <span>{description}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {skills.map(skill => (
          <button
            key={skill.id}
            type="button"
            aria-label={`了解并使用 ${skill.displayName}`}
            className="group overflow-hidden rounded-2xl text-left transition-transform hover:-translate-y-0.5"
            style={{ border: '1px solid var(--isl-line)', background: 'var(--isl-surface-2)' }}
            onClick={() => {
              setSelected(skill);
              setCopiedSkillId(null);
            }}
          >
            <div
              className="relative flex h-36 items-center justify-center overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, #f2dfb5 0%, #d75645 48%, #23384f 100%)',
              }}
            >
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage: 'repeating-linear-gradient(12deg, transparent 0 10px, rgba(20,20,20,.35) 11px 12px)',
                }}
              />
              <div className="relative flex -rotate-2 items-center gap-3 bg-[#f5edd7] px-5 py-3 text-[#191713] shadow-lg">
                <Newspaper size={22} />
                <span className="text-lg font-black tracking-tight">VOX COLLAGE</span>
              </div>
              <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2 py-1 text-[11px] font-bold text-white">
                内置示例
              </span>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-2">
                <Sparkles size={15} style={{ color: 'var(--isl-mint-deep)' }} />
                <strong style={{ color: 'var(--isl-ink)' }}>{skill.displayName}</strong>
                <span className="ml-auto text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>
                  v{skill.version}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5" style={{ color: 'var(--isl-ink-soft)' }}>
                {skill.description}
              </p>
              <span className="mt-3 block text-xs font-semibold" style={{ color: 'var(--isl-mint-deep)' }}>
                查看用法与示例 →
              </span>
            </div>
          </button>
        ))}
      </div>

      <Modal
        open={Boolean(selected)}
        title={selected?.displayName}
        width={680}
        onCancel={() => setSelected(null)}
        footer={selected ? [
          <Button
            key="source"
            href={selected.sourceUrl}
            target="_blank"
            icon={<ExternalLink size={14} />}
          >
            查看上游源码
          </Button>,
          <Button
            key="use"
            type="primary"
            onClick={() => {
              onUse(selected);
              setSelected(null);
            }}
          >
            在本机 Agent 中试用
          </Button>,
        ] : null}
      >
        {selected && (
          <div className="space-y-5">
            <div>
              <div className="flex flex-wrap gap-2">
                <Tag color="cyan">内置示例</Tag>
                <Tag>{directorSkillHandle(selected)}</Tag>
                <Tag>30 秒短片</Tag>
              </div>
              <p className="mt-3 text-sm leading-6" style={{ color: 'var(--isl-ink-soft)' }}>
                {selected.description}
              </p>
            </div>

            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--isl-surface-2)', border: '1px solid var(--isl-line)' }}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <strong className="block text-sm" style={{ color: 'var(--isl-ink)' }}>最简单的用法</strong>
                  <span className="text-xs" style={{ color: 'var(--isl-ink-soft)' }}>
                    直接描述也会自动匹配；保留 {directorSkillHandle(selected)} 可以明确指定它。
                  </span>
                </div>
                <Button
                  size="small"
                  type="text"
                  icon={copiedSkillId === selected.id ? <Check size={14} /> : <Copy size={14} />}
                  onClick={() => void copyStarterPrompt()}
                >
                  {copiedSkillId === selected.id ? '已复制' : '复制'}
                </Button>
              </div>
              <div
                className="rounded-lg px-3 py-2 text-xs leading-5"
                style={{ background: 'var(--isl-surface)', color: 'var(--isl-ink)' }}
              >
                {starterPrompt}
              </div>
            </div>

            <div
              className="flex items-start gap-3 rounded-xl p-3"
              style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)' }}
            >
              <ShieldCheck className="mt-0.5 shrink-0" size={17} />
              <div className="text-xs leading-5">
                <strong>点击后只会准备草稿：</strong>
                新建项目、打开本机 Agent、填入调用词；不会自动发送、调用 Provider 或产生费用。桌面版会自动连接 Managed Agent，浏览器版会显示连接步骤。
              </div>
            </div>

            <details className="rounded-xl p-3" style={{ border: '1px solid var(--isl-line)' }}>
              <summary className="cursor-pointer text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>
                查看技术与安全信息
              </summary>
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Tag>{selected.id}</Tag>
                  <Tag>{selected.license}</Tag>
                  <Tag>Runtime ≥ {selected.runtimeMinVersion}</Tag>
                </div>
                <p className="m-0 text-xs leading-5" style={{ color: 'var(--isl-ink-soft)' }}>
                  不读取 API Key、不直连 Provider、不运行私有轮询；只声明 Runtime Capability。
                </p>
                <div>
                  <div className="mb-1 text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>制作能力</div>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.capabilities.map(capability => <Tag key={capability}>{capability}</Tag>)}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>导演检查点</div>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.gates.map(gate => <Tag key={gate.id}>{gate.type}</Tag>)}
                  </div>
                </div>
              </div>
            </details>
          </div>
        )}
      </Modal>
    </section>
  );
}
