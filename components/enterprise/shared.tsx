// 企业后台面板共享组件
import React from 'react';
import type { Organization } from '../../services/orgApi';

export type PanelProps = {
  org: Organization;
  perms: string[];
  userId: string;
  toast: { show: (msg: string, type?: 'success' | 'error' | 'info') => void; toasts: unknown[]; dismiss: (id: string) => void };
};

export function FormInput({ value, onChange, placeholder, type = 'text', autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className="w-full rounded-lg px-3 py-2.5 text-sm"
      style={{ background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)' }}
    />
  );
}

export function PanelCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl p-4 ${className}`} style={{ background: 'var(--isl-surface)', border: '1.5px solid var(--isl-border)' }}>
      {children}
    </div>
  );
}

export function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="py-10 text-center">
      <div className="mx-auto mb-2 flex justify-center">{icon}</div>
      <p className="text-xs" style={{ color: 'var(--isl-ink-soft)' }}>{text}</p>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h3 className="text-base font-bold">{title}</h3>
        {subtitle && <p className="text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
