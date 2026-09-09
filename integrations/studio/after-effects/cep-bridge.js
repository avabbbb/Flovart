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
    return root ? cep.fs.getSystemPath(root.USER_DATA || root.EXTENSION) : '';
  };
  var filePath = function (prefix, extension) {
    var root = systemPath();
    return root ? root + '/flovart-' + prefix + '-' + Date.now() + extension : '';
  };
  var bytesFromBase64 = function (value) {
    var binary = atob(value);
    return Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
  };
  var readBlob = function (file, mimeType) {
    var read = cep && cep.fs && cep.fs.readFile ? cep.fs.readFile(file, cep.encoding && cep.encoding.Base64) : null;
    if (!read || read.err) return Promise.reject(new Error('After Effects 无法读取参考素材。'));
    var bytes;
    try { bytes = bytesFromBase64(read.data); } catch (error) { bytes = Uint8Array.from(read.data, function (character) { return character.charCodeAt(0); }); }
    if (cep.fs.deleteFile) cep.fs.deleteFile(file);
    return Promise.resolve({ blob: new Blob([bytes], { type: mimeType || 'image/png' }), kind: 'image', mimeType: mimeType || 'image/png' });
  };
  var writeBlob = function (file, blob) {
    return blob.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      var binary = Array.from(bytes, function (byte) { return String.fromCharCode(byte); }).join('');
      var value = cep && cep.fs && cep.fs.writeFile ? cep.fs.writeFile(file, btoa(binary), cep.encoding && cep.encoding.Base64) : null;
      if (!value || value.err) throw new Error('After Effects 无法写入 Flovart 产物。');
    });
  };
  var bridge = {
    getContext: function () { return hostCall('getContext').then(parse); },
    getSelection: function () { return hostCall('getSelection').then(parse); },
    materializeLayer: function () {
      var file = filePath('reference', '.png');
      return hostCall('materializeLayer', [file]).then(parse).then(function (value) {
        if (value && value.error) throw new Error(value.error);
        return value && value.path ? readBlob(value.path, value.mimeType) : value;
      });
    },
    importArtifact: function (payload) {
      if (nativeBridge && typeof nativeBridge.importArtifact === 'function') return nativeBridge.importArtifact(payload);
      var file = filePath('result', payload && payload.artifact && payload.artifact.mimeType === 'image/jpeg' ? '.jpg' : '.png');
      return writeBlob(file, payload.artifact.blob).then(function () { return hostCall('importArtifact', [file]).then(parse); });
    },
  };
  global.__FLOVART_AFTER_EFFECTS_BRIDGE__ = bridge;
}(window));
