import * as THREE from 'three'
import { GROUND_Y } from './terrain'
import { TUNE } from './tune'
import { LOW } from '../perf'

// uniform yang dishare semua material dunia (ditulis WorldLights tiap frame)
export const worldU = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(-0.45, 0.4, -0.8).normalize() },
  uFogTop: { value: 0.55 },
}

let detailTex = null
export function snowDetailTexture() {
  if (detailTex) return detailTex
  detailTex = new THREE.TextureLoader().load('/textures/snow_detail.jpg')
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping
  detailTex.anisotropy = 4
  // data (normal + tinggi), bukan warna: jangan dikonversi sRGB
  detailTex.colorSpace = THREE.NoColorSpace
  return detailTex
}

// kabut dengan ketinggian: makin tinggi dari permukaan salju makin tipis, jadi
// lembah berkabut tapi puncak gunung di cakrawala masih kebaca (aerial perspective)
const heightFog = /* glsl */ `
#ifdef USE_FOG
  float fogF = smoothstep( fogNear, fogFar, vFogDepth );
  fogF *= mix( 1.0, uFogTop, smoothstep( 0.0, 45.0, vWPos.y - (${GROUND_Y.toFixed(2)}) ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogF );
#endif
`

// ===== salju =====
// MeshStandardMaterial + tambahan lewat onBeforeCompile:
//  - detail normal (riak angin + butiran) diproyeksi dari atas (xz dunia), dua
//    skala biar pengulangannya gak kebaca; skala halus pudar di kejauhan
//  - cekungan sedikit redup (kanal tinggi tekstur)
//  - lereng curam pegunungan jadi batu gelap (salju gak nempel di tebing)
//  - kilau butiran salju: titik-titik kecil yang nyala pas arah pandangnya pas
// LOW (HP): sampel detail halus (sA, riak dekat kamera) diganti netral, jadi
// satu sampel tekstur per piksel, dan kilau butiran salju dibuang. Dari jarak
// HP layarnya kecil, dua-duanya nyaris gak kebaca
const SNOW_FINE = LOW ? 'vec4 sA = vec4(0.5);' : 'vec4 sA = texture2D(uDetail, vWPos.xz * 0.23);'

export function snowMaterial() {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: TUNE.snowColor,
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: TUNE.snowEnv,
  })
  const uBump = { value: TUNE.snowBump }
  const uGlint = { value: TUNE.snowGlint }
  const uRock = { value: new THREE.Color('#7a8592') }
  const uFarShade = { value: TUNE.farShade }
  m.userData.u = { uBump, uGlint, uFarShade }
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, worldU, { uDetail: { value: snowDetailTexture() }, uBump, uGlint, uRock, uFarShade })
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vWNormal = normalize(mat3(modelMatrix) * objectNormal);'
      )
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
varying vec3 vWNormal;
uniform sampler2D uDetail;
uniform float uBump;
uniform float uGlint;
uniform vec3 uRock;
uniform float uFarShade;
uniform vec3 uSunDir;
uniform float uFogTop;
uniform float uTime;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  ${SNOW_FINE}
  vec4 sB = texture2D(uDetail, vWPos.xz * 0.061 + vec2(0.37, 0.71));
  float camD = length(vWPos - cameraPosition);
  float fadeA = 1.0 - smoothstep(16.0, 48.0, camD);
  float cav = mix(sB.b, sA.b, 0.5 * fadeA);
  diffuseColor.rgb *= mix(0.9, 1.04, cav);
  // tebing batu cuma di lereng yang bener-bener curam, dipecah noise biar
  // kebaca alur salju nyangkut di sela batu (bukan siluet gelap rata)
  float steep = smoothstep(0.42, 0.22, vWNormal.y + (sB.b - 0.5) * 0.3) * smoothstep(60.0, 120.0, camD);
  diffuseColor.rgb = mix(diffuseColor.rgb, uRock * mix(0.8, 1.1, sB.b), steep * 0.85);
  // salju di pegunungan jauh sedikit lebih gelap dari langit (lereng teduh +
  // udara tebal), biar siluetnya kebaca, bukan cuma pita batu yang "ngambang"
  diffuseColor.rgb *= mix(1.0, uFarShade, smoothstep(150.0, 320.0, camD));`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  {
    vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    vec2 pert = (sA.rg * 2.0 - 1.0) * fadeA + (sB.rg * 2.0 - 1.0) * 0.75;
    nW = normalize(nW + vec3(pert.x, 0.0, pert.y) * uBump);
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  }`
      )
      .replace(
        '#include <opaque_fragment>',
        LOW
          ? '#include <opaque_fragment>'
          : `{
    vec2 gc = floor(vWPos.xz * 26.0);
    float gh = fract(sin(dot(gc, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 V = normalize(cameraPosition - vWPos);
    vec3 gd = normalize(vec3(fract(gh * 13.1) - 0.5, 0.9, fract(gh * 7.7) - 0.5));
    float sp = pow(max(dot(normalize(V + uSunDir), gd), 0.0), 220.0);
    float glint = step(0.9, gh) * sp * (1.0 - smoothstep(5.0, 24.0, camD));
    outgoingLight += vec3(glint * uGlint);
  }
  #include <opaque_fragment>`
      )
      .replace('#include <fog_fragment>', heightFog)
  }
  m.customProgramCacheKey = () => (LOW ? 'icev2-snow-low' : 'icev2-snow')
  return m
}

