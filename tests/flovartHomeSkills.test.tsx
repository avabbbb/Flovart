import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import FlovartHome from '../components/home/FlovartHome';

describe('Flovart Home Skill 台', () => {
  it('shows the bundled VOX example and opens its verified package details', () => {
    render(<FlovartHome />);

    expect(screen.getByRole('heading', { name: 'Skill 台' })).toBeInTheDocument();
    expect(screen.getByText('VOX Director')).toBeInTheDocument();
    expect(screen.getByText('内置示例')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看 VOX Director' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('community.vox-director');
    expect(screen.getByRole('dialog')).toHaveTextContent('不读取 API Key');
    expect(screen.getByRole('dialog')).toHaveTextContent('查看上游源码');
  });
});
