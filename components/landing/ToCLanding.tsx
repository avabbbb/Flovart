import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Brush, Sparkles, ArrowRight, Play, BookOpen, Image as ImageIcon, Video, Wand2, Shield, Zap } from 'lucide-react';
import { LANDING_TEMPLATES, SHOWCASE_WORKS, TEMPLATE_CATEGORIES, type TemplateCategory } from './templates';
import { useAuth } from '../../hooks/useAuth';
import { AuthModal } from '../auth/AuthModal';

const linkTo = (path: string) => (window.location.hash = path);

function HandDrawnUnderline({ color = '#19c8b9', width = 200 }: { color?: string; width?: number }) {
  return (
    <svg width={width} height={12} viewBox="0 0 200 12" fill="none" style={{ display: 'block' }}>
      <path d="M2 8 Q50 2, 100 6 T198 5" stroke={color} strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.7" />
    </svg>
  );
}

function HandDrawnArrow({ color = '#d4a574', className = '' }: { color?: string; className?: string }) {
  return (
    <svg width="60" height="40" viewBox="0 0 60 40" fill="none" className={className}>
      <path d="M5 20 Q25 5, 50 18 M50 18 L42 12 M50 18 L45 25" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6" />
    </svg>
  );
}

function SketchStar({ color = '#19c8b9', size = 24, className = '' }: { color?: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2 L13.5 9 L21 10.5 L13.5 12 L12 20 L10.5 12 L3 10.5 L10.5 9 Z" fill={color} opacity="0.5" />
    </svg>
  );
}

const FEATURES = [
  { num: '01', icon: Brush, title: '画布 + 工作流融合', desc: '画布与工作流无缝切换，拖拽组合、所见即所得的可视化创作体验' },
  { num: '02', icon: Zap, title: '多模型一站式', desc: 'Seedance、RunningHub、OpenAI 兼容接口，一个平台覆盖所有主流模型' },
  { num: '03', icon: Wand2, title: '原生中文创作', desc: '中文提示词精准理解，中文 UI 界面，贴合国内创作者使用习惯' },
  { num: '04', icon: Shield, title: '本地优先 · 开源免费', desc: '数据存储在浏览器本地，API Key 自己掌控，开源可自部署' },
];

