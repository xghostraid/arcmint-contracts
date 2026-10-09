declare module "ipfs-only-hash" {
  function of(content: Uint8Array): Promise<string>;
  export { of };
  export default { of: typeof of };
}

declare module "jpeg-js" {
  export function decode(data: Buffer, opts?: { useTArray?: boolean }): { data: Uint8Array; width: number; height: number };
  export function encode(image: { data: Uint8Array; width: number; height: number }, quality: number): { data: Uint8Array };
}

declare module "pngjs" {
  export class PNG {
    static sync: {
      read(data: Buffer): PNG;
      write(png: PNG): Buffer;
    };
  }
}
