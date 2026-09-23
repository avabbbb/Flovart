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
  var writeBlob = function (file, blob) {
    return blob.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      var encoded = base64FromBytes(bytes);
      var value = cep && cep.fs && cep.fs.writeFile ? cep.fs.writeFile(file, encoded, cep.encoding && cep.encoding.Base64) : null;
      if (!value || value.err) throw new Error('After Effects 无法写入 Flovart 产物。');
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
      return writeBlob(file, payload.artifact.blob).then(function () {
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
    listNativeCandidates: function (documentId) { return hostCall('listNativeCandidates', [documentId]).then(parse); },
    applyNativeEffect: function (request) {
      if (nativeBridge && typeof nativeBridge.applyNativeEffect === 'function') return nativeBridge.applyNativeEffect(request);
      return hostCall('applyNativeEffect', [request]).then(parse);
    },
  };
  global.__FLOVART_AFTER_EFFECTS_BRIDGE__ = bridge;
}(window));
