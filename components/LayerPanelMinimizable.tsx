/**
 * ============================================
 * 图层面板组件 (Layer Panel Minimizable)
 * ============================================
 * 
 * 【组件职责】
 * 管理画布上的所有图层（元素），提供可视化的图层操作界面
 * 
 * 【核心功能】
 * 1. 图层列表展示：显示所有画布元素的层级关系
 * 2. 可见性控制：显示/隐藏图层
 * 3. 锁定保护：锁定图层防止误操作
 * 4. 重命名功能：双击图层名称进行重命名
 * 5. 拖拽排序：调整图层的层级顺序（Z-index）
 * 6. 选中状态：高亮显示当前选中的图层
 * 7. 图标识别：为不同类型的元素显示对应图标
 * 8. 最小化动画：类似"传送门"的展开/收起效果
 * 
 * 【设计模式】
 * - 受控组件：所有状态由父组件管理
 * - 递归渲染：支持嵌套的父子图层关系
 * - 拖拽排序：使用原生 HTML5 Drag API
 * 
 * 【交互逻辑】
 * - 单击图层：选中该图层
 * - 双击名称：进入重命名模式
 * - 悬停显示：显示锁定和可见性按钮
 * - 拖拽图层：调整层级顺序
 * - 点击按钮：切换锁定/可见性状态
 * 
 * 【动画效果】
 * - 使用 scaleX 实现"传送门"展开效果
 * - transformOrigin 设为左侧，从左边展开
 * - 配合 opacity 实现平滑过渡
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { Element } from '../types';

/**
 * 【Props 接口定义】
 */
interface LayerPanelMinimizableProps {
    isMinimized: boolean;                // 是否最小化状态
    onToggleMinimize: () => void;        // 切换最小化/展开的回调
    elements: Element[];                 // 所有画布元素数组
    selectedElementIds: string[];        // 当前选中的元素ID列表
    onSelectElement: (id: string | null) => void;           // 选中图层的回调
    onToggleVisibility: (id: string) => void;               // 切换可见性的回调
    onToggleLock: (id: string) => void;                     // 切换锁定状态的回调
    onRenameElement: (id: string, name: string) => void;    // 重命名图层的回调
    onReorder: (draggedId: string, targetId: string, position: 'before' | 'after') => void;  // 拖拽排序的回调
}

/**
 * 【工具函数】获取元素类型对应的图标
 * 
 * 根据元素类型返回相应的 SVG 图标
 * 
 * @param {Element} element - 元素对象
 * @returns {React.ReactNode} SVG 图标组件
 * 
 * 【支持的元素类型】
 * - image: 图片图标
 * - video: 视频图标
 * - text: 文本图标
 * - shape: 形状图标（矩形、圆形、三角形）
 * - group: 分组图标
 * - path: 路径/画笔图标
 * - arrow: 箭头图标
 * - line: 直线图标
 */
const getElementIcon = (element: Element): React.ReactNode => {
    const commonProps = {
        width: "16",
        height: "16",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
    };

    switch (element.type) {
        case 'image':
            return <svg {...commonProps}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>;
        case 'video':
            return <svg {...commonProps}><path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" ry="2" /></svg>;
        case 'text':
            return <svg {...commonProps}><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>;
        case 'shape':
            switch (element.shapeType) {
                case 'rectangle': return <svg {...commonProps}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>;
                case 'circle': return <svg {...commonProps}><circle cx="12" cy="12" r="10" /></svg>;
                case 'triangle': return <svg {...commonProps}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>;
            }
            break;
        case 'group':
            return <svg {...commonProps}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>;
        case 'path':
            return <svg {...commonProps}><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>;
        case 'arrow':
            return <svg {...commonProps}><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>;
        case 'line':
            return <svg {...commonProps}><line x1="5" y1="19" x2="19" y2="5"></line></svg>;
        default:
            return <svg {...commonProps}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>;
    }
    return <svg {...commonProps}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>;
};

/**
 * 【子组件】单个图层项 (LayerItem)
 * 
 * 渲染单个图层行，包含图标、名称、锁定和可见性按钮
 * 
 * 【功能】
 * - 显示图层图标和名称
 * - 支持双击重命名
 * - 显示/隐藏、锁定/解锁按钮
 * - 选中状态高亮
 * - 支持拖拽排序
 * - 根据层级缩进显示
 */
