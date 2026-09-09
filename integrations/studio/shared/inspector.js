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
    let disposed = false, busy = false, reading = false, lastSelection = null, activeTab = 'make';
    const history = [];
    const resolveController = () => getController ? getController() : controller;
    const header = el('header', undefined, 'fs-header');
    const brand = el('div', undefined, 'fs-brand');
    brand.append(el('span', 'f', 'fs-logo'), el('strong', 'Flovart'), el('span', 'STUDIO', 'fs-wordmark'));
    const canvas = button('↗', 'fs-icon-button', () => {
      if (onOpenCanvas) Promise.resolve().then(() => onOpenCanvas()).catch(error => { if (!disposed) status.textContent = error.message; });
      else status.textContent = '请连接 Flovart 后打开画布。';
    });
    canvas.title = '展开 Flovart 画布';
    canvas.setAttribute('aria-label', canvas.title);
    header.append(brand, canvas);
    const tabs = el('nav', undefined, 'fs-tabs');
    tabs.setAttribute('aria-label', 'Flovart 面板');
    const makeTab = button('制作', 'fs-tab is-active', () => showTab('make'));
    const historyTab = button('本次记录', 'fs-tab', () => showTab('history'));
    tabs.append(makeTab, historyTab);
    const form = el('div', undefined, 'fs-form');
    const sourceLabel = el('div', undefined, 'fs-section-label');
    const refreshButton = button('↻', 'fs-icon-button', () => { void refresh(); });
    refreshButton.setAttribute('aria-label', '刷新宿主选择');
    sourceLabel.append(el('span', '来自当前选择'), refreshButton);
    const source = el('div', undefined, 'fs-source');
    const thumb = el('div', '▧', 'fs-source-thumb');
    const sourceInfo = el('div', undefined, 'fs-source-info');
    const reference = el('strong', '选择一个图层或素材');
    const context = el('span', hostLabel, 'fs-muted');
    const dimensions = el('span', '等待宿主选择', 'fs-mono fs-muted');
    sourceInfo.append(reference, context, dimensions);
    source.append(thumb, sourceInfo);
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
    const method = el('div', undefined, 'fs-setting-row');
    method.append(el('span', '制作方式'), el('span', 'Flovart 工作流', 'fs-muted'));
    const output = el('label', undefined, 'fs-setting-row');
    const target = el('select');
    target.setAttribute('aria-label', '输出位置');
    if (adapter.id === 'premiere') target.append(option('项目素材箱', 'project'));
    else if (adapter.id === 'after-effects') target.append(option('当前合成 · 新图层', 'new-layer'), option('项目素材箱', 'project'));
    else target.append(option('当前文档 · 新图层', 'new-layer'));
    target.value = defaultImportTarget.kind;
    output.append(el('span', '添加到'), target);
    settings.append(method, output);
    const generate = button(preview ? '✦  演示生成并添加' : '✦  生成并添加', 'fs-generate');
    const status = el('p', '', 'fs-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const results = el('div', undefined, 'fs-history');
    results.hidden = true;
    const footer = el('footer', undefined, 'fs-footer');
    const connection = el('span');
    footer.append(connection, el('span', preview ? '交互预览' : hostLabel, 'fs-muted'));
    form.append(sourceLabel, source, promptLabel, promptBox, recipes, settings, generate, el('div', 'Ctrl / ⌘ + Enter', 'fs-shortcut fs-mono'), status);
    root.append(header, tabs, form, results, footer);
    function showTab(tab) {
      activeTab = tab;
      form.hidden = tab !== 'make'; results.hidden = tab !== 'history';
      makeTab.className = `fs-tab${tab === 'make' ? ' is-active' : ''}`;
      historyTab.className = `fs-tab${tab === 'history' ? ' is-active' : ''}`;
      makeTab.setAttribute('aria-current', tab === 'make' ? 'page' : 'false');
      historyTab.setAttribute('aria-current', tab === 'history' ? 'page' : 'false');
      if (tab === 'history') {
        results.replaceChildren(el('p', history.length ? '本次会话的制作记录' : '你的下一个灵感，从这里开始。', 'fs-muted'));
        history.slice().reverse().forEach(item => {
          const row = el('div', undefined, 'fs-history-item');
          row.append(el('span', '✓', 'fs-success'), el('div', item.prompt), el('small', item.message, 'fs-muted'));
          results.append(row);
        });
      }
    }
    function update() {
      if (disposed) return;
      const linked = Boolean(resolveController());
      promptCount.textContent = String(prompt.value.length);
      generate.disabled = busy || !linked || !lastSelection || !prompt.value.trim();
      target.disabled = busy;
      generate.textContent = busy ? '正在制作…' : preview ? '✦  演示生成并添加' : '✦  生成并添加';
      generate.setAttribute('aria-busy', String(busy));
      connection.textContent = preview ? '○  示例素材' : linked ? '●  Flovart 已连接' : '○  等待 Flovart';
      connection.className = linked && !preview ? 'fs-success' : 'fs-muted';
      if (!linked && !status.textContent) status.textContent = '连接 Flovart 后即可使用当前工作流制作。';
    }
    async function refresh() {
      if (disposed || reading) return;
      reading = true;
      try {
        const current = await adapter.getContext();
        const selected = current.available ? await adapter.getSelection() : null;
        if (disposed) return;
        lastSelection = selected;
        context.textContent = current.title || current.documentName || `${hostLabel} · 尚未打开文档`;
        reference.textContent = selected?.label || '请先选择一个素材';
        dimensions.textContent = selected?.width && selected?.height ? `${Math.round(selected.width)} × ${Math.round(selected.height)} · ${selected.kind === 'video' ? '视频参考' : '图像参考'}` : selected ? '使用当前选择作为参考' : '等待宿主选择';
        if (preview && selected?.previewUrl) {
          if (thumb.firstChild?.src !== selected.previewUrl) {
            const img = el('img'); img.src = selected.previewUrl; img.alt = selected.label; thumb.replaceChildren(img);
          }
        } else thumb.textContent = selected ? '▧' : '+';
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
      status.textContent = preview ? '正在演示素材进入画布与结果回填…' : '正在通过 Flovart 工作流制作…';
      update();
      try {
        const result = await currentController.generate(submittedPrompt, { ...defaultImportTarget, kind: target.value });
        if (disposed) return;
        if (result?.import?.ok === false) throw new Error(result.import.message || '结果添加失败，请重试。');
        const message = result?.import?.message || '已添加新结果';
        history.push({ prompt: submittedPrompt, message }); status.textContent = message;
        historyTab.textContent = `本次记录 · ${history.length}`;
        if (activeTab === 'history') showTab('history');
      } catch (error) { if (!disposed) status.textContent = error?.message || '制作失败，请重试。'; }
      finally { busy = false; update(); }
    }
    generate.addEventListener('click', run);
    prompt.addEventListener('input', update);
    prompt.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); }
    });
    const onReady = () => { status.textContent = ''; void refresh(); };
    global.addEventListener?.('flovart:link-ready', onReady);
    const subscription = adapter.subscribeContext?.(() => { void refresh(); });
    void refresh(); update();
    return { refresh, dispose() { disposed = true; subscription?.dispose(); global.removeEventListener?.('flovart:link-ready', onReady); } };
  }
  global.FlovartStudioUI = { mountInspector };
})(typeof window !== 'undefined' ? window : globalThis);
