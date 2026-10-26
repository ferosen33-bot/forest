import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import * as CSMShaderModule from 'three/examples/jsm/csm/CSMShader.js';
import type { CSMShader as CSMShaderChunks } from 'three/examples/jsm/csm/CSMShader.js';
import { CLOUD_GLSL, cloudUniforms } from './SkyDome';

// Die Typen beschreiben `CSMShader` nur als Interface; zur Laufzeit ist es ein Objekt mit den Bausteinen.
const CSMShader = (CSMShaderModule as unknown as { CSMShader: CSMShaderChunks }).CSMShader;

// Die Shader-Bausteine von `CSMShader` hinken three.js hinterher (es fehlt z. B. die Mehrfachstreuung für
// Metalle – Werkzeuge würden schwarz). Daher: das aktuelle Original nehmen und nur den Block der
// gerichteten Lichter durch die Kaskaden-Variante ersetzen. Die Originale vor dem `CSM`-Konstruktor sichern,
// denn der überschreibt sie.
const ORIGINAL_FRAGMENT = THREE.ShaderChunk.lights_fragment_begin;
const ORIGINAL_PARS = THREE.ShaderChunk.lights_pars_begin;

function cascadeChunks(): { fragment: string; pars: string } {
  const dirStart = ORIGINAL_FRAGMENT.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  const dirEnd = ORIGINAL_FRAGMENT.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )', dirStart);
  const csm = CSMShader.lights_fragment_begin;
  const csmStart = csm.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && defined( USE_CSM )');
  const csmEnd = csm.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && !defined( USE_CSM )', csmStart);
  if (dirStart < 0 || dirEnd < 0 || csmStart < 0 || csmEnd < 0) throw new Error('Kaskadenschatten: Shader-Bausteine von three.js haben sich geändert.');
  // Wolkenschatten: Wo zwischen Punkt und Sonne eine Wolke hängt, kommt weniger Sonnenlicht an.
  const csmBlock = csm
    .slice(csmStart, csmEnd)
    .replace(
      'float linearDepth = (vViewPosition.z) / (shadowFar - cameraNear);',
      `float linearDepth = (vViewPosition.z) / (shadowFar - cameraNear);
	float csmCloudShadow = 1.0;
	if ( uClouds > 0.02 && NUM_DIR_LIGHTS > 0 ) {
		vec3 csmWorld = ( uInvView * vec4( geometryPosition, 1.0 ) ).xyz;
		vec3 csmSun = normalize( mat3( uInvView ) * directionalLights[ 0 ].direction );
		if ( csmSun.y > 0.05 ) {
			vec3 csmCloud = csmWorld + csmSun * ( ( CLOUD_BOTTOM + 450.0 - csmWorld.y ) / csmSun.y );
			float csmD = cloudDensity( csmCloud, 0.0 ) + cloudDensity( csmCloud + csmSun * 500.0, 0.0 );
			// Bei geschlossener Decke dunkelt das Wetter das Licht schon ab – dann keine Flecken mehr.
			csmCloudShadow = 1.0 - smoothstep( 0.05, 0.9, csmD ) * 0.72 * ( 1.0 - smoothstep( 0.75, 1.0, uClouds ) );
		}
	}`,
    )
    .split('getDirectionalLightInfo( directionalLight, directLight );')
    .join('getDirectionalLightInfo( directionalLight, directLight );\n\t\t\tdirectLight.color *= csmCloudShadow;');
  const fragment =
    ORIGINAL_FRAGMENT.slice(0, dirStart) +
    csmBlock +
    '\n#if !defined( USE_CSM )\n' +
    ORIGINAL_FRAGMENT.slice(dirStart, dirEnd) +
    '\n#endif\n' +
    ORIGINAL_FRAGMENT.slice(dirEnd);
  const pars =
    '#if defined( USE_CSM ) && defined( CSM_CASCADES )\nuniform vec2 CSM_cascades[CSM_CASCADES];\nuniform float cameraNear;\nuniform float shadowFar;\nuniform mat4 uInvView;\n' +
    CLOUD_GLSL +
    '\n#endif\n' +
    ORIGINAL_PARS;
  return { fragment, pars };
}

/** Grenzen der Kaskaden in Metern Blickentfernung (die letzte endet bei `maxFar`). */
const SPLITS = [30, 110];
/** Bis hierhin werfen Dinge Schatten (m). */
export const SHADOW_FAR = 350;