let wallTex = null
export function iceWallTexture() {
  if (wallTex) return wallTex
  wallTex = new THREE.TextureLoader().load('/textures/ice_wall.jpg')
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping
  wallTex.anisotropy = 4
  wallTex.colorSpace = THREE.NoColorSpace
  return wallTex
}

// ===== dinding es celah =====
//  - vertex color = warna + SUMBER CAHAYA (emissive): es tipis di atas tembus
//    cahaya siang, makin dalam makin gelap
//  - detail scallop + strata (tekstur ice_wall) diproyeksi dari samping (bidang
//    z-y) buat dinding, dari bawah (x-z) buat langit-langit, dicampur ngikut normal
//  - strata ikut ngatur terang-gelap cahaya tembusnya: pita lapisan es
//  - dilihat dari PERMUKAAN (kamera di luar), bagian yang makin dalam pudar ke
//    biru gelap, bukan ke abu kabut: retakan kebaca dalem
export const wallU = {
  uGlow: { value: TUNE.wallGlow },
  uWallBump: { value: TUNE.wallBump },
  uOut: { value: 1 },
  uCaveFog: { value: new THREE.Color('#0d2438') },
}
export function wallMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, envMapIntensity: 0.6 })
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, worldU, wallU, { uWallTex: { value: iceWallTexture() } })
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vWNormal = normalize(mat3(modelMatrix) * objectNormal);'
      )
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
varying vec3 vWNormal;
uniform sampler2D uWallTex;
uniform float uGlow;
uniform float uWallBump;
uniform float uOut;
uniform vec3 uCaveFog;
uniform float uFogTop;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float side = abs(vWNormal.y);
  vec4 tS = texture2D(uWallTex, vec2(vWPos.z, vWPos.y) * vec2(0.22, 0.3));
  vec4 tT = texture2D(uWallTex, vWPos.xz * 0.22 + 0.5);
  vec4 wt = mix(tS, tT, smoothstep(0.55, 0.8, side));
  float band = wt.b;
  diffuseColor.rgb *= mix(0.82, 1.12, band);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  {
    vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    vec2 p = wt.rg * 2.0 - 1.0;
    float sx = sign(vWNormal.x);
    vec3 pertS = vec3(0.0, p.y, p.x * sx);
    vec3 pertT = vec3(p.x, 0.0, p.y);
    nW = normalize(nW + mix(pertS, pertT, smoothstep(0.55, 0.8, side)) * uWallBump);
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * uGlow * mix(0.6, 1.35, band);'
      )
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
  float below = ${GROUND_Y.toFixed(2)} - vWPos.y;
  float fogF = smoothstep( fogNear, fogFar, vFogDepth );
  // dari permukaan: makin dalam makin tenggelam ke biru gelap
  fogF = max(fogF, uOut * smoothstep(1.5, 26.0, below) * 0.92);
  vec3 fogC = mix(fogColor, uCaveFog, uOut * smoothstep(0.5, 8.0, below));
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogC, fogF );
#endif`
      )
  }
  m.customProgramCacheKey = () => 'icev2-wall2'
  return m
}
