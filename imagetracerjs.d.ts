declare module 'imagetracerjs' {
  export interface ImageTracerImageData { width: number; height: number; data: Uint8ClampedArray | number[] }
  export type ImageTracerOptions = Record<string, number | boolean | string>;
  interface ImageTracer {
    imagedataToSVG(imageData: ImageTracerImageData, options?: ImageTracerOptions | string): string;
  }
  const tracer: ImageTracer;
  export default tracer;
}
