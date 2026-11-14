// Resolve the shared CLI modules from both the repository layout and the
// published flovart-cli layout. The agent code remains one implementation;
// only the package boundary changes the relative location.
export async function importFlovartModule(name) {
  const moduleName = String(name || '').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(moduleName)) throw new Error('Invalid Flovart module name.');
  try {
    return await import(`../tools/flovart/${moduleName}.js`);
  } catch {
    return import(`../${moduleName}.js`);
  }
}

// Agent 视频流水线模块在 pipeline/ 子目录；单独的模板让打包器能静态解析一层子目录。
export async function importFlovartPipelineModule(name) {
  const moduleName = String(name || '').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(moduleName)) throw new Error('Invalid Flovart pipeline module name.');
  try {
    return await import(`../tools/flovart/pipeline/${moduleName}.js`);
  } catch {
    return import(`../pipeline/${moduleName}.js`);
  }
}
