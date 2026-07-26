import { Button, Modal, Tag } from 'antd';
import { ExternalLink, Newspaper, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';

import {
  listBundledDirectorSkills,
  type BundledDirectorSkill,
} from '../../services/directorSkillCatalog';

export function DirectorSkillShelf({
  onUse,
}: {
  onUse: (skill: BundledDirectorSkill) => void;
}) {
  const skills = listBundledDirectorSkills();
  const [selected, setSelected] = useState<BundledDirectorSkill | null>(null);

  return (
    <section id="skill-hub" className="px-10 py-6">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: '#f5f5f0' }}>Skill 台</h2>
          <p className="mt-1 text-sm" style={{ color: '#a8a49c' }}>
            可由 Coding Agent 复用的 Director Skill。示例包只负责编译制作计划，执行仍由 Flovart Runtime 接管。
          </p>
        </div>
        <span className="text-xs" style={{ color: '#6b6862' }}>
          {skills.length} 个内置示例
        </span>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {skills.map(skill => (
          <button
            key={skill.id}
            type="button"
            aria-label={`查看 ${skill.displayName}`}
            className="group overflow-hidden rounded-2xl text-left transition-transform hover:-translate-y-0.5"
            style={{ border: '1px solid var(--isl-line)', background: 'var(--isl-surface-2)' }}
            onClick={() => setSelected(skill)}
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
            用示例创建项目
          </Button>,
        ] : null}
      >
        {selected && (
          <div className="space-y-5">
            <div>
              <div className="flex flex-wrap gap-2">
                <Tag color="cyan">内置示例</Tag>
                <Tag>{selected.id}</Tag>
                <Tag>MIT</Tag>
                <Tag>Runtime ≥ {selected.runtimeMinVersion}</Tag>
              </div>
              <p className="mt-3 text-sm leading-6" style={{ color: 'var(--isl-ink-soft)' }}>
                {selected.description}
              </p>
            </div>

            <div
              className="flex items-start gap-3 rounded-xl p-3"
              style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)' }}
            >
              <ShieldCheck className="mt-0.5 shrink-0" size={17} />
              <div className="text-xs leading-5">
                <strong>安全边界：</strong>
                不读取 API Key、不直连 Provider、不运行私有轮询；只声明 Runtime Capability。
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>制作能力</div>
              <div className="flex flex-wrap gap-1.5">
                {selected.capabilities.map(capability => <Tag key={capability}>{capability}</Tag>)}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>导演检查点</div>
              <div className="flex flex-wrap gap-1.5">
                {selected.gates.map(gate => <Tag key={gate.id}>{gate.type}</Tag>)}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
