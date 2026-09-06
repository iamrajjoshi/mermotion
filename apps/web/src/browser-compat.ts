import structuredClonePonyfill from '@ungap/structured-clone';

if (typeof Array.prototype.at !== 'function') {
  // oxlint-disable-next-line eslint/no-extend-native -- This guarded patch is the compatibility boundary.
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true,
    value<T>(this: T[], requestedIndex: number): T | undefined {
      const index = Number.isNaN(requestedIndex) ? 0 : Math.trunc(requestedIndex);
      const resolvedIndex = index < 0 ? this.length + index : index;
      return resolvedIndex < 0 || resolvedIndex >= this.length ? undefined : this[resolvedIndex];
    },
    writable: true,
  });
}

if (typeof globalThis.structuredClone !== 'function') {
  Object.defineProperty(globalThis, 'structuredClone', {
    configurable: true,
    value: structuredClonePonyfill,
    writable: true,
  });
}
