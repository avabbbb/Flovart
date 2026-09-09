import type {
  WorkflowDocumentOperation,
  WorkflowGenerationReferenceRole,
  WorkflowProject,
  WorkflowResource,
  WorkflowResourceKind,
  WorkflowResourceReference,
} from '../../components/workflow/types';

export type { WorkflowResource } from '../../components/workflow/types';

export type CreativeHostId = 'photoshop' | 'premiere' | 'after-effects' | 'resolve';
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
  kind?: 'image' | 'video' | 'audio';
  mimeType: string;
  href?: string;
  blob?: Blob;
}

export interface HostImportResult {
  ok: boolean;
  targetId?: string;
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
