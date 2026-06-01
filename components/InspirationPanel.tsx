/**
 * ============================================
 * 灵感库面板组件 (InspirationPanel)
 * ============================================
 * 
 * 【组件职责】
 * 这是 Flovart 的核心特色功能模块，负责管理和展示用户的创作素材库
 * 
 * 【核心功能】
 * 1. 素材分类管理：支持角色(character)、场景(scene)、道具(prop)三大分类
 * 2. 素材展示：瀑布流布局展示素材缩略图
 * 3. 拖拽复用：支持将素材拖拽到画布中使用
 * 4. 重命名功能：双击素材名称进行重命名
 * 5. 删除功能：移除不需要的素材
 * 6. AI生成：快速生成新素材并添加到库中
 * 7. 面板缩放：支持左侧拖拽调整面板宽度
 * 8. 最小化/展开：可收起为小图标节省空间
 * 
 * 【设计模式】
 * - 受控组件：所有数据由父组件管理，通过 props 传入
 * - 状态提升：增删改操作通过回调函数通知父组件
 * - 本地持久化：面板宽度存储在 localStorage
 * 
 * 【交互逻辑】
 * - 单击分类Tab：切换显示不同分类的素材
 * - 拖拽素材：将素材拖到画布上创建图片层
 * - 双击名称：进入编辑模式重命名
 * - 悬停素材：显示名称、尺寸和删除按钮
 * - 输入提示词：快速生成新素材
 */

import React, { useRef, useState, useEffect } from 'react';
import type { AssetLibrary, AssetCategory, AssetItem } from '../types';

/**
 * 【Props 接口定义】
 */
interface InspirationPanelProps {
    isMinimized: boolean;              // 是否最小化状态
    onToggleMinimize: () => void;      // 切换最小化/展开的回调
    library: AssetLibrary;             // 素材库数据（三个分类的素材数组）
    onRemove: (category: AssetCategory, id: string) => void;        // 删除素材的回调
    onRename: (category: AssetCategory, id: string, name: string) => void;  // 重命名素材的回调
    onGenerate: (prompt: string) => void;  // AI生成素材的回调
}

/**
 * 【分类标签Tab组件】
 * 渲染三个分类切换按钮：角色、场景、道具
 */
const CategoryTabs: React.FC<{ value: AssetCategory; onChange: (c: AssetCategory) => void }> = ({ value, onChange }) => (
    <div className="isl-tabbar">
        {(['character', 'scene', 'prop'] as AssetCategory[]).map(cat => (
            <button
                key={cat}
                onClick={() => onChange(cat)}
                className={`isl-tab px-2 py-1 text-xs ${value === cat ? 'isl-tab--active' : ''}`}
            >
                {cat === 'character' ? '角色' : cat === 'scene' ? '场景' : '道具'}
            </button>
        ))}
    </div>
);

/**
 * 【灵感库主组件】
 */
