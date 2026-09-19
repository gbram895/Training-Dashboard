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

  // Added for garminFitWorkout.ts (writing .fit workout files), same
  // real-shape-but-minimal approach as the read side above — field names,
  // enum values and the WATTS_OFFSET convention below all match the
  // package's actual (extension-broken) src/types/mesgs.d.ts and
  // src/types/profile.d.ts, just re-declared where NodeNext can see them.
  export interface Mesg {
    mesgNum?: number;
  }

  export interface FileIdMesg extends Mesg {
    type?: 'workout' | string;
    manufacturer?: 'development' | string;
    timeCreated?: Date;
  }

  export interface WorkoutMesg extends Mesg {
    sport?: 'cycling' | 'running' | string;
    numValidSteps?: number;
    wktName?: string;
  }

  export type WktStepTarget = 'open' | 'power' | 'speed' | 'heartRate' | 'cadence' | string;
  export type WktStepDuration = 'time' | 'open' | string;
  export type Intensity = 'active' | 'rest' | 'warmup' | 'cooldown' | 'recovery' | 'interval' | 'other';

  export interface WorkoutStepMesg extends Mesg {
    messageIndex?: number;
    durationType?: WktStepDuration;
    // durationTime/customTargetPowerLow/etc. are documented "subfield" aliases
    // of these raw fields (see profile.js's workoutStep field #2/#5/#6) that
    // only exist for the *decoder* to translate a raw value into a friendly
    // name — encoder.js has no subfield-resolution logic at all, so writing
    // the friendly names silently drops the value. Write the raw fields
    // directly instead, pre-scaled per the subfield each one represents:
    // durationValue is milliseconds when durationType is 'time'; the custom
    // target fields use whatever scale their subfield declares (1 for
    // power's "watts + 1000" encoding, 1000 for speed's m/s).
    durationValue?: number;
    intensity?: Intensity;
    targetType?: WktStepTarget;
    // The zone-number field (aliased on read as targetPowerZone/
    // targetSpeedZone/etc.) — the FIT profile's own doc comment says
    // "Custom = 0", meaning a custom low/high range (not a 1-7 zone) must
    // set this to 0 explicitly. Leaving it unset is what produced "Zone -1
    // (0-0W)" on a real device: it read as an invalid zone number instead
    // of "no zone, use the custom range."
    targetValue?: number;
    customTargetValueLow?: number;
    customTargetValueHigh?: number;
  }

  export class Encoder {
    constructor(options?: Record<string, unknown>);
    writeMesg(mesg: Mesg & { mesgNum: number }): this;
    close(): Uint8Array;
  }

  export const Profile: {
    MesgNum: {
      FILE_ID: number;
      WORKOUT: number;
      WORKOUT_STEP: number;
      [key: string]: number;
    };
  };
}