const LIT = (m: THREE.Material): boolean =>
  (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true ||
  (m as THREE.MeshLambertMaterial).isMeshLambertMaterial === true ||
  (m as THREE.MeshPhongMaterial).isMeshPhongMaterial === true;

/**
 * Kaskadierte Sonnenschatten: drei Schattenkarten statt einer. Nah am Spieler sind die Schatten scharf,
 * weiter weg gröber, und sie reichen bis 350 m statt bis 60 m – Bäume am Hang werfen auch in der Ferne
 * Schatten, und nichts „schaltet“ mehr sichtbar am Rand der Schattenkarte um.
 *
 * Die Kaskaden-Lichter von three.js (`CSM`) übernehmen Farbe, Stärke und Richtung des Sonnen-/Mondlichts.
 * Die Shader-Erweiterung bekommt jedes beleuchtete Material automatisch, sobald es zum ersten Mal in der
 * Spielszene gezeichnet wird (eigene `onBeforeCompile`-Erweiterungen bleiben dabei erhalten).
 */
export class CascadedShadows {
  readonly csm: CSM;
  private readonly uniforms = {
    cascades: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
    near: { value: 0.1 },
    far: { value: SHADOW_FAR },
    /** Kamera → Welt (für die Wolkenschatten); dieselbe Matrix wie `camera.matrixWorld`. */
    invView: { value: new THREE.Matrix4() },
  };
  private readonly dir = new THREE.Vector3();
  private readonly lens = { fov: 0, aspect: 0, far: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    mapSize: number,
  ) {
    this.uniforms.invView.value = camera.matrixWorld;
    this.csm = new CSM({
      camera,
      parent: scene,
      cascades: 3,
      maxFar: SHADOW_FAR,
      mode: 'custom',
      customSplitsCallback: (_amount: number, _near: number, far: number, target: number[]) => {
        for (const s of SPLITS) target.push(Math.min(s, far) / far);
        target.push(1);
      },
      shadowMapSize: mapSize,
      lightMargin: 220,
      lightFar: 900,
    });
    this.csm.fade = true;
    const chunks = cascadeChunks();
    THREE.ShaderChunk.lights_fragment_begin = chunks.fragment;
    THREE.ShaderChunk.lights_pars_begin = chunks.pars;
    this.csm.lights.forEach((l, i) => {
      // Fernere Kaskaden haben größere Texel und brauchen mehr Abstand gegen Schattenakne.
      l.shadow.bias = -0.0004 - i * 0.0004;
      l.shadow.normalBias = 0.05 * (1 + i * 1.6);
    });
    this.updateFrustums();
    this.installMaterialHook();
  }

  /** Lichter der Kaskaden (das mittlere deckt Spieler und Umgebung gut ab → Lichtstrahlen). */
  get lights(): THREE.DirectionalLight[] {
    return this.csm.lights;
  }

  /** Nach Änderung von Sichtfeld, Seitenverhältnis oder Sichtweite. */
  updateFrustums(): void {
    this.csm.updateFrustums();
    const breaks = this.csm.breaks;
    breaks.forEach((b, i) => this.uniforms.cascades.value[i].set(i === 0 ? 0 : breaks[i - 1], b));
    this.uniforms.near.value = this.camera.near;
    this.uniforms.far.value = Math.min(this.camera.far, SHADOW_FAR);
  }

  setMapSize(size: number): void {
    for (const l of this.csm.lights) {
      if (l.shadow.mapSize.x === size) continue;
      l.shadow.mapSize.set(size, size);
      l.shadow.map?.dispose();
      l.shadow.map = null;
    }
    this.csm.shadowMapSize = size;
  }

  /** Folgt dem Sonnen- bzw. Mondlicht (Richtung zur Lichtquelle, Farbe, Stärke). */
  update(sun: THREE.DirectionalLight): void {
    // Zielen mit dem Bogen ändert das Sichtfeld – die Kaskaden folgen.
    const c = this.camera;
    if (c.fov !== this.lens.fov || c.aspect !== this.lens.aspect || c.far !== this.lens.far) {
      this.lens.fov = c.fov;
      this.lens.aspect = c.aspect;
      this.lens.far = c.far;
      this.updateFrustums();
    }
    this.dir.subVectors(sun.target.position, sun.position).normalize();
    this.csm.lightDirection.copy(this.dir);
    for (const l of this.csm.lights) {
      l.color.copy(sun.color);
      l.intensity = sun.intensity;
    }
    this.csm.update();
  }

  /**
   * Hängt die Kaskaden-Defines und -Uniforms an jedes beleuchtete Material, das in der Spielszene
   * gezeichnet wird – auch an solche, die erst später entstehen (Beute, Bauwerke, Flöße …).
   */
  private installMaterialHook(): void {
    const scene = this.scene;
    const u = this.uniforms;
    const proto = THREE.Material.prototype as THREE.Material & { __csmHooked?: boolean };
    if (proto.__csmHooked) return;
    proto.__csmHooked = true;
    const original = proto.onBeforeRender;
    proto.onBeforeRender = function (this: THREE.Material, renderer, s, camera, geometry, object, group) {
      if (s === scene && !this.userData.__csm && LIT(this)) {
        this.userData.__csm = true;
        this.defines = { ...(this.defines ?? {}), USE_CSM: 1, CSM_CASCADES: 3, CSM_FADE: '' };
        const key = this.customProgramCacheKey();
        const prev = this.onBeforeCompile;
        this.onBeforeCompile = function (this: THREE.Material, shader, r) {
          prev.call(this, shader, r);
          shader.uniforms.CSM_cascades = u.cascades;
          shader.uniforms.cameraNear = u.near;
          shader.uniforms.shadowFar = u.far;
          shader.uniforms.uInvView = u.invView;
          shader.uniforms.tCloudNoise = cloudUniforms.tCloudNoise;
          shader.uniforms.uClouds = cloudUniforms.uClouds;
          shader.uniforms.uCloudOffset = cloudUniforms.uCloudOffset;
        };
        this.customProgramCacheKey = () => `${key}|csm`;
        this.needsUpdate = true;
      }
      original.call(this, renderer, s, camera, geometry, object, group);
    };
  }
}