const LayerItem: React.FC<{
    element: Element;               // 图层元素对象
    level: number;                  // 嵌套层级（用于缩进）
    isSelected: boolean;            // 是否被选中
    onSelect: () => void;           // 选中回调
    onToggleVisibility: () => void; // 切换可见性回调
    onToggleLock: () => void;       // 切换锁定回调
    onRename: (name: string) => void;  // 重命名回调
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;   // 拖拽开始
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;    // 拖拽经过
    onDrop: (e: React.DragEvent<HTMLDivElement>) => void;        // 拖拽放下
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;   // 拖拽离开
}> = ({ element, level, isSelected, onSelect, onToggleVisibility, onToggleLock, onRename, ...dragProps }) => {
    
    // ============ 状态管理 ============
    const [isEditing, setIsEditing] = useState(false);          // 是否处于编辑模式
    const [name, setName] = useState(element.name || element.type);  // 图层名称
    const inputRef = useRef<HTMLInputElement>(null);            // 输入框引用

    // ============ 副作用 ============
    
    /**
     * 【Effect 1】同步图层名称
     * 当元素名称或类型变化时，更新本地状态
     */
    useEffect(() => {
        setName(element.name || element.type);
    }, [element.name, element.type]);

    /**
     * 【Effect 2】自动聚焦输入框
     * 进入编辑模式时，自动聚焦并选中文本
     */
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    // ============ 事件处理 ============
    
    /**
     * 【方法】完成重命名
     * 失去焦点时保存新名称，如果为空则恢复原名称
     */
    const handleBlur = () => {
        setIsEditing(false);
        if (name.trim() === '') {
            setName(element.name || element.type);  // 恢复原名称
        } else {
            onRename(name);  // 保存新名称
        }
    };

    const iconProps = {
        width: 16, height: 16, viewBox: "0 0 24 24", fill: "none",
        stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round" as const, strokeLinejoin: "round" as const
    };

    return (
        <div
            draggable
            {...dragProps}
            onClick={onSelect}
            onDoubleClick={() => setIsEditing(true)}
            className={`isl-layer-row group flex items-center space-x-2 rounded-2xl border-[1.5px] border-transparent p-1.5 text-sm ${isSelected ? 'isl-row--active' : ''
                } ${element.isVisible === false ? 'opacity-50' : ''}`}
            style={isSelected ? { paddingLeft: `${10 + level * 20}px` } : { paddingLeft: `${10 + level * 20}px`, color: 'var(--isl-ink)' }}
        >
            <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center" style={{ color: isSelected ? '#fff' : 'var(--isl-ink-ghost)' }}>{getElementIcon(element)}</span>
            {isEditing ? (
                <input
                    ref={inputRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={handleBlur}
                    onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
                    className="flex-grow bg-transparent border-b border-current/40 outline-none"
                    onClick={e => e.stopPropagation()}
                    placeholder="图层名称"
                    aria-label="图层名称"
                />
            ) : (
                <span className="flex-grow truncate text-xs font-semibold">{name}</span>
            )}
            <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
                    className="isl-icon-btn h-6 w-6"
                    title={element.isLocked ? "Unlock" : "Lock"}
                >
                    {element.isLocked ?
                        <svg {...iconProps}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> :
                        <svg {...iconProps}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
                    }
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
                    className="isl-icon-btn h-6 w-6"
                    title={element.isVisible === false ? "Show" : "Hide"}
                >
                    {element.isVisible === false ?
                        <svg {...iconProps}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg> :
                        <svg {...iconProps}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    }
                </button>
            </div>
        </div>
    );
};

/**
 * 【主组件】图层面板 (LayerPanelMinimizable)
 */
export const LayerPanelMinimizable: React.FC<LayerPanelMinimizableProps> = ({
    isMinimized,
    onToggleMinimize,
    elements,
    selectedElementIds,
    onSelectElement,
    onToggleVisibility,
    onToggleLock,
    onRenameElement,
    onReorder
}) => {
    // ============ 引用和状态 ============
    const panelRef = useRef<HTMLDivElement>(null);                    // 面板DOM引用
    const [dragOverId, setDragOverId] = useState<string | null>(null); // 当前拖拽悬停的图层ID

    // ============ 拖拽排序事件处理 ============
    
    /**
     * 【方法】拖拽开始
     * 将被拖拽图层的ID存入 dataTransfer
     */
    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';  // 设置为移动模式
    };

    /**
     * 【方法】拖拽经过
     * 显示拖拽目标区域的高亮效果
     */
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();  // 阻止默认行为，允许放下
        const target = e.currentTarget;
        const id = target.getAttribute('data-id');
        setDragOverId(id);
        target.style.background = 'var(--isl-mint-bg)';  // 高亮显示
    };

    /**
     * 【方法】拖拽离开
     * 移除高亮效果
     */
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.currentTarget.style.background = '';
        setDragOverId(null);
    };

    /**
     * 【方法】放下图层
     * 
     * 根据鼠标位置判断插入位置（before/after），然后调用排序回调
     * 
     * 【实现逻辑】
     * 1. 获取被拖拽的图层ID和目标图层ID
     * 2. 计算鼠标相对于目标图层的位置
     * 3. 如果在上半部分，插入到目标之前（before）
     * 4. 如果在下半部分，插入到目标之后（after）
     * 5. 通知父组件重新排序
     */
    const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
        e.preventDefault();
        e.currentTarget.style.background = '';
        setDragOverId(null);
        
        const draggedId = e.dataTransfer.getData('text/plain');  // 获取被拖拽的图层ID

        // 计算插入位置：根据鼠标在目标元素的上半部分还是下半部分
        const rect = e.currentTarget.getBoundingClientRect();
        const position = e.clientY - rect.top > rect.height / 2 ? 'after' : 'before';

        // 如果拖拽的不是自己，则执行排序
        if (draggedId && targetId && draggedId !== targetId) {
            onReorder(draggedId, targetId, position);
        }
    };

    // ============ 性能优化 ============
    
    /**
     * 【useMemo】创建元素映射表
     * 方便通过ID快速查找元素（虽然这里暂未使用，但预留给未来优化）
     */
    const elementMap = useMemo(() => new Map(elements.map(el => [el.id, el])), [elements]);

    /**
     * 【方法】递归渲染图层列表
     * 
     * 支持嵌套的父子关系，递归渲染所有图层
     * 
     * @param {Element[]} elements - 所有元素数组
     * @param {number} level - 当前嵌套层级（用于缩进）
     * @param {string} parentId - 父元素ID（用于筛选子元素）
     * @returns {React.ReactNode} 渲染的图层列表
     * 
     * 【实现逻辑】
     * 1. 筛选出属于当前 parentId 的元素
     * 2. 为每个元素渲染 LayerItem 组件
     * 3. 递归渲染该元素的子元素（level + 1）
     * 4. 通过 level 计算缩进距离
     */
    const renderOrderedLayers = (elements: Element[], level: number = 0, parentId?: string) => {
        return elements
            .filter(el => el.parentId === parentId)  // 筛选出当前层级的元素
            .map(element => (
                <React.Fragment key={element.id}>
                    {/* 拖拽容器 - 监听拖拽事件 */}
                    <div data-id={element.id} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, element.id)}>
                        <LayerItem
                            element={element}
                            level={level}
                            isSelected={selectedElementIds.includes(element.id)}
                            onSelect={() => onSelectElement(element.id)}
                            onToggleLock={() => onToggleLock(element.id)}
                            onToggleVisibility={() => onToggleVisibility(element.id)}
                            onRename={name => onRenameElement(element.id, name)}
                            onDragStart={e => handleDragStart(e, element.id)}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, element.id)}
                        />
                    </div>
                    {/* 递归渲染子元素 */}
                    {renderOrderedLayers(elements, level + 1, element.id)}
                </React.Fragment>
            ));
    };

    // ============ 渲染 ============
    
    /**
     * 【渲染】面板主体
     * 
     * 使用 "传送门" 动画效果：
     * - 最小化时：scaleX(0.005) 缩小到极细的一条线
     * - 展开时：scaleX(1) 恢复正常宽度
     * - transformOrigin: 'left center' 从左侧展开
     * - 配合 opacity 实现平滑过渡
     * 
     * 类似 Lovart 的侧边栏展开效果
     */
    return (
        <div
            ref={panelRef}
            style={{
                left: '16px',           // 固定在左侧
                width: '256px',         // 固定宽度
                transform: isMinimized ? 'scaleX(0.005)' : 'scaleX(1)',  // 缩放动画
                transformOrigin: 'left center',  // 从左边展开
                opacity: isMinimized ? 0 : 1,    // 透明度过渡
                transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease-out',
                pointerEvents: isMinimized ? 'none' : 'auto',  // 最小化时禁用交互
            }}
            className="isl-panel theme-aware fixed top-4 bottom-4 z-20 overflow-hidden flex flex-col"
        >
            {/* 顶部标题栏 - 包含最小化按钮 */}
            <div className="flex-shrink-0 flex justify-between items-center px-3 py-2 border-b" style={{ borderColor: 'var(--isl-border)' }}>
                <h3 className="text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>图层</h3>
                <button
                    onClick={onToggleMinimize}
                    className="isl-icon-btn h-9 w-9"
                    title="最小化"
                    aria-label="最小化"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                        <path d="M19 12H5" />
                    </svg>
                </button>
            </div>

            {/* 图层列表区域 - 可滚动 */}
            <div className="flex-grow p-2 overflow-y-auto">
                {/* 
                    反转数组顺序显示：
                    - 画布上层级高的元素（后添加的）显示在列表顶部
                    - 符合图层面板的常见设计习惯
                */}
                {renderOrderedLayers([...elements].reverse())}
            </div>
        </div>
    );
};

