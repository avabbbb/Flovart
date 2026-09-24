/* Flovart's CEP bridge calls these functions through the After Effects host. */
var FlovartAE = (function () {
  function result(value) { return JSON.stringify(value); }
  function failure(message) { return result({ ok: false, message: message }); }
  function finiteValue(object, key, minimum) {
    try {
      var value = object && object[key];
      return typeof value === "number" && isFinite(value) && value >= minimum ? value : null;
    } catch (error) { return null; }
  }
  function booleanValue(object, key) {
    try {
      var value = object && object[key];
      return typeof value === "boolean" ? value : null;
    } catch (error) { return null; }
  }
  function captureSourceMediaMetadata(footage) {
    var metadata = {};
    var width = finiteValue(footage, "width", 1);
    var height = finiteValue(footage, "height", 1);
    var duration = finiteValue(footage, "duration", 0);
    var frameRate = finiteValue(footage, "frameRate", 0.000001);
    var frameDuration = finiteValue(footage, "frameDuration", 0.000001);
    var pixelAspect = finiteValue(footage, "pixelAspect", 0.000001);
    if (width !== null) metadata.width = width;
    if (height !== null) metadata.height = height;
    if (duration !== null) metadata.durationSeconds = duration;
    if (frameRate !== null) metadata.frameRate = frameRate;
    if (frameDuration !== null) metadata.frameDurationSeconds = frameDuration;
    if (pixelAspect !== null) metadata.pixelAspectRatio = pixelAspect;

    var source = null;
    try { source = footage && footage.mainSource; } catch (sourceError) { source = null; }
    if (!source) return metadata;

    var isStill = booleanValue(source, "isStill");
    var hasAlpha = booleanValue(source, "hasAlpha");
    if (isStill !== null) metadata.isStill = isStill;
    if (hasAlpha !== null) metadata.hasAlpha = hasAlpha;
    var nativeFrameRate = finiteValue(source, "nativeFrameRate", 0.000001);
    var displayFrameRate = finiteValue(source, "displayFrameRate", 0.000001);
    var conformFrameRate = finiteValue(source, "conformFrameRate", 0);
    if (nativeFrameRate !== null) metadata.nativeFrameRate = nativeFrameRate;
    if (displayFrameRate !== null) metadata.displayFrameRate = displayFrameRate;
    if (conformFrameRate !== null) metadata.conformFrameRate = conformFrameRate;

    if (hasAlpha) {
      try {
        if (typeof AlphaMode !== "undefined") {
          if (source.alphaMode === AlphaMode.IGNORE) metadata.alphaMode = "ignore";
          else if (source.alphaMode === AlphaMode.STRAIGHT) metadata.alphaMode = "straight";
          else if (source.alphaMode === AlphaMode.PREMULTIPLIED) metadata.alphaMode = "premultiplied";
          else metadata.alphaMode = "unknown";
        } else metadata.alphaMode = "unknown";
      } catch (alphaModeError) { metadata.alphaMode = "unknown"; }
      var invertAlpha = booleanValue(source, "invertAlpha");
      if (invertAlpha !== null) metadata.invertAlpha = invertAlpha;
      if (metadata.alphaMode === "premultiplied") {
        try {
          var color = source.premulColor;
          if (color && color.length >= 3
              && typeof color[0] === "number" && isFinite(color[0])
              && typeof color[1] === "number" && isFinite(color[1])
              && typeof color[2] === "number" && isFinite(color[2])) {
            metadata.premultipliedColor = [color[0], color[1], color[2]];
          }
        } catch (premultipliedColorError) {}
      }
    }
    return metadata;
  }
  function captureProjectColorContext(project) {
    var context = {};
    try { if (typeof project.workingSpace === "string") context.workingSpace = project.workingSpace; } catch (workingSpaceError) {}
    var gamma = finiteValue(project, "workingGamma", 0.000001);
    if (gamma !== null) context.workingGamma = gamma;
    var bitsPerChannel = finiteValue(project, "bitsPerChannel", 1);
    if (bitsPerChannel === 8 || bitsPerChannel === 16 || bitsPerChannel === 32) context.bitsPerChannel = bitsPerChannel;
    var linearBlending = booleanValue(project, "linearBlending");
    var linearizeWorkingSpace = booleanValue(project, "linearizeWorkingSpace");
    var compensate = booleanValue(project, "compensateForSceneReferredProfiles");
    if (linearBlending !== null) context.linearBlending = linearBlending;
    if (linearizeWorkingSpace !== null) context.linearizeWorkingSpace = linearizeWorkingSpace;
    if (compensate !== null) context.compensateForSceneReferredProfiles = compensate;
    return context;
  }
  function activeComp() {
    var item = app.project && app.project.activeItem;
    return item && item instanceof CompItem ? item : null;
  }
  function compById(id) {
    if (!app.project || id === undefined || id === null) return null;
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item instanceof CompItem && String(item.id) === String(id)) return item;
    }
    return null;
  }
  function layerById(comp, id) {
    if (!comp || id === undefined || id === null) return null;
    for (var i = 1; i <= comp.numLayers; i++) {
      var layer = comp.layer(i);
      if (String(layer.id) === String(id)) return layer;
    }
    return null;
  }
  function getContext() {
    var comp = activeComp();
    if (!comp) return result({ available: false, title: "请打开一个 After Effects 合成。" });
    if (typeof comp.id !== "number") {
      return result({ available: false, title: "精确绑定需要 After Effects 22.0 或更新版本。" });
    }
    return result({ available: true, documentId: String(comp.id), documentName: comp.name, title: comp.name });
  }
  function getSelection() {
    var comp = activeComp();
    if (!comp || typeof comp.id !== "number" || !comp.selectedLayers || comp.selectedLayers.length !== 1) return result(null);
    var layer = comp.selectedLayers[0];
    if (typeof layer.id !== "number") return result(null);
    var frameTime = layer.time;
    if (!isFinite(frameTime)) return result(null);
    // The handoff is a rendered comp-sized PNG, not the source layer's native dimensions.
    return result({
      selectionId: String(layer.id),
      label: layer.name,
      kind: "image",
      locator: { documentId: String(comp.id), layerId: Number(layer.id), frameTime: frameTime },
      mimeType: "image/png",
      width: comp.width,
      height: comp.height
    });
  }
  function pngAlphaTemplate(outputModule) {
    var templates = outputModule.templates || [];
    for (var i = 0; i < templates.length; i++) {
      if (/png/i.test(templates[i]) && /(alpha|rgba|透明)/i.test(templates[i])) return templates[i];
    }
    return null;
  }
  function generatedPngFiles(filePath) {
    var targetFile = new File(filePath);
    var baseName = targetFile.name.replace(/\.png$/i, "");
    var files = targetFile.parent.getFiles(baseName + "*.png");
    var outputs = [];
    for (var i = 0; i < files.length; i++) {
      if (files[i] instanceof File) outputs.push(files[i]);
    }
    return outputs;
  }
  function materializeLayer(filePath, target) {
    var comp = target && target.documentId !== undefined ? compById(target.documentId) : activeComp();
    var layer = comp && target && target.layerId !== undefined
      ? layerById(comp, target.layerId)
      : comp && comp.selectedLayers && comp.selectedLayers.length === 1 ? comp.selectedLayers[0] : null;
    if (!comp || !layer || typeof comp.id !== "number" || typeof layer.id !== "number") {
      return failure("生成时绑定的 After Effects 合成或图层已不存在。");
    }
    var frameTime = target && target.frameTime !== undefined ? target.frameTime : layer.time;
    if (typeof frameTime !== "number") return failure("After Effects 没有返回有效的图层时间。");
    if (!isFinite(frameTime) || !layer.activeAtTime(frameTime)) {
      return failure("所选图层在当前时间没有可读取的画面，请将播放头移到图层有效范围内。");
    }

    var queue = app.project.renderQueue;
    if (queue.rendering) return failure("After Effects 正在渲染；请等渲染队列结束后再读取参考帧。");

    var queueState = [];
    for (var q = 1; q <= queue.numItems; q++) {
      var existingItem = queue.item(q);
      queueState.push({
        item: existingItem,
        render: existingItem.render,
        queued: existingItem.status === RQItemStatus.QUEUED,
      });
    }

    var tempComp = null;
    var queueItem = null;
    var errorMessage = null;
    var generatedPath = null;
    try {
      tempComp = app.project.items.addComp("__flovart_reference_" + new Date().getTime(), comp.width, comp.height, comp.pixelAspect, comp.duration, comp.frameRate);
      tempComp.displayStartTime = comp.displayStartTime;
      tempComp.renderer = comp.renderer;
      layer.copyToComp(tempComp);
      queueItem = queue.items.add(tempComp);
      queueItem.timeSpanStart = frameTime;
      queueItem.timeSpanDuration = comp.frameDuration;
      var outputModule = queueItem.outputModule(1);
      var templateName = pngAlphaTemplate(outputModule);
      if (!templateName) throw new Error("After Effects 未配置带 Alpha 通道的 PNG 输出模板。");
      outputModule.applyTemplate(templateName);
      outputModule = queueItem.outputModule(1);
      outputModule.postRenderAction = PostRenderAction.NONE;
      outputModule.file = new File(filePath);

      for (var j = 0; j < queueState.length; j++) {
        if (queueState[j].queued) queueState[j].item.render = false;
      }
      queueItem.render = true;
      queue.render();
      if (queueItem.status !== RQItemStatus.DONE) throw new Error("After Effects 未能完成参考帧渲染。");
      var outputFiles = generatedPngFiles(filePath);
      if (outputFiles.length !== 1 || !outputFiles[0].exists || outputFiles[0].length <= 0) {
        throw new Error("After Effects 没有写出唯一的参考 PNG 文件。");
      }
      generatedPath = outputFiles[0].fsName;
    } catch (error) {
      errorMessage = error && error.message ? error.message : "After Effects 无法读取当前图层画面。";
    } finally {
      try { if (queueItem) queueItem.remove(); } catch (removeQueueItemError) {}
      try { if (tempComp) tempComp.remove(); } catch (removeTempCompError) {}
      for (var k = 0; k < queueState.length; k++) {
        if (!queueState[k].queued) continue;
        try { queueState[k].item.render = queueState[k].render; } catch (restoreQueueItemError) {}
      }
      if (errorMessage) {
        try {
          var failedFiles = generatedPngFiles(filePath);
          for (var f = 0; f < failedFiles.length; f++) if (failedFiles[f].exists) failedFiles[f].remove();
        } catch (removeOutputError) {}
      }
    }
    if (errorMessage) return failure(errorMessage);
    return result({ path: generatedPath, kind: "image", mimeType: "image/png" });
  }
  function importArtifact(filePath, target, artifactMetadata) {
    var comp = target && target.documentId !== undefined ? compById(target.documentId) : activeComp();
    if (!comp) return failure("生成时绑定的 After Effects 合成已不存在，请重新选择素材后生成。");

    if (!artifactMetadata
        || typeof artifactMetadata.artifactId !== "string"
        || !/^[A-Za-z0-9_-]{1,100}$/.test(artifactMetadata.artifactId)
        || typeof artifactMetadata.sha256 !== "string"
        || !/^[a-f0-9]{64}$/i.test(artifactMetadata.sha256)
        || typeof artifactMetadata.byteSize !== "number"
        || !isFinite(artifactMetadata.byteSize)
        || Math.floor(artifactMetadata.byteSize) !== artifactMetadata.byteSize
        || artifactMetadata.byteSize <= 0) {
      return failure("Flovart 候选素材缺少有效的版本身份或完整性信息。");
    }

    var sourceLayer = null;
    if (target && target.sourceSelectionId !== undefined) {
      sourceLayer = layerById(comp, target.sourceSelectionId);
      if (!sourceLayer) return failure("生成时绑定的 After Effects 图层已不存在；结果没有回写到其他图层。");
    }

    var file = new File(filePath);
    if (!file.exists) return failure("Flovart 产物文件不存在。");
    if (file.length !== artifactMetadata.byteSize) return failure("Flovart 产物文件字节数与版本记录不一致。");

    var footage = null;
    var layer = null;
    app.beginUndoGroup("导入 Flovart 候选素材");
    try {
      footage = app.project.importFile(new ImportOptions(file));
      layer = comp.layers.add(footage);
      layer.name = artifactMetadata.name ? "Flovart - " + artifactMetadata.name : "Flovart - Candidate";
      var manifest = {
        application: "Flovart",
        schemaVersion: 1,
        assetType: "scene-replace-candidate",
        artifactId: artifactMetadata.artifactId,
        sha256: artifactMetadata.sha256.toLowerCase(),
        byteSize: artifactMetadata.byteSize,
        mimeType: String(artifactMetadata.mimeType || "application/octet-stream"),
        kind: artifactMetadata.kind || null,
        name: artifactMetadata.name || null,
        prompt: artifactMetadata.prompt || null,
        modelId: artifactMetadata.modelId || null
      };
      manifest.sourceMedia = captureSourceMediaMetadata(footage);
      manifest.projectColorContext = captureProjectColorContext(app.project);
      if (typeof artifactMetadata.taskId === "string" && artifactMetadata.taskId) {
        manifest.providerTaskId = artifactMetadata.taskId;
      }
      if (typeof artifactMetadata.width === "number" && isFinite(artifactMetadata.width) && artifactMetadata.width > 0) {
        manifest.width = artifactMetadata.width;
      }
      if (typeof artifactMetadata.height === "number" && isFinite(artifactMetadata.height) && artifactMetadata.height > 0) {
        manifest.height = artifactMetadata.height;
      }
      if (typeof artifactMetadata.durationMs === "number" && isFinite(artifactMetadata.durationMs) && artifactMetadata.durationMs > 0) {
        manifest.durationMs = artifactMetadata.durationMs;
      }
      if (sourceLayer) {
        manifest.sourceCompId = String(comp.id);
        manifest.sourceLayerId = String(sourceLayer.id);
        manifest.sourceLayerName = sourceLayer.name;
      }
      layer.comment = JSON.stringify(manifest);
      if (sourceLayer) layer.moveAfter(sourceLayer);
      layer.enabled = false;
      return result({
        ok: true,
        targetId: String(layer.id),
        message: "候选素材已添加到绑定的合成。",
        sourceMedia: manifest.sourceMedia,
        projectColorContext: manifest.projectColorContext
      });
    } catch (error) {
      try { if (layer) layer.remove(); } catch (removeLayerError) {}
      try { if (footage) footage.remove(); } catch (removeFootageError) {}
      return failure(error && error.message ? error.message : "Flovart 产物导入 After Effects 失败。");
    } finally {
      app.endUndoGroup();
    }
  }
  function listNativeCandidates(documentId) {
    var comp = documentId === undefined || documentId === null ? activeComp() : compById(documentId);
    var candidates = [];
    if (!comp || typeof comp.id !== "number") return result(candidates);
    for (var i = 1; i <= comp.numLayers; i++) {
      var layer = comp.layer(i);
      var manifest = null;
      try { manifest = JSON.parse(layer.comment || ""); } catch (error) { manifest = null; }
      if (!manifest
          || manifest.application !== "Flovart"
          || manifest.assetType !== "scene-replace-candidate"
          || manifest.schemaVersion !== 1
          || String(manifest.sourceCompId || "") !== String(comp.id)
          || !manifest.sourceLayerId) continue;

      var sourceLayer = layerById(comp, manifest.sourceLayerId);
      var footage = layer.source instanceof FootageItem ? layer.source : null;
      var sourceFile = footage ? footage.file : null;
      var expectedByteSize = manifest.byteSize;
      var validManifest = /^[A-Za-z0-9_-]{1,100}$/.test(String(manifest.artifactId || ""))
        && /^[a-f0-9]{64}$/i.test(String(manifest.sha256 || ""))
        && typeof expectedByteSize === "number"
        && isFinite(expectedByteSize)
        && Math.floor(expectedByteSize) === expectedByteSize
        && expectedByteSize > 0;
      var sourceExists = Boolean(sourceFile && sourceFile.exists);
      var mediaAvailable = Boolean(validManifest && sourceExists && sourceFile.length === expectedByteSize);
      var mediaMessage = !validManifest
        ? "候选版本清单无效，不能应用"
        : !sourceExists
          ? "候选素材文件缺失，需重新定位后才能应用"
          : sourceFile.length !== expectedByteSize
            ? "候选素材字节数与版本记录不一致，需重新定位后才能应用"
            : "文件存在且大小匹配；应用前将校验 SHA-256";
      candidates.push({
        candidateLayerId: String(layer.id),
        artifactId: String(manifest.artifactId || ""),
        sha256: String(manifest.sha256 || ""),
        mediaAvailable: mediaAvailable,
        sourcePath: sourceExists ? sourceFile.fsName : null,
        byteSize: manifest.byteSize,
        sourceMedia: manifest.sourceMedia || null,
        projectColorContext: manifest.projectColorContext || null,
        name: manifest.name || layer.name,
        prompt: manifest.prompt || null,
        modelId: manifest.modelId || null,
        providerTaskId: manifest.providerTaskId || null,
        sourceSelection: sourceLayer ? {
          selectionId: String(sourceLayer.id),
          label: sourceLayer.name,
          kind: "image",
          locator: { documentId: String(comp.id), layerId: Number(sourceLayer.id) },
          mimeType: "image/png"
        } : null,
        message: !sourceLayer
          ? "原始图层已不存在，无法应用此候选"
          : mediaMessage
      });
    }
    return result(candidates);
  }
  function findSceneReplaceEffect(effects) {
    if (!effects) return null;
    for (var i = 1; i <= effects.numProperties; i++) {
      var effect = effects.property(i);
      if (effect && effect.matchName === "FLOVART_SceneReplace") return effect;
    }
    return null;
  }
  function applyNativeEffect(request) {
    if (!request || !request.sourceSelection || request.candidateLayerId === undefined) {
      return failure("场景替换缺少候选素材或原始图层引用。");
    }
    var projectBitDepth = app.project ? app.project.bitsPerChannel : null;
    if (projectBitDepth !== 8) {
      return failure(projectBitDepth
        ? "当前 After Effects 项目为 " + projectBitDepth + " bpc；Flovart Scene Replace 目前只支持 8 bpc 项目。"
        : "无法读取当前 After Effects 项目位深；为避免使用不受支持的像素格式，未应用效果。");
    }

    var selection = request.sourceSelection;
    var locator = selection.locator || {};
    if (selection.host !== "after-effects"
        || selection.selectionId === undefined
        || locator.layerId === undefined
        || locator.documentId === undefined
        || String(selection.selectionId) !== String(locator.layerId)) {
      return failure("原始 After Effects 图层引用无效，请重新选择素材。");
    }

    var currentComp = activeComp();
    if (!currentComp || String(currentComp.id) !== String(locator.documentId)) {
      return failure("当前合成已切换；请切换回候选所属合成后再应用。");
    }
    var comp = compById(locator.documentId);
    var sourceLayer = layerById(comp, locator.layerId);
    var candidateLayer = layerById(comp, request.candidateLayerId);
    if (!sourceLayer || !candidateLayer) {
      return failure("原始图层或候选素材已不存在；没有切换到其他目标。");
    }
    if (sourceLayer.id === candidateLayer.id) {
      return failure("候选素材不能同时作为原始图层和素材版本。");
    }
    var candidateManifest = null;
    try { candidateManifest = JSON.parse(candidateLayer.comment || ""); } catch (manifestError) { candidateManifest = null; }
    if (!candidateManifest
        || candidateManifest.application !== "Flovart"
        || candidateManifest.assetType !== "scene-replace-candidate"
        || candidateManifest.schemaVersion !== 1
        || String(candidateManifest.sourceCompId || "") !== String(comp.id)
        || String(candidateManifest.sourceLayerId || "") !== String(sourceLayer.id)
        || !/^[A-Za-z0-9_-]{1,100}$/.test(String(candidateManifest.artifactId || ""))
        || !/^[a-f0-9]{64}$/i.test(String(candidateManifest.sha256 || ""))
        || typeof candidateManifest.byteSize !== "number"
        || !isFinite(candidateManifest.byteSize)
        || Math.floor(candidateManifest.byteSize) !== candidateManifest.byteSize
        || candidateManifest.byteSize <= 0) {
      return failure("候选素材版本或其原始目标清单无效；没有修改原始图层。");
    }
    var candidateFootage = candidateLayer.source instanceof FootageItem ? candidateLayer.source : null;
    if (!candidateFootage || !candidateFootage.file || !candidateFootage.file.exists) {
      return failure("候选素材文件缺失，请重新定位素材后再应用。");
    }
    if (candidateFootage.file.length !== candidateManifest.byteSize) {
      return failure("候选素材字节数与版本记录不一致，请重新定位素材后再应用。");
    }

    var effects = sourceLayer.property("ADBE Effect Parade");
    if (!effects) return failure("所选图层不支持 After Effects 效果。");

    var effect = findSceneReplaceEffect(effects);
    if (!effect && !effects.canAddProperty("FLOVART_SceneReplace")) {
      return failure("Flovart Scene Replace 原生效果尚未安装或未被 After Effects 加载。");
    }

    app.beginUndoGroup("应用 Flovart 场景替换");
    var createdEffect = false;
    try {
      var isNew = !effect;
      if (isNew) {
        effect = effects.addProperty("FLOVART_SceneReplace");
        if (!effect) throw new Error("After Effects 无法创建 Flovart Scene Replace 效果。");
        createdEffect = true;
        effect.name = "Flovart Scene Replace";
      }

      var assetVersion = effect.property("Asset Version");
      if (!assetVersion) throw new Error("Flovart Scene Replace 缺少 Asset Version 参数。");
      var blend = isNew ? effect.property("Blend") : null;
      if (isNew) {
        if (!blend) throw new Error("Flovart Scene Replace 缺少 Blend 参数。");
      }

      assetVersion.setValue(candidateLayer.index);
      if (isNew) {
        blend.setValue(100);
      }

      return result({ ok: true, targetId: String(sourceLayer.id), message: "候选素材已应用为场景替换版本。" });
    } catch (error) {
      if (createdEffect && effect) {
        try { effect.remove(); } catch (removeEffectError) {}
      }
      return failure(error && error.message ? error.message : "应用 Flovart Scene Replace 失败。");
    } finally {
      app.endUndoGroup();
    }
  }
  return {
    getContext: getContext,
    getSelection: getSelection,
    materializeLayer: materializeLayer,
    importArtifact: importArtifact,
    listNativeCandidates: listNativeCandidates,
    applyNativeEffect: applyNativeEffect
  };
}());
