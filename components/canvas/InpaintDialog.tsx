import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Modal, Input, Button, Slider } from 'antd';
import type { ImageElement } from '../../types';

export interface InpaintDialogProps {
    element: ImageElement | null;
    open: boolean;
    busy: boolean;
    error: string | null;
    onClose: () => void;
    onConfirm: (element: ImageElement, maskDataUrl: string, prompt: string) => void;
}

export function InpaintDialog({ element, open, busy, error, onClose, onConfirm }: InpaintDialogProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const last = useRef({ x: 0, y: 0 });
    const [prompt, setPrompt] = useState('修改涂抹区域，保持未选区域不变');
    const [brush, setBrush] = useState(42);
    const [hasMask, setHasMask] = useState(false);

    useEffect(() => {
        if (open) {
            setHasMask(false);
            const canvas = canvasRef.current;
            canvas?.getContext('2d')?.clearRect(0, 0, canvas?.width || 0, canvas?.height || 0);
        }
    }, [open]);

    if (!element) return null;

    const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) / rect.width * event.currentTarget.width,
            y: (event.clientY - rect.top) / rect.height * event.currentTarget.height,
        };
    };

    const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!drawing.current) return;
        const next = point(event);
        const context = event.currentTarget.getContext('2d');
        if (!context) return;
        context.strokeStyle = 'rgba(25,200,185,0.65)';
        context.lineWidth = brush;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(last.current.x, last.current.y);
        context.lineTo(next.x, next.y);
        context.stroke();
        last.current = next;
        setHasMask(true);
    };

    const clearMask = () => {
        const canvas = canvasRef.current;
        canvas?.getContext('2d')?.clearRect(0, 0, canvas?.width || 0, canvas?.height || 0);
        setHasMask(false);
    };

    const submit = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const mask = document.createElement('canvas');
        mask.width = canvas.width;
        mask.height = canvas.height;
        const context = mask.getContext('2d');
        if (!context) return;
        context.fillStyle = '#fff';
        context.fillRect(0, 0, mask.width, mask.height);
        context.globalCompositeOperation = 'destination-out';
        context.drawImage(canvas, 0, 0);
        onConfirm(element, mask.toDataURL('image/png'), prompt.trim());
    };

    return (
        <Modal
            open={open}
            onCancel={busy ? undefined : onClose}
            footer={null}
            centered
            width={900}
            destroyOnHidden
            maskClosable={!busy}
            title="局部重绘 / Touch Edit"
        >
            <div className="workflow-image-tool__grid" data-workflow-overlay>
                <div className="workflow-image-tool__mask">
                    <img
                        src={element.href}
                        alt="蒙版编辑"
                        onLoad={event => {
                            const canvas = canvasRef.current;
                            if (!canvas) return;
                            canvas.width = event.currentTarget.naturalWidth || 1024;
                            canvas.height = event.currentTarget.naturalHeight || 768;
                        }}
                    />
                    <canvas
                        ref={canvasRef}
                        width={1024}
                        height={768}
                        onPointerDown={event => {
                            drawing.current = true;
                            last.current = point(event);
                            event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={draw}
                        onPointerUp={() => { drawing.current = false; }}
                    />
                </div>
                <div className="workflow-image-tool__controls">
                    <label>笔刷大小<Slider min={8} max={160} value={brush} onChange={setBrush} /></label>
                    <label>修改要求<Input.TextArea rows={6} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
                    <Button onClick={clearMask} disabled={busy}>重置蒙版</Button>
                    {error && <div role="alert" className="workflow-image-tool__error">{error}</div>}
                    <Button type="primary" loading={busy} disabled={!prompt.trim() || !hasMask} onClick={submit}>AI 修改</Button>
                </div>
            </div>
        </Modal>
    );
}
