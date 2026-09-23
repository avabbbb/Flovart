import type {
  WorkflowDocumentOperation,
  WorkflowGenerationReferenceRole,
  WorkflowProject,
  WorkflowResource,
  WorkflowResourceKind,
  WorkflowResourceReference,
} from '../../components/workflow/types';

export type { WorkflowResource } from '../../components/workflow/types';
export type CreativeHostId = 'photoshop' | 'premiere' | 'after-effects' | 'resolve' | 'browser-workspace';

export type CreativeHostSelectionKind = Extract<WorkflowResourceKind, 'image' | 'video'>;

export interface HostContext {
  host: CreativeHostId;
  available: boolean;
  documentId?: string;
  documentName?: string;
  projectId?: string;
  title?: string;
}

export interface HostSelection {
  host: CreativeHostId;
  selectionId: string;
  label: string;
  kind: CreativeHostSelectionKind;
  locator: Record<string, string | number>;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

/**
 * A host may keep a native Blob beside the provider-neutral locator. The Blob
 * is a handoff value for the current run, never project JSON or a Provider key.
 */
export interface MaterializedHostSelection {
  selection: HostSelection;
  resource: WorkflowResource;
  reference: WorkflowResourceReference;
  blob?: Blob;
}

export interface HostImportTarget {
  kind: 'new-layer' | 'project' | 'media-pool' | 'timeline';
  name?: string;
  afterPlayhead?: boolean;
}

export interface FlovartArtifact {
  artifactId?: string;
  taskId?: string;
  name?: string;
  prompt?: string;
  modelId?: string;
  kind?: 'image' | 'video' | 'audio';
  mimeType: string;
  sha256?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  href?: string;
  blob?: Blob;
}

export interface HostImportResult {
  ok: boolean;
  targetId?: string;
  message?: string;
  /** Metadata read from the imported After Effects footage source. */
  sourceMedia?: HostSourceMediaMetadata | null;
  /** Snapshot of the active AE project's color-processing context. */
  projectColorContext?: HostProjectColorContext | null;
}

export interface HostSourceMediaMetadata {
  width?: number;
  height?: number;
  durationSeconds?: number;
  frameRate?: number;
  frameDurationSeconds?: number;
  nativeFrameRate?: number;
  displayFrameRate?: number;
  conformFrameRate?: number;
  pixelAspectRatio?: number;
  isStill?: boolean;
  hasAlpha?: boolean;
  alphaMode?: 'ignore' | 'straight' | 'premultiplied' | 'unknown';
  invertAlpha?: boolean;
  premultipliedColor?: [number, number, number];
}

export interface HostProjectColorContext {
  workingSpace?: string;
  workingGamma?: number;
  bitsPerChannel?: 8 | 16 | 32;
  linearBlending?: boolean;
  linearizeWorkingSpace?: boolean;
  compensateForSceneReferredProfiles?: boolean;
}

export interface HostNativeEffectRequest {
  candidateLayerId: string;
  sourceSelection: HostSelection;
}

export interface HostNativeCandidate {
  candidateLayerId: string;
  artifactId: string;
  sha256: string;
  name?: string;
  mediaAvailable?: boolean;
  prompt?: string;
  modelId?: string;
  byteSize?: number;
  providerTaskId?: string;
  sourceMedia?: HostSourceMediaMetadata | null;
  projectColorContext?: HostProjectColorContext | null;
  sourceSelection?: HostSelection | null;
  message?: string;
}

export interface Disposable {
  dispose(): void;
}

/** The only native-host responsibilities; planning and Provider calls stay in Flovart Core. */
export interface CreativeHostAdapter {
  id: CreativeHostId;
  getContext(): Promise<HostContext>;
  getSelection(): Promise<HostSelection | null>;
  materializeSelection(selection: HostSelection): Promise<MaterializedHostSelection>;
  importArtifact(artifact: FlovartArtifact, target?: HostImportTarget): Promise<HostImportResult>;
  /** Optional host-native application step after a candidate artifact was imported. */
  applyNativeEffect?(request: HostNativeEffectRequest): Promise<HostImportResult>;
  /** Optional read from the host's persisted candidate records; no parallel app-side history. */
  listNativeCandidates?(documentId?: string): Promise<HostNativeCandidate[]>;
  subscribeContext?(listener: (context: HostContext) => void): Disposable;
}

export interface StudioApplyRequest {
  projectId: string;
  expectedRevision: number;
  mutationId: string;
  idempotencyKey: string;
  operations: WorkflowDocumentOperation[];
  intent?: string;
}

export interface StudioRunRequest {
  projectId: string;
  nodeId: string;
  expectedRevision?: number;
  idempotencyKey: string;
}

/** A narrow client over the existing stable Flovart command surface. */
export interface FlovartStudioCore {
  ensure?(): Promise<unknown>;
  inspect(projectId?: string): Promise<WorkflowProject>;
  selection(projectId?: string): Promise<unknown>;
  /** Link-owned handoff; the Workflow stores only the opaque host locator. */
  registerHostResource(materialized: MaterializedHostSelection): Promise<void>;
  apply(request: StudioApplyRequest): Promise<unknown>;
  run(request: StudioRunRequest): Promise<unknown>;
  artifactGet(args: { taskId?: string; artifactId?: string }): Promise<FlovartArtifact | null>;
}

export class StudioContractError extends Error {
  constructor(
    public readonly code:
      | 'HOST_CONTEXT_UNAVAILABLE'
      | 'WORKSPACE_REQUIRED'
      | 'INPUT_RESOLUTION_FAILED'
      | 'HOST_IMPORT_FAILED'
      | 'WORKSPACE_UNAVAILABLE',
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'StudioContractError';
  }
}

export function hostSelectionResource(selection: HostSelection): WorkflowResource {
  return {
    resourceId: `creative-host:${selection.host}:${selection.selectionId}`,
    title: selection.label,
    kind: selection.kind,
    locator: { kind: 'creative-host', host: selection.host, locator: selection.locator },
    mimeType: selection.mimeType,
  };
}

export function hostSelectionReference(
  selection: HostSelection,
  resource = hostSelectionResource(selection),
  role: WorkflowGenerationReferenceRole = 'reference',
): WorkflowResourceReference {
  return {
    id: `${resource.resourceId}:reference`,
    resourceId: resource.resourceId,
    resourceOrigin: 'creative-host',
    sourceId: selection.selectionId,
    kind: selection.kind,
    source: 'manual',
    role,
  };
}
