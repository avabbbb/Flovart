(function (global) {
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text, className, action) {
    const node = el('button', text, className);
    node.type = 'button';
    if (action) node.addEventListener('click', action);
    return node;
  }
  function option(label, value) { const node = el('option', label); node.value = value; return node; }

  // The real UXP/CEP packages and the browser preview mount this same UI.
  function mountInspector({ root, adapter, controller, getController, hostLabel, onOpenCanvas, defaultImportTarget = { kind: 'new-layer' }, preview = false }) {
    root.replaceChildren();
    root.className = 'flovart-studio-inspector';
    let disposed = false, busy = false, reading = false, lastSelection = null, activeTab = 'make', activeDocumentId = null, taskStart = 0, taskTimer = null, linkedModels = false, applyingCandidateId = null, lastNativeCandidate = null, loadingCandidates = false;
    const history = [];
    const knownCandidateIds = new Set();
    const loadedCandidateDocuments = new Set();
    const candidateKey = (documentId, layerId) => `${String(documentId)}:${String(layerId)}`;
    function candidateMetadataText(item) {
      const media = item?.sourceMedia;
      const color = item?.projectColorContext;
      if (!media && !color) return '';
      const details = [];
      if (Number.isFinite(media?.width) && Number.isFinite(media?.height)) {
        details.push(`${Math.round(media.width)} × ${Math.round(media.height)}`);
      }
      const frameRate = media?.displayFrameRate || media?.frameRate || media?.nativeFrameRate;
      if (media?.isStill !== true && Number.isFinite(frameRate) && frameRate > 0) details.push(`${Number(frameRate.toFixed(3))} fps`);
      if (Number.isFinite(media?.durationSeconds) && media.durationSeconds > 0) {
        details.push(`${Number(media.durationSeconds.toFixed(2))} 秒`);
      }
      if (Number.isFinite(media?.pixelAspectRatio) && media.pixelAspectRatio > 0) {
        details.push(`PAR ${Number(media.pixelAspectRatio.toFixed(4))}`);
      }
      if (media?.hasAlpha === true) {
        const alphaModes = { ignore: '忽略', straight: '直通', premultiplied: '预乘', unknown: '未知' };
        details.push(`Alpha ${alphaModes[media.alphaMode] || '已检测'}`);
      } else if (media?.hasAlpha === false) details.push('无 Alpha');
      if (color && typeof color.workingSpace === 'string') {
        details.push(`项目色彩 ${color.workingSpace || '关闭'}`);
      }
      if (Number.isFinite(color?.workingGamma) && color.workingGamma > 0) {
        details.push(`Gamma ${Number(color.workingGamma.toFixed(3))}`);
      }
      if (Number.isFinite(color?.bitsPerChannel)) details.push(`${color.bitsPerChannel} bpc`);
      if (typeof color?.linearizeWorkingSpace === 'boolean') details.push(color.linearizeWorkingSpace ? '工作空间线性化' : '工作空间未线性化');
      if (typeof color?.linearBlending === 'boolean') details.push(color.linearBlending ? '线性混合' : '非线性混合');
      return details.length ? `AE 解释：${details.join(' · ')}` : '';
    }
    function visibleHistory() {
      return adapter.id === 'after-effects'
        ? history.filter(item => item.documentId && item.documentId === activeDocumentId)
        : history;
    }
    function updateHistoryTab() {
      historyTab.textContent = `${adapter.id === 'after-effects' ? '候选版本' : '本次记录'} · ${visibleHistory().length}`;
    }
    const resolveController = () => getController ? getController() : controller;
    const header = el('header', undefined, 'fs-header');
    const brand = el('div', undefined, 'fs-brand');
    brand.append(el('span', 'i', 'fs-logo'), el('strong', 'Iris'), el('span', 'STUDIO', 'fs-wordmark'));
    const canvas = button('↗', 'fs-icon-button', () => {
      if (onOpenCanvas) Promise.resolve().then(() => onOpenCanvas()).catch(error => { if (!disposed) status.textContent = error.message; });
      else status.textContent = '请连接 Iris 后打开画布。';
    });
    canvas.title = '展开 Iris 工作区';
    canvas.setAttribute('aria-label', canvas.title);
    header.append(brand, canvas);
    const tabs = el('nav', undefined, 'fs-tabs');
    tabs.setAttribute('aria-label', 'Iris 面板');
    const makeTab = button('制作', 'fs-tab is-active', () => showTab('make'));
    const historyTab = button(adapter.id === 'after-effects' ? '候选版本' : '本次记录', 'fs-tab', () => showTab('history'));
    tabs.append(makeTab, historyTab);
    const form = el('div', undefined, 'fs-form');
    const sourceLabel = el('div', undefined, 'fs-section-label');
    const refreshButton = button('↻', 'fs-icon-button', () => { void refresh(); });
    refreshButton.setAttribute('aria-label', '刷新宿主选择');
    sourceLabel.append(el('span', '来自当前选择'), refreshButton);
    const referencesLabel = el('div', undefined, 'fs-section-label');
    const addReference = button('+ 素材', 'fs-chip-add', () => { void refresh(); });
    addReference.title = '重新读取当前选择作为参考';
    addReference.setAttribute('aria-label', addReference.title);
    referencesLabel.append(el('span', '参考素材'), addReference);
    const referenceRow = el('div', undefined, 'fs-references');
    const source = el('div', undefined, 'fs-source');
    const thumb = el('div', '▧', 'fs-source-thumb');
    const sourceInfo = el('div', undefined, 'fs-source-info');
    const reference = el('strong', '选择一个图层或素材');
    const context = el('span', hostLabel, 'fs-muted');
    const dimensions = el('span', '等待宿主选择', 'fs-mono fs-muted');
    sourceInfo.append(reference, context, dimensions);
    const referenceChip = el('span', '当前选择', 'fs-reference-chip fs-muted');
    source.append(thumb, sourceInfo);
    referenceRow.append(referenceChip);
    const promptLabel = el('label', '你想如何创作？', 'fs-section-label');
    const promptBox = el('div', undefined, 'fs-prompt-box');
    const prompt = el('textarea');
    prompt.id = 'flovart-studio-prompt';
    promptLabel.htmlFor = prompt.id;
    prompt.rows = 5;
    prompt.maxLength = 8000;
    prompt.placeholder = '描述画面、光线与氛围，\n让灵感继续向前。';
    const promptFoot = el('div', undefined, 'fs-prompt-foot');
    const promptCount = el('span', '0', 'fs-mono fs-muted');
    promptFoot.append(el('span', '当前选择作为参考', 'fs-muted'), promptCount);
    promptBox.append(prompt, promptFoot);
    const recipes = el('div', undefined, 'fs-recipes');
    for (const [label, text] of [['电影感', '保留主体和构图，增加柔和的电影光线、细腻颗粒与自然色彩。'], ['更换背景', '保留主体的细节和比例，将背景替换为雾气中的自然风景，匹配光线和透视。'], ['概念探索', '保持视觉主体，探索一个大胆但可信的科幻美术方向，强调环境尺度与叙事感。']]) {
      recipes.append(button(label, 'fs-recipe', () => { prompt.value = text; update(); prompt.focus(); }));
    }
    const settings = el('div', undefined, 'fs-settings');
    const modelRow = el('label', undefined, 'fs-setting-row');
    const model = el('select');
    model.setAttribute('aria-label', '模型');
    modelRow.append(el('span', '模型'), model);
    const output = el('label', undefined, 'fs-setting-row');
    const target = el('select');
    target.setAttribute('aria-label', '输出位置');
    if (adapter.id === 'premiere') target.append(option('项目素材箱', 'project'));
    else if (adapter.id === 'resolve') target.append(option('Media Pool', 'media-pool'));
    else if (adapter.id === 'after-effects') target.append(option('当前合成 · 新图层', 'new-layer'));
    else target.append(option('当前文档 · 新图层', 'new-layer'));
    target.value = defaultImportTarget.kind;
    output.append(el('span', '添加到'), target);
    settings.append(modelRow, output);
    const generate = button(preview ? '✦  演示生成并添加' : '✦  生成并添加', 'fs-generate');
    const taskRow = el('div', undefined, 'fs-task');
    taskRow.hidden = true;
    taskRow.setAttribute('role', 'status');
    const taskSpinner = el('span', '', 'fs-task-spinner');
    const taskLabel = el('span', '制作中…', 'fs-task-label');
    const taskBar = el('span', undefined, 'fs-task-bar');
    const taskBarFill = el('span', undefined, 'fs-task-bar-fill');
    taskBar.append(taskBarFill);
    taskRow.append(taskSpinner, taskLabel, taskBar);
    const status = el('p', '', 'fs-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const applyNative = typeof adapter.applyNativeEffect === 'function'
      ? button('应用为场景替换效果', 'fs-generate fs-native-apply', () => {
        if (lastNativeCandidate) void applyNativeCandidate(lastNativeCandidate);
      })
      : null;
    if (applyNative) applyNative.hidden = true;
    const results = el('div', undefined, 'fs-history');
    results.hidden = true;
    const refreshCandidates = typeof adapter.listNativeCandidates === 'function'
      ? button('↻', 'fs-icon-button', () => { void refreshPersistedCandidates(); })
      : null;
    if (refreshCandidates) {
      refreshCandidates.title = '重新检查当前合成中的候选素材';
      refreshCandidates.setAttribute('aria-label', refreshCandidates.title);
    }
    const footer = el('footer', undefined, 'fs-footer');
    const connection = el('span');
    footer.append(connection, el('span', preview ? '交互预览' : hostLabel, 'fs-muted'));
    form.append(sourceLabel, source, referencesLabel, referenceRow, promptLabel, promptBox, recipes, settings, generate, el('div', 'Ctrl / ⌘ + Enter', 'fs-shortcut fs-mono'), taskRow, status);
    if (applyNative) form.append(applyNative);
    root.append(header, tabs, form, results, footer);
    function renderHistory() {
      const entries = visibleHistory();
      const heading = el('div', undefined, 'fs-history-heading');
      heading.append(el('p', entries.length ? '已保存候选与本次制作记录' : '当前合成还没有候选版本。', 'fs-muted'));
      if (refreshCandidates) heading.append(refreshCandidates);
      results.replaceChildren(heading);
      entries.slice().reverse().forEach(item => {
        const row = el('div', undefined, 'fs-history-item');
        const message = !item.persistent && item.mediaAvailable === false
          ? `${item.message} · ${item.mediaMessage || '候选素材文件缺失'}`
          : item.message;
        row.append(el('span', '✓', 'fs-success'), el('div', item.prompt), el('small', message, 'fs-muted'));
        const metadataText = candidateMetadataText(item);
        if (metadataText) row.append(el('small', metadataText, 'fs-muted'));
        if (item.nativeCandidate && applyNative) {
          const applyVersion = button(item.applied ? '重新应用此候选' : '应用此候选', 'fs-recipe', () => { void applyNativeCandidate(item); });
          applyVersion.title = `应用到原始图层「${item.nativeCandidate.sourceSelection.label}」`;
          applyVersion.disabled = busy || Boolean(applyingCandidateId) || item.mediaAvailable === false;
          row.append(el('small', `目标图层：${item.nativeCandidate.sourceSelection.label}`, 'fs-muted'));
          row.append(applyVersion);
        }
        results.append(row);
      });
    }
    async function loadPersistedCandidates() {
      if (disposed || loadingCandidates || typeof adapter.listNativeCandidates !== 'function') return;
      let documentId = '';
      try {
        const current = await adapter.getContext();
        if (!current.available || !current.documentId) return;
        documentId = String(current.documentId);
        if (loadedCandidateDocuments.has(documentId)) return;
        loadingCandidates = true;
        const candidates = await adapter.listNativeCandidates(documentId);
        if (disposed) return;
        for (const candidate of candidates) {
          const key = candidate?.candidateLayerId ? candidateKey(documentId, candidate.candidateLayerId) : '';
          if (!key) continue;
          if (knownCandidateIds.has(key)) {
            const existing = history.find(item => item.documentId === documentId && item.candidateLayerId === String(candidate.candidateLayerId));
            if (existing && !existing.persistent) {
              existing.mediaAvailable = candidate.mediaAvailable;
              existing.mediaMessage = candidate.message;
            }
            continue;
          }
          knownCandidateIds.add(key);
          const hashPrefix = candidate.sha256 ? ` · SHA-256 ${candidate.sha256.slice(0, 12)}` : '';
          const modelLabel = candidate.modelId ? ` · ${candidate.modelId}` : '';
          history.push({
            documentId,
            candidateLayerId: candidate.candidateLayerId,
            prompt: candidate.prompt || candidate.name || `候选版本 ${String(candidate.artifactId || '').slice(0, 8)}`,
            message: `${candidate.message || '已从当前合成恢复'}${modelLabel}${hashPrefix}`,
            mediaAvailable: candidate.mediaAvailable,
            ...(candidate.sourceSelection ? {
            nativeCandidate: {
              candidateLayerId: candidate.candidateLayerId,
              sourceSelection: candidate.sourceSelection,
            },
            sourceMedia: candidate.sourceMedia,
            projectColorContext: candidate.projectColorContext,
            applied: false,
            } : {}),
            persistent: true,
          });
        }
        loadedCandidateDocuments.add(documentId);
        updateHistoryTab();
        if (activeTab === 'history') renderHistory();
        update();
      } catch (error) {
        if (!disposed) status.textContent = error?.message || '无法读取当前合成中的 Iris 候选。';
      } finally {
        loadingCandidates = false;
        if (documentId && activeDocumentId && activeDocumentId !== documentId && !loadedCandidateDocuments.has(activeDocumentId)) {
          void loadPersistedCandidates();
        }
      }
    }
    async function refreshPersistedCandidates() {
      const documentId = activeDocumentId;
      if (disposed || loadingCandidates || !documentId || typeof adapter.listNativeCandidates !== 'function') return;
      for (let index = history.length - 1; index >= 0; index--) {
        const item = history[index];
        if (!item.persistent || item.documentId !== documentId) continue;
        if (item.candidateLayerId) knownCandidateIds.delete(candidateKey(documentId, item.candidateLayerId));
        history.splice(index, 1);
      }
      loadedCandidateDocuments.delete(documentId);
      renderHistory();
      await loadPersistedCandidates();
    }
    function showTab(tab) {
      activeTab = tab;
      form.hidden = tab !== 'make'; results.hidden = tab !== 'history';
      makeTab.className = `fs-tab${tab === 'make' ? ' is-active' : ''}`;
      historyTab.className = `fs-tab${tab === 'history' ? ' is-active' : ''}`;
      makeTab.setAttribute('aria-current', tab === 'make' ? 'page' : 'false');
      historyTab.setAttribute('aria-current', tab === 'history' ? 'page' : 'false');
      if (tab === 'history') {
        renderHistory();
        void loadPersistedCandidates();
      }
    }
    function update() {
      if (disposed) return;
      const linked = Boolean(resolveController());
      const nativeCandidateMatchesDocument = adapter.id !== 'after-effects'
        || Boolean(lastNativeCandidate?.documentId && lastNativeCandidate.documentId === activeDocumentId);
      promptCount.textContent = String(prompt.value.length);
      generate.disabled = busy || !linked || !lastSelection || !prompt.value.trim();
      if (applyNative) {
        applyNative.hidden = !lastNativeCandidate || !nativeCandidateMatchesDocument;
        applyNative.disabled = busy || Boolean(applyingCandidateId) || !lastNativeCandidate || !nativeCandidateMatchesDocument || lastNativeCandidate.mediaAvailable === false;
      }
      model.disabled = busy;
      target.disabled = busy;
      generate.textContent = busy ? '正在制作…' : preview ? '✦  演示生成并添加' : '✦  生成并添加';
      generate.setAttribute('aria-busy', String(busy));
      connection.textContent = preview ? '○  示例素材' : linked ? '●  Iris 已连接' : '○  等待 Iris';
      connection.className = linked && !preview ? 'fs-success' : 'fs-muted';
      if (!linked && !status.textContent) status.textContent = '连接 Iris 后即可使用当前工作流制作。';
    }
    function refreshModels() {
      const choices = resolveController()?.models;
      const list = Array.isArray(choices) && choices.length ? choices : [{ label: '自动', value: 'auto' }];
      model.replaceChildren(...list.map(item => option(item.label || item.name || item.id, item.value || item.id)));
    }
    function progressOf(value) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(1, Math.max(0, number > 1 ? number / 100 : number)) : null;
    }
    function formatElapsed(ms) {
      const seconds = Math.max(0, Math.round(ms / 1000));
      return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    }
    function taskTick() {
      taskLabel.textContent = `制作中… ${formatElapsed(Date.now() - taskStart)}`;
    }
    function taskStartRow() {
      taskStart = Date.now();
      taskRow.hidden = false;
      taskBarFill.style.width = '';
      taskRow.classList.add('is-indeterminate');
      taskTick();
      taskTimer = global.setInterval(taskTick, 500);
    }
    function taskProgress(value) {
      const fraction = progressOf(value);
      if (fraction === null) return;
      taskRow.classList.remove('is-indeterminate');
      taskBarFill.style.width = `${Math.round(fraction * 100)}%`;
      taskLabel.textContent = `制作中… ${Math.round(fraction * 100)}%`;
    }
    function taskStopRow() {
      if (taskTimer) { global.clearInterval(taskTimer); taskTimer = null; }
      taskRow.hidden = true;
      taskRow.classList.remove('is-indeterminate');
      taskBarFill.style.width = '';
    }
    async function applyNativeCandidate(item) {
      if (disposed || !item?.nativeCandidate || applyingCandidateId) return;
      const candidateId = item.nativeCandidate.candidateLayerId;
      applyingCandidateId = candidateId;
      update();
      try {
        if (adapter.id === 'after-effects') {
          const current = await adapter.getContext();
          if (!current.available || String(current.documentId || '') !== String(item.documentId || '')) {
            throw new Error('当前合成已切换；请切换回候选所属合成后再应用。');
          }
        }
        const applied = await adapter.applyNativeEffect(item.nativeCandidate);
        if (disposed) return;
        if (!applied || applied.ok === false) throw new Error(applied?.message || '场景替换效果应用失败。');
        item.applied = true;
        item.message = applied.message || '已应用为场景替换效果';
        status.textContent = item.message;
        if (applyNative && lastNativeCandidate === item) applyNative.textContent = '重新应用此候选';
        if (activeTab === 'history') showTab('history');
      } catch (error) {
        if (!disposed) status.textContent = error?.message || '场景替换效果应用失败。';
      } finally {
        applyingCandidateId = null;
        update();
        if (activeTab === 'history') showTab('history');
      }
    }
    async function refresh() {
      if (disposed || reading) return;
      // Controller can arrive after mount: re-fill the model select once it links.
      if (resolveController() && !linkedModels) { linkedModels = true; refreshModels(); }
      reading = true;
      try {
        const current = await adapter.getContext();
        const nextDocumentId = current.available && current.documentId ? String(current.documentId) : null;
        const documentChanged = nextDocumentId !== activeDocumentId;
        activeDocumentId = nextDocumentId;
        const selected = current.available ? await adapter.getSelection() : null;
        if (disposed) return;
        lastSelection = selected;
        context.textContent = current.title || current.documentName || `${hostLabel} · 尚未打开文档`;
        reference.textContent = selected?.label || '请先选择一个素材';
        dimensions.textContent = selected?.width && selected?.height ? `${Math.round(selected.width)} × ${Math.round(selected.height)} · ${selected.kind === 'video' ? '视频参考' : '图像参考'}` : selected ? '使用当前选择作为参考' : '等待宿主选择';
        referenceChip.textContent = selected?.label || '当前选择';
        referenceChip.className = `fs-reference-chip${selected ? '' : ' fs-muted'}`;
        referenceChip.title = selected ? `${selected.label} · ${selected.kind === 'video' ? '视频' : '图像'}` : '请先选择一个素材';
        if (preview && selected?.previewUrl) {
          if (thumb.firstChild?.src !== selected.previewUrl) {
            const img = el('img'); img.src = selected.previewUrl; img.alt = selected.label; thumb.replaceChildren(img);
          }
        } else thumb.textContent = selected ? '▧' : '+';
        if (documentChanged) {
          updateHistoryTab();
          if (activeTab === 'history' && activeDocumentId) void loadPersistedCandidates();
          if (activeTab === 'history') renderHistory();
        }
      } catch (error) {
        if (disposed) return;
        lastSelection = null; reference.textContent = '无法读取当前选择';
        status.textContent = error?.message || '宿主上下文不可用。';
      } finally { reading = false; update(); }
    }
    async function run() {
      const currentController = resolveController();
      if (busy || !currentController || !lastSelection || !prompt.value.trim()) return;
      busy = true;
      const submittedPrompt = prompt.value.trim();
      taskStartRow();
      update();
      try {
        const result = await currentController.generate(submittedPrompt, { ...defaultImportTarget, kind: target.value }, taskProgress);
        if (disposed) return;
        if (result?.import?.ok === false) throw new Error(result.import.message || '结果添加失败，请重试。');
        const message = result?.import?.message || '已添加新结果';
        const selectionSnapshot = result?.executionTarget?.selectionSnapshot || result?.materialized?.selection;
        const candidateLayerId = result?.import?.targetId;
        const capturedDocumentId = selectionSnapshot?.locator?.documentId;
        const nativeCandidate = adapter.applyNativeEffect
          && selectionSnapshot?.host === adapter.id
          && result?.materialized?.selection?.host === adapter.id
          && capturedDocumentId !== undefined
          && capturedDocumentId !== null
          && candidateLayerId
          ? { candidateLayerId: String(candidateLayerId), sourceSelection: selectionSnapshot }
          : null;
        const documentId = nativeCandidate?.sourceSelection?.locator?.documentId;
        const item = {
          prompt: submittedPrompt,
          message,
          ...(nativeCandidate ? {
            nativeCandidate,
            sourceMedia: result.import?.sourceMedia,
            projectColorContext: result.import?.projectColorContext,
            applied: false,
            documentId: String(documentId || ''),
            candidateLayerId: String(candidateLayerId),
          } : {}),
        };
        history.push(item);
        lastNativeCandidate = nativeCandidate ? item : null;
        if (applyNative) {
          applyNative.hidden = !nativeCandidate;
          applyNative.textContent = '应用为场景替换效果';
          if (nativeCandidate) {
            applyNative.title = `应用到原始图层「${selectionSnapshot.label}」`;
            applyNative.setAttribute('aria-label', applyNative.title);
          }
        }
        status.textContent = nativeCandidate
          ? `${message} 点击下方按钮后，才会应用到原始图层「${selectionSnapshot.label}」。`
          : message;
        if (candidateLayerId && documentId) knownCandidateIds.add(candidateKey(documentId, candidateLayerId));
        updateHistoryTab();
        if (activeTab === 'history') showTab('history');
      } catch (error) { if (!disposed) status.textContent = error?.message || '制作失败，请重试。'; }
      finally { busy = false; taskStopRow(); update(); }
    }
    generate.addEventListener('click', run);
    prompt.addEventListener('input', update);
    prompt.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); }
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && activeTab !== 'make') { event.preventDefault(); showTab('make'); prompt.focus(); }
    });
    const onReady = () => { status.textContent = ''; refreshModels(); void refresh(); };
    refreshModels();
    global.addEventListener?.('flovart:link-ready', onReady);
    const subscription = adapter.subscribeContext?.(() => { void refresh(); });
    void refresh(); update();
    return { refresh, dispose() { disposed = true; taskStopRow(); subscription?.dispose(); global.removeEventListener?.('flovart:link-ready', onReady); } };
  }
  global.FlovartStudioUI = { mountInspector };
})(typeof window !== 'undefined' ? window : globalThis);
