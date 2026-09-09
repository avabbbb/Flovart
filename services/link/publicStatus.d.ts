export type LinkPublicState = 'ready' | 'needs_setup' | 'needs_login' | 'offline';
export interface LinkStatusInput {
  service: 'ready' | 'connecting' | 'offline' | 'error';
  browserConnected?: boolean;
  writerActive?: boolean;
  host?: { available?: boolean; status?: string; authStatus?: string } | null;
  authState?: 'ready' | 'needs-login' | 'not-inspected' | 'unknown';
}
export interface LinkPublicStatus {
  state: LinkPublicState;
  label: string;
  message: string;
  action: 'use' | 'setup' | 'login' | 'repair' | null;
}
export interface LocalLinkStatusShape {
  ready?: boolean;
  runtime?: { status?: string };
  frontend?: { status?: string };
  agent?: { status?: string; error?: string };
  browserConnected?: boolean;
}
export declare function toLinkPublicStatus(input: LinkStatusInput): LinkPublicStatus;
export declare function publicStateLabel(state: LinkPublicState): string;
export declare function toLocalLinkPublicStatus(status: LocalLinkStatusShape): LinkPublicStatus;
