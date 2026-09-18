'use strict';
// effectShader.js — the two fragment passes an effect burns with: the light pass that adds fire,
// interior wash and sparks, and the dark pass that lays smoke and haze over it. Colours come from
// the material, never from here.

// The shader's vertex cap: the uniform array every ring is walked through, so it is the shader's
// number and the mesh builder reads it from here.
const MAX_FX_VERTS = 64;

const _FX_VERT = `
attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vMap;
void main(){
  vMap = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

// Shared prefix for both passes: uniforms and the geometry/colour helpers.
const _FX_COMMON = `
precision highp float;
varying vec2 vMap;
uniform vec2 uVerts[${MAX_FX_VERTS}];
uniform float uBreak[${MAX_FX_VERTS}];   // 1.0 where a new ring starts — see polyInfo
uniform int uCount;
uniform float uTime, uHeight, uSpeed, uAlong, uDiss, uWarm;
uniform vec3  uRamp[6];   // the material's colour stops — effectMaterials.js owns the numbers
uniform float uFill;    // interior warm-wash opacity
uniform float uG;       // grid cell in map units — the scale unit for sparks/haze
uniform float uSpark;   // ember sparks over the zone
uniform float uSmoke;   // dark smoke-flames on the border
uniform float uHaze;    // soft haze rising above the zone
uniform vec2  uCentroid;// zone centre, so haze knows which way is "above"

float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(11.,7.); a*=.5; } return v; }

