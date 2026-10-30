import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MentionList from '../components/MentionList';

const connected = [
    { id: 'n1', label: '图片1', thumbnail: '', elementType: 'image' },
    { id: 'n2', label: '图片2', thumbnail: '', elementType: 'image' },
    { id: 'n3', label: '视频1', thumbnail: '', elementType: 'video' },
];

const renderMenu = (query = '', command = vi.fn()) => {
    render(<MentionList connectedItems={connected} assetFolders={[]} assetItems={[]} query={query} command={command} />);
    return command;
};

describe('LibTV-style @ menu', () => {
    it('shows material categories for upstream nodes and no Skill placeholder', () => {
        renderMenu();
        expect(screen.getByTestId('mention-category-image')).toBeEnabled();
        expect(screen.getByTestId('mention-category-video')).toBeEnabled();
        expect(screen.getByTestId('mention-category-audio')).toBeDisabled();
        expect(screen.queryByText(/Skill|即将开放/)).toBeNull();
        expect(screen.getByText('图片2')).toBeInTheDocument();
    });

    it('inserts checked upstream nodes in one batch', () => {
        const command = renderMenu();
        fireEvent.click(screen.getByRole('checkbox', { name: '选择 图片1' }));
        fireEvent.click(screen.getByRole('checkbox', { name: '选择 图片2' }));
        fireEvent.click(screen.getByRole('button', { name: '插入 2 项' }));
        expect(command).toHaveBeenCalledWith({ batch: [expect.objectContaining({ id: 'n1' }), expect.objectContaining({ id: 'n2' })] });
    });

    it('switches to flat search results while typing after @', () => {
        renderMenu('视频');
        expect(screen.getByText('视频1')).toBeInTheDocument();
        expect(screen.queryByText('图片1')).toBeNull();
    });
});
