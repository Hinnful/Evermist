'use strict';
// effectShader.js — the two fragment passes an effect burns with: the light pass that adds the
// burning border, the flames, the pool and the sparks, and the dark pass that lays smoke, steam and
// char over them. Colours and amounts come from the material's record, never from here; a term a
// material sets to 0 is skipped.

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
uniform vec3  uSparkCol, uSmokeCol, uSteamCol;
uniform float uSteam;   // vapour rising off the zone, in uSteamCol
uniform float uLiquid;  // slow light flowing across a pool
uniform float uBub, uBubSize;  // bubbles that swell and pop
uniform float uToon;    // cartoon flames across the inside, in three flat bands
uniform float uCore;    // a thinner, hotter tongue inside the border's
uniform float uSpill;   // light thrown past the edge onto the floor
uniform float uFlicker; // how much the whole fire's light wavers
uniform float uScorch;  // the ground charred dark under the flames
uniform float uDrift;   // tiny sparks that rise fast and die young

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
// The toon flames' field: rising noise that churns and sways, thresholded lower where two slow
// patterns drifting opposite ways bunch it into clumps.
// ⚠ THE SWAY IS A NOISE FIELD, NEVER A SINE OF HEIGHT OR TIME ALONE. Either moves every flame the
// same way at once; noise gives each flame its own lean on its own beat.
// ⚠ THE CLUMPS LOWER THE THRESHOLD, NEVER GATE IT. A gate leaves a small zone dark for seconds
// whenever the empty part of one pattern drifts over it.
float toonField(vec2 p){
  float t = uTime*uSpeed;
  vec2 q = vec2(p.x/(uG*0.6), p.y/(uG*1.15));
  q.y += t*1.2;
  q.x += (noise(vec2(q.x*0.7, q.y*0.35 - t*0.5)) - 0.5)*0.9;
  float f = fbm(q + vec2(0.0, fbm(q*0.5 + 3.0 + t*0.6)*1.4));
  float cn = max(fbm(p*(0.9/uG) + vec2(t*0.03, -t*0.05)), fbm(p*(0.9/uG) + vec2(-t*0.04, -t*0.03) + 17.0));
  float th = 0.60 - 0.16*smoothstep(0.4, 0.75, cn);
  return smoothstep(th, th + 0.38, f);
}
// Straight-alpha "over" for the dark pass's premultiplied accumulation.
void over(inout vec4 dst, vec3 c, float a){
  a = clamp(a, 0.0, 1.0);
  dst.rgb = c*a + dst.rgb*(1.0 - a);
  dst.a   = a + dst.a*(1.0 - a);
}
`;

// LIGHT pass (NORMAL blend, premultiplied): fire, interior fill and sparks — everything that emits
// light. Its alpha is its brightest channel, so it paints over the map in proportion to its glow.
const _FX_FRAG_LIGHT = _FX_COMMON + `
void main(){
  vec2 p = vMap;
  float d; vec2 n, seed;
  polyInfo(p, d, n, seed);
  if(d > (uSpill > 0.001 ? uG*0.8 : 1.5)) discard;   // light inside the zone, and its spill
  float inside = smoothstep(1.5, -2.0, d);
  float inward = -d;
  float fl = mix(1.0, 0.78 + 0.4*noise(vec2(uTime*5.0, seed.x*0.004)), uFlicker);

  vec3 acc = vec3(0.0);

  if(uSpill > 0.001 && d > 0.0){
    float sp = smoothstep(uG*0.8, 0.0, d);
    acc += uSpill * sp*sp * fl * fireRamp(0.55) * 0.55;
  }

  // interior wash
  float fillFall = clamp(1.0 - inward/(uHeight*3.0), 0.0, 1.0);
  acc += inside * uFill * (0.45 + 0.55*fillFall) * fireRamp(0.5);

  if(uLiquid > 0.001){
    float f1 = fbm(p*(1.1/uG) + vec2(uTime*0.05, uTime*0.03));
    float f2 = fbm(p*(2.6/uG) - vec2(uTime*0.07, -uTime*0.04) + f1*2.0);
    float caust = smoothstep(0.5, 0.85, f2);
    acc += inside * uLiquid * (0.22 + 0.78*caust) * fireRamp(0.5 + 0.35*caust) * 0.8;
  }

  if(uToon > 0.001 && inside > 0.01){
    float tf = toonField(p), aa = 0.025;
    vec3 c = mix(vec3(0.0), fireRamp(0.42)*0.55, smoothstep(0.12 - aa, 0.12 + aa, tf));
    c = mix(c, fireRamp(0.695)*0.775, smoothstep(0.40 - aa, 0.40 + aa, tf));
    c = mix(c, fireRamp(0.97), smoothstep(0.68 - aa, 0.68 + aa, tf));
    acc += uToon * inside * c * fl * 1.2;
  }

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
  acc += fireRamp(inten) * inten * fl;

  if(uCore > 0.001){
    float cf = 0.25 + 0.9*fbm(seed*uAlong*1.7 + vec2(uTime*uSpeed*1.8, 30.0));
    float ci = clamp(1.0 - inward / max(2.0, uHeight*0.45*cf), 0.0, 1.0) * smoothstep(-1.0, 1.0, inward);
    ci *= ci*ci;
    acc += uCore * fireRamp(0.75 + 0.25*ci) * ci * fl;
  }

  // bubbles: two sizes on loose grids, each swelling, catching a dim highlight and popping
  if(uBub > 0.001 && inside > 0.01){
    for(int L=0; L<2; L++){
      float CS = uG * (L==0 ? 0.55 : 0.32);
      vec2 q = p + float(L)*vec2(17.0, 31.0);
      vec2 cell = floor(q/CS);
      float r1 = hash(cell + float(L)*3.7), r2 = hash(cell + 7.3), r3 = hash(cell + 3.1);
      float on = step(1.0 - uBub*(0.45 + 0.4*smoothstep(uHeight*4.0, 0.0, inward)), r2);
      float age = fract(uTime*(0.22 + 0.3*r3) + r1);
      vec2 c = (cell + 0.5)*CS + (vec2(r1, r3) - 0.5)*CS*0.45;
      float R = CS*0.5*uBubSize*(0.4 + 0.6*r1) * smoothstep(0.0, 0.85, age);
      float dist = length(q - c), alive = step(age, 0.9);
      float rim = smoothstep(uG*0.022, 0.0, abs(dist - R)) * alive;
      float body = smoothstep(R, R*0.5, dist) * 0.22 * alive;
      float hl = smoothstep(R*0.3, 0.0, length(q - c + vec2(R*0.38))) * alive;
      float pop = smoothstep(0.9, 0.925, age) * smoothstep(1.0, 0.94, age) * smoothstep(uG*0.03, 0.0, abs(dist - R*1.35));
      acc += on * inside * ((rim*0.7 + body)*fireRamp(0.62) + (hl*0.25 + pop*0.6)*fireRamp(0.7));
    }
  }

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
    acc += uSpark * dot * life * on * inside * uSparkCol * 2.2;
  }

  // drift sparks. ⚠ EACH PIXEL WALKS THE CELLS BELOW IT TOO: a spark climbs out of the cell it was
  // born in, and a pixel that checked only its own cell would cut it off at the cell's top.
  if(uDrift > 0.001){
    float soft = smoothstep(uG*0.6, -2.0, d);
    for(int L=0; L<2; L++){
      float CS = uG*(L==0 ? 0.45 : 0.32);
      vec2 base0 = floor(p/CS + float(L)*0.5);
      for(int j=0; j<4; j++){
        vec2 cell = base0 + vec2(0.0, float(j));
        float r1 = hash(cell + float(L)*4.1), r2 = hash(cell + 7.7), r3 = hash(cell + 2.9);
        float age = fract(uTime*(0.55 + 0.6*r3) + r1);
        vec2 born = (cell - float(L)*0.5 + 0.5 + (vec2(r1, r3) - 0.5)*0.8)*CS;
        vec2 pos = born + vec2(sin(age*5.0 + r1*20.0)*uG*0.1, -age*uG*1.1);
        float tw = 0.55 + 0.45*step(0.4, fract(uTime*9.0 + r2*13.0));
        float dt = smoothstep(uG*0.02, 0.0, length(p - pos));
        acc += uDrift * step(0.72, r2) * dt * (1.0 - age) * tw * soft * uSparkCol * 3.0;
      }
    }
  }

  float a = clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0);
  if(a <= 0.001) discard;
  gl_FragColor = vec4(acc, a);   // premultiplied: rgb never exceeds a, since a is its largest channel
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
    over(R, uSmokeCol, uSmoke * smk * 0.8);
  }

  // char under the flames, kept off the burning border so it never dims it
  if(uScorch > 0.001){
    float within = smoothstep(1.0, -3.0, d) * smoothstep(uHeight*0.4, uHeight*1.4, inward);
    over(R, vec3(0.03,0.022,0.018), uScorch * within * (0.55 + 0.45*fbm(p*(1.3/uG))) * 0.6);
  }

  // steam or smoke, rising off the zone in wisps and drifting above it
  if(uSteam > 0.001){
    float within = smoothstep(uG*0.2, -uG*0.6, d);
    float rise = smoothstep(hazeReach, 0.0, d) * smoothstep(0.0, -uG*2.2, p.y - uCentroid.y);
    float s1 = fbm(p*(1.2/uG) + vec2(sin(uTime*0.2)*0.4, uTime*0.45));
    float s2 = fbm(p*(2.5/uG) + vec2(uTime*0.1, uTime*0.85) + s1*1.5);
    float st = smoothstep(0.42, 0.85, s1*0.55 + s2*0.55);
    over(R, uSteamCol, uSteam * max(within*0.75, rise) * st * 0.55);
  }

  if(R.a <= 0.001) discard;
  gl_FragColor = R;   // NORMAL blend, premultiplied: darkens the map
}`;
