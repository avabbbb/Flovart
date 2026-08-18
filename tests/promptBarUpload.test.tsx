import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { PromptBar } from '../components/PromptBar';

describe('PromptBar media attachments', () => {
  it('accepts both image and video reference uploads', () => {
    const { container } = render(
      <PromptBar
        t={(key) => key}
        theme="light"
        prompt=""
        setPrompt={() => undefined}
        onGenerate={() => undefined}
        isLoading={false}
        isSelectionActive={false}
        selectedElementCount={0}
        userEffects={[]}
        onAddUserEffect={() => undefined}
        onDeleteUserEffect={() => undefined}
        generationMode="image"
        setGenerationMode={() => undefined}
        videoAspectRatio="16:9"
        setVideoAspectRatio={() => undefined}
        imageAspectRatio="1:1"
        setImageAspectRatio={() => undefined}
      />,
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input?.accept).toBe('image/*,video/*,audio/*');
  });

  it('shows Seedance video controls for Seedance models', () => {
    render(
      <PromptBar
        t={(key) => key}
        theme="light"
        prompt="make a cinematic product shot"
        setPrompt={() => undefined}
        onGenerate={() => undefined}
        isLoading={false}
        isSelectionActive={false}
        selectedElementCount={0}
        userEffects={[]}
        onAddUserEffect={() => undefined}
        onDeleteUserEffect={() => undefined}
        generationMode="video"
        setGenerationMode={() => undefined}
        videoAspectRatio="16:9"
        setVideoAspectRatio={() => undefined}
        imageAspectRatio="1:1"
        setImageAspectRatio={() => undefined}
        selectedVideoModel="seedance-2.0"
        videoModelOptions={['seedance-2.0']}
      />,
    );

    fireEvent.click(screen.getByTitle('生成参数'));

    expect(screen.getByText('生成音频')).toBeTruthy();
    expect(screen.getByRole('button', { name: '开启' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Seedance 视频参数')).not.toBeInTheDocument();
  });

  it('uses video model controls for keyframe mode', () => {
    render(
      <PromptBar
        t={(key) => key}
        theme="light"
        prompt="animate between two frames"
        setPrompt={() => undefined}
        onGenerate={() => undefined}
        isLoading={false}
        isSelectionActive={false}
        selectedElementCount={0}
        userEffects={[]}
        onAddUserEffect={() => undefined}
        onDeleteUserEffect={() => undefined}
        generationMode="keyframe"
        setGenerationMode={() => undefined}
        videoAspectRatio="16:9"
        setVideoAspectRatio={() => undefined}
        imageAspectRatio="1:1"
        setImageAspectRatio={() => undefined}
        selectedImageModel="gpt-image-2"
        selectedVideoModel="seedance-2.0"
        imageModelOptions={['gpt-image-2']}
        videoModelOptions={['seedance-2.0']}
      />,
    );

    fireEvent.click(screen.getByText(/Seedance/).closest('button')!);
    expect(screen.getByText('选择模型')).toBeTruthy();
    expect(screen.getAllByText(/Seedance/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTitle('生成参数'));

    expect(screen.getByTestId('prompt-parameter-panel')).toHaveAttribute('data-density', 'compact');
    expect(screen.getByText('尺寸')).toBeTruthy();
    expect(screen.getByRole('button', { name: '720p' })).toBeTruthy();
  });
});
