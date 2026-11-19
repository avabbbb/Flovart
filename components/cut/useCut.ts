import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { cutStore, type CutStore } from '../../services/cut/cutStore';
import { cutMediaRevision, subscribeCutMedia } from '../../services/cut/runtime';

export function useCut<T>(selector: (state: CutStore) => T): T {
  return useStore(cutStore, selector);
}

/** 媒体可用性 / 代理状态变化时触发重渲染。 */
export function useCutMediaRevision() {
  const [revision, setRevision] = useState(cutMediaRevision());
  useEffect(() => subscribeCutMedia(() => setRevision(cutMediaRevision())), []);
  return revision;
}
