// Source-mode alias for the Skill package helpers.
// The canonical implementation lives in tools/iris/skill-package.js (the
// published package root). prepack rewrites the copy under managed-agent/ to
// `../skill-package.js` for the packaged layout.
export * from '../tools/iris/skill-package.js';