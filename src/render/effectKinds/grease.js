'use strict';
// grease.js — Grease, the 'tar' kind: bubbling tar whose flow turns, with an amber rim. Ported from
// `.claude/private/design/item-286/` round 4 (`grease4`, `tar3`), in lab pixels on a 36px cell
// (effectShaderKinds.js).

_FX_KIND_FRAG.tar = _FX_KIND_COMMON + `
// Each region flows its own way and the directions turn slowly; two layers cross-fade so it never resets.
vec2 flowDir(vec2 p, float t){ float a = noise(p * .005 + vec2(t * .025, -t * .02)) * 10. + t * .05; return vec2(cos(a), sin(a)); }

void main(){
  K = uG / 36.;
  vec2 p = vMap / K;
  float t = uTime;
  float d = sdLab(p);
  if (d > 30.) discard;
  vec2 wob = vec2(sin(t * .05), cos(t * .043)) * 1.5;
  float sw = fit(30., .12), se = fit(8., .4);
  float dd = d + (fbm(p * .035 + wob) - .5) * 14. * sw;
  float m = smoothstep(.8, -.8, dd);
  vec2 fd = flowDir(p, t) * 34.;
  float ph0 = fract(t * .07), ph1 = fract(t * .07 + .5), bl = abs(ph0 - .5) * 2.;
  vec2 s0 = p - fd * ph0, s1 = p - fd * ph1 + vec2(31., 17.);
  float h = mix(fbm(s0 * .02), fbm(s1 * .02), bl);
  float hx = mix(fbm((s0 + vec2(2., 0.)) * .02), fbm((s1 + vec2(2., 0.)) * .02), bl);
  float hy = mix(fbm((s0 + vec2(0., 2.)) * .02), fbm((s1 + vec2(0., 2.)) * .02), bl);
  vec3 nrm = normalize(vec3((h - hx) * 14., (h - hy) * 14., 1.));
  over(mix(vec3(.02, .017, .015), vec3(.075, .06, .045), smoothstep(.35, .7, h)), m * .95);
  float spots = mix(fbm(s0 * .018 + 3.), fbm(s1 * .018 + 3.), bl);
  over(vec3(0.), smoothstep(.54, .6, spots) * .55 * m);
  over(vec3(.12, .085, .05), smoothstep(.36, .3, spots) * .3 * m);
  vec3 n2 = normalize(vec3(nrm.xy * 1.8, 1.));
  float lh = max(dot(n2, normalize(vec3(-.35, -.45, 1.))), 0.);
  over(vec3(.95, .9, .8), pow(lh, 160.) * .6 * m);
  over(vec3(.3, .24, .17), pow(lh, 18.) * .18 * m);
  vec2 gi = floor(p / 34.);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 c = gi + vec2(float(x), float(y));
    if (hash(c) > .62) continue;
    float ph = fract(t * (.1 + .1 * hash(c + 3.)) + hash(c + 5.));
    vec2 ce = (c + .25 + .5 * vec2(hash(c + 1.), hash(c + 2.))) * 34.;
    float room = -sdLab(ce) - 1.5;
    if (room < 2.) continue;
    float r = min(5. + 6. * hash(c + 4.), room) * smoothstep(0., .8, ph);
    vec2 v = p - ce; float L = length(v);
    float live = step(ph, .86);
    float ins = smoothstep(.7, -.7, L - r) * live;
    vec2 nv = v / max(r, .1);
    vec3 bn = normalize(vec3(nv, sqrt(max(0., 1. - dot(nv, nv)))));
    float bb = dot(bn, normalize(vec3(-.5, -.6, .65)));
    over(vec3(.0), band(L - r - 1., 1.3) * live * .5 * m);
    over(vec3(.1, .085, .07), ins * .95 * m);
    over(vec3(.97, .93, .85), ins * smoothstep(.86, .96, bb) * m);
    over(vec3(.4, .34, .27), band(L - r + .6, .5) * live * .45 * m * smoothstep(.1, .4, ph));
    float pp = (ph - .86) / .14;
    over(vec3(.55, .47, .36), band(L - r * (1. + pp * 1.3), .7) * step(.86, ph) * (1. - pp) * .7 * m);
  }
  over(vec3(.26, .2, .13), band(dd + se, se) * .6);
  // The amber rim.
  over(vec3(.01, .008, .005), band(dd + .3 * se, 2. * se) * .7);
  over(vec3(.6, .42, .2), band(dd + 1.8 * se, .8 * se) * .85);
  float gl = smoothstep(.55, .8, noise(p * .05 + vec2(t * .2, 0.)));
  over(vec3(1., .9, .66), band(dd + 1.8 * se, .35) * gl * .6);
  if (col.a <= .001) discard;
  gl_FragColor = col;
}`;
