import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Check, ArrowRight, MousePointerClick } from 'lucide-react';

const linkTo = (path: string) => (window.location.hash = path);

type Scene = 'input' | 'thinking' | 'generating' | 'touchEdit' | 'done';

const THINKING_STEPS = [
  { label: '分析品牌定位：精品社区咖啡馆', duration: 1400 },
  { label: '搜索风格参考：日系极简 + 暖色调', duration: 1400 },
  { label: '生成 Logo 设计', duration: 1600 },
  { label: '生成 咖啡杯包装样机', duration: 1600 },
  { label: '生成 品牌海报', duration: 1600 },
];

const GENERATED_CARDS = [
  { gradient: 'linear-gradient(135deg, #2d1b0e 0%, #8b5e3c 50%, #d4a574 100%)', label: 'Logo', delay: 0 },
  { gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)', label: '包装', delay: 800 },
  { gradient: 'linear-gradient(135deg, #2d1b69 0%, #6e0e5c 50%, #c5365e 100%)', label: '海报', delay: 1600 },
];

const PROMPT_TEXT = '为街角咖啡馆设计品牌视觉系统';

function Typewriter({ text, onDone, speed = 45 }: { text: string; onDone?: () => void; speed?: number }) {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    setDisplayed('');
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(timer);
        onDone?.();
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, onDone, speed]);
  return <span>{displayed}<motion.span animate={{ opacity: [0, 1] }} transition={{ repeat: Infinity, duration: 0.6 }} className="inline-block w-[2px] h-[1em] align-middle ml-0.5" style={{ background: '#19c8b9' }} /></span>;
}

export default function AgentDemoAnimation() {
  const [scene, setScene] = useState<Scene>('input');
  const [thinkingStep, setThinkingStep] = useState(0);
  const [visibleCards, setVisibleCards] = useState(0);
  const [editingCard, setEditingCard] = useState<number | null>(null);

  const reset = useCallback(() => {
    setScene('input');
    setThinkingStep(0);
    setVisibleCards(0);
    setEditingCard(null);
  }, []);

  useEffect(() => {
    if (scene === 'input') {
      const timer = setTimeout(() => setScene('thinking'), 2800);
      return () => clearTimeout(timer);
    }
    if (scene === 'thinking') {
      if (thinkingStep < THINKING_STEPS.length) {
        const timer = setTimeout(() => {
          setThinkingStep(prev => prev + 1);
        }, THINKING_STEPS[thinkingStep].duration);
        return () => clearTimeout(timer);
      } else {
        const timer = setTimeout(() => setScene('generating'), 400);
        return () => clearTimeout(timer);
      }
    }
    if (scene === 'generating') {
      if (visibleCards < GENERATED_CARDS.length) {
        const timer = setTimeout(() => setVisibleCards(prev => prev + 1), 900);
        return () => clearTimeout(timer);
      } else {
        const timer = setTimeout(() => setScene('touchEdit'), 1200);
        return () => clearTimeout(timer);
      }
    }
    if (scene === 'touchEdit') {
      setEditingCard(1);
      const timer = setTimeout(() => {
        setEditingCard(null);
        setScene('done');
      }, 2800);
      return () => clearTimeout(timer);
    }
    if (scene === 'done') {
      const timer = setTimeout(() => reset(), 5000);
      return () => clearTimeout(timer);
    }
  }, [scene, thinkingStep, visibleCards, reset]);

  return (
    <div
      className="relative rounded-2xl overflow-hidden"
      style={{
        maxWidth: 800,
        aspectRatio: '16/9',
        background: 'linear-gradient(135deg, #0d0d0d 0%, #12121f 100%)',
        border: '1px solid rgba(25,200,185,0.12)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 80px rgba(25,200,185,0.06) inset',
      }}
    >
      {/* grid background */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
      />

      {/* Chat input bar */}
      <AnimatePresence>
        {scene === 'input' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-4 left-4 right-4 z-20"
          >
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl" style={{ background: 'rgba(25,200,185,0.06)', border: '1px solid rgba(25,200,185,0.2)' }}>
              <Sparkles size={14} color="#19c8b9" className="flex-shrink-0" />
              <span className="text-sm" style={{ color: '#a8a49c' }}>
                <Typewriter text={PROMPT_TEXT} onDone={() => {}} />
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Agent thinking steps */}
      <AnimatePresence>
        {scene === 'thinking' && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="absolute top-4 left-4 z-20 space-y-1.5"
            style={{ maxWidth: 280 }}
          >
            {THINKING_STEPS.slice(0, thinkingStep + 1).map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {i < thinkingStep ? (
                  <Check size={12} color="#19c8b9" className="flex-shrink-0" />
                ) : (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    className="flex-shrink-0 w-3 h-3 rounded-full border-[1.5px] border-transparent"
                    style={{ borderTopColor: '#19c8b9', borderRightColor: '#19c8b9' }}
                  />
                )}
                <span style={{ color: i < thinkingStep ? '#6b6862' : '#c9c5bd' }}>{step.label}</span>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generated cards on mini-canvas */}
      <div className="absolute inset-0 flex items-center justify-center gap-3 px-4" style={{ paddingTop: 0 }}>
        <AnimatePresence>
          {scene !== 'input' && scene !== 'thinking' && GENERATED_CARDS.slice(0, visibleCards).map((card, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.6, y: 30 }}
              animate={{
                opacity: 1,
                scale: editingCard === i ? 1.05 : 1,
                y: 0,
              }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: 'spring', stiffness: 120, damping: 14 }}
              className="relative rounded-xl overflow-hidden cursor-pointer"
              style={{
                width: '28%',
                aspectRatio: '3/4',
                background: card.gradient,
                border: editingCard === i ? '2px solid #19c8b9' : '1px solid rgba(255,255,255,0.1)',
                boxShadow: editingCard === i ? '0 0 24px rgba(25,200,185,0.3)' : '0 4px 20px rgba(0,0,0,0.3)',
              }}
            >
              {/* label badge */}
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-medium" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', color: 'rgba(255,255,255,0.8)' }}>
                {card.label}
              </div>

              {/* Touch Edit popup */}
              <AnimatePresence>
                {editingCard === i && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.9 }}
                    className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium"
                    style={{ background: '#19c8b9', color: '#fff', boxShadow: '0 4px 16px rgba(25,200,185,0.4)' }}
                  >
                    <MousePointerClick size={11} />
                    替换此区域
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* CTA at bottom */}
      <AnimatePresence>
        {scene === 'done' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20"
          >
            <button
              onClick={() => linkTo('/app')}
              className="group flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold transition-all hover:scale-105"
              style={{ background: '#19c8b9', color: '#fff', boxShadow: '0 4px 24px rgba(25,200,185,0.3)' }}
            >
              用你的 API Key 试试
              <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* scene label */}
      <div className="absolute bottom-3 right-4 text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
        {scene === 'input' && '用户输入'}
        {scene === 'thinking' && 'Agent 思考中'}
        {scene === 'generating' && '生成中'}
        {scene === 'touchEdit' && '点选编辑'}
        {scene === 'done' && '完成'}
      </div>
    </div>
  );
}
