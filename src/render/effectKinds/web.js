'use strict';
// web.js — Web, the 'orbweb' kind: one orb web per effect, spokes from a hub near the middle, broken spiral
// threads, a thick frame thread. Ported from `.claude/private/design/item-286/` round 4 "Old web" (`web4`,
// `orbWeb` worn), in lab pixels on a 36px cell (effectShaderKinds.js). The hub is uHub, which effects.js sets.

_FX_KIND_FRAG.orbweb = _FX_KIND_COMMON + `
vec2 HUB = vec2(0.);
float rayHit(vec2 dir, vec2 a, vec2 b){
  vec2 e = b - a, w = a - HUB;
  float den = dir.x * e.y - dir.y * e.x;
  if (abs(den) < 1e-5) return 1e5;
  float tt = (w.x * e.y - w.y * e.x) / den, s = (w.x * dir.y - w.y * dir.x) / den;
  return (tt > 0. && s >= 0. && s <= 1.) ? tt : 1e5;
}
// Distance from the hub along dir to the outer ring. The holes are left out: a web over a hole spans it and
// the hole cuts the threads, and in a ring the hub sits in the hole.
float rayR(vec2 dir){
  float best = 1e5;
  vec2 ringStart = uVerts[0] / K, vprev = ringStart;
  for (int i = 1; i < ${MAX_FX_VERTS}; i++){
    if (i >= uCount) break;
    vec2 va = uVerts[i] / K;
    if (uBreak[i] > .5) break;
    best = min(best, rayHit(dir, vprev, va));
    vprev = va;
  }
  return min(best, rayHit(dir, vprev, ringStart));
}
float NS = 24.;
float spokeAng(float k){ return (k + (hash(vec2(mod(k, NS), 3.)) - .5) * .4) * 6.2832 / NS; }

void main(){
  K = uG / 36.;
  HUB = uHub / K;
  // A small web keeps fewer spokes and a looser spiral, or its threads run together. Sized by the outer ring.
  float req = uPerim / K / 6.2832;
  NS = clamp(floor(req / 3.), 10., 24.);
  vec2 p = vMap / K;
  float t = uTime;
  float d = sdLab(p);
  if (d > 6.) discard;
  float worn = 1.;
  over(vec3(.95, .95, .92), exp(-(d + 7.) * (d + 7.) / 50.) * .1 * step(d, 0.));
  float m = smoothstep(.7, -.7, d);
  over(vec3(.9, .9, .86), m * (.04 + worn * .05 * fbm(p * .02 + t * .02)));
  vec2 q = p - HUB;
  float sway = (1. + worn * 1.5);
  float rq = length(q);
  q += vec2(sin(t * .8 + rq * .01), cos(t * .7 + rq * .012)) * .9 * sway * smoothstep(0., 60., rq) * smoothstep(20., -40., d);
  float a = atan(q.y, q.x); if (a < 0.) a += 6.2832;
  float k0 = floor(a / 6.2832 * NS);
  float A0 = spokeAng(k0), A1 = spokeAng(k0 + 1.);
  if (a < A0){ k0 -= 1.; A1 = A0; A0 = spokeAng(k0); }
  else if (a > A1){ k0 += 1.; A0 = A1; A1 = spokeAng(k0 + 1.); }
  vec2 u0 = vec2(cos(A0), sin(A0)), u1 = vec2(cos(A1), sin(A1));
  float R0 = rayR(u0), R1 = rayR(u1);
  vec2 PA = u0 * R0, PB = u1 * R1;
  float sp0 = abs(u0.x * q.y - u0.y * q.x) + (dot(q, u0) < 0. ? 99. : 0.);
  float sp1 = abs(u1.x * q.y - u1.y * q.x) + (dot(q, u1) < 0. ? 99. : 0.);
  float spokeD = min(sp0, sp1);
  vec2 ch = PB - PA; vec2 n = normalize(vec2(ch.y, -ch.x));
  float hA = dot(n, PA);
  float s = dot(n, q) / hA;
  float lam = clamp((a - A0) / (A1 - A0), 0., 1.);
  float Rav = abs(hA);
  float Dp = max(10.5 / 140., 5.5 / max(req, 1.));
  float ph = (mod(k0, NS) + lam) / NS;
  float j = floor(s / Dp - ph + .5);
  float sT = (j + ph) * Dp;
  float ringD = abs(s - sT) * Rav;
  float broken = worn * step(.8, hash(vec2(j, mod(k0, NS))));
  float spiral = (s > .2 && s < .95 && broken < .5) ? ringD : 99.;
  float hub = s < .085 ? abs(fract(s / .028) - .5) * .028 * Rav : 99.;
  if (s < .025) spokeD = 99.;
  float Ls = min(spokeD, abs(d)), Lr = min(spiral, hub);
  over(vec3(.03, .03, .04), max(band(Ls, 1.6), band(Lr, 1.4)) * .4 * m);
  over(vec3(.94, .94, .9), band(Ls, .55) * .92 * m);
  over(vec3(.94, .94, .9), band(Lr, .42) * .85 * m);
  float kN = sp0 < sp1 ? k0 : k0 + 1.; float RN = sp0 < sp1 ? R0 : R1;
  float hk = hash(vec2(mod(kN, NS), 9.));
  float slide = mod(t * 10. + hk * 400., RN * 1.6);
  over(vec3(1.), step(.55, hash(vec2(mod(kN, NS), 4.))) * smoothstep(2.4, .8, abs(rq - slide)) * smoothstep(1.6, .4, spokeD) * m);
  float lam0 = .2 + .6 * hash(vec2(j, mod(k0, NS) + 40.));
  float bead = step(.72, hash(vec2(j + 3., mod(k0, NS)))) * smoothstep(1.7, .7, length(vec2(spiral, (lam - lam0) * length(ch) * sT)));
  float tw = .55 + .45 * pow(max(0., sin(t * 1.3 + hash(vec2(j, k0)) * 30.)), 6.);
  over(vec3(1.), bead * tw * m);
  over(vec3(.02, .02, .03), band(d + .6, 2.1) * .5);
  over(vec3(.93, .93, .89), band(d + .6, .95) * .95);
  if (col.a <= .001) discard;
  gl_FragColor = col;
}`;
