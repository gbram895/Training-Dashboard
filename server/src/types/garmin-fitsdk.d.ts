// @garmin/fitsdk ships internal .d.ts files with extension-less relative
// imports (e.g. `from './types/decoder'`), which fail to resolve under this
// project's strict NodeNext module resolution — Node's ESM resolver requires
// an explicit extension. This is a defect in the package's shipped types,
// not a runtime issue (the package itself is native ESM and works fine), so
// this is a minimal ambient declaration covering only what this codebase
// actually uses, bypassing the package's broken type-resolution chain.
declare module '@garmin/fitsdk' {
  export class Stream {
    static fromBuffer(buffer: Uint8Array): Stream;
  }

  export interface FitDecodeResult {
    messages: Record<string, Array<Record<string, unknown>>>;
    errors: Error[];
  }

  export class Decoder {
    constructor(stream: Stream);
    static isFIT(stream: Stream): boolean;
    read(options?: Record<string, unknown>): FitDecodeResult;
  }
}
