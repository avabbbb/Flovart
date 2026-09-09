/* Flovart's CEP bridge calls these functions through the After Effects host. */
var FlovartAE = (function () {
  function result(value) { return JSON.stringify(value); }
  function activeComp() {
    var item = app.project && app.project.activeItem;
    return item && item instanceof CompItem ? item : null;
  }
  function getContext() {
    var comp = activeComp();
    return result(comp ? { available: true, documentId: String(comp.id), documentName: comp.name, title: comp.name } : { available: false, title: "请打开一个 After Effects 合成。" });
  }
  function getSelection() {
    var comp = activeComp();
    var layer = comp && comp.selectedLayers && comp.selectedLayers.length ? comp.selectedLayers[0] : null;
    return result(layer ? { selectionId: String(layer.id), label: layer.name, kind: "image", locator: { documentId: String(comp.id), layerId: Number(layer.id) }, mimeType: "image/png" } : null);
  }
  function materializeLayer(filePath) {
    var comp = activeComp();
    var layer = comp && comp.selectedLayers && comp.selectedLayers.length ? comp.selectedLayers[0] : null;
    if (!comp || !layer) return result({ error: "请先在 After Effects 中选择一个图层。" });
    var tempComp = app.project.items.addComp("__flovart_reference__", comp.width, comp.height, comp.pixelAspect, comp.duration, comp.frameRate);
    layer.copyToComp(tempComp);
    var queueItem = app.project.renderQueue.items.add(tempComp);
    queueItem.outputModule(1).file = new File(filePath);
    app.project.renderQueue.render();
    queueItem.remove();
    tempComp.remove();
    return result({ path: filePath, kind: "image", mimeType: "image/png" });
  }
  function importArtifact(filePath) {
    var comp = activeComp();
    if (!comp) return result({ ok: false, message: "请先打开一个 After Effects 合成。" });
    var file = new File(filePath);
    if (!file.exists) return result({ ok: false, message: "Flovart 产物文件不存在。" });
    var footage = app.project.importFile(new ImportOptions(file));
    var layer = comp.layers.add(footage);
    return result({ ok: true, targetId: String(layer.id), message: "已添加到当前合成的新图层。" });
  }
  return { getContext: getContext, getSelection: getSelection, materializeLayer: materializeLayer, importArtifact: importArtifact };
}());
