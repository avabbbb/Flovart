(function (global) {
  var nativeBridge = global.__FLOVART_AFTER_EFFECTS_NATIVE__;
  var cep = global.cep;
  var evalScript = global.__adobe_cep__ && global.__adobe_cep__.evalScript;
  var parse = function (value) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (error) { return { error: value }; }
  };
  var hostCall = function (name, args) {
    if (nativeBridge && typeof nativeBridge[name] === 'function') return Promise.resolve(nativeBridge[name].apply(nativeBridge, args || []));
    if (typeof evalScript !== 'function') return Promise.reject(new Error('After Effects CEP bridge 不可用。'));
    return new Promise(function (resolve, reject) {
      var script = 'FlovartAE.' + name + '(' + (args || []).map(function (arg) { return JSON.stringify(arg); }).join(',') + ')';
      evalScript.call(global.__adobe_cep__, script, function (value) {
        var parsed = parse(value);
        if (parsed && parsed.error) reject(new Error(parsed.error)); else resolve(parsed);
      });
    });
  };
  var systemPath = function () {
    var root = cep && cep.fs && cep.fs.getSystemPath && cep.fs.SystemPath;
    return root && root.USER_DATA ? cep.fs.getSystemPath(root.USER_DATA) : '';
  };
  var filePath = function (prefix, extension) {
    var root = systemPath();
    return root ? root + '/flovart-' + prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000000000) + extension : '';
  };
  var assetFilePath = function (artifact, extension) {
    var root = systemPath();
    var artifactId = String(artifact && artifact.artifactId || '');
    var sha256 = String(artifact && artifact.sha256 || '').toLowerCase();
    if (!root || !/^[A-Za-z0-9_-]{1,100}$/.test(artifactId) || !/^[a-f0-9]{64}$/.test(sha256)) return '';
    return root + '/flovart-asset-' + artifactId + '-sha256-' + sha256 + extension;
  };
  var extensionForMimeType = function (mimeType) {
    var type = String(mimeType || '').split(';')[0].trim().toLowerCase();
    var extensions = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'video/webm': '.webm',
    };
    return extensions[type] || '';
  };
  var bytesFromBase64 = function (value) {
    var binary = atob(value);
    return Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
  };
  var readFileBytes = function (file) {
    var read = cep && cep.fs && cep.fs.readFile ? cep.fs.readFile(file, cep.encoding && cep.encoding.Base64) : null;
    if (!read || read.err || typeof read.data !== 'string') {
      return Promise.reject(new Error('After Effects 无法回读候选素材文件。'));
    }
    try {
      return Promise.resolve(bytesFromBase64(read.data));
    } catch (error) {
      return Promise.reject(new Error('After Effects 回读的候选素材不是有效的 Base64 数据。'));
    }
  };
  var sha256Hex = function (bytes) {
    var subtle = global.crypto && global.crypto.subtle;
    if (!subtle || typeof subtle.digest !== 'function') {
      return Promise.reject(new Error('当前 CEP 运行时不支持 SHA-256 回读校验。'));
    }
    return Promise.resolve(subtle.digest('SHA-256', bytes)).then(function (digest) {
      return Array.prototype.map.call(new Uint8Array(digest), function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    });
  };
  var verifyFile = function (file, metadata) {
    var expectedHash = String(metadata && metadata.sha256 || '').toLowerCase();
    var expectedByteSize = metadata && metadata.byteSize;
    if (!file || !/^[a-f0-9]{64}$/.test(expectedHash)
        || typeof expectedByteSize !== 'number'
        || !isFinite(expectedByteSize)
        || Math.floor(expectedByteSize) !== expectedByteSize
        || expectedByteSize <= 0) {
      return Promise.reject(new Error('候选素材缺少有效的 SHA-256 或字节数记录。'));
    }
    return readFileBytes(file).then(function (bytes) {
      if (bytes.length !== expectedByteSize) {
        throw new Error('候选素材文件字节数与版本记录不一致。');
      }
      return sha256Hex(bytes).then(function (actualHash) {
        if (actualHash !== expectedHash) {
          throw new Error('候选素材文件 SHA-256 与版本记录不一致。');
        }
        return true;
      });
    });
  };
  var base64FromBytes = function (bytes) {
    var encoded = [];
    var chunkSize = 0x6000;
    var conversionSize = 0x1000;
    for (var offset = 0; offset < bytes.length; offset += chunkSize) {
      var chunkEnd = Math.min(offset + chunkSize, bytes.length);
      var binary = '';
      for (var cursor = offset; cursor < chunkEnd; cursor += conversionSize) {
        var conversionEnd = Math.min(cursor + conversionSize, chunkEnd);
        binary += String.fromCharCode.apply(null, bytes.subarray(cursor, conversionEnd));
      }
      encoded.push(btoa(binary));
    }
    return encoded.join('');
  };
  var readBlob = function (file, mimeType) {
    var read = cep && cep.fs && cep.fs.readFile ? cep.fs.readFile(file, cep.encoding && cep.encoding.Base64) : null;
    if (!read || read.err) {
      if (cep && cep.fs && cep.fs.deleteFile) cep.fs.deleteFile(file);
      return Promise.reject(new Error('After Effects 无法读取参考素材。'));
    }
    var bytes;
    try { bytes = bytesFromBase64(read.data); } catch (error) { bytes = Uint8Array.from(read.data, function (character) { return character.charCodeAt(0); }); }
    if (cep.fs.deleteFile) cep.fs.deleteFile(file);
    return Promise.resolve({ blob: new Blob([bytes], { type: mimeType || 'image/png' }), kind: 'image', mimeType: mimeType || 'image/png' });
  };
  var writeBlob = function (file, blob, metadata) {
    return blob.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      var encoded = base64FromBytes(bytes);
      var value = cep && cep.fs && cep.fs.writeFile ? cep.fs.writeFile(file, encoded, cep.encoding && cep.encoding.Base64) : null;
      if (!value || value.err) throw new Error('After Effects 无法写入 Flovart 产物。');
    }).then(function () {
      return verifyFile(file, metadata);
    });
  };
  var discardFile = function (file) {
    if (cep && cep.fs && cep.fs.deleteFile) cep.fs.deleteFile(file);
  };
  var persistBlob = function (file, extension, blob, metadata) {
    var stagingFile = filePath('asset-stage', extension);
    if (!stagingFile) return Promise.reject(new Error('After Effects CEP 无法创建候选素材暂存路径。'));
    return writeBlob(stagingFile, blob, metadata).then(function () {
      var renamed = cep && cep.fs && cep.fs.rename ? cep.fs.rename(stagingFile, file) : null;
      if (renamed && !renamed.err) return;
      return verifyFile(file, metadata).then(function () {
        // A previous project may already reference this content-addressed file.
        // Reuse it only when its bytes match; never overwrite or delete it here.
        discardFile(stagingFile);
      }, function () {
        throw new Error('After Effects 无法将已校验的候选素材提交到固定版本路径。');
      });
    }).catch(function (error) {
      discardFile(stagingFile);
      throw error;
    });
  };
  var bridge = {
    getContext: function () { return hostCall('getContext').then(parse); },
    getSelection: function () { return hostCall('getSelection').then(parse); },
    materializeLayer: function (payload) {
      var file = filePath('reference', '.png');
      if (!file) return Promise.reject(new Error('After Effects CEP 无法取得持久用户数据目录。'));
      var selection = payload && payload.selection;
      var locator = selection && selection.locator || {};
      return hostCall('materializeLayer', [file, {
        documentId: locator.documentId,
        layerId: locator.layerId,
        frameTime: locator.frameTime,
      }]).then(parse).then(function (value) {
        if (!value || value.ok === false || value.error) throw new Error(value && (value.message || value.error) || 'After Effects 无法读取当前选择。');
        if (!value.path) throw new Error('After Effects 没有返回参考素材文件。');
        return readBlob(value.path, value.mimeType);
      });
    },
    importArtifact: function (payload) {
      if (nativeBridge && typeof nativeBridge.importArtifact === 'function') return nativeBridge.importArtifact(payload);
      var artifact = payload && payload.artifact;
      var extension = extensionForMimeType(artifact && artifact.mimeType);
      if (!extension) return Promise.reject(new Error('After Effects 暂不支持导入此产物格式。'));
      var file = assetFilePath(artifact, extension);
      if (!file) return Promise.reject(new Error('After Effects 产物缺少有效的任务身份或 SHA-256，无法固定为素材版本。'));
      if (!artifact.blob || (artifact.byteSize !== undefined && artifact.byteSize !== artifact.blob.size)) {
        return Promise.reject(new Error('After Effects 产物字节数与素材元数据不一致。'));
      }
      return persistBlob(file, extension, payload.artifact.blob, {
        sha256: artifact.sha256,
        byteSize: artifact.blob.size,
      }).then(function () {
        return hostCall('importArtifact', [file, payload.target || null, {
          artifactId: artifact.artifactId,
          taskId: artifact.taskId || null,
          sha256: artifact.sha256,
          byteSize: artifact.blob.size,
          kind: artifact.kind || null,
          mimeType: artifact.mimeType,
          name: artifact.name || null,
          prompt: artifact.prompt || null,
          modelId: artifact.modelId || null,
          width: artifact.width || null,
          height: artifact.height || null,
          durationMs: artifact.durationMs || null,
        }]).then(parse);
      });
    },
    listNativeCandidates: function (documentId) {
      return hostCall('listNativeCandidates', [documentId]).then(parse).then(function (candidates) {
        if (!Array.isArray(candidates)) return candidates;
        return candidates.map(function (candidate) {
          if (!candidate || typeof candidate !== 'object') return candidate;
          var result = {};
          Object.keys(candidate).forEach(function (key) {
            if (key !== 'sourcePath') result[key] = candidate[key];
          });
          return result;
        });
      });
    },
    applyNativeEffect: function (request) {
      if (nativeBridge && typeof nativeBridge.applyNativeEffect === 'function') return nativeBridge.applyNativeEffect(request);
      var selection = request && request.sourceSelection;
      var locator = selection && selection.locator;
      var documentId = locator && locator.documentId;
      var candidateLayerId = request && request.candidateLayerId;
      if (documentId === undefined || documentId === null || candidateLayerId === undefined || candidateLayerId === null) {
        return Promise.reject(new Error('场景替换缺少候选素材或原始图层引用。'));
      }
      if (selection.selectionId === undefined || selection.selectionId === null
          || locator.layerId === undefined || locator.layerId === null
          || String(selection.selectionId) !== String(locator.layerId)) {
        return Promise.reject(new Error('原始 After Effects 图层引用无效，请重新选择素材。'));
      }
      return hostCall('listNativeCandidates', [documentId]).then(parse).then(function (candidates) {
        var candidate = Array.isArray(candidates) ? candidates.filter(function (item) {
          return item && String(item.candidateLayerId) === String(candidateLayerId);
        })[0] : null;
        var candidateSelection = candidate && candidate.sourceSelection;
        if (!candidate || !candidateSelection
            || String(candidateSelection.selectionId) !== String(selection.selectionId)
            || String(candidateSelection.locator && candidateSelection.locator.documentId) !== String(documentId)
            || String(candidateSelection.locator && candidateSelection.locator.layerId) !== String(locator.layerId)) {
          throw new Error(candidate && candidate.message || '候选素材不属于当前原始图层，无法应用。');
        }
        if (!candidate.mediaAvailable || !candidate.sourcePath) {
          throw new Error(candidate.message || '候选素材文件缺失或大小不符，无法应用。');
        }
        return verifyFile(candidate.sourcePath, candidate);
      }).then(function () {
        return hostCall('applyNativeEffect', [request]).then(parse);
      });
    },
  };
  global.__FLOVART_AFTER_EFFECTS_BRIDGE__ = bridge;
}(window));