// One edge: nearest-point distance, and the crossing-parity flip that decides inside from outside.
void edgeStep(vec2 p, vec2 va, vec2 vb, inout float dmin, inout float s, inout vec2 closest){
  vec2 e = vb - va, w = p - va;
  float t = clamp(dot(w,e)/max(dot(e,e),1e-6), 0.0, 1.0);
  vec2 pr = w - e*t;
  float dd = dot(pr,pr);
  if(dd < dmin){ dmin = dd; closest = va + e*t; }
  bvec3 c = bvec3(p.y>=va.y, p.y<vb.y, e.x*w.y > e.y*w.x);
  if(all(c) || all(not(c))) s = -s;
}
// Signed distance to the shape (negative inside), the outward normal, and the nearest outline
// point. ⚠ Carries the previous vertex across the loop, so only the loop index touches the uniform
// array — WebGL1 does not guarantee dynamic array indexing.
// ⚠ EVERY RING CLOSES AT ITS OWN FIRST POINT, marked by uBreak. Without it the walk bridges the
// outline to a hole and back, which fills the hole in. The parity then flips once per ring, so a
// point inside a hole reads as outside the shape, and the nearest edge can be on any ring — which
// is what makes the flames lick the inner wall.
void polyInfo(vec2 p, out float sd, out vec2 nrm, out vec2 near){
  float dmin = 1e12, s = 1.0;
  vec2 closest = p;
  vec2 ringStart = uVerts[0];
  vec2 vprev = uVerts[0];
  for(int i=1;i<${MAX_FX_VERTS};i++){
    if(i>=uCount) break;
    vec2 va = uVerts[i];
    if(uBreak[i] > 0.5){
      edgeStep(p, vprev, ringStart, dmin, s, closest);
      ringStart = va;
    } else {
      edgeStep(p, vprev, va, dmin, s, closest);
    }
    vprev = va;
  }
  edgeStep(p, vprev, ringStart, dmin, s, closest);
  sd = s*sqrt(dmin);
  near = closest;
  nrm = normalize((p - closest) + 1e-5) * s;   // s flips it to point OUT of the shape
}
vec3 fireRamp(float t){
  t = clamp(t,0.,1.);
  vec3 c = mix(uRamp[0], uRamp[1], smoothstep(0.0,0.22,t));
  c = mix(c, uRamp[2], smoothstep(0.18,0.5,t));
  c = mix(c, uRamp[3], smoothstep(0.5,0.78,t));
  c = mix(c, mix(uRamp[4], uRamp[5], uWarm), smoothstep(0.78,1.0,t));
  return c;
}
// Straight-alpha "over" for the dark pass's premultiplied accumulation.
void over(inout vec4 dst, vec3 c, float a){
  a = clamp(a, 0.0, 1.0);
  dst.rgb = c*a + dst.rgb*(1.0 - a);
  dst.a   = a + dst.a*(1.0 - a);
}
`;

// LIGHT pass (ADD blend): fire, interior fill and sparks — everything that emits light. Kept
// additive so the border keeps the glow the DM approved; a normal blend dimmed it.
const _FX_FRAG_LIGHT = _FX_COMMON + `
void main(){
  vec2 p = vMap;
  float d; vec2 n, seed;
  polyInfo(p, d, n, seed);
  if(d > 1.5) discard;                         // light only inside the zone
  float inside = smoothstep(1.5, -2.0, d);
  float inward = -d;

  vec3 acc = vec3(0.0);

  // interior wash
  float fillFall = clamp(1.0 - inward/(uHeight*3.0), 0.0, 1.0);
  acc += inside * uFill * (0.45 + 0.55*fillFall) * fireRamp(0.5);

  // flaming border: tongues licking inward, tips dissolving into embers
  float hf = 0.30 + 0.95*fbm(seed*uAlong + vec2(uTime*uSpeed*0.9, 0.0));
  hf *= 0.70 + 0.55*fbm(seed*uAlong*2.6 + vec2(uTime*uSpeed*2.2, 5.0));
  float k = inward / max(3.0, uHeight*hf);
  float inten = 1.0 - k;
  inten *= smoothstep(-1.0, 1.5, inward);
  float ember = fbm(p*0.02 - n*uTime*uSpeed*1.6);
  inten -= smoothstep(0.25, 1.0, k) * ember * uDiss;
  inten = clamp(inten, 0.0, 1.0);
  inten *= smoothstep(0.03, 0.16, inten);
  inten *= inten;
  acc += fireRamp(inten) * inten;

  // sparks: embers scattered over the zone, rising and wandering on their own life cycle
  if(uSpark > 0.001 && inside > 0.01){
    float CS = uG * 0.95;
    vec2 cell = floor(p / CS);
    float r1 = hash(cell), r2 = hash(cell + 7.3), r3 = hash(cell + 3.1);
    float on = step(0.60, r2);
    float age = fract(uTime * (0.18 + 0.22*r3) + r1);
    vec2 base = (cell + 0.5) * CS + (vec2(r1,r2) - 0.5) * CS * 0.7;
    float wander = fbm(base*(2.0/uG) + uTime*0.2 + r1*10.0) - 0.5;
    vec2 pos = base + vec2(wander * uG*0.7, -age * uG*1.2)
                    + vec2(sin(uTime*1.6 + r1*20.0), cos(uTime*1.3 + r2*17.0)) * uG*0.08;
    float dot = smoothstep(uG*0.045, 0.0, length(p - pos));
    float life = sin(age * 3.14159);
    acc += uSpark * dot * life * on * inside * vec3(1.0,0.72,0.35) * 2.2;
  }

  float a = clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0);
  if(a <= 0.001) discard;
  gl_FragColor = vec4(acc, a);   // ADD blend: this light is added to the map
}`;

// DARK pass (NORMAL blend): smoke and haze — the layers that DARKEN the map, which an additive
// pass cannot do. Runs on its own mesh over the same shape, on top of the light pass.
const _FX_FRAG_DARK = _FX_COMMON + `
void main(){
  vec2 p = vMap;
  float d; vec2 n, seed;
  polyInfo(p, d, n, seed);
  float hazeReach = uG * 2.5;                   // how far above the zone haze can climb
  if(d > hazeReach) discard;
  float inward = -d;

  vec4 R = vec4(0.0);                           // premultiplied, composited back-to-front

  // haze: soft grey over the WHOLE zone, thinning as it climbs above the top edge.
  // ⚠ NEVER GATE IT ON BEING NEAR THE EDGE, or it reads as a second smoke band on the outline.
  if(uHaze > 0.001){
    float within = smoothstep(1.0, -2.0, d);                  // full strength anywhere inside
    float above  = smoothstep(0.0, -uG*2.2, p.y - uCentroid.y);
    float rise   = smoothstep(hazeReach, 0.0, d) * above;     // outside, and only overhead
    float hz = smoothstep(0.35, 0.9, fbm(p*(1.6/uG) + vec2(uTime*0.15, -uTime*uSpeed*0.6)));
    over(R, vec3(0.10,0.10,0.12), uHaze * max(within, rise) * hz * 0.7);
  }

  // smoke: a second layer of dark flames on the border, over the fire
  if(uSmoke > 0.001){
    float shf = 0.30 + 0.95*fbm(seed*uAlong*0.85 + vec2(uTime*uSpeed*0.5 + 40.0, 0.0));
    shf *= 0.70 + 0.55*fbm(seed*uAlong*1.9 + vec2(uTime*uSpeed*1.1, 20.0));
    float smk = clamp(1.0 - inward / max(6.0, uHeight*1.5*shf), 0.0, 1.0);
    smk *= smoothstep(-1.5, 2.0, inward);
    smk *= smoothstep(0.06, 0.35, smk);
    over(R, vec3(0.03,0.03,0.035), uSmoke * smk * 0.8);
  }

  if(R.a <= 0.001) discard;
  gl_FragColor = R;   // NORMAL blend, premultiplied: darkens the map
}`;
