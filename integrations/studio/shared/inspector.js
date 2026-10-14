(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Iris Studio contextual inspector (Resolve-first).
  // Implements integrations/studio/resolve/PRODUCT_UI_SPEC.md §6/§7:
  //   Current Clip → Generate → References → Model → Output → Task → Candidates
  //   → Open in Iris. No marketing card grid, no embedded Agent chat, no 制作/历史
  //   tabs. Provider credentials never enter the panel.
  // ---------------------------------------------------------------------------

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

  // --- Locale ----------------------------------------------------------------
  // Language resolution: explicit ?lang= / data attr / navigator.language.
  // 'zh' covers zh-CN/zh-TW/zh-Hans; default fallback English.
  function resolveLocale() {
    try {
      const params = new URLSearchParams(global.location && global.location.search || '');
      const q = (params.get('lang') || params.get('locale') || '').toLowerCase();
      if (q.startsWith('zh')) return 'zh';
      if (q.startsWith('en')) return 'en';
      const docLang = (global.document && global.document.documentElement.lang || '').toLowerCase();
      if (docLang.startsWith('zh')) return 'zh';
      const nav = (global.navigator && (navigator.languages && navigator.languages[0] || navigator.language) || '').toLowerCase();
      if (nav.startsWith('zh')) return 'zh';
    } catch (_) {}
    return 'en';
  }

  const STR = {
    en: {
      panelAria: 'Iris panel',
      currentClip: 'CURRENT CLIP',
      generate: 'GENERATE',
      references: 'REFERENCES',
      refreshSelAria: 'Refresh host selection',
      addReferenceAria: 'Re-read current selection as a reference',
      addReference: '+ Reference',
      currentSelectionChip: 'Current selection',
      promptLabel: 'Describe the new shot, motion, lighting or change…',
      promptFootRef: 'Current clip used as reference',
      model: 'Model',
      output: 'Output',
      outputMediaPool: 'Media Pool',
      outputProjectBin: 'Project bin',
      outputNewLayerComp: 'Current comp · new layer',
      outputNewLayerDoc: 'Current doc · new layer',
      generateCta: '✦  Generate candidate',
      generateCtaPreview: '✦  Demo generate & add',
      generating: 'Generating…',
      task: 'TASK',
      candidates: 'CANDIDATES',
      candidatesEmpty: 'No candidates yet.',
      openInIris: 'Open in Iris ↗',
      connectToOpen: 'Connect Iris to open the workspace.',
      openCanvasTitle: 'Open Iris workspace',
      connected: 'Iris connected',
      waiting: 'Waiting for Iris',
      sampleMedia: 'Sample media',
      selectLayerOrClip: 'Select a layer or clip',
      waitingHostSel: 'Waiting for host selection',
      noDocOpen: 'No project open',
      selectMediaFirst: 'Select a media clip first',
      videoRef: 'video reference',
      imageRef: 'image reference',
      useCurrentAsRef: 'Use current selection as reference',
      selChanged: 'Current selection changed',
      auto: 'Auto',
      sec: 's', min: 'min',
      failedRetry: 'Generation failed. Retry.',
      resultAdded: 'Result added.',
      addFailed: 'Failed to add result. Retry.',
      applyFailed: 'Failed to apply as scene-replace effect.',
      appliedAsEffect: 'Applied as scene-replace effect',
      reapplyCandidate: 'Re-apply this candidate',
      applyCandidate: 'Apply this candidate',
      applyToLayerPrefix: 'Apply to original layer',
      candidatesTabAe: 'Candidates',
      historyTab: 'History',
      makeTab: 'Make',
      recoveredFromComp: 'Recovered from current comp',
      candidateFileMissing: 'candidate file missing',
      preview: 'Preview',
      addToMediaPool: 'Add to Media Pool',
      recipeCinematic: 'Cinematic', recipeCinematicP: 'Keep subject and framing; add soft cinematic light, fine grain and natural color.',
      recipeBg: 'Replace background', recipeBgP: 'Keep subject detail and proportion; replace background with a misty natural landscape matching light and perspective.',
      recipeConcept: 'Concept explore', recipeConceptP: 'Keep the visual subject; explore a bold but believable sci-fi art direction, emphasizing environment scale and narrative.',
      connectHint: 'Connect Iris to use this workflow.',
      promptCharsUnit: '',
    },
    zh: {
      panelAria: 'Iris 面板',
      currentClip: '当前片段',
      generate: '生成',
      references: '参考素材',
      refreshSelAria: '刷新宿主选择',
      addReferenceAria: '重新读取当前选择作为参考',
      addReference: '+ 素材',
      currentSelectionChip: '当前选择',
      promptLabel: '描述想要的镜头、运动、光线或变化…',
      promptFootRef: '当前片段作为参考',
      model: '模型',
      output: '输出',
      outputMediaPool: 'Media Pool',
      outputProjectBin: '项目素材箱',
      outputNewLayerComp: '当前合成 · 新图层',
      outputNewLayerDoc: '当前文档 · 新图层',
      generateCta: '✦  生成候选',
      generateCtaPreview: '✦  演示生成并添加',
      generating: '生成中…',
      task: '任务',
      candidates: '候选',
      candidatesEmpty: '还没有候选。',
      openInIris: '在 Iris 中打开 ↗',
      connectToOpen: '连接 Iris 后即可打开工作区。',
      openCanvasTitle: '打开 Iris 工作区',
      connected: 'Iris 已连接',
      waiting: '等待 Iris',
      sampleMedia: '示例素材',
      selectLayerOrClip: '选择一个图层或素材',
      waitingHostSel: '等待宿主选择',
      noDocOpen: '尚未打开项目',
      selectMediaFirst: '请先选择一个素材',
      videoRef: '视频参考',
      imageRef: '图像参考',
      useCurrentAsRef: '使用当前选择作为参考',
      selChanged: '当前选择已变化',
      auto: '自动',
      sec: '秒', min: '分',
      failedRetry: '生成失败，请重试。',
      resultAdded: '已添加新结果',
      addFailed: '结果添加失败，请重试。',
      applyFailed: '场景替换效果应用失败。',
      appliedAsEffect: '已应用为场景替换效果',
      reapplyCandidate: '重新应用此候选',
      applyCandidate: '应用此候选',
      applyToLayerPrefix: '应用到原始图层',
      candidatesTabAe: '候选版本',
      historyTab: '本次记录',
      makeTab: '制作',
      recoveredFromComp: '已从当前合成恢复',
      candidateFileMissing: '候选素材文件缺失',
      preview: '预览',
      addToMediaPool: '添加到 Media Pool',
      recipeCinematic: '电影感', recipeCinematicP: '保留主体和构图，增加柔和的电影光线、细腻颗粒与自然色彩。',
      recipeBg: '更换背景', recipeBgP: '保留主体的细节和比例，将背景替换为雾气中的自然风景，匹配光线和透视。',
      recipeConcept: '概念探索', recipeConceptP: '保持视觉主体，探索一个大胆但可信的科幻美术方向，强调环境尺度与叙事感。',
      connectHint: '连接 Iris 后即可使用当前工作流制作。',
      promptCharsUnit: '',
    },
  };
  const L = STR[resolveLocale()] || STR.en;

  function mountInspector({ root, adapter, controller, getController, hostLabel, onOpenCanvas, defaultImportTarget = { kind: 'new-layer' }, preview = false }) {
    root.replaceChildren();
    root.className = 'flovart-studio-inspector';
    let disposed = false, busy = false, reading = false, lastSelection = null, lastContext = null,
        taskStart = 0, taskTimer = null, linkedModels = false, applyingCandidateId = null,
        lastNativeCandidate = null, loadingCandidates = false, frozenTarget = null;
    const history = [];
    const knownCandidateIds = new Set();
    const loadedCandidateDocuments = new Set();
    let activeDocumentId = null;
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
        details.push(`${Number(media.durationSeconds.toFixed(2))} s`);
      }
      if (Number.isFinite(media?.pixelAspectRatio) && media.pixelAspectRatio > 0) {
        details.push(`PAR ${Number(media.pixelAspectRatio.toFixed(4))}`);
      }
      if (media?.hasAlpha === true) details.push('Alpha');
      else if (media?.hasAlpha === false) details.push('no Alpha');
      return details.join(' · ');
    }

    const resolveController = () => getController ? getController() : controller;

    // --- Header: brand + readiness (no semantic ↗ here; Open in Iris lives in footer)
    const header = el('header', undefined, 'fs-header');
    const brand = el('div', undefined, 'fs-brand');
    brand.append(el('span', 'i', 'fs-logo'), el('strong', 'Iris'));
    const headerStatus = el('span', '', 'fs-header-status');
    header.append(brand, headerStatus);

    const form = el('div', undefined, 'fs-form');

    // --- CURRENT CLIP ----------------------------------------------------------
    const clipSection = el('section', undefined, 'fs-block');
    const clipHead = el('div', undefined, 'fs-section-label');
    const refreshButton = button('↻', 'fs-icon-button', () => { void refresh(); });
    refreshButton.setAttribute('aria-label', L.refreshSelAria);
    clipHead.append(el('span', L.currentClip), refreshButton);
    const clipBody = el('div', undefined, 'fs-source');
    const thumb = el('div', '▧', 'fs-source-thumb');
    const clipInfo = el('div', undefined, 'fs-source-info');
    const clipName = el('strong', L.selectLayerOrClip);
    const clipContext = el('span', hostLabel, 'fs-muted');
    const clipMeta = el('span', L.waitingHostSel, 'fs-mono fs-muted');
    const selChanged = el('span', '', 'fs-stale');
    clipInfo.append(clipName, clipContext, clipMeta, selChanged);
    clipBody.append(thumb, clipInfo);
    clipSection.append(clipHead, clipBody);

    // --- GENERATE --------------------------------------------------------------
    const genSection = el('section', undefined, 'fs-block');
    const genHead = el('div', undefined, 'fs-section-label');
    const addReference = button(L.addReference, 'fs-chip-add', () => { void refresh(); });
    addReference.title = L.addReferenceAria;
    addReference.setAttribute('aria-label', addReference.title);
    genHead.append(el('span', L.generate), addReference);
    const referenceRow = el('div', undefined, 'fs-references');
    const referenceChip = el('span', L.currentSelectionChip, 'fs-reference-chip fs-muted');
    referenceRow.append(referenceChip);
    const promptBox = el('div', undefined, 'fs-prompt-box');
    const prompt = el('textarea');
    prompt.id = 'flovart-studio-prompt';
    prompt.rows = 4;
    prompt.maxLength = 8000;
    prompt.placeholder = L.promptLabel;
    prompt.setAttribute('aria-label', L.promptLabel);
    const promptFoot = el('div', undefined, 'fs-prompt-foot');
    const promptCount = el('span', '0', 'fs-mono fs-muted');
    promptFoot.append(el('span', L.promptFootRef, 'fs-muted'), promptCount);
    promptBox.append(prompt, promptFoot);
    const recipes = el('div', undefined, 'fs-recipes');
    for (const [label, text] of [[L.recipeCinematic, L.recipeCinematicP], [L.recipeBg, L.recipeBgP], [L.recipeConcept, L.recipeConceptP]]) {
      recipes.append(button(label, 'fs-recipe', () => { prompt.value = text; update(); prompt.focus(); }));
    }
    const settings = el('div', undefined, 'fs-settings');
    const modelRow = el('label', undefined, 'fs-setting-row');
    const model = el('select');
    model.setAttribute('aria-label', L.model);
    modelRow.append(el('span', L.model), model);
    const output = el('label', undefined, 'fs-setting-row');
    const target = el('select');
    target.setAttribute('aria-label', L.output);
    if (adapter.id === 'premiere') target.append(option(L.outputProjectBin, 'project'));
    else if (adapter.id === 'resolve') target.append(option(L.outputMediaPool, 'media-pool'));
    else if (adapter.id === 'after-effects') target.append(option(L.outputNewLayerComp, 'new-layer'));
    else target.append(option(L.outputNewLayerDoc, 'new-layer'));
    target.value = defaultImportTarget.kind;
    output.append(el('span', L.output), target);
    settings.append(modelRow, output);
    const generate = button(preview ? L.generateCtaPreview : L.generateCta, 'fs-generate');
    genSection.append(genHead, referenceRow, promptBox, recipes, settings, generate);

    // --- TASK (frozen target) ---------------------------------------------------
    const taskSection = el('section', undefined, 'fs-block fs-task-section');
    const taskHead = el('div', undefined, 'fs-section-label');
    taskHead.append(el('span', L.task));
    const taskRow = el('div', undefined, 'fs-task');
    taskRow.setAttribute('role', 'status');
    const taskSpinner = el('span', '', 'fs-task-spinner');
    const taskLabel = el('span', L.generating, 'fs-task-label');
    const taskBar = el('span', undefined, 'fs-task-bar');
    const taskBarFill = el('span', undefined, 'fs-task-bar-fill');
    taskBar.append(taskBarFill);
    taskRow.append(taskSpinner, taskLabel, taskBar);
    const taskTarget = el('div', '', 'fs-task-target fs-muted');
    taskSection.append(taskHead, taskRow, taskTarget);
    taskSection.hidden = true;
    const status = el('p', '', 'fs-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    // --- CANDIDATES --------------------------------------------------------------
    const candSection = el('section', undefined, 'fs-block fs-candidates');
    const candHead = el('div', undefined, 'fs-section-label');
    const candTitle = el('span', L.candidates);
    candHead.append(candTitle);
    const refreshCandidates = typeof adapter.listNativeCandidates === 'function'
      ? button('↻', 'fs-icon-button', () => { void refreshPersistedCandidates(); })
      : null;
    if (refreshCandidates) {
      refreshCandidates.title = L.refreshSelAria;
      refreshCandidates.setAttribute('aria-label', L.refreshSelAria);
      candHead.append(refreshCandidates);
    }
    const candList = el('div', undefined, 'fs-candidate-list');
    candSection.append(candHead, candList);
    candSection.hidden = true;

    const applyNative = typeof adapter.applyNativeEffect === 'function'
      ? button(L.applyCandidate, 'fs-generate fs-native-apply', () => {
        if (lastNativeCandidate) void applyNativeCandidate(lastNativeCandidate);
      })
      : null;
    if (applyNative) applyNative.hidden = true;

    // --- Footer: connection + Open in Iris ---------------------------------------
    const footer = el('footer', undefined, 'fs-footer');
    const connection = el('span');
    const openLink = button(L.openInIris, 'fs-open-link', () => {
      if (onOpenCanvas) Promise.resolve().then(() => onOpenCanvas()).catch(error => { if (!disposed) status.textContent = error.message; });
      else status.textContent = L.connectToOpen;
    });
    openLink.title = L.openCanvasTitle;
    footer.append(connection, openLink);

    form.append(clipSection, genSection, taskSection, status, candSection);
    if (applyNative) form.append(applyNative);
    root.append(header, form, footer);

    // --- Candidates rendering -----------------------------------------------------
    function renderCandidates() {
      const entries = adapter.id === 'after-effects'
        ? history.filter(item => item.documentId && item.documentId === activeDocumentId)
        : history;
      candSection.hidden = entries.length === 0;
      candTitle.textContent = `${L.candidates} · ${entries.length}`;
      candList.replaceChildren();
      entries.slice().reverse().forEach(item => {
        const card = el('div', undefined, 'fs-candidate-card');
        const poster = el('div', '▧', 'fs-candidate-thumb');
        if (item.previewUrl) { const img = el('img'); img.src = item.previewUrl; img.alt = item.prompt; poster.replaceChildren(img); }
        const body = el('div', undefined, 'fs-candidate-body');
        body.append(el('strong', item.versionLabel || item.prompt || L.candidates));
        const metaLine = [item.modelLabel, item.durationLabel, item.resolutionLabel].filter(Boolean).join(' · ');
        if (metaLine) body.append(el('small', metaLine, 'fs-muted'));
        const metaText = candidateMetadataText(item);
        if (metaText) body.append(el('small', metaText, 'fs-muted'));
        const msg = !item.persistent && item.mediaAvailable === false
          ? `${item.message} · ${item.mediaMessage || L.candidateFileMissing}`
          : item.message;
        if (msg) body.append(el('small', msg, 'fs-muted'));
        const actions = el('div', undefined, 'fs-candidate-actions');
        if (item.previewUrl) actions.append(button(L.preview, 'fs-recipe', () => { try { global.open(item.previewUrl, '_blank'); } catch (_) {} }));
        // P0 primary action label reflects the actual import target.
        const primaryLabel = adapter.id === 'resolve' ? L.addToMediaPool : (item.message || L.resultAdded);
        actions.append(el('span', primaryLabel, 'fs-candidate-done'));
        if (item.nativeCandidate && applyNative) {
          const applyVersion = button(item.applied ? L.reapplyCandidate : L.applyCandidate, 'fs-recipe', () => { void applyNativeCandidate(item); });
          applyVersion.title = `${L.applyToLayerPrefix}「${item.nativeCandidate.sourceSelection.label}」`;
          applyVersion.disabled = busy || Boolean(applyingCandidateId) || item.mediaAvailable === false;
          body.append(el('small', `${L.applyToLayerPrefix}：${item.nativeCandidate.sourceSelection.label}`, 'fs-muted'));
          actions.append(applyVersion);
        }
        card.append(poster, body);
        body.append(actions);
        candList.append(card);
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
            prompt: candidate.prompt || candidate.name || `Candidate ${String(candidate.artifactId || '').slice(0, 8)}`,
            message: `${candidate.message || L.recoveredFromComp}${modelLabel}${hashPrefix}`,
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
        renderCandidates();
        update();
      } catch (error) {
        if (!disposed) status.textContent = error?.message || 'Could not read candidates.';
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
      renderCandidates();
      await loadPersistedCandidates();
    }

    // --- Frozen target / selection freshness --------------------------------------
    function selectionChangedSinceFreeze() {
      if (!frozenTarget || !lastSelection) return false;
      return frozenTarget.selectionId && lastSelection.selectionId && frozenTarget.selectionId !== lastSelection.selectionId;
    }
    function renderTaskTarget() {
      if (!frozenTarget) { taskTarget.textContent = ''; return; }
      const parts = [frozenTarget.label];
      if (frozenTarget.timelineLabel) parts.push(frozenTarget.timelineLabel);
      if (frozenTarget.trackLabel) parts.push(frozenTarget.trackLabel);
      taskTarget.textContent = parts.join(' · ');
      selChanged.textContent = selectionChangedSinceFreeze() ? L.selChanged : '';
      selChanged.className = 'fs-stale' + (selectionChangedSinceFreeze() ? ' is-visible' : '');
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
      generate.textContent = busy ? L.generating : preview ? L.generateCtaPreview : L.generateCta;
      generate.setAttribute('aria-busy', String(busy));
      connection.textContent = preview ? `○  ${L.sampleMedia}` : linked ? `●  ${L.connected}` : `○  ${L.waiting}`;
      connection.className = linked && !preview ? 'fs-success' : 'fs-muted';
      headerStatus.textContent = linked ? '● Ready' : '○';
      headerStatus.className = 'fs-header-status ' + (linked ? 'fs-success' : 'fs-muted');
      if (!linked && !status.textContent) status.textContent = L.connectHint;
      renderTaskTarget();
    }
    function refreshModels() {
      const choices = resolveController()?.models;
      const list = Array.isArray(choices) && choices.length ? choices : [{ label: L.auto, value: 'auto' }];
      model.replaceChildren(...list.map(item => option(item.label || item.name || item.id, item.value || item.id)));
    }
    function progressOf(value) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(1, Math.max(0, number > 1 ? number / 100 : number)) : null;
    }
    function formatElapsed(ms) {
      const seconds = Math.max(0, Math.round(ms / 1000));
      return seconds < 60 ? `${seconds}${L.sec}` : `${Math.floor(seconds / 60)}${L.min}${seconds % 60}${L.sec}`;
    }
    function taskTick() {
      taskLabel.textContent = `${L.generating} ${formatElapsed(Date.now() - taskStart)}`;
    }
    function taskStartRow() {
      taskStart = Date.now();
      taskSection.hidden = false;
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
      taskLabel.textContent = `${L.generating} ${Math.round(fraction * 100)}%`;
    }
    function taskStopRow() {
      if (taskTimer) { global.clearInterval(taskTimer); taskTimer = null; }
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
        if (!applied || applied.ok === false) throw new Error(applied?.message || L.applyFailed);
        item.applied = true;
        item.message = applied.message || L.appliedAsEffect;
        status.textContent = item.message;
        if (applyNative && lastNativeCandidate === item) applyNative.textContent = L.reapplyCandidate;
        renderCandidates();
      } catch (error) {
        if (!disposed) status.textContent = error?.message || L.applyFailed;
      } finally {
        applyingCandidateId = null;
        update();
        renderCandidates();
      }
    }

    async function refresh() {
      if (disposed || reading) return;
      if (resolveController() && !linkedModels) { linkedModels = true; refreshModels(); }
      reading = true;
      try {
        const current = await adapter.getContext();
        const nextDocumentId = current.available && current.documentId ? String(current.documentId) : null;
        const documentChanged = nextDocumentId !== activeDocumentId;
        activeDocumentId = nextDocumentId;
        lastContext = current;
        const selected = current.available ? await adapter.getSelection() : null;
        if (disposed) return;
        lastSelection = selected;
        clipContext.textContent = current.title || current.documentName || `${hostLabel} · ${L.noDocOpen}`;
        clipName.textContent = selected?.label || L.selectMediaFirst;
        // Clip meta: kind + dimensions + source type; timecode/track only when host supplies them.
        const metaBits = [];
        if (selected?.kind === 'video') metaBits.push(L.videoRef); else if (selected) metaBits.push(L.imageRef);
        if (selected?.width && selected?.height) metaBits.push(`${Math.round(selected.width)} × ${Math.round(selected.height)}`);
        if (selected?.timeRange) metaBits.push(selected.timeRange);
        else if (selected?.timecode) metaBits.push(selected.timecode);
        clipMeta.textContent = selected ? (metaBits.length ? metaBits.join(' · ') : L.useCurrentAsRef) : L.waitingHostSel;
        referenceChip.textContent = selected?.label || L.currentSelectionChip;
        referenceChip.className = `fs-reference-chip${selected ? '' : ' fs-muted'}`;
        referenceChip.title = selected ? `${selected.label} · ${selected.kind === 'video' ? 'video' : 'image'}` : L.selectMediaFirst;
        if (preview && selected?.previewUrl) {
          if (thumb.firstChild?.src !== selected.previewUrl) {
            const img = el('img'); img.src = selected.previewUrl; img.alt = selected.label; thumb.replaceChildren(img);
          }
        } else thumb.textContent = selected ? '▧' : '+';
        if (documentChanged) {
          if (activeDocumentId) void loadPersistedCandidates();
          renderCandidates();
        }
      } catch (error) {
        if (disposed) return;
        lastSelection = null; clipName.textContent = 'Could not read selection';
        status.textContent = error?.message || 'Host context unavailable.';
      } finally { reading = false; update(); }
    }

    async function run() {
      const currentController = resolveController();
      if (busy || !currentController || !lastSelection || !prompt.value.trim()) return;
      busy = true;
      const submittedPrompt = prompt.value.trim();
      // Freeze the target identity at submit; it must NOT follow later selection changes.
      frozenTarget = {
        selectionId: lastSelection.selectionId,
        label: lastSelection.label,
        kind: lastSelection.kind,
        locator: lastSelection.locator,
        timelineLabel: lastSelection.timelineLabel || lastContext?.timelineLabel || '',
        trackLabel: lastSelection.trackLabel || '',
      };
      taskStartRow();
      update();
      try {
        const result = await currentController.generate(submittedPrompt, { ...defaultImportTarget, kind: target.value, frozenTarget }, taskProgress);
        if (disposed) return;
        if (result?.import?.ok === false) throw new Error(result.import.message || L.addFailed);
        const message = result?.import?.message || L.resultAdded;
        const selectionSnapshot = result?.executionTarget?.selectionSnapshot || result?.materialized?.selection || frozenTarget;
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
        const media = result?.import?.sourceMedia || result?.materialized?.media || {};
        const item = {
          prompt: submittedPrompt,
          message,
          versionLabel: `V${history.length + 1}`,
          modelLabel: result?.model || result?.modelId || '',
          durationLabel: Number.isFinite(media.durationSeconds) ? `${Number(media.durationSeconds.toFixed(1))}s` : (Number.isFinite(media.durationMs) ? `${(media.durationMs / 1000).toFixed(1)}s` : ''),
          resolutionLabel: (Number.isFinite(media.width) && Number.isFinite(media.height)) ? `${media.width} × ${media.height}` : '',
          previewUrl: result?.import?.previewUrl || result?.materialized?.previewUrl || '',
          artifact: { artifactId: result?.import?.artifactId || result?.artifactId, path: result?.import?.artifact?.path, sha256: result?.import?.artifact?.sha256 },
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
          applyNative.textContent = L.applyCandidate;
          if (nativeCandidate) {
            applyNative.title = `${L.applyToLayerPrefix}「${selectionSnapshot.label}」`;
            applyNative.setAttribute('aria-label', applyNative.title);
          }
        }
        status.textContent = nativeCandidate
          ? `${message} ${L.applyToLayerPrefix}「${selectionSnapshot.label}」.`
          : message;
        if (candidateLayerId && documentId) knownCandidateIds.add(candidateKey(documentId, candidateLayerId));
        renderCandidates();
      } catch (error) { if (!disposed) status.textContent = error?.message || L.failedRetry; }
      finally { busy = false; taskStopRow(); update(); }
    }
    generate.addEventListener('click', run);
    prompt.addEventListener('input', update);
    prompt.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); }
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
