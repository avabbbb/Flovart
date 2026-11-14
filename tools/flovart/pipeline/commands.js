// 轻量命令清单：CLI / Agent 路由只需要名字，不必在启动时加载 SQLite 与媒体模块。
export const PIPELINE_COMMAND_NAMES = Object.freeze([
  'pipeline.run.start',
  'pipeline.run.get',
  'asset.import',
  'asset.list',
  'audio.tts',
  'audio.transcribe',
  'timeline.align',
  'composition.patch',
  'composition.render',
  'media.probe',
  'media.frames',
  'review.submit',
  'run.archive',
]);

export const PIPELINE_WRITE_COMMAND_NAMES = Object.freeze([
  'pipeline.run.start',
  'asset.import',
  'audio.tts',
  'audio.transcribe',
  'composition.patch',
  'composition.render',
  'review.submit',
  'run.archive',
]);

export const PIPELINE_COMMANDS = new Set(PIPELINE_COMMAND_NAMES);
export const PIPELINE_WRITE_COMMANDS = new Set(PIPELINE_WRITE_COMMAND_NAMES);
