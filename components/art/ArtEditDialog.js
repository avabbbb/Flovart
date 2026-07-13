import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Modal, Button, Spin, Alert, Segmented } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { ART_TOOLS } from './artTools';
import { useArtWorker } from './useArtWorker';
const TOOL_LABEL = ART_TOOLS.reduce((acc, t) => {
    acc[t.id] = t.label;
    return acc;
}, {});
export const ArtEditDialog = ({ state, element, onClose, onConfirm }) => {
    const toolId = state?.toolId;
    const elementHref = element?.href;
    const { run, cancel } = useArtWorker();
    const [runState, setRunState] = useState({ phase: 'idle' });
    const [view, setView] = useState('result');
    const start = useCallback(async () => {
        if (!toolId || !elementHref)
            return;
        setRunState({ phase: 'decoding' });
        setView('result');
        try {
            const result = await run(toolId, elementHref, undefined, (phase, value) => {
                if (phase === 'processing' && typeof value === 'number') {
                    setRunState({ phase: 'processing', progress: value });
                }
                else {
                    setRunState({ phase: phase });
                }
            });
            setRunState({ phase: 'done', result });
        }
        catch (err) {
            setRunState({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
        }
    }, [toolId, elementHref, run]);
    useEffect(() => {
        if (!state || !element)
            return;
        void start();
        return () => cancel();
    }, [state, element, start, cancel]);
    if (!state || !element)
        return null;
    const isVideo = element.type === 'video';
    const label = TOOL_LABEL[state.toolId] ?? state.toolId;
    const busy = runState.phase !== 'idle' && runState.phase !== 'done' && runState.phase !== 'error';
    const phaseText = {
        decoding: '读取媒体…',
        processing: '处理中…',
        encoding: '编码结果…',
        done: '完成',
        error: '失败',
        idle: '',
    }[runState.phase];
    return (_jsx(Modal, { open: true, onCancel: busy ? undefined : onClose, footer: null, centered: true, width: 960, destroyOnHidden: true, maskClosable: !busy, title: `${label} / Art Edit`, children: _jsxs("div", { className: "workflow-image-tool__grid", "data-workflow-overlay": true, children: [_jsxs("div", { className: "workflow-image-tool__preview", style: { minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }, children: [busy && (_jsxs("div", { style: { textAlign: 'center' }, children: [_jsx(Spin, { size: "large" }), _jsx("div", { style: { marginTop: 12, color: 'var(--isl-mint, #5ec8c8)', fontSize: 13 }, children: phaseText })] })), !busy && runState.phase === 'done' && runState.result && (_jsx(_Fragment, { children: view === 'result' ? (_jsx("img", { src: runState.result.dataUrl, alt: "\u7ED3\u679C", draggable: false, style: { maxWidth: '100%', maxHeight: '60vh' } })) : isVideo ? (_jsx("video", { src: elementHref, controls: true, loop: true, muted: true, style: { maxWidth: '100%', maxHeight: '60vh' } })) : (_jsx("img", { src: elementHref, alt: "\u539F\u56FE", draggable: false, style: { maxWidth: '100%', maxHeight: '60vh' } })) })), !busy && runState.phase === 'error' && (_jsx(Alert, { type: "error", showIcon: true, message: runState.error ?? '处理失败' }))] }), _jsxs("div", { className: "workflow-image-tool__controls", children: [runState.phase === 'done' && runState.result && (_jsx("div", { style: { marginBottom: 12 }, children: _jsx(Segmented, { size: "small", value: view, onChange: (v) => setView(v), options: [
                                    { label: '原图', value: 'original' },
                                    { label: '结果', value: 'result' },
                                ] }) })), runState.phase === 'error' && (_jsx("div", { style: { marginBottom: 12, display: 'flex', gap: 8 }, children: _jsx(Button, { onClick: start, disabled: busy, children: "\u91CD\u8BD5" }) })), _jsx(Button, { onClick: onClose, disabled: busy, children: "\u53D6\u6D88" }), _jsx(Button, { type: "primary", disabled: busy || runState.phase !== 'done' || !runState.result, onClick: () => runState.result && onConfirm(runState.result.dataUrl), children: "\u66FF\u6362\u753B\u5E03\u5185\u5BB9" })] })] }) }));
};
