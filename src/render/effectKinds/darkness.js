'use strict';
// darkness.js — Darkness, the 'billows' kind: slow churning billows, a violet edge line that rolls as Fog cloud's
// does, purple light on the folds, rare dark motes. Ported from `.claude/private/design/item-286/` round 4
// (`billows4`), the edge from `.claude/private/design/item-294-poison/` round 5 (`darkEdge`, edge 0), in lab
// pixels on a 36px cell (effectShaderKinds.js).

_FX_KIND_FRAG.billows = _FX_KIND_COMMON + `
float dens(vec2 p, float t){
  vec2 q = p * .009;
  vec2 w = vec2(fbm(q * 1.3 + vec2(t * .05, 0.)), fbm(q * 1.3 + vec2(4., -t * .04)));
  return fbm(q + w * 1.6 + vec2(t * .015, t * .01));
}
float soft(vec2 p, float t){
  vec2 q = p * .009;
  vec2 w = vec2(noise(q * 1.3 + vec2(t * .05, 0.)), noise(q * 1.3 + vec2(4., -t * .04)));
  vec2 r = q + w * 1.6 + vec2(t * .015, t * .01);
  return noise(r) * .65 + noise(r * 2.03 + 3.) * .35;
}
// Each point orbits a small circle out of phase with its neighbours, and eddies twist one way then back.
vec2 churn(vec2 p, float t, float amt){
  float ph = noise(p * .006) * 12.566;
  vec2 orb = vec2(cos(t * .45 * amt + ph), sin(t * .45 * amt + ph)) * 20. * amt;
  vec2 g = p / 120.; vec2 i = floor(g); vec2 q = p;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 c = i + vec2(float(x), float(y));
    vec2 ce = (c + .5 + .4 * (h22(c) - .5)) * 120.;
    vec2 v = p - ce; float fall = exp(-dot(v, v) / 3600.);
    float a = 1.1 * amt * sin(t * .22 + hash(c) * 6.2832) * fall;
    float cs = cos(a), sn = sin(a);
    q += mat2(cs, sn, -sn, cs) * v - v;
  }
  return q + orb;
}

void main(){
  K = uG / 36.;
  vec2 p = vMap / K;
  float t = uTime;
  float d = sdLab(p);
  if (d > 34.) discard;
  t *= .6;
  vec2 w = churn(p, t, 1.);
  float tt = t * 1.8;
  float n = dens(w, tt);
  float sw = fit(40., .12), se = fit(8., .4);
  float dd = d + (sN(p * .02 - drift(t) * .22 + n * 1.5) - .5) * 22. * fit(60., .1);
  float m = smoothstep(2. * sw, -6. * sw, dd);
  float n2 = soft(w, tt), nx = soft(w + vec2(9., 0.), tt), ny = soft(w + vec2(0., 9.), tt);
  float lit = ((n2 - nx) + (n2 - ny)) * 7.;
  vec3 c = mix(vec3(.008, .005, .018), vec3(.07, .05, .12), smoothstep(-.35, .55, lit + (n - .5) * .8));
  c = mix(c, vec3(.3, .16, .52), smoothstep(.35, .95, lit) * .6);
  // Faint patches with a dark veil under each, from item-294's board (darkRef with patches): never holes.
  float o = cellsF(w, t, 115., .1, 60., 48.) * .75 * smoothstep(-20., -46., dd);
  over(c, m * .93 * (1. - o * .82));
  over(vec3(.4, .2, .75), o * (1. - o) * 4. * .15 * m);
  over(vec3(.025, .015, .05), o * .45 * m);
  float pk = smoothstep(.58, .74, soft(w * 1.6 + 30., tt * .8));
  over(vec3(.26, .08, .44), pk * .38 * m * (.65 + .35 * sin(t * .8 + n * 6.)));
  over(vec3(0.), smoothstep(-14. * sw, -70. * sw, dd) * .38 * m * (1. - o));
  over(vec3(.4, .2, .75), exp(-(dd + se) * (dd + se) / (40. * se * se)) * .3);
  over(vec3(.02, 0., .05), band(dd + 1.5 * se, 2.2 * se) * .5);
  over(vec3(.66, .46, 1.), band(dd + 1.5 * se, .85 * se) * .85);
  vec2 mp = w + vec2(0., t * 5.);
  over(vec3(.45, .3, .75), sparkle(mp, t * .5, 27., .06) * .6 * smoothstep(-10. * sw, -30. * sw, d));
  if (col.a <= .001) discard;
  gl_FragColor = col;
}`;
