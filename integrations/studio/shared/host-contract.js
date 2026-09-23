(function (global) {
  function resourceFor(selection) {
    return {
      resourceId: `creative-host:${selection.host}:${selection.selectionId}`,
      title: selection.label,
      kind: selection.kind,
      locator: { kind: 'creative-host', host: selection.host, locator: selection.locator },
      mimeType: selection.mimeType,
    };
  }

  function referenceFor(selection, resource) {
    return {
      id: `${resource.resourceId}:reference`,
      resourceId: resource.resourceId,
      resourceOrigin: 'creative-host',
      sourceId: selection.selectionId,
      kind: selection.kind,
      source: 'manual',
      role: 'reference',
    };
  }

  function materialized(selection, value) {
    const details = value && typeof value === 'object' && !(value instanceof Blob) ? value : { blob: value };
    const blob = details.blob;
    const resourceSelection = {
      ...selection,
      ...(details.kind ? { kind: details.kind } : {}),
      ...(details.mimeType ? { mimeType: details.mimeType } : blob?.type ? { mimeType: blob.type } : {}),
    };
    const resource = resourceFor(resourceSelection);
    return { selection, resource, reference: referenceFor(resourceSelection, resource), ...(blob ? { blob } : {}) };
  }

  function unavailable(message) {
    const error = new Error(message);
    error.code = 'HOST_CONTEXT_UNAVAILABLE';
    error.retryable = true;
    throw error;
  }

  function nativeModule(options, key, moduleName, label) {
    if (options && options[key]) return options[key];
    if (typeof global.require === 'function') {
      try { return global.require(moduleName); } catch { unavailable(`${label} 宿主 API 不可用。`); }
    }
    unavailable(`${label} 宿主 API 不可用。`);
  }

  function createPhotoshopAdapter(options = {}) {
    const photoshop = nativeModule(options, 'photoshop', 'photoshop', 'Photoshop');
    const app = options.app || photoshop.app;
    const activeDocument = () => app.activeDocument || null;
    const activeLayer = () => activeDocument()?.activeLayers?.[0] || null;
    return {
      id: 'photoshop',
      async getContext() {
        const document = activeDocument();
        return {
          host: 'photoshop',
          available: Boolean(document),
          ...(document ? { documentId: String(document.id), documentName: document.name || document.title, title: document.title || document.name } : {}),
        };
      },
      async getSelection() {
        const document = activeDocument();
        const layer = activeLayer();
        if (!document || !layer) return null;
        const bounds = layer.bounds || {};
        return {
          host: 'photoshop',
          selectionId: String(layer.id),
          label: layer.name || `Layer ${layer.id}`,
          kind: 'image',
          locator: { documentId: String(document.id), layerId: Number(layer.id) },
          mimeType: 'image/png',
          ...(Number.isFinite(bounds.right - bounds.left) ? { width: bounds.right - bounds.left } : {}),
          ...(Number.isFinite(bounds.bottom - bounds.top) ? { height: bounds.bottom - bounds.top } : {}),
        };
      },
      async materializeSelection(selection) {
        const layer = activeLayer();
        const document = activeDocument();
        if (!layer || !document || String(document.id) !== String(selection.locator.documentId) || String(layer.id) !== String(selection.locator.layerId)) {
          unavailable('Photoshop 当前选择已变化，请重新选择图层。');
        }
        if (typeof options.exportLayer !== 'function') unavailable('Photoshop 图层导出适配器尚未由 Flovart Link 注入。');
        return materialized(selection, await options.exportLayer({ document, layer, selection }));
      },
      async importArtifact(artifact, target) {
        if (typeof options.importArtifact !== 'function') unavailable('Photoshop 产物导入适配器尚未由 Flovart Link 注入。');
        return options.importArtifact({ app, artifact, target });
      },
      subscribeContext(listener) {
        const timer = global.setInterval(async () => listener(await this.getContext()), 500);
        return { dispose: () => global.clearInterval(timer) };
      },
    };
  }

  function createPremiereAdapter(options = {}) {
    const premiere = nativeModule(options, 'premiere', 'premierepro', 'Premiere');
    const projectApi = options.projectApi || premiere.Project;
    const utils = options.projectUtils || premiere.ProjectUtils;
    let activeProject = null;
    let activeSelection = null;
    async function project() {
      activeProject = await projectApi.getActiveProject();
      return activeProject;
    }
    return {
      id: 'premiere',
      async getContext() {
        const current = await project();
        return {
          host: 'premiere',
          available: Boolean(current),
          ...(current ? { documentId: String(current.guid), documentName: current.name, projectId: String(current.guid), title: current.name } : {}),
        };
      },
      async getSelection() {
        const current = await project();
        if (!current || !utils?.getSelection) return null;
        const selection = await utils.getSelection(current);
        const items = selection?.getItems ? await selection.getItems() : [];
        const item = items?.[0];
        if (!item) return null;
        const id = item.getId ? item.getId() : item.id;
        return {
          host: 'premiere',
          selectionId: String(id),
          label: item.name || `Clip ${id}`,
          kind: 'video',
          locator: { projectId: String(current.guid), projectItemId: String(id) },
          mimeType: 'video/mp4',
        };
      },
      async materializeSelection(selection) {
        activeSelection = selection;
        if (typeof options.materializeClip !== 'function') unavailable('Premiere 当前帧物化适配器尚未由 Flovart Link 注入。');
        return materialized(selection, await options.materializeClip({ project: activeProject, selection }));
      },
      async importArtifact(artifact, target) {
        if (typeof options.importArtifact !== 'function') unavailable('Premiere 产物导入适配器尚未由 Flovart Link 注入。');
        return options.importArtifact({ project: activeProject, artifact, target });
      },
      subscribeContext(listener) {
        const timer = global.setInterval(async () => listener(await this.getContext()), 700);
        return { dispose: () => global.clearInterval(timer) };
      },
      get lastSelection() { return activeSelection; },
    };
  }

  function injectedBridge(options, globalKey, label) {
    const bridge = options?.bridge || global[globalKey];
    if (!bridge || typeof bridge !== 'object') unavailable(`${label} Link bridge 尚未注入。`);
    return bridge;
  }

  function normalizeContext(id, value) {
    return {
      ...(value && typeof value === 'object' ? value : {}),
      host: id,
      available: Boolean(value?.available),
    };
  }

  function normalizeSelection(id, value, defaultKind) {
    if (!value) return null;
    const selectionId = String(value.selectionId ?? value.id ?? '');
    if (!selectionId) unavailable(`${id} 当前选择缺少稳定身份，请刷新宿主选择。`);
    return {
      ...value,
      host: id,
      selectionId,
      label: value.label || `${id} selection ${selectionId}`,
      kind: value.kind === 'image' || value.kind === 'video' ? value.kind : defaultKind,
      locator: value.locator && typeof value.locator === 'object' ? value.locator : { selectionId },
    };
  }

  function locatorKey(locator) {
    return JSON.stringify(Object.entries(locator || {}).sort(([left], [right]) => left.localeCompare(right)));
  }

  function bridgeAdapter({ id, label, defaultKind, globalKey, options, materializeKey, defaultImportTarget }) {
    const getBridge = () => injectedBridge(options, globalKey, label);
    const call = async (method, ...args) => {
      const bridge = getBridge();
      if (typeof bridge[method] !== 'function') unavailable(`${label} Link bridge 缺少 ${method} 能力。`);
      return bridge[method](...args);
    };
    let lastSelection = null;
    const adapter = {
      id,
      async getContext() {
        return normalizeContext(id, await call('getContext'));
      },
      async getSelection() {
        const context = await adapter.getContext();
        if (!context.available) return null;
        const selection = normalizeSelection(id, await call('getSelection'), defaultKind);
        lastSelection = selection;
        return selection;
      },
      async materializeSelection(selection) {
        const current = await adapter.getSelection();
        if (!current || current.selectionId !== selection.selectionId || locatorKey(current.locator) !== locatorKey(selection.locator)) {
          unavailable(`${label} 当前选择已变化，请重新选择素材。`);
        }
        const bridge = getBridge();
        const materializer = bridge[materializeKey] || bridge.materializeSelection;
        if (typeof materializer !== 'function') unavailable(`${label} 物化适配器尚未由 Flovart Link 注入。`);
        return materialized(selection, await materializer.call(bridge, { selection, target: defaultImportTarget }));
      },
      async importArtifact(artifact, target = defaultImportTarget) {
        const result = await call('importArtifact', { artifact, target });
        return result || { ok: true, message: `${label} 已接收 Flovart 产物。` };
      },
      get lastSelection() { return lastSelection; },
      subscribeContext(listener) {
        const bridge = getBridge();
        if (typeof bridge.subscribeContext === 'function') return bridge.subscribeContext(listener);
        const timer = global.setInterval(async () => listener(await adapter.getContext()), 700);
        return { dispose: () => global.clearInterval(timer) };
      },
    };
    if (id === 'after-effects') {
      adapter.listNativeCandidates = async documentId => {
        const value = await call('listNativeCandidates', documentId);
        if (!Array.isArray(value)) return [];
        return value.map(candidate => ({
          ...candidate,
          candidateLayerId: String(candidate?.candidateLayerId || ''),
          artifactId: String(candidate?.artifactId || ''),
          sha256: String(candidate?.sha256 || ''),
          mediaAvailable: typeof candidate?.mediaAvailable === 'boolean' ? candidate.mediaAvailable : undefined,
          ...(candidate?.sourceSelection ? {
            sourceSelection: normalizeSelection(id, candidate.sourceSelection, defaultKind),
          } : { sourceSelection: null }),
        })).filter(candidate => candidate.candidateLayerId && candidate.artifactId && /^[a-f0-9]{64}$/i.test(candidate.sha256));
      };
      adapter.applyNativeEffect = request => call('applyNativeEffect', request);
    }
    return adapter;
  }

  function createAfterEffectsAdapter(options = {}) {
    return bridgeAdapter({
      id: 'after-effects',
      label: 'After Effects',
      defaultKind: 'image',
      globalKey: '__FLOVART_AFTER_EFFECTS_BRIDGE__',
      options,
      materializeKey: 'materializeLayer',
      defaultImportTarget: { kind: 'new-layer' },
    });
  }

  function createResolveAdapter(options = {}) {
    return bridgeAdapter({
      id: 'resolve',
      label: 'DaVinci Resolve Studio',
      defaultKind: 'video',
      globalKey: '__FLOVART_RESOLVE_BRIDGE__',
      options,
      materializeKey: 'materializeClip',
      defaultImportTarget: { kind: 'media-pool' },
    });
  }

  function createBrowserWorkspaceAdapter(options = {}) {
    // Panels running on Flovart's own Browser Workflow surface bind to the live
    // project getter injected by installStudioBrowserLink — a function, not a
    // state copy — so target/selection resolve through the workflow store at
    // call time and never fork a second authority.
    const workspace = () => {
      const api = options.workspace || global.__FLOVART_BROWSER_WORKSPACE__;
      if (!api || typeof api.getActiveProject !== 'function') unavailable('Flovart Browser Workflow 尚未注入工作区连接。');
      return api;
    };
    const projectOf = () => workspace().getActiveProject() || null;
    const selectionFromProject = project => {
      if (!project || !Array.isArray(project.nodes)) return null;
      const selectedIds = Array.isArray(project.selectedNodeIds) ? project.selectedNodeIds : [];
      const node = project.nodes.find(item => selectedIds.includes(item.id)) || null;
      if (!node) return null;
      return {
        host: 'browser-workspace',
        selectionId: String(node.id),
        label: node.title || String(node.id),
        kind: node.type === 'video' ? 'video' : 'image',
        locator: { projectId: String(project.id), nodeId: String(node.id) },
        mimeType: node.metadata && node.metadata.mimeType,
        width: node.metadata && node.metadata.naturalWidth,
        height: node.metadata && node.metadata.naturalHeight,
        ...(node.metadata && Number.isFinite(node.metadata.durationMs) ? { durationMs: node.metadata.durationMs } : {}),
      };
    };
    return {
      id: 'browser-workspace',
      async getContext() {
        const project = projectOf();
        return {
          host: 'browser-workspace',
          available: Boolean(project),
          ...(project ? { projectId: project.id, documentId: project.id, documentName: project.title, title: project.title } : {}),
        };
      },
      async getSelection() {
        const project = projectOf();
        if (!project) return null;
        return selectionFromProject(project);
      },
      async materializeSelection(selection) {
        const current = selectionFromProject(projectOf());
        if (!current || current.selectionId !== selection.selectionId || locatorKey(current.locator) !== locatorKey(selection.locator)) {
          unavailable('Flovart 画布当前选择已变化，请重新选择节点。');
        }
        const materializer = options.materializeSelection || workspace().materializeSelection;
        if (typeof materializer !== 'function') unavailable('画布节点物化适配器尚未注入。');
        return materialized(selection, await materializer({ selection }));
      },
      async importArtifact(artifact, target = { kind: 'new-layer' }) {
        const importer = options.importArtifact || workspace().importArtifact;
        if (typeof importer !== 'function') unavailable('画布产物回写适配器尚未注入。');
        const result = await importer({ artifact, target });
        return result || { ok: true, message: '已添加新结果。' };
      },
      subscribeContext(listener) {
        const api = workspace();
        if (typeof api.subscribeContext === 'function') return api.subscribeContext(listener);
        const timer = global.setInterval(async () => listener(await this.getContext()), 500);
        return { dispose: () => global.clearInterval(timer) };
      },
    };
  }

  global.FlovartStudioHosts = {
    createPhotoshopAdapter,
    createPremiereAdapter,
    createAfterEffectsAdapter,
    createResolveAdapter,
    createBrowserWorkspaceAdapter,
    materialized,
    resourceFor,
    referenceFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
