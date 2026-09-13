/**
 * 本地文件夹直读的测试替身。
 *
 * 真实 `FileSystemDirectoryHandle` 不在 jsdom 中，且带方法的对象无法被
 * IndexedDB 结构化克隆——这与真实句柄的行为差异（真句柄可克隆）正是服务里
 * “句柄落盘失败则退回会话内存”分支要覆盖的场景。
 */

export interface FakeFileSpec {
  name: string;
  type: string;
  size?: number;
  lastModified?: number;
}

export interface FakeFileHandle {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
}

export interface FakeDirectoryHandle {
  kind: 'directory';
  name: string;
  queryPermission: () => Promise<PermissionState>;
  requestPermission: () => Promise<PermissionState>;
  getDirectoryHandle: (name: string) => Promise<FakeDirectoryHandle>;
  getFileHandle: (name: string) => Promise<FakeFileHandle>;
  entries: () => AsyncIterableIterator<[string, FakeFileHandle | FakeDirectoryHandle]>;
}

export function fakeFileHandle(spec: FakeFileSpec): FakeFileHandle {
  const size = spec.size ?? 4;
  const lastModified = spec.lastModified ?? 1_700_000_000_000;
  return {
    kind: 'file',
    name: spec.name,
    getFile: async () => new File([new Uint8Array(size)], spec.name, { type: spec.type, lastModified }),
  };
}

export function fakeDirectoryHandle(
  name: string,
  children: Array<[string, FakeFileHandle | FakeDirectoryHandle]>,
  permission: PermissionState = 'granted',
): FakeDirectoryHandle {
  // 真实句柄在 requestPermission 成功后会改变 queryPermission 的结果，替身保持一致。
  let current = permission;
  return {
    kind: 'directory',
    name,
    queryPermission: async () => current,
    requestPermission: async () => {
      current = 'granted';
      return current;
    },
    getDirectoryHandle: async (child: string) => {
      const found = children.find(([entryName, handle]) => entryName === child && handle.kind === 'directory');
      if (!found) throw new DOMException(`${child} is missing`, 'NotFoundError');
      return found[1] as FakeDirectoryHandle;
    },
    getFileHandle: async (child: string) => {
      const found = children.find(([entryName, handle]) => entryName === child && handle.kind === 'file');
      if (!found) throw new DOMException(`${child} is missing`, 'NotFoundError');
      return found[1] as FakeFileHandle;
    },
    entries: async function* () {
      for (const child of children) yield child;
    },
  };
}