export const InspirationPanel: React.FC<InspirationPanelProps> = ({
    isMinimized,
    onToggleMinimize,
    library,
    onRemove,
    onRename,
    onGenerate
}) => {
    // ============ 引用 (Refs) ============
    const panelRef = useRef<HTMLDivElement>(null);           // 面板DOM引用
    const editInputRef = useRef<HTMLInputElement>(null);     // 重命名输入框引用
    const promptInputRef = useRef<HTMLInputElement>(null);   // AI提示词输入框引用

    // ============ 状态管理 (State) ============
    const [category, setCategory] = useState<AssetCategory>('character');  // 当前选中的分类
    const [editingId, setEditingId] = useState<string | null>(null);       // 正在编辑的素材ID
    const [editingName, setEditingName] = useState<string>('');            // 编辑中的素材名称
    const [prompt, setPrompt] = useState<string>('');                      // AI生成提示词

    // ============ 面板缩放相关状态 ============
    // 从 localStorage 读取上次保存的宽度，默认420px
    const [panelWidth, setPanelWidth] = useState(() => {
        const saved = localStorage.getItem('inspirationPanelWidth');
        return saved ? parseInt(saved, 10) : 420;
    });
    const [isResizing, setIsResizing] = useState(false);         // 是否正在调整大小
    const [resizeStartX, setResizeStartX] = useState(0);         // 调整开始时的鼠标X坐标
    const [resizeStartWidth, setResizeStartWidth] = useState(420);  // 调整开始时的面板宽度

    // ============ 副作用 (Effects) ============
    
    /**
     * 【Effect 1】持久化面板宽度
     * 每当面板宽度改变时，保存到 localStorage
     */
    useEffect(() => {
        localStorage.setItem('inspirationPanelWidth', panelWidth.toString());
    }, [panelWidth]);

    /**
     * 【Effect 2】处理面板缩放的拖拽逻辑
     * 监听全局鼠标移动和释放事件，实时更新面板宽度
     */
    useEffect(() => {
        if (!isResizing) return;

        const handlePointerMove = (e: PointerEvent) => {
            // 从左侧边缘拖拽，dx为负值表示向左拖（增大面板）
            const dx = resizeStartX - e.clientX;
            const minW = 320;  // 最小宽度
            const maxW = Math.min(800, window.innerWidth - 160);  // 最大宽度
            const nextW = Math.min(maxW, Math.max(minW, resizeStartWidth + dx));
            setPanelWidth(nextW);
        };

        const handlePointerUp = () => {
            setIsResizing(false);  // 结束拖拽
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        
        // 清理事件监听器
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [isResizing, resizeStartX, resizeStartWidth]);

    /**
     * 【Effect 3】自动聚焦重命名输入框
     * 进入编辑模式时，自动聚焦并选中输入框文本
     */
    useEffect(() => {
        if (editingId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingId]);

    // ============ 事件处理函数 (Event Handlers) ============

    /**
     * 【方法】开始调整面板大小
     * 用户按下左侧调整手柄时触发
     */
    const handleResizePointerDown = (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;  // 只响应左键
        setIsResizing(true);
        setResizeStartX(e.clientX);
        setResizeStartWidth(panelWidth);
        e.stopPropagation();
        e.preventDefault();
    };

    /**
     * 【方法】素材拖拽开始
     * 将素材信息存入 dataTransfer，供画布接收
     */
    const handleDragStart = (e: React.DragEvent, item: AssetItem) => {
        // 使用特殊标记 __makingAsset 来识别这是从灵感库拖出的素材
        e.dataTransfer.setData('text/plain', JSON.stringify({ __makingAsset: true, item }));
        e.dataTransfer.effectAllowed = 'copy';  // 设置为复制模式
    };

    /**
     * 【方法】双击素材名称
     * 进入重命名编辑模式
     */
    const handleDoubleClick = (item: AssetItem) => {
        setEditingId(item.id);
        setEditingName(item.name || '');
    };

    /**
     * 【方法】保存重命名
     * 验证名称后通知父组件更新
     */
    const handleSaveEdit = (itemId: string) => {
        if (editingId === itemId && editingName.trim()) {
            onRename(category, itemId, editingName.trim());
        }
        setEditingId(null);
        setEditingName('');
    };

    /**
     * 【方法】重命名输入框键盘事件
     * Enter: 保存, Escape: 取消
     */
    const handleKeyDown = (e: React.KeyboardEvent, itemId: string) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSaveEdit(itemId);
        } else if (e.key === 'Escape') {
            setEditingId(null);
            setEditingName('');
        }
    };

    /**
     * 【方法】AI生成素材
     * 将提示词传递给父组件，清空输入框
     */
    const handleGenerate = () => {
        if (prompt.trim()) {
            onGenerate(prompt.trim());
            setPrompt('');
        }
    };

    // 获取当前分类的素材列表
    const items = library[category];

    // ============ 渲染逻辑 ============

    /**
     * 【渲染模式 1】最小化按钮
     * 面板收起时只显示一个小图标按钮
     */
    if (isMinimized) {
        return (
            <button
                onClick={onToggleMinimize}
                className="isl-icon-btn theme-aware fixed top-4 right-4 z-20 flex h-12 w-12 items-center justify-center"
                title="打开灵感库"
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 3v18" />
                </svg>
            </button>
        );
    }

    /**
     * 【渲染模式 2】展开面板
     * 完整的灵感库界面，包含：
     * - 左侧调整手柄
     * - 顶部标题栏和分类Tab
     * - AI生成输入区
     * - 素材列表（瀑布流布局）
     */
    return (
        <div
            ref={panelRef}
            className="isl-panel theme-aware fixed top-4 bottom-4 right-4 z-20 overflow-hidden flex flex-col"
            style={{ width: `${panelWidth}px` }}
        >
            {/* Resize handle (left edge) */}
            <div
                className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize transition-colors z-10 group"
                onPointerDown={handleResizePointerDown}
            >
                <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-12 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'var(--isl-border-strong)' }} />
            </div>

            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--isl-border)' }}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <strong className="text-sm shrink-0" style={{ color: 'var(--isl-ink)' }}>灵感库</strong>
                    <CategoryTabs value={category} onChange={setCategory} />
                </div>
                <button
                    onClick={onToggleMinimize}
                    className="isl-icon-btn h-9 w-9 shrink-0"
                    title="最小化"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M19 12H5" />
                    </svg>
                </button>
            </div>

            {/* Generate input */}
            <div className="flex-shrink-0 p-3 border-b" style={{ borderColor: 'var(--isl-border)' }}>
                <div className="flex items-center gap-2">
                    <input
                        ref={promptInputRef}
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleGenerate();
                        }}
                        placeholder="描述你想要生成的图片..."
                        className="isl-well flex-1 px-3 py-2 text-sm outline-none"
                    />
                    <button
                        onClick={handleGenerate}
                        disabled={!prompt.trim()}
                        className="isl-go h-auto shrink-0 px-4 py-2 text-sm"
                    >
                        生成
                    </button>
                </div>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-3">
                {items.length === 0 ? (
                    <div className="text-center text-sm py-10" style={{ color: 'var(--isl-ink-soft)' }}>
                        该分类暂无素材<br />选中图片后使用"加入灵感库"按钮添加
                    </div>
                ) : (
                    <div className="columns-2 gap-3">
                        {items.map(item => (
                            <div
                                key={item.id}
                                className="isl-elastic group inline-block w-full mb-3 break-inside-avoid rounded-2xl border-[1.5px] overflow-hidden cursor-grab active:cursor-grabbing relative"
                                style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-2)' }}
                                draggable
                                onDragStart={(e) => handleDragStart(e, item)}
                            >
                                <img src={item.dataUrl} alt={item.name || ''} className="w-full h-auto object-contain" style={{ background: 'var(--isl-surface-2)' }} />

                                {/* Hover overlay */}
                                {editingId === item.id ? (
                                    <div className="absolute inset-x-2 bottom-2 flex items-center gap-2">
                                        <input
                                            ref={editInputRef}
                                            type="text"
                                            value={editingName}
                                            onChange={(e) => setEditingName(e.target.value)}
                                            onBlur={() => handleSaveEdit(item.id)}
                                            onKeyDown={(e) => handleKeyDown(e, item.id)}
                                            className="isl-well text-xs px-2 py-1 outline-none min-w-0 flex-1"
                                            placeholder="输入素材名称"
                                            aria-label="素材名称"
                                        />
                                    </div>
                                ) : (
                                    <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
                                        <div className="absolute bottom-2 left-2 right-2 text-white flex items-end justify-between gap-2">
                                            <div className="min-w-0 pointer-events-auto cursor-text" onDoubleClick={() => handleDoubleClick(item)}>
                                                <div className="text-[13px] font-medium truncate">{item.name || '未命名'}</div>
                                                <div className="text-[11px] opacity-80">{item.width}×{item.height}</div>
                                            </div>
                                            <button
                                                className="pointer-events-auto p-1.5 rounded-lg bg-white/10 hover:bg-white/20 backdrop-blur transition-colors"
                                                title="删除"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRemove(category, item.id);
                                                }}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white">
                                                    <polyline points="3 6 5 6 21 6" />
                                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                                    <path d="M10 11v6" />
                                                    <path d="M14 11v6" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

