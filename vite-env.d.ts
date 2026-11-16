/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  readonly VITE_APP_COMMIT_SHA?: string;
  /** 'off' 关闭 Web 端 LLM 同源代理（如纯静态 GitHub Pages 部署）。 */
  readonly VITE_LLM_PROXY?: string;
  // 逗号分隔的 Flovart 浏览器插件 ID（商店 ID 与本地旁加载 ID 可同时填写）。
  readonly VITE_FLOVART_EXTENSION_IDS?: string;
  /** 点选主体模型仓库根地址（默认 https://huggingface.co/；大陆可用 https://hf-mirror.com/ 或自托管）。 */
  readonly VITE_SEGMENTATION_MODEL_BASE_URL?: string;
  /** onnxruntime-web wasm 文件目录（默认 jsDelivr CDN）。 */
  readonly VITE_SEGMENTATION_WASM_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.md?raw' {
  const content: string;
  export default content;
}

declare module '*.json?raw' {
  const content: string;
  export default content;
}

declare module '*.svg?raw' {
  const content: string;
  export default content;
}

declare const chrome: any;
