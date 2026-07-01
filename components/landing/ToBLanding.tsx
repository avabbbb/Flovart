import { motion } from 'motion/react';
import {
  ArrowRight, Check, Server, Shield, Code2, Workflow, Globe, Cpu,
  Lock, Zap, FileText, Headphones, Star, Building2,
} from 'lucide-react';

const linkTo = (path: string) => (window.location.hash = path);

const ENTERPRISE_FEATURES = [
  { icon: Code2, title: '开源可自部署', desc: '完整源码 AGPL-3.0 协议，支持私有化部署，数据完全掌控在企业内部' },
  { icon: Workflow, title: '画布 + 工作流融合', desc: '可视化画布与工作流无缝切换，拖拽组合多模型，构建团队专属创作流水线' },
  { icon: Globe, title: '原生中文创作', desc: '中文提示词精准理解，中文管理后台，贴合国内团队协作与审批场景' },
  { icon: Lock, title: '本地优先 · 隐私安全', desc: 'API Key 加密存储，生成数据浏览器本地保存，无需上传云端' },
];

const MODELS = [
  { name: 'Seedance 2.0', type: '视频', vendor: '字节跳动' },
  { name: 'Kling 2.0', type: '视频', vendor: '快手' },
  { name: 'Seedream 4.5', type: '图像', vendor: '字节跳动' },
  { name: 'Flux Pro', type: '图像', vendor: 'Black Forest Labs' },
  { name: 'Nano Banana', type: '图像', vendor: 'Google' },
  { name: 'RunningHub', type: '多模态', vendor: 'RunningHub' },
  { name: 'OpenAI 兼容', type: '多模态', vendor: '任意第三方' },
  { name: 'Qwen Image', type: '图像', vendor: '阿里' },
];

const COMPARISON = [
  { feature: '开源协议', flovart: 'AGPL-3.0', krea: '闭源', jimeng: '闭源' },
  { feature: '私有化部署', flovart: true, krea: false, jimeng: false },
  { feature: '画布 + 工作流', flovart: true, krea: false, jimeng: true },
  { feature: '本地数据存储', flovart: true, krea: false, jimeng: false },
  { feature: '中文原生支持', flovart: true, krea: false, jimeng: true },
  { feature: '多模型聚合', flovart: true, krea: true, jimeng: false },
  { feature: 'API Key 自管', flovart: true, krea: false, jimeng: false },
  { feature: '按量付费', flovart: '按模型计费', krea: '订阅制', jimeng: '按量计费' },
];

const PRICING = [
  {
    name: '社区版', price: '免费', desc: '开源自部署，适合个人和小团队',
    features: ['完整画布 + 工作流', '所有模型接入', '本地浏览器存储', 'AGPL-3.0 开源协议', '社区支持'],
    cta: '立即使用', highlight: false,
  },
  {
    name: '企业版', price: '联系我们', desc: '私有化部署，适合中大型企业',
    features: ['社区版全部功能', '私有化部署支持', '组织/部门/角色 RBAC', '权限继承与部门树', '桌面端自动更新', '全栈 CLI 工具链', 'AGPL-3.0 开源协议'],
    cta: '咨询方案', highlight: true,
  },
];

const FAQS = [
  { q: 'Flovart 是完全免费的吗？', a: '是的，社区版基于 AGPL-3.0 协议开源，完全免费。你只需为使用的 AI 模型 API 付费（由模型提供商收取）。' },
  { q: '数据存储在哪里？', a: '所有生成数据和 API Key 都存储在你的浏览器本地（localforage），不会上传到任何服务器。私有化部署后数据完全在企业内部。' },
  { q: '支持哪些 AI 模型？', a: '支持 Seedance、Kling、Seedream、Flux、Nano Banana 等主流模型，以及任何 OpenAI 兼容接口。通过 RunningHub 还可接入更多模型。' },
  { q: '企业版和社区版有什么区别？', a: '企业版提供私有化部署支持、组织/部门/角色权限体系、桌面端自动更新和全栈 CLI 工具链。功能上与社区版一致。' },
  { q: '可以商业化使用吗？', a: 'AGPL-3.0 协议允许商业化使用，但如果你修改后提供网络服务，需要开源你的修改。详见 LICENSE 文件。' },
];

