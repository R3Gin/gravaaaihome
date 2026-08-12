declare module "@jitsi/rnnoise-wasm/dist/rnnoise-sync.js" {
  const createRNNWasmModuleSync: () => unknown;
  export default createRNNWasmModuleSync;
}

declare module "@jitsi/rnnoise-wasm/dist/rnnoise-sync.js?raw" {
  const source: string;
  export default source;
}
