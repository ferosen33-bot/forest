// Minimale Typen für n8ao (das Paket liefert keine mit) – nur, was PostFX benutzt.
declare module 'n8ao' {
  import type * as THREE from 'three';

  export class N8AOPass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      halfRes: boolean;
      gammaCorrection: boolean;
      autoRenderBeauty: boolean;
      color: THREE.Color;
    };
    beautyRenderTarget: THREE.WebGLRenderTarget;
    autoDetectTransparency: boolean;
    renderToScreen: boolean;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
    render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer?: THREE.WebGLRenderTarget): void;
    dispose(): void;
  }
}