function CheckIcon({ value }: { value: boolean | string }) {
  if (value === true) return <Check size={16} color="#19c8b9" />;
  if (value === false) return <span style={{ color: '#5a564f' }}>—</span>;
  return <span className="text-sm" style={{ color: '#d4a574' }}>{value}</span>;
}

export default function ToBLanding() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#f5f5f0', fontFamily: '-apple-system, "Segoe UI", "Noto Sans SC", sans-serif' }}>
      {/* ===== Header ===== */}
      <header className="fixed top-0 left-0 right-0 z-50" style={{ backdropFilter: 'blur(16px)', background: 'rgba(10,10,10,0.72)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="mx-auto flex items-center justify-between px-6 py-3" style={{ maxWidth: 1200 }}>
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => linkTo('/')}>
            <Building2 size={18} color="#19c8b9" />
            <span style={{ fontSize: 20, fontWeight: 800 }}>Flovart</span>
            <span className="text-xs ml-1 px-2 py-0.5 rounded" style={{ background: 'rgba(25,200,185,0.1)', color: '#19c8b9' }}>企业版</span>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm" style={{ color: '#a8a49c' }}>
            <a href="#features" className="hover:text-white transition-colors">功能</a>
            <a href="#models" className="hover:text-white transition-colors">模型</a>
            <a href="#comparison" className="hover:text-white transition-colors">对比</a>
            <a href="#pricing" className="hover:text-white transition-colors">定价</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            <div className="flex items-center gap-1 p-1 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <button onClick={() => linkTo('/')} className="px-3 py-1 rounded-full text-xs font-medium transition-all hover:text-white" style={{ color: '#a8a49c' }}>个人版</button>
              <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ background: '#19c8b9', color: '#fff' }}>企业版</span>
            </div>
          </nav>
          <button
            onClick={() => linkTo('/app')}
            className="text-sm font-medium px-5 py-2 rounded-full transition-all hover:scale-105"
            style={{ background: '#19c8b9', color: '#fff' }}
          >
            免费开始
          </button>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="relative flex items-center px-6 pt-24 pb-20 overflow-hidden" style={{ minHeight: '100vh' }}>
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(25,200,185,0.08) 0%, transparent 50%)' }} />
        <div className="relative z-10 mx-auto text-center" style={{ maxWidth: 900 }}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 120, damping: 18 }}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8 text-xs" style={{ background: 'rgba(25,200,185,0.1)', border: '1px solid rgba(25,200,185,0.25)', color: '#19c8b9' }}>
              <Server size={12} />
              <span>开源 · 自部署 · 企业级 AI 创作平台</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-6" style={{ lineHeight: 1.15 }}>
              企业级 AI 创作画布<br />
              <span style={{ color: '#19c8b9' }}>私有部署 · 数据自主</span>
            </h1>
            <p className="text-lg md:text-xl mb-10" style={{ color: '#a8a49c', lineHeight: 1.7 }}>
              开源 AGPL-3.0 协议，画布 + 工作流融合，聚合 20+ 主流 AI 模型<br />
              部署在企业内部，数据完全掌控，告别云端依赖
            </p>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <button
                onClick={() => linkTo('/app')}
                className="group flex items-center gap-2 px-8 py-3.5 rounded-full text-base font-semibold transition-all hover:scale-105"
                style={{ background: '#19c8b9', color: '#fff', boxShadow: '0 8px 32px rgba(25,200,185,0.3)' }}
              >
                免费试用
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </button>
              <a
                href="#pricing"
                className="flex items-center gap-2 px-8 py-3.5 rounded-full text-base font-medium transition-all hover:bg-white/10"
                style={{ border: '1px solid rgba(255,255,255,0.15)' }}
              >
                查看定价
              </a>
            </div>

            {/* trust indicators */}
            <div className="mt-14 flex items-center justify-center gap-8 flex-wrap text-sm" style={{ color: '#6b6862' }}>
              <span className="flex items-center gap-1.5"><Code2 size={14} /> AGPL-3.0 开源</span>
              <span className="flex items-center gap-1.5"><Shield size={14} /> 数据本地化</span>
              <span className="flex items-center gap-1.5"><Cpu size={14} /> 20+ 模型接入</span>
              <span className="flex items-center gap-1.5"><Star size={14} /> 私有化部署</span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ===== Features ===== */}
      <section id="features" className="px-6 py-24" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 100, damping: 20 }} className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">为什么企业选择 <span style={{ color: '#19c8b9' }}>Flovart</span></h2>
          <p style={{ color: '#a8a49c' }}>开源、自主、可控 — 企业 AI 创作的基础设施</p>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {ENTERPRISE_FEATURES.map((feat, i) => (
            <motion.div
              key={feat.title}
              initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ type: 'spring', stiffness: 100, damping: 18, delay: i * 0.1 }}
              className="rounded-2xl p-8 transition-all hover:scale-[1.02]"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="flex items-start gap-5">
                <div className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: 'rgba(25,200,185,0.1)', border: '1px solid rgba(25,200,185,0.2)' }}>
                  <feat.icon size={24} color="#19c8b9" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">{feat.title}</h3>
                  <p className="text-sm" style={{ color: '#a8a49c', lineHeight: 1.7 }}>{feat.desc}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== Model Ecosystem ===== */}
      <section id="models" className="px-6 py-24" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 100, damping: 20 }} className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">模型生态 · <span style={{ color: '#19c8b9' }}>一站式接入</span></h2>
          <p style={{ color: '#a8a49c' }}>聚合主流模型供应商，通过统一接口自由切换</p>
        </motion.div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {MODELS.map((m, i) => (
            <motion.div
              key={m.name}
              initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
              transition={{ type: 'spring', stiffness: 120, damping: 16, delay: i * 0.05 }}
              className="rounded-xl p-5 text-center transition-all hover:scale-[1.03]"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3" style={{ background: 'rgba(25,200,185,0.08)' }}>
                {m.type === '视频' ? <Zap size={18} color="#19c8b9" /> : <Globe size={18} color="#19c8b9" />}
              </div>
              <h3 className="text-sm font-semibold mb-1">{m.name}</h3>
              <p className="text-xs" style={{ color: '#6b6862' }}>{m.vendor} · {m.type}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== Comparison ===== */}
      <section id="comparison" className="px-6 py-24" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 100, damping: 20 }} className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">与竞品对比</h2>
          <p style={{ color: '#a8a49c' }}>Flovart vs Krea vs 即梦 — 企业选型的关键差异</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          transition={{ type: 'spring', stiffness: 80, damping: 16 }}
          className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'rgba(25,200,185,0.06)' }}>
                <th className="text-left p-4 font-semibold">能力</th>
                <th className="text-center p-4 font-semibold" style={{ color: '#19c8b9' }}>Flovart</th>
                <th className="text-center p-4 font-semibold" style={{ color: '#a8a49c' }}>Krea</th>
                <th className="text-center p-4 font-semibold" style={{ color: '#a8a49c' }}>即梦</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row, i) => (
                <tr key={row.feature} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td className="p-4 font-medium">{row.feature}</td>
                  <td className="text-center p-4"><CheckIcon value={row.flovart} /></td>
                  <td className="text-center p-4"><CheckIcon value={row.krea} /></td>
                  <td className="text-center p-4"><CheckIcon value={row.jimeng} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </section>

      {/* ===== Pricing ===== */}
      <section id="pricing" className="px-6 py-24" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 100, damping: 20 }} className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">简单透明的定价</h2>
          <p style={{ color: '#a8a49c' }}>社区版永久免费，企业版按需定制</p>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {PRICING.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ type: 'spring', stiffness: 100, damping: 18, delay: i * 0.1 }}
              className="rounded-2xl p-8 relative"
              style={{
                background: plan.highlight ? 'rgba(25,200,185,0.06)' : 'rgba(255,255,255,0.03)',
                border: plan.highlight ? '1px solid rgba(25,200,185,0.3)' : '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs px-3 py-1 rounded-full font-medium" style={{ background: '#19c8b9', color: '#fff' }}>
                  推荐
                </span>
              )}
              <h3 className="text-xl font-bold mb-2">{plan.name}</h3>
              <div className="text-3xl font-black mb-1" style={{ color: plan.highlight ? '#19c8b9' : '#f5f5f0' }}>{plan.price}</div>
              <p className="text-sm mb-6" style={{ color: '#a8a49c' }}>{plan.desc}</p>
              <ul className="space-y-3 mb-8">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <Check size={16} color="#19c8b9" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => linkTo('/app')}
                className="w-full py-3 rounded-full font-semibold transition-all hover:scale-[1.02]"
                style={{
                  background: plan.highlight ? '#19c8b9' : 'rgba(255,255,255,0.05)',
                  color: plan.highlight ? '#fff' : '#f5f5f0',
                  border: plan.highlight ? 'none' : '1px solid rgba(255,255,255,0.1)',
                }}
              >
                {plan.cta}
              </button>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section id="faq" className="px-6 py-24" style={{ maxWidth: 800, margin: '0 auto' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 100, damping: 20 }} className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">常见问题</h2>
        </motion.div>
        <div className="space-y-4">
          {FAQS.map((faq, i) => (
            <motion.div
              key={faq.q}
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ type: 'spring', stiffness: 100, damping: 18, delay: i * 0.05 }}
              className="rounded-xl p-6"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <h3 className="font-semibold mb-2 flex items-center gap-2"><FileText size={16} color="#19c8b9" /> {faq.q}</h3>
              <p className="text-sm" style={{ color: '#a8a49c', lineHeight: 1.7 }}>{faq.a}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="px-6 py-32 text-center relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, rgba(25,200,185,0.1) 0%, transparent 60%)' }} />
        <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 100, damping: 16 }} className="relative z-10">
          <h2 className="text-4xl md:text-5xl font-black mb-6" style={{ lineHeight: 1.2 }}>
            让 AI 创作能力<br /><span style={{ color: '#19c8b9' }}>成为企业基础设施</span>
          </h2>
          <p className="text-lg mb-10" style={{ color: '#a8a49c' }}>免费开始，或联系我们定制企业方案</p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <button onClick={() => linkTo('/app')} className="group inline-flex items-center gap-2 px-10 py-4 rounded-full text-lg font-bold transition-all hover:scale-105" style={{ background: '#19c8b9', color: '#fff', boxShadow: '0 12px 40px rgba(25,200,185,0.35)' }}>
              免费开始 <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <a href="mailto:contact@flovart.com" className="inline-flex items-center gap-2 px-10 py-4 rounded-full text-lg font-medium transition-all hover:bg-white/10" style={{ border: '1px solid rgba(255,255,255,0.15)' }}>
              <Headphones size={18} /> 联系销售
            </a>
          </div>
        </motion.div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="px-6 py-12" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="mx-auto flex flex-col md:flex-row items-center justify-between gap-6" style={{ maxWidth: 1200 }}>
          <div className="flex items-center gap-2">
            <Building2 size={16} color="#19c8b9" />
            <span style={{ fontSize: 18, fontWeight: 800 }}>Flovart</span>
            <span className="text-sm ml-2" style={{ color: '#6b6862' }}>企业级 AI 创作平台</span>
          </div>
          <div className="flex items-center gap-6 text-sm" style={{ color: '#6b6862' }}>
            <a href="#/" className="hover:text-white transition-colors">社区版</a>
            <a href="https://github.com/avabbbb/Flovart" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white transition-colors"><Code2 size={14} /> GitHub</a>
            <a href="mailto:contact@flovart.com" className="hover:text-white transition-colors">联系我们</a>
          </div>
          <div className="text-xs" style={{ color: '#4a463f' }}>© 2026 Flovart · AGPL-3.0-only</div>
        </div>
      </footer>
    </div>
  );
}
