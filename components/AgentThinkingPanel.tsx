import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Sparkles } from 'lucide-react';

interface AgentThinkingPanelProps {
    progressMessage: string;
    isLoading: boolean;
    batchTotal?: number;
    batchDone?: number;
}

export function AgentThinkingPanel({ progressMessage, isLoading, batchTotal, batchDone }: AgentThinkingPanelProps) {
    const [steps, setSteps] = useState<string[]>([]);
    const prevMessage = useRef('');

    useEffect(() => {
        if (progressMessage && progressMessage !== prevMessage.current) {
            setSteps(prev => [...prev, progressMessage]);
            prevMessage.current = progressMessage;
        }
    }, [progressMessage]);

    useEffect(() => {
        if (!isLoading) {
            const timer = setTimeout(() => {
                setSteps([]);
                prevMessage.current = '';
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [isLoading]);

    const showBatch = batchTotal && batchTotal > 1 && typeof batchDone === 'number';
    const visibleSteps = steps.slice(-5);

    return (
        <div className="absolute top-4 right-4 z-50" data-workflow-overlay>
            <AnimatePresence>
                {visibleSteps.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
                        className="isl-shell isl-pop-in"
                        style={{ borderRadius: 'var(--isl-r-lg)', padding: '12px 16px', minWidth: 240, maxWidth: 360 }}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <Sparkles size={14} style={{ color: 'var(--isl-mint-deep)' }} />
                            <span className="text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>Agent 思考过程</span>
                            {showBatch && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-auto" style={{ background: 'var(--isl-mint)', color: 'var(--isl-mint-deep)' }}>
                                    {batchDone}/{batchTotal}
                                </span>
                            )}
                        </div>
                        <div className="space-y-1">
                            {visibleSteps.map((step, i) => {
                                const isLast = i === visibleSteps.length - 1;
                                const isDone = !isLast || !isLoading;
                                return (
                                    <motion.div
                                        key={`${step}-${i}`}
                                        initial={{ opacity: 0, x: -8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                                        className="flex items-center gap-2 text-xs"
                                    >
                                        {isDone ? (
                                            <Check size={12} style={{ color: 'var(--isl-mint-deep)' }} className="flex-shrink-0" />
                                        ) : (
                                            <motion.div
                                                animate={{ rotate: 360 }}
                                                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                                                className="flex-shrink-0 w-3 h-3 rounded-full border-[1.5px] border-transparent"
                                                style={{ borderTopColor: 'var(--isl-mint-deep)', borderRightColor: 'var(--isl-mint-deep)' }}
                                            />
                                        )}
                                        <span style={{ color: isDone ? 'var(--isl-ink-dim)' : 'var(--isl-ink)' }}>{step}</span>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
