import * as THREE from 'three'
import { BlendFunction, Effect } from 'postprocessing'
import { computeFx, fx, portalFx } from './fxState'
import { frostCanvasRGB } from './frostMap'

// ===== efek transisi desktop: CA + frost + glitch dalam SATU efek =====
// Dimasukin ke EffectComposer yang udah ada (Experience.jsx), di belakang
// Bloom. Sengaja GAK ditandai CONVOLUTION: @react-three/postprocessing bikin
// pass baru buat efek convolution, dan itu satu render layar penuh tambahan
// tiap frame walau efeknya lagi 0. Tanpa tanda itu dia ngegabung ke EffectPass
// Bloom (satu program shader, satu pass).
//
// Konsekuensinya: inputBuffer di sini = scene SEBELUM bloom. Jadi CA dan blur
// frost gak ngeganti warna, tapi nambahin SELISIH sampel geser vs sampel
// tengah ke inputColor (yang udah ada bloom-nya). Glow bloom tetep utuh.
//
// Biaya pas diem: semua cabang digerbang uniform (koheren di semua piksel),
// jadi di luar jendela transisi shader-nya cuma baca inputColor lalu keluar.
const frag = /* glsl */ `
  uniform sampler2D frostMap;
  uniform float ca;
  uniform float frost;
  uniform float glitch;
  uniform float warp;
  uniform float seed;
  uniform vec3 frostTint;

  float h11(float p) {
    return fract(sin(p * 127.1 + seed * 311.7) * 43758.5453);
  }

  // ubin kristal diulang di layar dengan skala tetap (rasio layar dikoreksi),
  // jadi garis es-nya tetep tajam di layar lebar maupun HP
  vec2 tileUv(vec2 uv) {
    return uv * vec2(aspect, 1.0) * 1.7;
  }

  float frostCover(vec2 uv) {
    // rambatan: peta tumbuh (G, ruang layar) di-threshold kekuatan frost,
    // sudut dulu, lalu tepi, baru agak ke tengah
    float th = 1.0 - frost;
    return smoothstep(th, th + 0.22, texture2D(frostMap, uv).g);
  }

  void mainUv(inout vec2 uv) {
    if (frost > 0.001) {
      // pembiasan es: geser UV searah gradien kristal ter-blur, cuma di area beku
      float cov = frostCover(uv);
      if (cov > 0.0) {
        vec2 tu = tileUv(uv);
        vec2 px = vec2(1.0 / 512.0, 0.0);
        float gx = texture2D(frostMap, tu + px.xy).b - texture2D(frostMap, tu - px.xy).b;
        float gy = texture2D(frostMap, tu + px.yx).b - texture2D(frostMap, tu - px.yx).b;
        uv += vec2(gx, gy) * cov * 0.03;
      }
    }
    if (glitch > 0.001) {
      // glitch displacement ala igloo: pita horizontal acak geser samping,
      // pola ganti ~14 kali per detik (seed dari JS)
      float band = floor(uv.y * 26.0);
      float r = h11(band);
      if (r < glitch * 0.45) {
        uv.x += (h11(band + 17.0) - 0.5) * 0.09 * glitch;
      }
      float big = floor(uv.y * 5.0);
      if (h11(big + 40.0) < glitch * 0.25) uv.x += (h11(big + 3.0) - 0.5) * 0.03 * glitch;
    }
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb;
    if (warp > 0.001) {
      // melesat nembus gerbang portal: blur zoom radial (sampel ditarik ke
      // tengah), nol di tengah layar, makin kuat ke tepi. Lembut, bukan garis
      vec2 dir = uv - 0.5;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float k = 1.0 - warp * 0.085 * float(i) / 7.0;
        acc += texture2D(inputBuffer, 0.5 + dir * k).rgb;
      }
      c += acc / 8.0 - texture2D(inputBuffer, uv).rgb;
    }
    if (ca > 0.001 || frost > 0.001) {
      vec3 base = texture2D(inputBuffer, uv).rgb;
      if (ca > 0.001) {
        // radial: nol di tengah, makin gede ke tepi (kayak lensa beneran)
        vec2 d = uv - 0.5;
        vec2 off = d * (0.012 + 0.03 * dot(d, d)) * ca;
        float r = texture2D(inputBuffer, uv + off).r;
        float b = texture2D(inputBuffer, uv - off).b;
        c.r += r - base.r;
        c.b += b - base.b;
      }
      if (frost > 0.001) {
        float cov = frostCover(uv);
        if (cov > 0.0) {
          vec3 f = texture2D(frostMap, tileUv(uv)).rgb;
          // kaca beku: blur 4 tap tipis, embun pucat makin tebal ke sudut,
          // kristal jadi garis terang
          vec2 o = vec2(0.0022, 0.0034) * cov;
          vec3 bl = texture2D(inputBuffer, uv + o).rgb + texture2D(inputBuffer, uv - o).rgb
                  + texture2D(inputBuffer, uv + vec2(o.x, -o.y)).rgb + texture2D(inputBuffer, uv + vec2(-o.x, o.y)).rgb;
          c += (bl * 0.25 - base) * cov;
          float haze = cov * cov;
          c = mix(c, c * 0.72 + frostTint * 0.34, haze * 0.55);
          c += frostTint * f.r * cov * 0.8;
        }
      }
    }
    outputColor = vec4(c, inputColor.a);
  }
`

export class TransitionEffect extends Effect {
  constructor() {
    const tex = new THREE.CanvasTexture(frostCanvasRGB(512))
    // data, bukan warna: jangan dikonversi sRGB
    tex.colorSpace = THREE.NoColorSpace
    tex.generateMipmaps = false
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    super('TransitionEffect', frag, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['frostMap', new THREE.Uniform(tex)],
        ['ca', new THREE.Uniform(0)],
        ['frost', new THREE.Uniform(0)],
        ['glitch', new THREE.Uniform(0)],
        ['warp', new THREE.Uniform(0)],
        ['seed', new THREE.Uniform(0)],
        // es kebiruan, dalam ruang linear (EffectPass kerja di linear)
        ['frostTint', new THREE.Uniform(new THREE.Color('#dcebf5'))],
      ]),
    })
    this.frostTex = tex
    this.clock = 0
  }

  // dipanggil EffectPass tiap frame sebelum render
  update(renderer, inputBuffer, dt) {
    const f = computeFx()
    const u = this.uniforms
    u.get('ca').value = f.ca
    u.get('frost').value = f.frost
    u.get('glitch').value = f.glitch
    u.get('warp').value = portalFx.warp
    if (f.glitch > 0.001) {
      this.clock += dt
      u.get('seed').value = Math.floor(this.clock * 14) % 97
    }
  }

  dispose() {
    this.frostTex.dispose()
    super.dispose()
  }
}

export { fx }