export default function ToCLanding() {
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>('全部');
  const { user, isLoggedIn, authOpen, setAuthOpen } = useAuth();

  const filteredTemplates = useMemo(() => {
    if (activeCategory === '全部') return LANDING_TEMPLATES;
    return LANDING_TEMPLATES.filter((t) => t.category === activeCategory);
  }, [activeCategory]);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#f5f5f0', fontFamily: '-apple-system, "Segoe UI", "Noto Sans SC", sans-serif' }}>
      {/* ===== Header ===== */}
      <header className="fixed top-0 left-0 right-0 z-50" style={{ backdropFilter: 'blur(16px)', background: 'rgba(10,10,10,0.72)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="mx-auto flex items-center justify-between px-6 py-3" style={{ maxWidth: 1200 }}>
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => linkTo('/')}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Flovart</span>
            <SketchStar size={14} color="#19c8b9" />
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm" style={{ color: '#a8a49c' }}>
            <a href="#features" className="hover:text-white transition-colors">功能</a>
            <a href="#templates" className="hover:text-white transition-colors">模板</a>
            <a href="#showcase" className="hover:text-white transition-colors">展示</a>
            <div className="flex items-center gap-1 p-1 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ background: '#19c8b9', color: '#fff' }}>个人版</span>
              <button onClick={() => linkTo('/business')} className="px-3 py-1 rounded-full text-xs font-medium transition-all hover:text-white" style={{ color: '#a8a49c' }}>企业版</button>
            </div>
            <a href="https://github.com/avabbbb/Flovart" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">GitHub</a>
          </nav>
          <div className="flex items-center gap-3">
            <button onClick={() => linkTo('/prompts')} className="text-sm hover:text-white transition-colors" style={{ color: '#a8a49c' }}>
              提示词社区
            </button>
            {isLoggedIn ? (
              <span className="text-sm" style={{ color: '#19c8b9' }}>{user?.username}</span>
            ) : (
              <button
                onClick={() => setAuthOpen(true)}
                className="text-sm hover:text-white transition-colors"
                style={{ color: '#a8a49c' }}
              >
                登录
              </button>
            )}
            <button
              onClick={() => linkTo('/app')}
              className="text-sm font-medium px-5 py-2 rounded-full transition-all hover:scale-105"
              style={{ background: '#19c8b9', color: '#fff', boxShadow: '0 0 20px rgba(25,200,185,0.3)' }}
            >
              开始创作
            </button>
          </div>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="relative flex items-center justify-center px-6 pt-24 pb-20 overflow-hidden" style={{ minHeight: '100vh' }}>
        {/* background texture */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 30% 20%, rgba(25,200,185,0.08) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(212,165,116,0.06) 0%, transparent 50%)' }} />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence baseFrequency=%220.9%22/%3E%3C/filter%3E%3Crect width=%22120%22 height=%22120%22 filter=%22url(%23n)%22/%3E%3C/svg%3E")' }} />

        <div className="relative z-10 mx-auto text-center" style={{ maxWidth: 900 }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 120, damping: 18 }}
          >
            {/* badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8 text-xs" style={{ background: 'rgba(25,200,185,0.1)', border: '1px solid rgba(25,200,185,0.25)', color: '#19c8b9' }}>
              <Sparkles size={12} />
              <span>开源免费 · 本地优先 · 多模型融合</span>
            </div>

            {/* headline */}
            <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-3" style={{ lineHeight: 1.1 }}>
              用画布
              <span style={{ color: '#19c8b9', position: 'relative', display: 'inline-block' }}>
                造梦
                <HandDrawnUnderline color="#19c8b9" width={140} />
              </span>
            </h1>
            <p className="text-lg md:text-xl mt-6 mb-10" style={{ color: '#a8a49c', lineHeight: 1.7 }}>
              AI 驱动的可视化创作画布 — 拖拽、生成、组合<br />
              <span style={{ color: '#d4a574' }}>一站式创意工作流</span>，从灵感到成片
            </p>

            {/* CTAs */}
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <button
                onClick={() => linkTo('/app')}
                className="group flex items-center gap-2 px-8 py-3.5 rounded-full text-base font-semibold transition-all hover:scale-105"
                style={{ background: '#19c8b9', color: '#fff', boxShadow: '0 8px 32px rgba(25,200,185,0.3)' }}
              >
                开始创作
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </button>
              <a
                href="#templates"
                className="flex items-center gap-2 px-8 py-3.5 rounded-full text-base font-medium transition-all hover:bg-white/10"
                style={{ border: '1px solid rgba(255,255,255,0.15)', color: '#f5f5f0' }}
              >
                <Play size={16} />
                探索模板
              </a>
            </div>
          </motion.div>

          {/* demo placeholder — will be replaced with real canvas recording */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 80, damping: 16, delay: 0.3 }}
            className="mt-16 mx-auto rounded-2xl overflow-hidden relative"
            style={{ maxWidth: 800, aspectRatio: '16/9', background: 'linear-gradient(135deg, #111 0%, #1a1a2e 100%)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4" style={{ background: 'rgba(25,200,185,0.15)', border: '1px solid rgba(25,200,185,0.3)' }}>
                  <Play size={24} color="#19c8b9" />
                </div>
                <p className="text-sm" style={{ color: '#6b6862' }}>Canvas 操作演示视频即将上线</p>
              </div>
            </div>
            {/* hand-drawn decorative arrows */}
            <HandDrawnArrow color="#d4a574" className="absolute top-4 right-8" />
            <SketchStar size={16} color="#19c8b9" className="absolute bottom-6 left-6" />
          </motion.div>
        </div>
      </section>

      {/* ===== Features ===== */}
      <section id="features" className="px-6 py-24" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', stiffness: 100, damping: 20 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl font-bold mb-4">
            为什么选择 <span style={{ color: '#19c8b9' }}>Flovart</span>
          </h2>
          <p style={{ color: '#a8a49c' }}>四个核心优势，重新定义 AI 创作工作流</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {FEATURES.map((feat, i) => (
            <motion.div
              key={feat.num}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ type: 'spring', stiffness: 100, damping: 18, delay: i * 0.1 }}
              className="relative rounded-2xl p-8 group transition-all hover:scale-[1.02]"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="flex items-start gap-5">
                <div className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: 'rgba(25,200,185,0.1)', border: '1px solid rgba(25,200,185,0.2)' }}>
                  <feat.icon size={24} color="#19c8b9" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-mono" style={{ color: '#d4a574' }}>{feat.num}</span>
                    <h3 className="text-xl font-semibold">{feat.title}</h3>
                  </div>
                  <p className="text-sm" style={{ color: '#a8a49c', lineHeight: 1.7 }}>{feat.desc}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== Template Gallery ===== */}
      <section id="templates" className="px-6 py-24" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', stiffness: 100, damping: 20 }}
          className="text-center mb-12"
        >
          <h2 className="text-4xl font-bold mb-4">
            精选模板 · <span style={{ color: '#19c8b9' }}>一键使用</span>
          </h2>
          <p style={{ color: '#a8a49c' }}>点击模板即可在画布中打开，替换内容直接生成</p>
        </motion.div>

        {/* category tabs */}
        <div className="flex justify-center gap-2 mb-10 flex-wrap">
          {TEMPLATE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="px-5 py-2 rounded-full text-sm font-medium transition-all"
              style={{
                background: activeCategory === cat ? '#19c8b9' : 'rgba(255,255,255,0.05)',
                color: activeCategory === cat ? '#fff' : '#a8a49c',
                border: `1px solid ${activeCategory === cat ? 'transparent' : 'rgba(255,255,255,0.1)'}`,
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* template grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {filteredTemplates.map((tpl, i) => (
            <motion.div
              key={tpl.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 120, damping: 16, delay: i * 0.05 }}
              className="group cursor-pointer rounded-2xl overflow-hidden relative transition-all hover:scale-[1.03]"
              style={{ aspectRatio: '3/4', background: tpl.gradient, border: '1px solid rgba(255,255,255,0.08)' }}
              onClick={() => linkTo(`/app?templateId=${tpl.id}`)}
            >
              {/* overlay */}
              <div className="absolute inset-0 flex flex-col justify-end p-5" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 60%)' }}>
                {tpl.badge && (
                  <span className="absolute top-4 right-4 text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)', color: '#fff' }}>
                    {tpl.badge}
                  </span>
                )}
                <div className="flex items-center gap-2 mb-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {tpl.type === 'video' ? <Video size={12} /> : <ImageIcon size={12} />}
                  <span>{tpl.model}</span>
                </div>
                <h3 className="text-base font-semibold text-white mb-2">{tpl.title}</h3>
                <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: '#19c8b9' }}>
                  <Wand2 size={12} />
                  <span>一键使用</span>
                  <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== Showcase ===== */}
      <section id="showcase" className="px-6 py-24" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', stiffness: 100, damping: 20 }}
          className="text-center mb-12"
        >
          <h2 className="text-4xl font-bold mb-4">
            用 Flovart 创作的
            <span style={{ position: 'relative', display: 'inline-block' }}>
              <span style={{ color: '#d4a574' }}>作品</span>
              <HandDrawnUnderline color="#d4a574" width={80} />
            </span>
          </h2>
          <p style={{ color: '#a8a49c' }}>来自社区的精选创作，点击「创作同款」即可复用</p>
        </motion.div>

        {/* masonry grid */}
        <div className="columns-2 md:columns-3 lg:columns-4 gap-4 [&>*]:mb-4">
          {SHOWCASE_WORKS.map((work, i) => (
            <motion.div
              key={work.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ type: 'spring', stiffness: 100, damping: 18, delay: (i % 4) * 0.08 }}
              className="group break-inside-avoid rounded-xl overflow-hidden cursor-pointer relative transition-all hover:scale-[1.02]"
              style={{ aspectRatio: i % 3 === 0 ? '3/4' : '1/1', background: work.gradient, border: '1px solid rgba(255,255,255,0.06)' }}
              onClick={() => linkTo(`/app?templateId=${work.id}`)}
            >
              <div className="absolute inset-0 flex flex-col justify-end p-4 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 70%)' }}>
                <div className="flex items-center gap-2 mb-1 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {work.type === 'video' ? <Video size={10} /> : <ImageIcon size={10} />}
                </div>
                <h3 className="text-sm font-semibold text-white mb-0.5">{work.title}</h3>
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>@{work.author}</span>
                  <span className="text-xs font-medium" style={{ color: '#19c8b9' }}>创作同款 →</span>
                </div>
              </div>
              {/* type indicator always visible */}
              <div className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}>
                {work.type === 'video' ? <Video size={12} color="#fff" /> : <ImageIcon size={12} color="#fff" />}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== Bottom CTA ===== */}
      <section className="px-6 py-32 text-center relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, rgba(25,200,185,0.1) 0%, transparent 60%)' }} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', stiffness: 100, damping: 16 }}
          className="relative z-10"
        >
          <SketchStar size={32} color="#19c8b9" className="mx-auto mb-6" />
          <h2 className="text-4xl md:text-5xl font-black mb-6" style={{ lineHeight: 1.2 }}>
            开启你的
            <span style={{ color: '#19c8b9' }}>创作之旅</span>
          </h2>
          <p className="text-lg mb-10" style={{ color: '#a8a49c' }}>免费、开源、本地优先 — 现在就开始</p>
          <button
            onClick={() => linkTo('/app')}
            className="group inline-flex items-center gap-2 px-10 py-4 rounded-full text-lg font-bold transition-all hover:scale-105"
            style={{ background: '#19c8b9', color: '#fff', boxShadow: '0 12px 40px rgba(25,200,185,0.35)' }}
          >
            开始创作
            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </button>
        </motion.div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="px-6 py-12" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="mx-auto flex flex-col md:flex-row items-center justify-between gap-6" style={{ maxWidth: 1200 }}>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 18, fontWeight: 800 }}>Flovart</span>
            <SketchStar size={12} color="#19c8b9" />
            <span className="text-sm ml-2" style={{ color: '#6b6862' }}>用画布造梦</span>
          </div>
          <div className="flex items-center gap-6 text-sm" style={{ color: '#6b6862' }}>
            <a href="https://github.com/avabbbb/Flovart" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white transition-colors">
              <BookOpen size={14} /> GitHub
            </a>
            <a href="#/business" className="hover:text-white transition-colors">企业版</a>
            <a href="https://github.com/avabbbb/Flovart/blob/main/docs" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white transition-colors">
              <BookOpen size={14} /> 文档
            </a>
          </div>
          <div className="text-xs" style={{ color: '#4a463f' }}>
            © 2026 Flovart · AGPL-3.0-only
          </div>
        </div>
      </footer>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
