// Flovart Popup — Entry point actions
document.addEventListener('DOMContentLoaded', () => {
  const EXTERNAL_LINKS = {
    demo: 'https://paker-kk.github.io/Flovart/',
    github: 'https://github.com/Paker-kk/Flovart',
    issues: 'https://github.com/Paker-kk/Flovart/issues',
  };

  const PROVIDER_HINTS = {
    google: '官方 Gemini Key，适合文本、图像、视频生成。',
    openai: '官方 OpenAI Key，适合文本与图像能力。',
    openrouter: '聚合路由入口，适合快速切换多家模型。',
    deepseek: 'DeepSeek 官方文本模型。',
    siliconflow: 'SiliconFlow 聚合入口，适合国产模型分发。',
    anthropic: 'Anthropic Claude 官方文本模型。',
    minimax: 'MiniMax 兼容文本、图像、视频。',
    volcengine: '火山引擎 Ark / 豆包系模型入口。',
    qwen: '通义千问兼容接口。',
    custom: '自定义 OpenAI 兼容端点，适合第三方代理、One-API、LiteLLM。',
  };

  const PROVIDER_KEY_PLACEHOLDERS = {
    google: 'AIza... 或 Gemini Key',
    openai: 'sk-proj-... 或 sk-...',
    openrouter: 'sk-or-...',
    deepseek: 'sk-...',
    siliconflow: 'sk-sf...',
    anthropic: 'sk-ant-...',
    minimax: 'Bearer Token / JWT',
    volcengine: 'Volcengine API Key',
    qwen: 'DashScope API Key',
    custom: '第三方 API Key',
  };

  // ─── Provider capability defaults (与 Web App DEFAULT_PROVIDER_MODELS 对齐) ───
  const PROVIDER_CAPABILITIES = {
    google: ['text', 'image', 'video'],
    openai: ['text', 'image'],
    openrouter: ['text', 'image'],
    deepseek: ['text'],
    siliconflow: ['text'],
    anthropic: ['text'],
    minimax: ['text', 'image', 'video'],
    volcengine: ['text'],
    qwen: ['text'],
    custom: ['text', 'image', 'video'],
  };

  // 桥必须由 popup.html 提前注入（shared/crypto.js + shared/keyBridge.js）
  const Bridge = globalThis.FlovartKeyBridge;
  const Crypto = globalThis.FlovartCrypto;

  function trimTrailingSlashes(value) {
    return (value || '').trim().replace(/\/+$/, '');
  }

  function safeParseUrl(value) {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }

  function isRootPath(pathname) {
    return pathname === '' || pathname === '/';
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function normalizeProviderBaseUrl(provider, baseUrl) {
    const trimmed = trimTrailingSlashes(baseUrl);
    if (!trimmed) return trimmed;

    if (provider === 'google') {
      return trimmed.replace(/\/models$/i, '');
    }

    const parsed = safeParseUrl(trimmed);
    if (!parsed || !isRootPath(parsed.pathname)) {
      return trimmed;
    }

    const origin = parsed.origin;
    if (provider === 'openrouter' || /openrouter/i.test(parsed.hostname)) {
      return `${origin}/api/v1`;
    }
    if (provider === 'qwen' || /dashscope\.aliyuncs\.com/i.test(parsed.hostname)) {
      return `${origin}/compatible-mode/v1`;
    }
    if (provider === 'volcengine' || /volces\.com/i.test(parsed.hostname)) {
      return `${origin}/api/v3`;
    }
    return `${origin}/v1`;
  }

  function getOpenAICompatibleBaseUrlCandidates(provider, baseUrl) {
    const trimmed = trimTrailingSlashes(baseUrl);
    if (!trimmed) return [];

    const normalized = normalizeProviderBaseUrl(provider, trimmed);
    const parsed = safeParseUrl(trimmed);
    if (!parsed || !isRootPath(parsed.pathname)) {
      return unique([normalized, trimmed]);
    }

    const origin = parsed.origin;
    const candidates = provider === 'openrouter' || /openrouter/i.test(parsed.hostname)
      ? [`${origin}/api/v1`, normalized, trimmed, `${origin}/v1`]
      : [normalized, trimmed, `${origin}/v1`, `${origin}/api/v1`];

    if (provider === 'qwen' || /dashscope\.aliyuncs\.com/i.test(parsed.hostname)) {
      candidates.push(`${origin}/compatible-mode/v1`);
    }
    if (provider === 'volcengine' || /volces\.com/i.test(parsed.hostname)) {
      candidates.push(`${origin}/api/v3`);
    }

    return unique(candidates);
  }

  function looksLikeHtmlResponse(text) {
    return /^\s*<(?:!doctype|html|head|body)\b/i.test(text || '');
  }

  function extractErrorDetail(status, text) {
    if (!text) return `HTTP ${status}`;
    if (looksLikeHtmlResponse(text)) {
      return '返回了网页 HTML，请确认 Base URL 指向 API 根地址';
    }
    try {
      const json = JSON.parse(text);
      return json?.error?.message || json?.message || json?.detail || `HTTP ${status}`;
    } catch {
      return text.replace(/\s+/g, ' ').trim().slice(0, 180);
    }
  }

  function inferCapabilityFromModelId(modelId) {
    const value = String(modelId || '').toLowerCase();
    if (!value) return 'text';
    if (/(veo|video|kling|hailuo|pixverse|seedance|wan|ltx|sora|minimax-video)/i.test(value)) {
      return 'video';
    }
    if (/(image|imagen|gpt-image|dall-e|flux|midjourney|recraft|sdxl|banana|nano-banana)/i.test(value)) {
      return 'image';
    }
    return 'text';
  }

  function sanitizeModels(rawModels) {
    return (rawModels || [])
      .map(model => {
        const id = model?.id || model?.name;
        if (!id) return null;
        return {
          id,
          name: model?.name || id,
        };
      })
      .filter(Boolean)
      .slice(0, 60);
  }

  function summarizeCapabilities(models, fallback) {
    if (!models.length) return fallback;
    const set = new Set(models.map(model => inferCapabilityFromModelId(model.id)));
    const ordered = ['text', 'image', 'video'].filter(capability => set.has(capability));
    return ordered.length ? ordered : fallback;
  }

  async function detectCompatibleBaseUrl(provider, baseUrl, apiKey) {
    const candidates = getOpenAICompatibleBaseUrlCandidates(provider, baseUrl);
    let lastError = '未能识别兼容 API 根地址';

    for (const candidate of candidates) {
      try {
        const response = await fetch(`${candidate}/models`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
        const text = await response.text().catch(() => '');

        if (!response.ok) {
          lastError = extractErrorDetail(response.status, text);
          if (looksLikeHtmlResponse(text) || (response.status === 404 && /invalid url|you may need|get \/v1\/models/i.test(text))) {
            continue;
          }
          return { ok: false, error: lastError };
        }

        if (looksLikeHtmlResponse(text)) {
          lastError = '返回了网页 HTML，请确认 Base URL 指向 API 根地址';
          continue;
        }

        const data = text ? JSON.parse(text) : {};
        const models = sanitizeModels(data?.data || data?.models || []);
        return {
          ok: true,
          effectiveBaseUrl: candidate,
          models,
          capabilities: summarizeCapabilities(models, ['text', 'image', 'video']),
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : '网络错误';
      }
    }

    return { ok: false, error: lastError };
  }

  function getKeyFingerprint(entry) {
    return `${entry.provider || ''}::${entry.key || ''}::${trimTrailingSlashes(entry.baseUrl || '')}`;
  }

  function registerExternalLink(buttonId, url) {
    const element = document.getElementById(buttonId);
    if (!element) return;
    element.addEventListener('click', () => {
      chrome.tabs.create({ url });
      window.close();
    });
  }

  // Open full canvas in new tab
  const openBtn = document.getElementById('openCanvas');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      const canvasUrl = chrome.runtime.getURL('app/index.html');
      chrome.tabs.create({ url: canvasUrl });
      window.close();
    });
  }

  // Capture current tab screenshot → send to canvas
  const captureBtn = document.getElementById('captureTab');
  if (captureBtn) {
    captureBtn.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;
        const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
        await chrome.storage.local.set({
          flovart_pending_image: {
            dataUrl,
            source: 'screenshot',
            name: `Screenshot — ${tab.title || 'Page'}`,
            timestamp: Date.now(),
          },
        });
        const canvasUrl = chrome.runtime.getURL('app/index.html');
        chrome.tabs.create({ url: canvasUrl });
        window.close();
      } catch (err) {
        console.error('[Flovart] Capture failed:', err);
        updateStatus('截图失败', false);
      }
    });
  }

  // Collect all images from current page → send to canvas
  const collectBtn = document.getElementById('collectImages');
  if (collectBtn) {
    collectBtn.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;

        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const imgs = Array.from(document.querySelectorAll('img'));
            return imgs
              .map(img => ({ src: img.src || img.currentSrc, alt: img.alt || '', width: img.naturalWidth, height: img.naturalHeight }))
              .filter(i => i.src && i.width > 100 && i.height > 100);
          },
        });

        const images = results?.[0]?.result || [];
        if (images.length === 0) {
          updateStatus('未找到有效图片', false);
          return;
        }

        await chrome.storage.local.set({
          flovart_collected_images: {
            images,
            source: tab.url,
            timestamp: Date.now(),
          },
        });

        updateStatus(`找到 ${images.length} 张图片`, true);
        const canvasUrl = chrome.runtime.getURL('app/index.html');
        chrome.tabs.create({ url: canvasUrl });
        window.close();
      } catch (err) {
        console.error('[Flovart] Collect failed:', err);
        updateStatus('采集失败', false);
      }
    });
  }

  // --- API Key Configuration ---
  const keyIndicator = document.getElementById('keyIndicator');
  const keyStatusText = document.getElementById('keyStatusText');
  const quickKeySetup = document.getElementById('quickKeySetup');
  const toggleKeySetup = document.getElementById('toggleKeySetup');
  const toggleKeyText = document.getElementById('toggleKeyText');
  const providerSelect = document.getElementById('providerSelect');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const providerHint = document.getElementById('providerHint');
  const customBaseUrlWrap = document.getElementById('customBaseUrlWrap');
  const baseUrlInput = document.getElementById('baseUrlInput');
  const saveKeyBtn = document.getElementById('saveKeyBtn');
  const keySaveStatus = document.getElementById('keySaveStatus');

  let keySetupVisible = false;

  registerExternalLink('openDemoLink', EXTERNAL_LINKS.demo);
  registerExternalLink('openGithubLink', EXTERNAL_LINKS.github);
  registerExternalLink('openIssuesLink', EXTERNAL_LINKS.issues);

  function syncProviderUi() {
    const provider = providerSelect?.value || 'google';
    if (providerHint) {
      providerHint.textContent = PROVIDER_HINTS[provider] || '粘贴 API Key 后可快速同步到画布。';
    }
    if (apiKeyInput) {
      apiKeyInput.placeholder = PROVIDER_KEY_PLACEHOLDERS[provider] || '粘贴 API Key...';
    }
    if (customBaseUrlWrap) {
      customBaseUrlWrap.style.display = provider === 'custom' ? 'flex' : 'none';
    }
  }

  if (providerSelect) {
    providerSelect.addEventListener('change', syncProviderUi);
    syncProviderUi();
  }

  // 渲染 key 状态：列出所有 key，附数据源标签 (Tauri / 本地)
  function renderKeyStatus(keys) {
    if (!keyIndicator || !keyStatusText) return;
    if (keys.length > 0) {
      keyIndicator.classList.remove('empty');
      keyIndicator.classList.add('active');
      const providers = [...new Set(keys.map(k => k.provider))];
      const tauri = Bridge?.isTauriAvailable();
      // 异步探测 Tauri 可用性 → 显示数据源
      Promise.resolve(tauri).then((onTauri) => {
        const source = onTauri ? 'Tauri 桌面' : '本地';
        keyStatusText.textContent = `已配置 ${keys.length} 个 Key（${providers.join(', ')}）· ${source}`;
      });
    } else {
      keyIndicator.classList.remove('active');
      keyIndicator.classList.add('empty');
      keyStatusText.textContent = '未配置 API Key — 右键反推需要 Key';
    }
  }

  // Load existing keys and show status (通过 keyBridge 走 Tauri 优先 + 本地 fallback)
  if (Bridge) {
    Bridge.listKeys()
      .then(renderKeyStatus)
      .catch((err) => {
        console.warn('[Flovart] listKeys failed:', err);
        if (keyIndicator) keyIndicator.classList.add('empty');
        if (keyStatusText) keyStatusText.textContent = '未配置 API Key — 右键反推需要 Key';
      });
  } else {
    if (keyIndicator) keyIndicator.classList.add('empty');
    if (keyStatusText) keyStatusText.textContent = '扩展脚本加载异常';
  }

  // Toggle key setup panel
  if (toggleKeySetup) {
    toggleKeySetup.addEventListener('click', () => {
      keySetupVisible = !keySetupVisible;
      quickKeySetup.style.display = keySetupVisible ? 'flex' : 'none';
      toggleKeyText.textContent = keySetupVisible ? '收起配置' : '配置 API Key';
    });
  }

  // Save key
  if (saveKeyBtn) {
    saveKeyBtn.addEventListener('click', async () => {
      const provider = providerSelect.value;
      const apiKey = apiKeyInput.value.trim();
      const requestedBaseUrl = trimTrailingSlashes(baseUrlInput?.value || '');

      if (!apiKey) {
        showKeySaveStatus('请输入 API Key', 'error');
        return;
      }

      if (apiKey.length < 10) {
        showKeySaveStatus('API Key 格式不正确', 'error');
        return;
      }

      try {
        const existing = await Bridge.listKeys();
        let effectiveBaseUrl = '';
        let discoveredModels = [];
        let capabilities = PROVIDER_CAPABILITIES[provider] || ['text'];
        let extraConfig;

        if (provider === 'custom') {
          if (!requestedBaseUrl) {
            showKeySaveStatus('自定义兼容端点必须填写 Base URL', 'error');
            return;
          }

          showKeySaveStatus('正在识别兼容端点与模型...', 'info');
          const detection = await detectCompatibleBaseUrl(provider, requestedBaseUrl, apiKey);
          if (!detection.ok) {
            showKeySaveStatus(`识别失败：${detection.error}`, 'error');
            return;
          }

          effectiveBaseUrl = detection.effectiveBaseUrl;
          discoveredModels = detection.models || [];
          capabilities = detection.capabilities || capabilities;
          extraConfig = { endpointFlavor: 'openai-compatible' };
          if (baseUrlInput) {
            baseUrlInput.value = effectiveBaseUrl;
          }
        }

        // 重复检测
        const fingerprint = getKeyFingerprint({
          provider,
          key: apiKey,
          baseUrl: effectiveBaseUrl || requestedBaseUrl,
        });
        const duplicate = existing.findIndex(k => getKeyFingerprint(k) === fingerprint);
        if (duplicate >= 0) {
          showKeySaveStatus('该 Key 已存在', 'error');
          return;
        }

        const now = Date.now();
        const newKey = {
          provider,
          key: apiKey,
          capabilities,
          baseUrl: effectiveBaseUrl || undefined,
          name: provider === 'custom' && effectiveBaseUrl
            ? new URL(effectiveBaseUrl).host
            : undefined,
          isDefault: existing.length === 0,
          status: 'unknown',
          models: discoveredModels,
          extraConfig,
          createdAt: now,
          updatedAt: now,
        };

        const saved = await Bridge.saveKey(newKey);

        // 重新拉取并刷新 UI
        const allKeys = await Bridge.listKeys();
        renderKeyStatus(allKeys);

        apiKeyInput.value = '';
        if (saved?._source === 'tauri') {
          showKeySaveStatus(`保存成功 · 同步到 Flovart 桌面`, 'success');
        } else if (provider === 'custom') {
          showKeySaveStatus(
            `保存成功（本地），已识别 ${discoveredModels.length || 0} 个模型`,
            'success'
          );
        } else {
          showKeySaveStatus('保存成功（本地），画布中也可使用此 Key', 'success');
        }
      } catch (err) {
        showKeySaveStatus('保存失败: ' + err.message, 'error');
      }
    });
  }

  function showKeySaveStatus(text, type) {
    if (keySaveStatus) {
      keySaveStatus.textContent = text;
      keySaveStatus.className = 'popup-key-save-status ' + type;
      setTimeout(() => { keySaveStatus.textContent = ''; }, 4000);
    }
  }

  function updateStatus(text, success) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    if (statusDot) statusDot.style.background = success ? '#10B981' : '#EF4444';
    if (statusText) statusText.textContent = text;
  }
});
