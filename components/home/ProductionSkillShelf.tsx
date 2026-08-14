import { Button, Modal, Tag } from 'antd';
import { ArrowRight, BookOpen, Check, Copy, ExternalLink, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';

import skillCover from '../../tools/flovart/evaluations/vox-history-1776/contact-sheet-10.png';

import {
  listBundledProductionSkills,
  type BundledProductionSkill,
} from '../../services/productionSkillCatalog';
import {
  buildProductionSkillStarterPrompt,
  productionSkillHandle,
} from '../../services/productionSkillLaunch';

export function ProductionSkillShelf({
  onUse,
}: {
  onUse: (skill: BundledProductionSkill) => void;
}) {
  const skills = listBundledProductionSkills();
  const [selected, setSelected] = useState<BundledProductionSkill | null>(null);
  const [copiedSkillId, setCopiedSkillId] = useState<string | null>(null);
  const starterPrompt = selected ? buildProductionSkillStarterPrompt(selected) : '';

  const copyStarterPrompt = async () => {
    if (!selected || !navigator.clipboard) return;
    await navigator.clipboard.writeText(starterPrompt);
    setCopiedSkillId(selected.id);
  };

  return (
    <section id="skill-hub" className="home-skill-shelf">
      <div className="home-skill-shelf__heading">
        <div>
          <span>PRODUCTION SKILL</span>
          <h3>选择一种制作方法</h3>
          <p>
            不用学习命令。选择后，我们会新建项目并把推荐调用词填进 Agent，你只需要改主题并发送。
          </p>
        </div>
        <a
          href="https://github.com/avabbbb/Flovart/blob/main/docs/overview/skill-guide.md"
          target="_blank"
          rel="noreferrer"
          className="home-skill-shelf__manual"
        >
          <BookOpen size={13} /> 使用手册
        </a>
      </div>
      <div className="home-skill-grid">
        {skills.map(skill => (
          <button
            key={skill.id}
            type="button"
            aria-label={`了解并使用 ${skill.displayName}`}
            className="home-skill-card"
            onClick={() => {
              setSelected(skill);
              setCopiedSkillId(null);
            }}
          >
            <span className="home-skill-card__visual"><img src={skillCover} alt="" /><i>内置示例</i></span>
            <span className="home-skill-card__body">
              <span><Sparkles size={15} /><strong>{skill.displayName}</strong><em>{productionSkillHandle(skill)}</em></span>
              <small>{skill.description}</small>
              <b>v{skill.version} · 30 秒短片 · 确认后执行</b>
            </span>
            <span className="home-skill-card__open">查看用法 <ArrowRight size={14} /></span>
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
                <Tag>{productionSkillHandle(selected)}</Tag>
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
                    直接描述也会自动匹配；保留 {productionSkillHandle(selected)} 可以明确指定它。
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
                  <div className="mb-1 text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>制作检查点</div>
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
