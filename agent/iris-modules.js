// Resolve the shared CLI modules from both the repository layout and the
// published iris-cli layout. The agent code remains one implementation;
// only the package boundary changes the relative location.
export async function importIrisModule(name) {
  const moduleName = String(name || '').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(moduleName)) throw new Error('Invalid Iris module name.');
  try {
    return await import(`../tools/iris/${moduleName}.js`);
  } catch {
    return import(`../${moduleName}.js`);
  }
}

// Agent 视频流水线模块在 pipeline/ 子目录；单独的模板让打包器能静态解析一层子目录。
export async function importIrisPipelineModule(name) {
  const moduleName = String(name || '').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(moduleName)) throw new Error('Invalid Iris pipeline module name.');
  try {
    return await import(`../tools/iris/pipeline/${moduleName}.js`);
  } catch {
    return import(`../pipeline/${moduleName}.js`);
  }
}
