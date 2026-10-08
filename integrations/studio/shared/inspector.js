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

  const resolveCopy = {
    'zh-CN': {
      language: '语言', currentClip: '当前片段', generate: '生成', references: '参考素材', task: '任务', candidates: '候选项',
      openProject: '打开一个 Resolve 项目以使用 Iris。', selectClip: '选择一个 Media Pool 素材或时间线片段。',
      noProject: '打开一个 Resolve 项目', noSelection: '选择一个片段或素材',
      promptPlaceholder: '描述新镜头、运动、光线或变化…', currentReference: '当前片段用作参考',
      model: '模型', auto: '自动', output: '输出', mediaPool: 'Media Pool',
      generateCandidate: '生成候选', generating: '生成中…', demoGenerate: '演示生成候选',
      ready: '已就绪', candidateReady: '等待审核', failed: '失败', adding: '正在添加…', addToMediaPool: '添加到 Media Pool', retryAdd: '重试添加',
      importUnknown: '导入状态未知。请先检查 Resolve Media Pool，确认候选是否已添加；确认前不要重试。', verifyMediaPoolFirst: '先核对 Media Pool',
      preview: '预览', hidePreview: '收起预览', previewUnavailable: '当前环境无法预览此候选。', prepareFailed: '候选未能完成持久化校验。', importFailed: '无法添加到 Media Pool。候选已保留，可重试。', addedToMediaPool: '已添加到 Media Pool', importNotConfirmed: 'Resolve 尚未确认将结果添加到 Media Pool。', basedOn: '基于',
      openInIris: '在 Iris 中打开 ↗', openInIrisUnavailable: 'Iris Canvas 暂不可用。', resolveUnavailable: '项目不可用', irisUnavailable: 'Iris 未连接', selectClipStatus: '选择片段', readyStatus: '已就绪',
      refreshSelection: '刷新当前片段', promptLabel: '描述', mediaPoolClip: 'Media Pool 片段', timelineItem: '时间线片段',
      languageChinese: '简体中文', languageEnglish: 'English',
      hintToggle: '这是什么？', stageSubmit: '提交', stageGenerate: '生成', stageDownload: '下载', stageVerify: '校验',
      readyIn: '已就绪 · 用时', partialPreview: '预览', partialWaiting: '等待第一张预览…',
      alphaYes: '透明 ✓', alphaNo: '不透明', alphaChecking: '检查透明度…',
      agentPrepared: '准备了 1 个生成', agentReview: '填入并审核', agentDismiss: '忽略', agentFallback: 'Agent',
      pullFromCanvas: '取回画布结果', pulling: '正在取回…', nothingToPull: '画布里还没有可取回的结果。',
      hintClip: '在 Resolve 里点选一个 Media Pool 素材或时间线片段，Iris 会以它为参考。切换选择不会影响正在进行的任务。',
      hintGenerate: '用一句话描述你想要的结果，例如「透明背景的霓虹标题」。点击生成后会出一个候选，不会改动时间线。',
      hintTask: '四个阶段依次点亮。不知道进度时只显示动画，不会编造百分比。',
      hintCandidates: '棋盘格表示透明区域。确认满意后再添加到 Media Pool，原片不会被替换。',
    },
    en: {
      language: 'Language', currentClip: 'Current clip', generate: 'Generate', references: 'References', task: 'Task', candidates: 'Candidates',
      openProject: 'Open a Resolve project to use Iris.', selectClip: 'Select a Media Pool clip or timeline item.',
      noProject: 'Open a Resolve project', noSelection: 'Select a clip or media item',
      promptPlaceholder: 'Describe the new shot, motion, lighting, or change…', currentReference: 'Current clip used as reference',
      model: 'Model', auto: 'Auto', output: 'Output', mediaPool: 'Media Pool',
      generateCandidate: 'Generate candidate', generating: 'Generating…', demoGenerate: 'Preview generation',
      ready: 'Ready', candidateReady: 'Ready for review', failed: 'Failed', adding: 'Adding…', addToMediaPool: 'Add to Media Pool', retryAdd: 'Retry Add',
      importUnknown: 'Import status is unknown. Check the Resolve Media Pool to confirm whether the candidate was added. Do not retry before confirming.', verifyMediaPoolFirst: 'Verify Media Pool first',
      preview: 'Preview', hidePreview: 'Hide preview', previewUnavailable: 'This candidate cannot be previewed in the current host.', prepareFailed: 'Candidate did not pass persistence validation.', importFailed: 'Could not add to Media Pool. The candidate is retained and can be retried.', addedToMediaPool: 'Added to Media Pool', importNotConfirmed: 'Resolve did not confirm that the result was added to the Media Pool.', basedOn: 'Based on',
      openInIris: 'Open in Iris ↗', openInIrisUnavailable: 'Iris Canvas is not available.', resolveUnavailable: 'Project unavailable', irisUnavailable: 'Iris is not connected', selectClipStatus: 'Select a clip', readyStatus: 'Ready',
      refreshSelection: 'Refresh current clip', promptLabel: 'Prompt', mediaPoolClip: 'Media Pool clip', timelineItem: 'Timeline item',
      languageChinese: 'Simplified Chinese', languageEnglish: 'English',
      hintToggle: 'What is this?', stageSubmit: 'Submit', stageGenerate: 'Generate', stageDownload: 'Download', stageVerify: 'Verify',
      readyIn: 'Ready · took', partialPreview: 'Preview', partialWaiting: 'Waiting for the first preview…',
      alphaYes: 'Transparent ✓', alphaNo: 'Opaque', alphaChecking: 'Checking alpha…',
      agentPrepared: 'prepared 1 generation', agentReview: 'Fill in & review', agentDismiss: 'Dismiss', agentFallback: 'Agent',
      pullFromCanvas: 'Pull from canvas', pulling: 'Pulling…', nothingToPull: 'The canvas has no result to pull yet.',
      hintClip: 'Select a Media Pool clip or timeline item in Resolve. Iris uses it as the reference. Changing selection never retargets a running task.',
      hintGenerate: 'Describe the result in one sentence, e.g. "neon title on a transparent background". Generate makes a candidate and never touches the timeline.',
      hintTask: 'The four stages light up in order. When progress is unknown, only the animation runs. No made-up percentages.',
      hintCandidates: 'The checkerboard shows transparent areas. Add to Media Pool only when you like it. The source clip is never replaced.',
    },
  };

  // The real UXP/CEP packages and the browser preview mount this same UI.
  function mountInspector({ root, adapter, controller, getController, hostLabel, onOpenCanvas, defaultImportTarget = { kind: 'new-layer' }, preview = false, locale }) {
    root.replaceChildren();
    root.className = 'flovart-studio-inspector';
    const isResolve = adapter.id === 'resolve';
    root.dataset.studioHost = adapter.id;
    function resolveLocale() {
      if (!isResolve) return 'zh-CN';
      const requested = locale || root.dataset.locale || (() => {
        try { return global.localStorage?.getItem('flovart.studio.resolve.locale'); } catch { return ''; }
      })() || global.navigator?.language || '';
      return String(requested).toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
    }
    let currentLocale = resolveLocale();
    const t = key => isResolve ? resolveCopy[currentLocale][key] : '';
    let disposed = false, busy = false, reading = false, lastSelection = null, activeTab = 'make', activeDocumentId = null, taskStart = 0, taskTimer = null, linkedModels = false, applyingCandidateId = null, lastNativeCandidate = null, loadingCandidates = false, resolveProjectAvailable = false, resolveTaskState = null, resolveProgress = null, resolveTaskTargetLabel = '', resolveTaskPrompt = '', importingCandidateId = null;
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
      if (!historyTab) return;
      historyTab.textContent = `${adapter.id === 'after-effects' ? '候选版本' : '本次记录'} · ${visibleHistory().length}`;
    }
    const resolveController = () => getController ? getController() : controller;
    const header = el('header', undefined, 'fs-header');
    const brand = el('div', undefined, 'fs-brand');
    brand.append(el('span', 'i', 'fs-logo'), el('strong', 'Iris'));
    const canvas = button('↗', 'fs-icon-button', () => {
      if (onOpenCanvas) Promise.resolve().then(() => onOpenCanvas()).catch(error => { if (!disposed) status.textContent = error.message; });
      else status.textContent = '请连接 Iris 后打开画布。';
    });
    canvas.title = '展开 Iris 工作区';
    canvas.setAttribute('aria-label', canvas.title);
    let makeTab = null, historyTab = null, headerStatus = null, localeToggle = null, languageZh = null, languageEn = null;
    if (isResolve) {
      headerStatus = el('span', '', 'fs-header-status fs-muted');
      headerStatus.setAttribute('role', 'status');
      headerStatus.setAttribute('aria-live', 'polite');
      localeToggle = el('div', undefined, 'fs-locale-toggle');
      localeToggle.setAttribute('role', 'group');
      localeToggle.setAttribute('aria-label', t('language'));
      languageZh = button('中', 'fs-locale-button', () => setResolveLocale('zh-CN'));
      languageEn = button('EN', 'fs-locale-button', () => setResolveLocale('en'));
      languageZh.title = t('languageChinese'); languageZh.setAttribute('aria-label', t('languageChinese'));
      languageEn.title = t('languageEnglish'); languageEn.setAttribute('aria-label', t('languageEnglish'));
      localeToggle.append(languageZh, languageEn);
      header.append(brand, headerStatus, localeToggle);
    } else header.append(brand, canvas);
    const tabs = isResolve ? null : el('nav', undefined, 'fs-tabs');
    if (tabs) {
      tabs.setAttribute('aria-label', 'Iris 面板');
      makeTab = button('制作', 'fs-tab is-active', () => showTab('make'));
      historyTab = button(adapter.id === 'after-effects' ? '候选版本' : '本次记录', 'fs-tab', () => showTab('history'));
      tabs.append(makeTab, historyTab);
    }
    const form = el('div', undefined, 'fs-form');
    if (isResolve) form.classList.add('fs-resolve-form');
    const sourceLabel = el('div', undefined, 'fs-section-label');
    const refreshButton = button('↻', 'fs-icon-button', () => { void refresh(); });
    refreshButton.setAttribute('aria-label', isResolve ? t('refreshSelection') : '刷新宿主选择');
    sourceLabel.append(el('span', isResolve ? t('currentClip') : '来自当前选择'), refreshButton);
    const referencesLabel = el('div', undefined, 'fs-section-label');
    const addReference = button('+ 素材', 'fs-chip-add', () => { void refresh(); });
    addReference.title = '重新读取当前选择作为参考';
    addReference.setAttribute('aria-label', addReference.title);
    const referencesLabelText = el('span', isResolve ? t('references') : '参考素材');
    referencesLabel.append(referencesLabelText);
    if (!isResolve) referencesLabel.append(addReference);
    const referenceRow = el('div', undefined, 'fs-references');
    const source = el('div', undefined, 'fs-source');
    const thumb = el('div', '▧', 'fs-source-thumb');
    if (isResolve && !preview) thumb.hidden = true;
    const sourceInfo = el('div', undefined, 'fs-source-info');
    const reference = el('strong', isResolve ? t('noSelection') : '选择一个图层或素材');
    const context = el('span', hostLabel, 'fs-muted');
    const dimensions = el('span', '等待宿主选择', 'fs-mono fs-muted');
    sourceInfo.append(reference, context, dimensions);
    const referenceChip = el('span', isResolve ? t('noSelection') : '当前选择', 'fs-reference-chip fs-muted');
    source.append(thumb, sourceInfo);
    referenceRow.append(referenceChip);
    const generateLabel = isResolve ? el('div', undefined, 'fs-section-label fs-resolve-generate-heading') : null;
    const generateLabelText = isResolve ? el('span', t('generate')) : null;
    if (generateLabel) generateLabel.append(generateLabelText);
    const promptLabel = el('label', isResolve ? t('promptLabel') : '你想如何创作？', 'fs-section-label');
    const promptBox = el('div', undefined, 'fs-prompt-box');
    const prompt = el('textarea');
    prompt.id = 'flovart-studio-prompt';
    promptLabel.htmlFor = prompt.id;
    prompt.rows = 5;
    prompt.maxLength = 8000;
    prompt.placeholder = isResolve ? t('promptPlaceholder') : '描述画面、光线与氛围，\n让灵感继续向前。';
    const promptFoot = el('div', undefined, 'fs-prompt-foot');
    const promptCount = el('span', '0', 'fs-mono fs-muted');
    const promptFootText = el('span', isResolve ? t('currentReference') : '当前选择作为参考', 'fs-muted');
    promptFoot.append(promptFootText, promptCount);
    promptBox.append(prompt, promptFoot);
    const recipes = el('div', undefined, 'fs-recipes');
    for (const [label, text] of (isResolve ? [] : [['电影感', '保留主体和构图，增加柔和的电影光线、细腻颗粒与自然色彩。'], ['更换背景', '保留主体的细节和比例，将背景替换为雾气中的自然风景，匹配光线和透视。'], ['概念探索', '保持视觉主体，探索一个大胆但可信的科幻美术方向，强调环境尺度与叙事感。']])) {
      recipes.append(button(label, 'fs-recipe', () => { prompt.value = text; update(); prompt.focus(); }));
    }
    const settings = el('div', undefined, 'fs-settings');
    const modelRow = el('label', undefined, 'fs-setting-row');
    const model = el('select');
    model.setAttribute('aria-label', '模型');
    modelRow.append(el('span', '模型'), model);
    const modelAutoRow = el('div', undefined, 'fs-setting-row fs-setting-static');
    modelAutoRow.setAttribute('aria-label', `${t('model')}: ${t('auto')}`);
    const modelAutoLabel = el('span', t('model'));
    const modelAutoValue = el('span', t('auto'), 'fs-setting-value');
    modelAutoRow.append(modelAutoLabel, modelAutoValue);
    modelRow.hidden = isResolve;
    const output = el('label', undefined, 'fs-setting-row');
    const target = el('select');
    target.setAttribute('aria-label', isResolve ? `${t('output')}: ${t('mediaPool')}` : '输出位置');
    if (adapter.id === 'premiere') target.append(option('项目素材箱', 'project'));
    else if (isResolve) target.append(option(t('mediaPool'), 'media-pool'));
    else if (adapter.id === 'after-effects') target.append(option('当前合成 · 新图层', 'new-layer'));
    else target.append(option('当前文档 · 新图层', 'new-layer'));
    target.value = defaultImportTarget.kind;
    const outputLabel = el('span', isResolve ? t('output') : '添加到');
    output.append(outputLabel, target);
    settings.append(isResolve ? modelAutoRow : modelRow, output);
    const generate = button(isResolve ? (preview ? t('demoGenerate') : t('generateCandidate')) : (preview ? '✦  演示生成并添加' : '✦  生成并添加'), 'fs-generate');
    const taskRow = el('div', undefined, 'fs-task');
    taskRow.hidden = true;
    taskRow.setAttribute('role', 'status');
    const taskSpinner = el('span', '', 'fs-task-spinner');
    const taskLabel = el('span', isResolve ? t('generating') : '制作中…', 'fs-task-label');
    const taskBar = el('span', undefined, 'fs-task-bar');
    const taskBarFill = el('span', undefined, 'fs-task-bar-fill');
    taskBar.append(taskBarFill);
    taskRow.append(taskSpinner, taskLabel, taskBar);
    const taskSectionLabel = isResolve ? el('div', undefined, 'fs-section-label fs-resolve-state-heading') : null;
    const taskSectionText = isResolve ? el('span', t('task')) : null;
    if (taskSectionLabel) taskSectionLabel.append(taskSectionText);
    if (taskSectionLabel) taskSectionLabel.hidden = true;
    const status = el('p', '', 'fs-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const applyNative = !isResolve && typeof adapter.applyNativeEffect === 'function'
      ? button('应用为场景替换效果', 'fs-generate fs-native-apply', () => {
        if (lastNativeCandidate) void applyNativeCandidate(lastNativeCandidate);
      })
      : null;
    if (applyNative) applyNative.hidden = true;
    const results = el('div', undefined, 'fs-history');
    results.hidden = true;
    const resolveCandidates = isResolve ? el('section', undefined, 'fs-resolve-candidates') : null;
    const resolveCandidatesHeading = isResolve ? el('div', undefined, 'fs-section-label fs-resolve-state-heading') : null;
    const resolveCandidatesHeadingText = isResolve ? el('span', t('candidates')) : null;
    if (resolveCandidatesHeading) resolveCandidatesHeading.append(resolveCandidatesHeadingText);
    const resolveCandidateList = isResolve ? el('div', undefined, 'fs-resolve-candidate-list') : null;
    if (resolveCandidates) {
      resolveCandidates.hidden = true;
      resolveCandidates.append(resolveCandidatesHeading, resolveCandidateList);
    }
    const refreshCandidates = typeof adapter.listNativeCandidates === 'function'
      ? button('↻', 'fs-icon-button', () => { void refreshPersistedCandidates(); })
      : null;
    if (refreshCandidates) {
      refreshCandidates.title = '重新检查当前合成中的候选素材';
      refreshCandidates.setAttribute('aria-label', refreshCandidates.title);
    }
    const footer = el('footer', undefined, 'fs-footer');
    const connection = el('span');
    let openInIris = null, pullFromCanvas = null, pulling = false;
    if (isResolve) {
      footer.classList.add('fs-resolve-footer');
      openInIris = button(t('openInIris'), 'fs-open-in-iris', () => {
        if (onOpenCanvas) Promise.resolve().then(() => onOpenCanvas()).catch(error => { if (!disposed) status.textContent = error.message; });
        else status.textContent = t('openInIrisUnavailable');
      });
      // Gyroflow-style round trip: send work to the canvas, then bring its latest result back here.
      pullFromCanvas = button(t('pullFromCanvas'), 'fs-open-in-iris fs-pull-canvas', () => { void pullCanvasResult(); });
      pullFromCanvas.hidden = true;
      footer.append(pullFromCanvas, openInIris);
    } else footer.append(connection, el('span', preview ? '交互预览' : hostLabel, 'fs-muted'));
    const shortcut = el('div', 'Ctrl / ⌘ + Enter', 'fs-shortcut fs-mono');
    // Quiet, static guidance: a small marker that never pops up by itself; one sentence only when asked.
    const hints = [];
    function attachHint(label, key) {
      if (!isResolve || !label) return null;
      const marker = button('?', 'fs-hint-marker');
      const note = el('p', t(key), 'fs-hint');
      note.hidden = true;
      note.id = `fs-hint-${key}`;
      marker.setAttribute('aria-controls', note.id);
      marker.setAttribute('aria-expanded', 'false');
      marker.title = t('hintToggle'); marker.setAttribute('aria-label', t('hintToggle'));
      marker.addEventListener('click', () => {
        note.hidden = !note.hidden;
        marker.setAttribute('aria-expanded', String(!note.hidden));
        marker.classList.toggle('is-open', !note.hidden);
      });
      label.classList.add('fs-has-hint');
      label.append(marker);
      label.after(note);
      hints.push({ marker, note, key, label });
      return note;
    }
    const stageKeys = ['submitting', 'generating', 'downloading', 'verifying'];
    const stageCopy = { submitting: 'stageSubmit', generating: 'stageGenerate', downloading: 'stageDownload', verifying: 'stageVerify' };
    const stageRow = isResolve ? el('ol', undefined, 'fs-stages') : null;
    const stageNodes = {};
    if (stageRow) for (const key of stageKeys) { stageNodes[key] = el('li', t(stageCopy[key]), 'fs-stage'); stageRow.append(stageNodes[key]); }
    let resolveStage = null, resolveElapsed = 0, pendingPartial = null;
    function renderStages() {
      if (!stageRow) return;
      const index = resolveTaskState === 'ready' ? stageKeys.length : stageKeys.indexOf(resolveStage);
      stageKeys.forEach((key, i) => {
        stageNodes[key].textContent = t(stageCopy[key]);
        stageNodes[key].className = `fs-stage${i < index ? ' is-done' : i === index ? ' is-active' : ''}${resolveTaskState === 'failed' && i === index ? ' is-failed' : ''}`;
        if (i === index && resolveTaskState === 'generating') stageNodes[key].setAttribute('aria-current', 'step');
        else stageNodes[key].removeAttribute('aria-current');
      });
    }
    const agentBanner = isResolve ? el('div', undefined, 'fs-agent-banner') : null;
    let agentRequest = null;
    if (agentBanner) agentBanner.hidden = true;
    function renderAgentBanner() {
      if (!agentBanner) return;
      agentBanner.replaceChildren();
      agentBanner.hidden = !agentRequest;
      if (!agentRequest) return;
      const text = el('span', `${agentRequest.agent || t('agentFallback')} ${t('agentPrepared')}`, 'fs-agent-text');
      const review = button(t('agentReview'), 'fs-agent-review', () => {
        prompt.value = agentRequest.prompt; agentRequest = null; renderAgentBanner(); update(); prompt.focus();
      });
      const dismiss = button('×', 'fs-icon-button fs-agent-dismiss', () => { agentRequest = null; renderAgentBanner(); });
      dismiss.setAttribute('aria-label', t('agentDismiss'));
      agentBanner.append(el('span', '●', 'fs-agent-dot'), text, review, dismiss);
    }
    const onAgentRequest = event => {
      const detail = event?.detail || {};
      if (!isResolve || typeof detail.prompt !== 'string' || !detail.prompt.trim()) return;
      // An Agent can only prefill; paid generation still waits for the user's click.
      agentRequest = { agent: typeof detail.agent === 'string' ? detail.agent.slice(0, 40) : '', prompt: detail.prompt.slice(0, 8000) };
      renderAgentBanner();
    };
    if (agentBanner) form.append(agentBanner);
    // Resolve: Inspector-style collapsible groups (the way OFX plugins such as Gyroflow appear natively).
    const groups = {};
    function group(key, label, ...body) {
      const node = el('section', undefined, 'fs-group');
      node.dataset.group = key;
      const content = el('div', undefined, 'fs-group-body');
      content.append(...body.filter(Boolean));
      const chevron = button('', 'fs-group-toggle', () => {
        const collapsed = node.classList.toggle('is-collapsed');
        chevron.setAttribute('aria-expanded', String(!collapsed));
      });
      chevron.setAttribute('aria-expanded', 'true');
      label.classList.add('fs-group-header');
      label.prepend(chevron);
      node.append(label, content);
      groups[key] = node;
      return node;
    }
    if (isResolve) {
      if (stageRow) stageRow.hidden = true;
      const candidateBody = el('div', undefined, 'fs-group-body');
      candidateBody.append(resolveCandidateList);
      form.append(
        group('clip', sourceLabel, source),
        group('generate', generateLabel, promptLabel, promptBox, referencesLabel, referenceRow, settings, generate),
        group('task', taskSectionLabel, taskRow, stageRow, status),
      );
      resolveCandidates.classList.add('fs-group');
      resolveCandidates.dataset.group = 'candidates';
      const candidateChevron = button('', 'fs-group-toggle', () => {
        const collapsed = resolveCandidates.classList.toggle('is-collapsed');
        candidateChevron.setAttribute('aria-expanded', String(!collapsed));
      });
      candidateChevron.setAttribute('aria-expanded', 'true');
      resolveCandidatesHeading.classList.add('fs-group-header');
      resolveCandidatesHeading.prepend(candidateChevron);
      resolveCandidates.append(candidateBody);
      form.append(resolveCandidates);
    } else {
      form.append(sourceLabel, source);
      form.append(promptLabel, promptBox, recipes, referencesLabel, referenceRow, settings, generate, shortcut);
      form.append(taskRow);
      form.append(status);
      if (applyNative) form.append(applyNative);
    }
    if (isResolve) {
      attachHint(sourceLabel, 'hintClip');
      attachHint(generateLabel, 'hintGenerate');
      attachHint(taskSectionLabel, 'hintTask');
      attachHint(resolveCandidatesHeading, 'hintCandidates');
      root.append(header, form, footer);
    }
    else root.append(header, tabs, form, results, footer);
    if (isResolve) {
      status.hidden = true;
      root.dataset.locale = currentLocale;
      languageZh.setAttribute('aria-pressed', String(currentLocale === 'zh-CN'));
      languageEn.setAttribute('aria-pressed', String(currentLocale === 'en'));
    }
    function setResolveLayout() {
      if (!isResolve) return;
      const canGenerate = resolveProjectAvailable && Boolean(lastSelection);
      for (const node of [generateLabel, promptLabel, promptBox, referencesLabel, referenceRow, settings, generate, shortcut]) {
        if (node) node.hidden = !canGenerate;
      }
      if (groups.generate) groups.generate.hidden = !canGenerate;
      if (taskSectionLabel) taskSectionLabel.hidden = !resolveProjectAvailable || !resolveTaskState;
      if (groups.task) groups.task.hidden = !resolveProjectAvailable || !resolveTaskState;
      taskRow.hidden = !resolveProjectAvailable || !resolveTaskState;
      if (resolveCandidates) resolveCandidates.hidden = !resolveProjectAvailable || (history.length === 0 && !(busy && resolveTaskState === 'generating'));
      if (stageRow) stageRow.hidden = taskRow.hidden || resolveTaskState === 'ready';
      for (const hint of hints) if (hint.label.hidden || hint.label.closest('[hidden]')) { hint.note.hidden = true; hint.marker.setAttribute('aria-expanded', 'false'); hint.marker.classList.remove('is-open'); }
      status.hidden = !status.textContent;
    }
    function renderResolveCandidates() {
      if (!isResolve) return;
      const entries = history.slice().reverse();
      resolveCandidatesHeadingText.textContent = entries.length ? `${t('candidates')} · ${entries.length}` : t('candidates');
      resolveCandidateList.replaceChildren();
      if (busy && resolveTaskState === 'generating') {
        const pending = el('article', undefined, 'fs-resolve-candidate is-pending');
        const frame = el('div', undefined, `fs-candidate-preview fs-checker${pendingPartial ? '' : ' is-skeleton'}`);
        if (pendingPartial) {
          const img = el('img'); img.src = pendingPartial.url; img.alt = t('partialPreview'); frame.append(img);
          const count = pendingPartial.total ? ` ${pendingPartial.index + 1}/${pendingPartial.total}` : '';
          frame.append(el('span', `${t('partialPreview')}${count}`, 'fs-alpha-badge'));
        } else frame.append(el('span', t('partialWaiting'), 'fs-skeleton-text'));
        pending.append(frame, el('div', resolveTaskPrompt, 'fs-resolve-candidate-prompt fs-muted'));
        pending.setAttribute('aria-busy', 'true');
        resolveCandidateList.append(pending);
      }
      for (const item of entries) {
        const row = el('article', undefined, 'fs-resolve-candidate');
        row.append(el('div', item.prompt, 'fs-resolve-candidate-prompt'));
        if (item.selectionLabel) row.append(el('small', `${t('basedOn')} ${item.selectionLabel}`, 'fs-muted'));
        const imported = item.importState === 'imported';
        const unknown = item.importState === 'unknown';
        const stateText = imported ? t('addedToMediaPool')
          : unknown ? t('importUnknown')
          : item.importState === 'failed' ? (item.importError || t('failed')) : t('candidateReady');
        const candidateState = el('small', stateText, unknown ? 'fs-candidate-import-warning' : 'fs-muted');
        if (unknown) candidateState.setAttribute('role', 'status');
        row.append(candidateState);
        const modelId = item.candidate?.persistenceReceipt?.modelId || item.candidate?.artifact?.modelId;
        if (typeof modelId === 'string' && modelId) row.append(el('small', modelId, 'fs-muted fs-candidate-model'));
        const artifact = item.candidate?.artifact;
        const mimeType = typeof artifact?.mimeType === 'string' ? artifact.mimeType : '';
        const canPreview = Boolean(artifact?.blob && (mimeType.startsWith('image/') || mimeType.startsWith('video/')));
        // Result first: the picture leads the card, on a checkerboard so transparency is visible.
        if (canPreview) {
          const previewBox = el('div', undefined, 'fs-candidate-preview fs-checker');
          try {
            item.previewUrl ||= global.URL.createObjectURL(artifact.blob);
            const media = mimeType.startsWith('video/') ? el('video') : el('img');
            media.src = item.previewUrl;
            if (media.tagName === 'VIDEO') { media.controls = true; media.muted = true; media.preload = 'metadata'; media.setAttribute('aria-label', t('preview')); }
            else media.alt = `${item.prompt} — ${t('preview')}`;
            previewBox.append(media);
            if (mimeType.startsWith('image/')) {
              const badge = el('span', t(item.alpha === true ? 'alphaYes' : item.alpha === false ? 'alphaNo' : 'alphaChecking'), `fs-alpha-badge${item.alpha === true ? ' is-alpha' : ''}`);
              badge.hidden = item.alpha !== true && item.alpha !== false;
              if (item.alpha === undefined) void detectAlpha(item);
              previewBox.append(badge);
            }
            row.prepend(previewBox);
          } catch {
            status.textContent = t('previewUnavailable');
          }
        }
        const addButton = button(
          imported ? t('addedToMediaPool')
            : item.importState === 'importing' ? t('adding')
              : unknown ? t('verifyMediaPoolFirst')
              : item.importState === 'failed' ? t('retryAdd') : t('addToMediaPool'),
          imported ? 'fs-recipe fs-candidate-add is-complete' : 'fs-generate fs-candidate-add',
          () => { void addResolveCandidate(item); },
        );
        addButton.disabled = busy || imported || unknown || item.importState === 'importing' || importingCandidateId !== null;
        row.append(addButton);
        resolveCandidateList.append(row);
      }
      setResolveLayout();
    }
    async function detectAlpha(item) {
      // Measure the real pixels; a transparent-background request is not proof of alpha.
      if (item.alphaChecking) return;
      item.alphaChecking = true;
      try {
        const bitmap = await global.createImageBitmap(item.candidate.artifact.blob);
        const width = Math.min(256, bitmap.width), height = Math.max(1, Math.round(bitmap.height * width / bitmap.width));
        const canvasNode = document.createElement('canvas');
        canvasNode.width = width; canvasNode.height = height;
        const context2d = canvasNode.getContext('2d', { willReadFrequently: true });
        context2d.drawImage(bitmap, 0, 0, width, height);
        const data = context2d.getImageData(0, 0, width, height).data;
        let transparent = false;
        for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { transparent = true; break; }
        item.alpha = transparent;
      } catch { item.alpha = null; }
      if (!disposed && item.alpha !== null) renderResolveCandidates();
    }
    function isPersistedResolveCandidate(candidate) {
      const artifact = candidate?.artifact;
      const receipt = candidate?.persistenceReceipt;
      const executionTarget = candidate?.executionTarget;
      const snapshot = executionTarget?.selectionSnapshot;
      const locator = snapshot?.locator;
      const outputTarget = executionTarget?.outputTarget;
      const hostProjectId = outputTarget?.projectId;
      return Boolean(
        typeof candidate?.candidateId === 'string' && candidate.candidateId
        && typeof artifact?.taskId === 'string' && artifact.taskId
        && typeof artifact?.artifactId === 'string' && artifact.artifactId
        && typeof artifact?.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(artifact.sha256)
        && Number.isFinite(artifact?.byteSize) && artifact.byteSize > 0
        && typeof artifact?.mimeType === 'string' && artifact.mimeType
        && receipt?.status === 'persisted'
        && receipt.artifactId === artifact.artifactId
        && receipt.sha256 === artifact.sha256
        && receipt.byteSize === artifact.byteSize
        && receipt.mimeType === artifact.mimeType
        && snapshot?.host === 'resolve'
        && typeof hostProjectId === 'string' && hostProjectId
        && outputTarget?.projectId === locator?.projectId
        && (typeof locator?.clipId === 'string' || typeof locator?.timelineItemId === 'string')
        && outputTarget?.kind === 'media-pool'
        && typeof outputTarget?.sourceSelectionId === 'string' && outputTarget.sourceSelectionId
        && [snapshot.selectionId, locator.clipId, locator.timelineItemId].some(value => typeof value === 'string' && value === outputTarget.sourceSelectionId)
      );
    }
    async function addResolveCandidate(item) {
      const currentController = resolveController();
      if (disposed || !item?.candidateId || item.importState === 'imported' || item.importState === 'unknown' || item.importState === 'importing' || importingCandidateId) return;
      if (typeof currentController?.importCandidate !== 'function') {
        status.textContent = t('irisUnavailable');
        update();
        return;
      }
      item.importState = 'importing';
      item.importError = '';
      importingCandidateId = item.candidateId;
      status.textContent = '';
      renderResolveCandidates();
      try {
        const result = await currentController.importCandidate(item.candidateId);
        if (disposed) return;
        if (result?.importStatus === 'unknown') {
          item.importState = 'unknown';
          return;
        }
        if (result?.importStatus === 'rejected') {
          throw new Error(result?.message || t('importFailed'));
        }
        if (result?.ok !== true) throw new Error(result?.message || t('importNotConfirmed'));
        item.importState = 'imported';
        status.textContent = t('addedToMediaPool');
      } catch (error) {
        if (!disposed) {
          item.importState = 'failed';
          item.importError = t('importFailed');
          status.textContent = item.importError;
        }
      } finally {
        importingCandidateId = null;
        if (!disposed) { renderResolveCandidates(); update(); }
      }
    }
    async function pullCanvasResult() {
      const currentController = resolveController();
      if (disposed || pulling || busy || typeof currentController?.pullCanvasResult !== 'function') return;
      pulling = true; pullFromCanvas.textContent = t('pulling'); update();
      try {
        const result = await currentController.pullCanvasResult();
        if (disposed) return;
        if (!result) { status.textContent = t('nothingToPull'); return; }
        if (!isPersistedResolveCandidate(result)) throw new Error(t('prepareFailed'));
        if (history.some(entry => entry.candidateId === result.candidateId)) return;
        const frozenSelection = result.executionTarget.selectionSnapshot;
        history.push({ candidateId: result.candidateId, candidate: result, prompt: typeof result.prompt === 'string' ? result.prompt : '', selectionLabel: frozenSelection.label || '', importState: 'ready' });
        status.textContent = '';
        renderResolveCandidates();
      } catch (error) {
        if (!disposed) status.textContent = error?.message || t('failed');
      } finally {
        pulling = false;
        if (!disposed) { pullFromCanvas.textContent = t('pullFromCanvas'); update(); }
      }
    }
    function setResolveLocale(nextLocale) {
      if (!isResolve || !resolveCopy[nextLocale] || currentLocale === nextLocale) return;
      currentLocale = nextLocale;
      root.dataset.locale = currentLocale;
      try { global.localStorage?.setItem('flovart.studio.resolve.locale', currentLocale); } catch { /* host storage may be unavailable */ }
      localeToggle.setAttribute('aria-label', t('language'));
      languageZh.title = t('languageChinese'); languageZh.setAttribute('aria-label', t('languageChinese'));
      languageEn.title = t('languageEnglish'); languageEn.setAttribute('aria-label', t('languageEnglish'));
      languageZh.setAttribute('aria-pressed', String(currentLocale === 'zh-CN'));
      languageEn.setAttribute('aria-pressed', String(currentLocale === 'en'));
      sourceLabel.firstChild.textContent = t('currentClip');
      referencesLabelText.textContent = t('references');
      if (generateLabelText) generateLabelText.textContent = t('generate');
      promptLabel.textContent = t('promptLabel');
      prompt.placeholder = t('promptPlaceholder');
      promptFootText.textContent = t('currentReference');
      modelAutoLabel.textContent = t('model'); modelAutoValue.textContent = t('auto');
      modelAutoRow.setAttribute('aria-label', `${t('model')}: ${t('auto')}`);
      outputLabel.textContent = t('output');
      target.setAttribute('aria-label', `${t('output')}: ${t('mediaPool')}`);
      target.options[0].textContent = t('mediaPool');
      taskSectionText.textContent = t('task');
      resolveCandidatesHeadingText.textContent = t('candidates');
      openInIris.textContent = t('openInIris');
      if (pullFromCanvas) pullFromCanvas.textContent = t('pullFromCanvas');
      for (const hint of hints) { hint.note.textContent = t(hint.key); hint.marker.title = t('hintToggle'); hint.marker.setAttribute('aria-label', t('hintToggle')); }
      renderStages(); renderAgentBanner();
      refreshButton.setAttribute('aria-label', t('refreshSelection'));
      if (resolveTaskState === 'generating') {
        taskLabel.textContent = resolveProgress === null
          ? `${t('generating')}${resolveTaskTargetLabel ? ` · ${resolveTaskTargetLabel}` : ''}`
          : `${t('generating')}${resolveTaskTargetLabel ? ` · ${resolveTaskTargetLabel}` : ''} · ${Math.round(resolveProgress * 100)}%`;
      } else if (resolveTaskState === 'ready') taskLabel.textContent = resolveElapsed ? `✓ ${t('readyIn')} ${formatElapsed(resolveElapsed)}` : t('ready');
      else if (resolveTaskState === 'failed') taskLabel.textContent = t('failed');
      if (lastSelection) {
        referenceChip.textContent = lastSelection.label || t('noSelection');
        const sourceKind = lastSelection.locator?.clipId ? t('mediaPoolClip') : lastSelection.locator?.timelineItemId ? t('timelineItem') : '';
        dimensions.textContent = sourceKind;
        dimensions.hidden = !sourceKind;
      } else {
        referenceChip.textContent = resolveProjectAvailable ? t('noSelection') : t('noProject');
        dimensions.textContent = '';
        dimensions.hidden = true;
      }
      renderResolveCandidates();
      update();
    }
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
      if (isResolve) return;
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
      const currentController = resolveController();
      const linked = isResolve
        ? typeof currentController?.prepareCandidate === 'function' && typeof currentController?.importCandidate === 'function'
        : Boolean(currentController);
      const nativeCandidateMatchesDocument = adapter.id !== 'after-effects'
        || Boolean(lastNativeCandidate?.documentId && lastNativeCandidate.documentId === activeDocumentId);
      promptCount.textContent = String(prompt.value.length);
      generate.disabled = busy || importingCandidateId !== null || !linked || !lastSelection || !prompt.value.trim();
      if (applyNative) {
        applyNative.hidden = !lastNativeCandidate || !nativeCandidateMatchesDocument;
        applyNative.disabled = busy || Boolean(applyingCandidateId) || !lastNativeCandidate || !nativeCandidateMatchesDocument || lastNativeCandidate.mediaAvailable === false;
      }
      model.disabled = busy;
      target.disabled = busy;
      generate.setAttribute('aria-busy', String(busy));
      if (isResolve) {
        generate.disabled = busy || importingCandidateId !== null || !linked || !resolveProjectAvailable || !lastSelection || !prompt.value.trim();
        generate.textContent = busy ? `${t('generating')}` : preview ? t('demoGenerate') : t('generateCandidate');
        headerStatus.textContent = !resolveProjectAvailable
          ? `○  ${t('resolveUnavailable')}`
          : !linked ? `○  ${t('irisUnavailable')}`
            : !lastSelection ? `○  ${t('selectClipStatus')}`
              : `●  ${t('readyStatus')}`;
        headerStatus.className = `fs-header-status ${resolveProjectAvailable && linked && lastSelection ? 'fs-success' : 'fs-muted'}`;
        pullFromCanvas.hidden = typeof currentController?.pullCanvasResult !== 'function';
        pullFromCanvas.disabled = busy || pulling;
        languageZh.setAttribute('aria-pressed', String(currentLocale === 'zh-CN'));
        languageEn.setAttribute('aria-pressed', String(currentLocale === 'en'));
        if (resolveTaskState === 'generating') {
          taskLabel.textContent = resolveProgress === null
            ? `${t('generating')}${resolveTaskTargetLabel ? ` · ${resolveTaskTargetLabel}` : ''} · ${formatElapsed(Date.now() - taskStart)}`
            : `${t('generating')}${resolveTaskTargetLabel ? ` · ${resolveTaskTargetLabel}` : ''} · ${Math.round(resolveProgress * 100)}%`;
        } else if (resolveTaskState === 'ready') taskLabel.textContent = resolveElapsed ? `✓ ${t('readyIn')} ${formatElapsed(resolveElapsed)}` : t('ready');
        else if (resolveTaskState === 'failed') taskLabel.textContent = t('failed');
        setResolveLayout();
      } else {
        generate.textContent = busy ? '正在制作…' : preview ? '✦  演示生成并添加' : '✦  生成并添加';
        connection.textContent = preview ? '○  示例素材' : linked ? '●  Iris 已连接' : '○  等待 Iris';
        connection.className = linked && !preview ? 'fs-success' : 'fs-muted';
        if (!linked && !status.textContent) status.textContent = '连接 Iris 后即可使用当前工作流制作。';
      }
    }
    function refreshModels() {
      if (isResolve) return;
      const choices = resolveController()?.models;
      const list = Array.isArray(choices) && choices.length ? choices : [{ label: '自动', value: 'auto' }];
      model.replaceChildren(...list.map(item => option(item.label || item.name || item.id, item.value || item.id)));
    }
    function rangeText(range) {
      const fps = Number(range?.fps), start = Number(range?.startFrame), end = Number(range?.endFrame);
      if (!(fps > 0) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
      const base = Math.round(fps);
      const tc = frame => {
        const f = Math.max(0, Math.round(frame));
        const pad = n => String(n).padStart(2, '0');
        return `${pad(Math.floor(f / (base * 3600)))}:${pad(Math.floor(f / (base * 60)) % 60)}:${pad(Math.floor(f / base) % 60)}:${pad(f % base)}`;
      };
      return `${tc(start)} – ${tc(end)}`;
    }
    function progressOf(value) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(1, Math.max(0, number > 1 ? number / 100 : number)) : null;
    }
    function formatElapsed(ms) {
      const seconds = Math.max(0, Math.round(ms / 1000));
      if (isResolve && currentLocale === 'en') return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
      return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    }
    function taskTick() {
      if (isResolve) {
        taskLabel.textContent = `${t('generating')}${resolveTaskTargetLabel ? ` · ${resolveTaskTargetLabel}` : ''} · ${formatElapsed(Date.now() - taskStart)}`;
        return;
      }
      taskLabel.textContent = `制作中… ${formatElapsed(Date.now() - taskStart)}`;
    }
    function taskStartRow() {
      taskStart = Date.now();
      if (isResolve) { resolveTaskState = 'generating'; resolveProgress = null; resolveStage = 'submitting'; pendingPartial = null; taskRow.classList.remove('is-done'); renderStages(); }
      taskRow.hidden = false;
      taskBarFill.style.width = '';
      taskRow.classList.add('is-indeterminate');
      taskTick();
      taskTimer = global.setInterval(taskTick, 500);
      if (isResolve) { renderResolveCandidates(); update(); }
    }
    function taskProgress(value) {
      if (isResolve && value && typeof value === 'object') {
        // Structured stream event: { stage?, progress?, partialImage?, partialIndex?, partialTotal? }
        if (stageKeys.includes(value.stage)) { resolveStage = value.stage; renderStages(); }
        if (value.partialImage && (typeof value.partialImage === 'string' || value.partialImage instanceof global.Blob)) {
          if (pendingPartial?.url && pendingPartial.owned) global.URL?.revokeObjectURL?.(pendingPartial.url);
          const owned = typeof value.partialImage !== 'string';
          let url = '';
          try { url = owned ? global.URL.createObjectURL(value.partialImage) : value.partialImage; } catch { url = ''; }
          if (url && (owned || /^(data:image\/|blob:|https:)/.test(url))) {
            pendingPartial = { url, owned, index: Number(value.partialIndex) || 0, total: Number(value.partialTotal) || 0 };
            renderResolveCandidates();
          }
        }
        if (value.progress === undefined || value.progress === null) return;
        value = value.progress;
      }
      const fraction = progressOf(value);
      if (fraction === null) return;
      if (isResolve) resolveProgress = fraction;
      taskRow.classList.remove('is-indeterminate');
      taskBarFill.style.width = `${Math.round(fraction * 100)}%`;
      taskLabel.textContent = isResolve
        ? `${t('generating')}${resolveTaskTargetLabel ? ` · ${resolveTaskTargetLabel}` : ''} · ${Math.round(fraction * 100)}%`
        : `制作中… ${Math.round(fraction * 100)}%`;
    }
    function taskStopRow(preserveResolveState = false) {
      if (taskTimer) { global.clearInterval(taskTimer); taskTimer = null; }
      if (isResolve) {
        resolveElapsed = Date.now() - taskStart;
        if (pendingPartial?.owned) global.URL?.revokeObjectURL?.(pendingPartial.url);
        pendingPartial = null;
        taskRow.classList.toggle('is-done', resolveTaskState === 'ready');
        taskRow.classList.toggle('is-failed', resolveTaskState === 'failed');
        renderStages();
      }
      taskRow.hidden = isResolve && preserveResolveState ? false : true;
      taskRow.classList.remove('is-indeterminate');
      taskBarFill.style.width = '';
      if (isResolve && preserveResolveState) update();
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
      let contextRead = false;
      try {
        const current = await adapter.getContext();
        contextRead = true;
        if (isResolve) resolveProjectAvailable = Boolean(current.available);
        const nextDocumentId = current.available && current.documentId ? String(current.documentId) : null;
        const documentChanged = nextDocumentId !== activeDocumentId;
        activeDocumentId = nextDocumentId;
        const selected = current.available ? await adapter.getSelection() : null;
        if (disposed) return;
        lastSelection = selected;
        if (isResolve) {
          const projectName = current.available ? current.title || current.documentName || '' : '';
          context.textContent = projectName;
          context.hidden = !projectName;
          reference.textContent = selected?.label || (current.available ? t('noSelection') : t('noProject'));
          const sourceKind = selected?.locator?.clipId ? t('mediaPoolClip') : selected?.locator?.timelineItemId ? t('timelineItem') : '';
          const range = rangeText(selected?.range);
          dimensions.textContent = [sourceKind || (selected?.width && selected?.height ? `${Math.round(selected.width)} × ${Math.round(selected.height)}` : ''), range].filter(Boolean).join(' · ');
          dimensions.hidden = !dimensions.textContent;
          referenceChip.textContent = selected?.label || (current.available ? t('noSelection') : t('noProject'));
          referenceChip.title = selected?.label || (current.available ? t('selectClip') : t('openProject'));
        } else {
          context.textContent = current.title || current.documentName || `${hostLabel} · 尚未打开文档`;
          reference.textContent = selected?.label || '请先选择一个素材';
          dimensions.textContent = selected?.width && selected?.height ? `${Math.round(selected.width)} × ${Math.round(selected.height)} · ${selected.kind === 'video' ? '视频参考' : '图像参考'}` : selected ? '使用当前选择作为参考' : '等待宿主选择';
          referenceChip.textContent = selected?.label || '当前选择';
        }
        referenceChip.className = `fs-reference-chip${selected ? '' : ' fs-muted'}`;
        if (!isResolve) referenceChip.title = selected ? `${selected.label} · ${selected.kind === 'video' ? '视频' : '图像'}` : '请先选择一个素材';
        if (preview && selected?.previewUrl) {
          if (thumb.firstChild?.src !== selected.previewUrl) {
            const img = el('img'); img.src = selected.previewUrl; img.alt = selected.label; thumb.replaceChildren(img);
          }
        } else if (!isResolve) thumb.textContent = selected ? '▧' : '+';
        if (documentChanged) {
          updateHistoryTab();
          if (activeTab === 'history' && activeDocumentId) void loadPersistedCandidates();
          if (activeTab === 'history') renderHistory();
        }
        if (isResolve) renderResolveCandidates();
      } catch (error) {
        if (disposed) return;
        lastSelection = null;
        if (isResolve) {
          if (!contextRead) resolveProjectAvailable = false;
          const emptyLabel = resolveProjectAvailable ? t('noSelection') : t('noProject');
          reference.textContent = emptyLabel;
          referenceChip.textContent = emptyLabel;
          context.textContent = '';
          context.hidden = true;
          dimensions.textContent = '';
          dimensions.hidden = true;
          referenceChip.title = resolveProjectAvailable ? t('selectClip') : t('openProject');
        } else reference.textContent = '无法读取当前选择';
        status.textContent = error?.message || '宿主上下文不可用。';
      } finally { reading = false; update(); }
    }
    async function run() {
      const currentController = resolveController();
      if (busy || !currentController || (isResolve && (typeof currentController.prepareCandidate !== 'function' || typeof currentController.importCandidate !== 'function')) || !lastSelection || !prompt.value.trim()) return;
      busy = true;
      const submittedPrompt = prompt.value.trim();
      const submittedSelectionLabel = lastSelection.label || '';
      resolveTaskTargetLabel = isResolve ? submittedSelectionLabel : '';
      resolveTaskPrompt = submittedPrompt;
      if (isResolve) status.textContent = '';
      taskStartRow();
      update();
      try {
        const result = isResolve
          ? await currentController.prepareCandidate(submittedPrompt, { kind: target.value }, taskProgress)
          : await currentController.generate(submittedPrompt, { ...defaultImportTarget, kind: target.value }, taskProgress);
        if (disposed) return;
        if (isResolve) {
          if (!isPersistedResolveCandidate(result)) throw new Error(t('prepareFailed'));
          const frozenSelection = result.executionTarget.selectionSnapshot;
          const item = {
            candidateId: result.candidateId,
            candidate: result,
            prompt: submittedPrompt,
            selectionLabel: frozenSelection.label || submittedSelectionLabel,
            importState: 'ready',
          };
          history.push(item);
          resolveTaskTargetLabel = item.selectionLabel;
          resolveTaskState = 'ready';
          resolveProgress = null;
          status.textContent = '';
          renderResolveCandidates();
          return;
        }
        if (result?.import?.ok === false) throw new Error(result.import.message || '结果添加失败，请重试。');
        const message = result?.import?.message || (isResolve ? t('addedToMediaPool') : '已添加新结果');
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
          ...(isResolve ? { selectionLabel: submittedSelectionLabel } : {}),
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
        if (isResolve) {
          resolveTaskState = 'ready';
          status.textContent = message;
          renderResolveCandidates();
        }
        updateHistoryTab();
        if (activeTab === 'history') showTab('history');
      } catch (error) {
        if (!disposed) {
          if (isResolve) resolveTaskState = 'failed';
          status.textContent = error?.message || (isResolve ? t('failed') : '制作失败，请重试。');
        }
      } finally {
        busy = false;
        taskStopRow(isResolve);
        if (!disposed) { if (isResolve) renderResolveCandidates(); update(); }
      }
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
    if (isResolve) global.addEventListener?.('flovart:agent-request', onAgentRequest);
    const subscription = adapter.subscribeContext?.(() => { void refresh(); });
    void refresh(); update();
    return { refresh, dispose() {
      disposed = true;
      taskStopRow();
      subscription?.dispose();
      global.removeEventListener?.('flovart:link-ready', onReady);
      global.removeEventListener?.('flovart:agent-request', onAgentRequest);
      if (isResolve) for (const item of history) if (item.previewUrl) global.URL?.revokeObjectURL?.(item.previewUrl);
    } };
  }
  global.FlovartStudioUI = { mountInspector };
})(typeof window !== 'undefined' ? window : globalThis);
