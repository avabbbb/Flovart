import { AnimatePresence, motion } from 'motion/react';
import { Sparkles, Zap, Mountain, Spline, PenLine, Box, PersonStanding, Scissors, type LucideIcon } from 'lucide-react';
import type { ArtToolId } from './artTools';

const ICONS: Record<string, LucideIcon> = {
  Sparkles, Zap, Mountain, Spline, PenLine, Box, PersonStanding, Scissors,
};

export interface ArtRippleState {
  id: number;
  toolId: ArtToolId;
  icon: string;
  x: number;
  y: number;
}

export interface ArtRippleOverlayProps {
  ripple: ArtRippleState | null;
  onComplete: () => void;
}

export const ArtRippleOverlay: React.FC<ArtRippleOverlayProps> = ({ ripple, onComplete }) => {
  return (
    <AnimatePresence onExitComplete={onComplete}>
      {ripple && (
        <motion.div
          key={ripple.id}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          className="pointer-events-none fixed inset-0 z-[80]"
          style={{ display: 'flex' }}
        >
          <div style={{ position: 'absolute', left: ripple.x, top: ripple.y, transform: 'translate(-50%, -50%)' }}>
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                initial={{ width: 0, height: 0, opacity: 0.6 }}
                animate={{ width: 320, height: 320, opacity: 0 }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: i * 0.12 }}
                className="absolute rounded-full"
                style={{
                  left: '50%',
                  top: '50%',
                  x: '-50%',
                  y: '-50%',
                  border: `2px solid var(--isl-mint, #19c8b9)`,
                  boxShadow: '0 0 24px rgba(25,200,185,0.4)',
                }}
              />
            ))}
            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1.2, opacity: 1 }}
              transition={{ duration: 0.35, ease: 'backOut' }}
              className="absolute flex items-center justify-center rounded-full"
              style={{
                left: '50%',
                top: '50%',
                x: '-50%',
                y: '-50%',
                width: 56,
                height: 56,
                background: 'var(--isl-card, rgba(20,24,28,0.9))',
                border: `1.5px solid var(--isl-mint, #19c8b9)`,
                backdropFilter: 'blur(8px)',
              }}
            >
              {(() => {
                const Icon = ICONS[ripple.icon] ?? Sparkles;
                return <Icon size={24} style={{ color: 'var(--isl-mint, #19c8b9)' }} />;
              })()}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
