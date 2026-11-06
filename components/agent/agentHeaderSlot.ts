import { createContext, type ReactNode } from 'react';

/** Agent 侧栏注入到对话顶栏最左侧的内容（Logo 页面菜单）。未提供时为 null。 */
export const AgentHeaderLeadingContext = createContext<ReactNode>(null);
