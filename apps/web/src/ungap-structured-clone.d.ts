declare module '@ungap/structured-clone' {
  interface StructuredClonePonyfillOptions {
    json?: boolean;
    lossy?: boolean;
  }

  export default function structuredClonePonyfill<T>(
    value: T,
    options?: StructuredClonePonyfillOptions,
  ): T;
}
