// 模拟 chrome.runtime Port 的两端：一端 postMessage 异步（JSON 序列化）投递到另一端；任一端 disconnect 触发对端 onDisconnect。
export interface FakePort {
  name: string;
  sender?: { origin?: string };
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: any) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
  sent: any[];
}

export function fakePortPair(name: string, origin: string): { web: FakePort; ext: FakePort } {
  const make = (): FakePort & { _msg: Array<(m: any) => void>; _disc: Array<() => void> } => {
    const port = {
      name,
      sent: [] as any[],
      _msg: [] as Array<(m: any) => void>,
      _disc: [] as Array<() => void>,
      postMessage: (_m: unknown) => {},
      disconnect: () => {},
      onMessage: { addListener: (l: (m: any) => void) => { port._msg.push(l); } },
      onDisconnect: { addListener: (l: () => void) => { port._disc.push(l); } },
    };
    return port;
  };
  const web = make();
  const ext = make();
  ext.sender = { origin };
  let open = true;
  const wire = (from: typeof web, to: typeof web) => {
    from.postMessage = (message: unknown) => {
      if (!open) throw new Error('Attempting to use a disconnected port object');
      const copy = JSON.parse(JSON.stringify(message));
      from.sent.push(copy);
      queueMicrotask(() => { if (open) to._msg.forEach(l => l(copy)); });
    };
    from.disconnect = () => {
      if (!open) return;
      open = false;
      queueMicrotask(() => to._disc.forEach(l => l()));
    };
  };
  wire(web, ext);
  wire(ext, web);
  return { web, ext };
}
