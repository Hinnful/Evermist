'use strict';
// ice.js — Ice, the 'frost' kind: a cracked see-through sheet, a blue frost rim with crystals in clusters, a
// honeycomb near the rim and a blue edge. Ported from `.claude/private/design/item-286/` round 4 (`iceSheet4`),
// in lab pixels on a 36px cell (effectShaderKinds.js).

_FX_KIND_FRAG.frost = _FX_KIND_COMMON + `
float ridge(vec2 p){ return 1. - abs(noise(p) * 2. - 1.); }
vec3 worley(vec2 p, float t, out vec2 o){
  vec2 i = floor(p), f = fract(p); float f1 = 9., f2 = 9., id = 0.; o = vec2(0.);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    float h1 = hash(i + g), h2 = hash(i + g + 19.7);
    vec2 pt = g + .5 + .35 * vec2(sin(t*.25 + 6.28*h1), cos(t*.21 + 6.28*h2));
    vec2 r = pt - f; float dd = length(r);
    if (dd < f1){ f2 = f1; f1 = dd; o = r; id = h1; } else if (dd < f2) f2 = dd;
  }
  return vec3(f1, f2, id);
}
vec3 hexVor(vec2 x){ vec2 n = floor(x), f = fract(x); float d1 = 8., d2 = 8.; vec2 id = vec2(0.);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 g = vec2(float(i), float(j));
    vec2 o = .5 + .3 * (h22(n + g) - .5) + vec2(mod(n.y + g.y, 2.) * .5 - .25, 0.); vec2 r = g + o - f; float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; id = n + g + o; } else if (d < d2) d2 = d; }
  return vec3(id, sqrt(d2) - sqrt(d1)); }

void main(){
  K = uG / 36.;
  vec2 p = vMap / K;
  float t = uTime;
  float per; float d = sdLab(p, per);
  if (d > 8.) discard;
  float m = smoothstep(.7, -.7, d), dep = -d;
  float sc = fit(45., .15), se = fit(8., .4), deps = dep / sc;
  over(vec3(.42, .7, .95), m * (.32 + .14 * smoothstep(0., 80., dep)));
  vec2 o; vec3 w = worley(p / 46., 0., o); float cr = (w.y - w.x) * 46. * .5;
  vec3 w2 = worley(p / 17. + 7., 0., o); float cr2 = (w2.y - w2.x) * 17. * .5;
  over(vec3(.04, .1, .22), band(cr, 1.6) * .35 * m);
  over(vec3(.88, .96, 1.), band(cr, .55) * .8 * m);
  over(vec3(.85, .94, 1.), band(cr2, .3) * .35 * m * step(.5, hash(floor(p / 60.))));
  float sa = .65 + .55 * sin(t * .05);
  float g = mod(dot(p, vec2(cos(sa), sin(sa))) - t * 55., 1100.) - 550.;
  over(vec3(.9, .97, 1.), exp(-g * g / 800.) * .4 * m);
  vec2 wq = (vec2(fbm(p * .02), fbm(p * .02 + 7.)) - .5) * .6;
  vec3 hA = hexVor(p / 24. + wq);
  float zone = smoothstep(10., 20., deps) * smoothstep(66., 36., deps) * smoothstep(.25, .5, fbm(p * .015 + t * .02));
  float lit = smoothstep(.55, 1., sin(t * .5 + hash(hA.xy) * 6.2832));
  float ln = smoothstep(.13, 0., hA.z) * (.35 + .65 * hash(hA.xy)) * zone;
  over(vec3(.75, .9, 1.), ln * (.4 + .55 * lit) * .8 * m);
  float fr = fbm(p * .11) * .6 + fbm(p * .035) * .6;
  float thr = .18 + deps / 42. + .02 * sin(t * .4);
  float rime = smoothstep(thr, thr + .06, fr) * m;
  float grow = .8 + .2 * sin(t * .25 + per * .01);
  float cl = smoothstep(.4, .65, noise(vec2(per * .025, 7.)));
  float spikes = (pow(ridge(vec2(per * .08, 1.)), 4.5) * 26. + pow(ridge(vec2(per * .2, 4.)), 4.) * 10.) * cl;
  float reach = 2. * se + spikes * grow * sc;
  float fing = smoothstep(reach + 1.2, reach - 1.2, dep) * m;
  float fro = max(rime * (1. - fing * .3), fing);
  over(vec3(.25, .48, .78), fro * .45);
  over(vec3(.76, .89, 1.), fro * .85);
  over(vec3(.5, .74, .98), fing * band(dep - reach * .55, .6) * smoothstep(6., 12., reach) * .6);
  float fl = abs(fract(fbm(p * .045) * 9.) - .5);
  over(vec3(.9, .97, 1.), band(fl * 24., .5) * smoothstep(40., 8., deps) * m * .5);
  over(vec3(1.), sparkle(p, t, 13., .2) * m);
  over(vec3(1.), sparkle(p + 5., t * 1.3, 9., .3) * fro);
  over(vec3(.01, .04, .13), band(d + 1.6 * se, 2.4 * se) * .6);
  over(vec3(.3, .62, 1.), band(d + 1.6 * se, 1.1 * se) * .95);
  over(vec3(.85, .95, 1.), band(d + 3.6, .45) * .55 * smoothstep(.6, 1., se));
  if (col.a <= .001) discard;
  gl_FragColor = col;
}`;
