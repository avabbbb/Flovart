import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentOrbIcon, AgentWorkingOrb } from '../components/agent/AgentWorkingOrb';

describe('AgentWorkingOrb (奶蛙思考)', () => {
  it('renders the Naiwa thinking animation with the phase label, state and meta', () => {
    const { container } = render(<AgentWorkingOrb state="breathing" label="正在思考" meta="4s" />);
    const pill = screen.getByTestId('agent-working-orb');
    expect(pill.getAttribute('role')).toBe('status');
    expect(pill.dataset.state).toBe('breathing');
    expect(pill.textContent).toContain('正在思考…');
    expect(pill.textContent).toContain('4s');
    const naiwa = container.querySelector('.naiwa-think');
    expect(naiwa).not.toBeNull();
    expect(naiwa?.getAttribute('aria-hidden')).toBe('true');
    // 32px 工作胶囊带「…」气泡；SVG 叠层（瞳孔 / 眼皮 / 嘴）都在。
    expect(container.querySelector('.naiwa-think__bubble')).not.toBeNull();
    expect(container.querySelectorAll('.nw-pupil')).toHaveLength(2);
    expect(container.querySelectorAll('.nw-lid')).toHaveLength(2);
    expect(container.querySelector('.nw-mouth')).not.toBeNull();
  });

  it('gives each instance its own eye clip paths', () => {
    const { container } = render(<><AgentOrbIcon state="working" /><AgentOrbIcon state="working" /></>);
    const ids = [...container.querySelectorAll('clipPath')].map(node => node.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('drops the bubble at the 20px inline size and stays hidden from screen readers unless labelled', () => {
    const { container, rerender } = render(<AgentOrbIcon state="searching" />);
    const icon = container.querySelector('.agent-orb') as HTMLElement;
    expect(icon.dataset.state).toBe('searching');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.naiwa-think__bubble')).toBeNull();
    rerender(<AgentOrbIcon state="working" label="运行中" />);
    expect(screen.getByRole('img', { name: '运行中' })).toBeTruthy();
  });
});
