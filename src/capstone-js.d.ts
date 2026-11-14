declare module '@alexaltea/capstone-js' {
  const factory: (options?: { locateFile?: (path: string) => string }) => Promise<unknown>;
  export default factory;
}
