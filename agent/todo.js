// 2026-11-20：Agent「执行计划」（任务清单）功能已整体移除。
// 只保留旧工具名 flovart_todo 作为弃用的无操作别名：旧会话 / 旧外部调用方再调用时直接返回 ok，不报错。
// 不提供 iris_todo；系统提示词也不再要求模型维护清单。
import { Type } from 'typebox';

export const LEGACY_TODO_TOOL_NAME = 'flovart_todo';

export function createLegacyTodoTool() {
  return {
    name: LEGACY_TODO_TOOL_NAME,
    label: '已弃用',
    description: '[已弃用，无操作] 旧版任务清单工具，调用直接返回 ok:true，不记录任何内容。不要使用。',
    parameters: Type.Object({}, { additionalProperties: true }),
    executionMode: 'sequential',
    async execute() {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, deprecated: true, message: 'flovart_todo 已移除（无操作）。' }) }],
        details: { command: 'todo', deprecated: true },
      };
    },
  };
}
