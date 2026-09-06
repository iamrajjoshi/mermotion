export {
  compileMotion,
  compileMotionSource,
  diagnosticForUnexpectedCompilerFailure,
  emptyTimeline,
  noMotionDocument,
  sampleMotion,
  sampleTimeline,
} from './compiler.js';
export {
  formatMotion,
  MOTION_DEFAULTS,
  parseMotion,
  tokenizeMotion,
  validateMotionSyntax,
} from './language.js';
export {
  detectMermaidType,
  inspectMermaid,
  MermaidAdapterError,
  registeredMermaidDiagramTypes,
  renderMermaid,
  validateMermaid,
} from './mermaid-adapter.js';
export {
  applyFrameToSvg,
  clearMotionFromSvg,
  discoverTargets,
  discoverTargetsFromSvg,
  resolveTargetFromElement,
  TARGET_ATTRIBUTE,
} from './targets.js';
export { MERMAID_VERSION } from './version.js';
export { validateMotion } from './validation.js';
export type * from './types.js';
