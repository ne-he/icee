import { iceWallTexture } from './materials'
import { TUNE } from './tune'

// ===== es v2: tambahan di atas MeshTransmissionMaterial (drei) =====
// Batu v1 kebaca "kaca plastik": permukaan mulus sempurna, bening rata, putih.
// Es gletser asli: permukaan bergelombang bekas leleh (scallop), sebagian
// buram karena frost, salju nempel di sisi atas, dan makin tebal makin biru.
//  - detail normal triplanar di ruang OBJEK (ikut muter bareng batunya, gak
//    "berenang"), dari tekstur ice_wall yang sama kayak dinding celah
//  - frost: bercak dari kanal B tekstur + sisi yang ngadep atas (salju/hoarfrost).
//    Di situ transmission dikurangin & roughness dinaikin: jadi putih buram
//  - biru ketebalan: attenuationColor/Distance (Beer's law bawaan MTM)
// Dipasang lewat ref (patchIce) SEBELUM kompilasi pertama, jadi Warmup tetep
// ngompilasi versi final (jumlah program shader gak nambah pas scroll).

export const iceU = {
  uIceTex: { value: null },
  uIceBump: { value: TUNE.iceBump },
  uFrost: { value: TUNE.iceFrost },
}

const PATCH = /* glsl */ `
  float iceFrost = 0.0;
  {
    mat3 m3 = mat3(modelMatrix);
    vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    vec3 nO = normalize(transpose(m3) * nW);
    vec3 w = pow(abs(nO), vec3(4.0));
    w /= (w.x + w.y + w.z + 1e-4);
    vec3 p = vIcePos * 0.55;
    vec4 tx = texture2D(uIceTex, p.zy + 0.13);
    vec4 ty = texture2D(uIceTex, p.xz + 0.41);
    vec4 tz = texture2D(uIceTex, p.xy + 0.77);
    vec2 ax = tx.rg * 2.0 - 1.0;
    vec2 ay = ty.rg * 2.0 - 1.0;
    vec2 az = tz.rg * 2.0 - 1.0;
    vec3 pert = vec3(0.0, ax.y, ax.x) * w.x + vec3(ay.x, 0.0, ay.y) * w.y + vec3(az.x, az.y, 0.0) * w.z;
    nO = normalize(nO + pert * uIceBump);
    nW = normalize(m3 * nO);
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
    float b = tx.b * w.x + ty.b * w.y + tz.b * w.z;
    float patches = smoothstep(0.5, 0.82, b) * uFrost;
    float top = smoothstep(0.35, 0.8, nW.y + (b - 0.5) * 0.4) * uSnowTop;
    iceFrost = clamp(max(patches, top), 0.0, 1.0);
    roughnessFactor = min(1.0, roughnessFactor + iceFrost * 0.55);
  }
`

export function patchIce(m, snowTop = 0.35) {
  if (!m || m.userData.icev2) return
  m.userData.icev2 = true
  if (!iceU.uIceTex.value) iceU.uIceTex.value = iceWallTexture()
  const uSnowTop = { value: snowTop }
  m.userData.uSnowTop = uSnowTop
  const orig = m.onBeforeCompile
  m.onBeforeCompile = (s, r) => {
    orig(s, r)
    Object.assign(s.uniforms, iceU, { uSnowTop })
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIcePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vIcePos = transformed;')
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vIcePos;\nuniform sampler2D uIceTex;\nuniform float uIceBump;\nuniform float uFrost;\nuniform float uSnowTop;'
      )
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + PATCH)
      // frost = es buram: sinar yang tembus dikurangin, sisanya warna es terang
      .replace('material.transmission = _transmission;', 'material.transmission = _transmission * (1.0 - iceFrost * 0.88);')
  }
  m.customProgramCacheKey = () => 'icev2-ice'
  m.needsUpdate = true
}
