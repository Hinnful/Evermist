'use strict';
// weatherShader.js - the weather pass's shaders, as data. weather.js draws them.
// KEEP THE SOURCE ASCII, comments included: a driver may reject the rest, and the cost is a black
// screen with no error the app can show.

// The quad is the whole map in map units; vUv is the map as 0..1, top left first.
const WEATHER_VERT = `
precision highp float;
attribute vec2 aPos;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec2 uMapSize;
varying vec2 vUv;
void main() {
  vUv = aPos / uMapSize;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aPos, 1.0)).xy, 0.0, 1.0);
}
`;

// Time of day's numbers, written into the source from timeOfDayPlan.js so the two never drift.
const _wf = n => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const _wv = a => 'vec3(' + a.map(_wf).join(',') + ')';

// Time of day: the map pixel graded before any weather runs on it, in linear light. uTod weighs Day,
// Dusk and Night (a fade blends them); a room keeps a dark interior and dims bright ground.
const WEATHER_TOD = `
uniform sampler2D uRoomGlow, uLamp;
uniform vec3 uTod;
float tLum(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
vec3 toLin(vec3 s){ return mix(s/12.92, pow((s+.055)/1.055, vec3(2.4)), step(.04045, s)); }
vec3 toSrgb(vec3 l){ l=clamp(l,0.,1.); return mix(l*12.92, 1.055*pow(l, vec3(1./2.4))-.055, step(.0031308, l)); }
vec3 tShoulder(vec3 x){ float k=${_wf(TOD.shoulder[0])}, r=${_wf(TOD.shoulder[1])}; return mix(x, k+r*(1.-exp(-(x-k)/r)), step(k, x)); }
vec3 tContrast(vec3 c, float p){ float L=tLum(c); float Lc=${_wf(TOD.pivot)}*pow((L+1e-4)/${_wf(TOD.pivot)}, p); return c*(Lc/(L+1e-4)); }
vec3 tResat(vec3 c, float k){ float L=tLum(c); return L+(c-L)*k; }
vec3 tNight(vec3 a){
  vec3 t=${_wv(TOD.night.tint)}; t/=tLum(t); float L=tLum(a);
  return tContrast((a+(L-a)*${_wf(TOD.night.desat)})*t, ${_wf(TOD.night.contrast)})*${_wf(TOD.night.gain)}+${_wv(TOD.night.floor)};
}
vec3 tDusk(vec3 a, vec2 uv){
  float L=tLum(a);
  float sun=${_wf(TOD.dusk.sun[0])}-${_wf(TOD.dusk.sun[1])}*smoothstep(0.,1., uv.x*${_wf(TOD.dusk.sunDir[0])}+uv.y*${_wf(TOD.dusk.sunDir[1])});
  float rel=smoothstep(0., ${_wf(TOD.dusk.relTop)}, L);
  float mx=max(a.r,max(a.g,a.b)), mn=min(a.r,min(a.g,a.b));
  float k=smoothstep(${_wf(TOD.dusk.satEdge[0])}, ${_wf(TOD.dusk.satEdge[1])}, (mx-mn)/(mx+1e-4));
  vec3 hf=${_wv(TOD.dusk.hiFull)}, hs=${_wv(TOD.dusk.hiSoft)}, lo=${_wv(TOD.dusk.lo)};
  hf/=tLum(hf); hs/=tLum(hs); lo/=tLum(lo);
  vec3 c=tResat(a*(lo+(hs+(hf-hs)*k-lo)*rel), ${_wf(TOD.dusk.sat)});
  return tContrast(c, ${_wf(TOD.dusk.contrast)})*(${_wf(TOD.dusk.gain)}+${_wf(TOD.dusk.bright)}*smoothstep(${_wf(TOD.dusk.brightEdge[0])}, ${_wf(TOD.dusk.brightEdge[1])}, L))*sun;
}
vec3 tDay(vec3 a, float lamp){
  vec3 b=a*${_wv(TOD.day.sun)}; float Lb=tLum(b);
  b=b+(Lb*${_wf(TOD.day.lampGrey)}-b)*lamp*${_wf(TOD.day.lampPull)};
  float E=${_wf(TOD.day.lift)};
  return tShoulder(tResat(E*b/(1.+(E-1.)*b/${_wf(TOD.day.white)}), ${_wf(TOD.day.sat)}));
}
vec3 tRooms(vec3 a, vec3 o, float inside, float glow, float spill, float cap){
  float L=tLum(a); float dim=1.-cap*smoothstep(.05,.5,L); float cst=1.-smoothstep(.12,.35,L);
  vec3 lit=o+a*${_wv(TOD.warm)}*glow*spill;
  vec3 room=a*dim*(1.+(${_wv(TOD.roomWarm)}-1.)*cst);
  return tShoulder(lit*(1.-inside)+room*inside);
}
vec3 todGrade(vec3 s, vec2 uv, float inside, vec3 w, float str){
  float sum=w.x+w.y+w.z;
  if(sum<.001) return s;
  vec3 a=toLin(s); float glow=clamp(texture2D(uRoomGlow, uv).a-inside, 0., 1.);
  vec3 o=a*(1.-sum);
  if(w.x>0.) o+=w.x*tDay(a, texture2D(uLamp, uv).r);
  if(w.y>0.) o+=w.y*tRooms(a, tDusk(a, uv), inside, glow, ${_wf(TOD.dusk.spill)}, ${_wf(TOD.dusk.cap)});
  if(w.z>0.) o+=w.z*tRooms(a, tNight(a), inside, glow, ${_wf(TOD.night.spill)}, ${_wf(TOD.night.cap)});
  return mix(s, toSrgb(o), str);
}
`;

// The map is read through uRect (the map-space rectangle uMap covers: the whole map, or the region
// an animated map's texture carries). With uOverlay on there is no map texture to read - a DM
// animated map is a video under the canvas - so a mid grey stands in and only what the weather
// changes is drawn, as coverage. Time of day there is a tint fitted on that grey, rooms cut out.
// uFloor: the main mesh draws the graded map opaque under its weather, since the grade changes every pixel.
const WEATHER_FRAG = `
precision highp float;
uniform sampler2D uMap;
uniform sampler2D uRoom;
uniform float uT, uSim, uWind, uAspect, uInt, uCell, uLines, uBeams, uAlpha, uGustA, uDark, uFlash, uWet, uSnowC, uStr, uOverlay;
uniform vec2 uGustC, uMapSize;
uniform vec4 uRect, uP1, uP2;
uniform int uW;
uniform float uFloor;
varying vec2 vUv;
${WEATHER_TOD}

float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ s+=a*vn(p); p=m*p; a*=.5; } return s; }
float an(vec2 p){ return vn(p)*.55+vn(p*2.03+3.1)*.28+vn(p*4.07+7.3)*.17; }
vec4 mapTex(vec2 uv){ return texture2D(uMap, (uv*uMapSize - uRect.xy) / uRect.zw); }
vec3 mapAt(vec2 uv){ return mix(mapTex(uv).rgb, vec3(.5), uOverlay); }
const vec2 WD=vec2(.9578,.2873);
float cellAt(vec2 q, float t){ return smoothstep(.4,.66, fbm(q*1.3 - WD*t*.025 + vec2(0.,t*.006))); }
float rain(vec2 q, vec2 dir, float N, float v, float len, float dens, float seed){
  vec2 ac=vec2(-dir.y, dir.x); float a=dot(q,ac)*N; float col=floor(a); float r1=h21(vec2(col,seed));
  float b=(dot(q,dir) - uT*v*(.85+.3*r1))*N*.25 + r1*7.; float row=floor(b);
  float r2=h21(vec2(col,row+seed*13.)); if(r2>dens) return 0.;
  float fx=fract(a)-.5-(r2-.5)*.6; float fy=fract(b);
  return smoothstep(.09,.0,abs(fx)) * step(fy,len) * (fy/len); }
float ripple(vec2 q, float N, float rate, float dens){
  vec2 p=q*N; vec2 c=floor(p), f=fract(p); float r=h21(c); float ph=uT*rate*(.8+.5*r)+r*13.;
  float cyc=floor(ph); ph=fract(ph); if(h21(c+cyc*.37)>dens) return 0.;
  vec2 ctr=vec2(h21(c+cyc+3.1),h21(c+cyc+7.7))*.5+.25; float d=length(f-ctr); float rad=ph*.3;
  return smoothstep(.03,0.,abs(d-rad))*(1.-ph) + smoothstep(.05,0.,d)*step(ph,.12); }
float flake(vec2 q, float N, vec2 vel, float seed, float size, float dens, float sharp){
  vec2 p=(q - vel*uT)*N; vec2 c=floor(p), f=fract(p); float r=h21(c+seed*17.); if(r>dens) return 0.;
  vec2 ctr=vec2(h21(c+seed+1.7),h21(c+seed+3.1))*.5+.25;
  ctr+=vec2(sin(uT*(.3+r*.5)+r*40.), cos(uT*(.25+r*.4)+r*20.))*.12;
  float sz=size*(.6+.6*h21(c+seed+5.3)); return smoothstep(sz, sz*sharp, length(f-ctr)); }
void main(){
  vec2 uv=vUv; vec2 q=vec2(uv.x*uAspect, uv.y); vec2 dir=vec2(sin(uWind), cos(uWind)); vec2 ac=vec2(-dir.y,dir.x);
  vec2 wp=vec2(-WD.y,WD.x); float inRoom=texture2D(uRoom, uv).a;
  vec3 base=uOverlay>.5 ? mix(todGrade(vec3(.5), uv, 0., vec3(0.,uTod.yz), uStr), vec3(.5), inRoom) : todGrade(mapAt(uv), uv, inRoom, uTod, uStr);
  float lum0=dot(base,vec3(.3,.59,.11));
  vec3 col=base;
  float C=uCell*cellAt(q,uSim);
  float I=uInt*(.55+.7*C);
  float hist=uCell>0.? (cellAt(q,uSim-20.)+cellAt(q,uSim-45.)+cellAt(q,uSim-75.))/3. : .5;
  if(uWet>.001){ float W=clamp(uWet*(.55+.8*hist),0.,1.); vec2 e=vec2(.012,0.);
    vec3 b=(base+mapAt(uv+e.xy)+mapAt(uv-e.xy)+mapAt(uv+e.yx)+mapAt(uv-e.yx))/5.;
    float dirt=clamp((b.r-b.g)*5.+.3,0.,1.); float low=1.-dot(b,vec3(.3,.59,.11));
    float n=fbm(q*5.+3.)*.65+dirt*.35+low*.15; float th=mix(1.08,.66,W);
    float pm=smoothstep(th,th+.025,n); float rim=smoothstep(th-.05,th,n)*(1.-pm);
    col=mix(col, pow(col,vec3(1.25))*.92, min(W*1.4,1.)*.7); col*=1.-.3*rim;
    vec3 sky=mix(vec3(.36,.41,.48), vec3(.66,.7,.76), fbm(q*2.+vec2(uT*.012,uT*.007)));
    float rp=uW==0? (ripple(q,70.,.9,.55)+ripple(q+vec2(.13,.29),95.,1.1,.5)*.7)*(.3+.7*I) : 0.;
    col=mix(col, mix(col*.4, sky, .42)+vec3(.85,.9,.95)*rp*.45, pm); }
  if(uSnowC>.001){ float Sv=clamp(uSnowC*(.6+.6*hist),0.,1.); float n=fbm(q*6.+1.7)*.55+fbm(q*22.)*.3+(lum0-.3)*.3;
    float cov=smoothstep(1.-Sv*.5, 1.1-Sv*.5, n+.1*Sv); col=mix(col, vec3(.9,.93,.98)*(.6+.6*lum0), cov*.8); }
  if(uW==0){
    col=mix(col, col*vec3(.74,.8,.9), uP1.x*(.7+.3*I));
    if(uP2.z>0.){ float cur=smoothstep(.35,.78, fbm((q - dir*uT*.05)*2.2)); col=mix(col, vec3(.5,.55,.6), cur*uP2.z*I); }
    col*=1.-.16*C;
    if(uP1.y>0.){ float rp=ripple(q,30.,.55,uP1.y*(.4+.8*I))+ripple(q+vec2(.37,.11),44.,.65,uP1.y*(.4+.8*I))*.8; col+=vec3(.82,.87,.92)*rp*uP1.z; }
    float sd=uP1.w*(.3+1.1*I); float s=rain(q,dir,110.,uP2.y,.4,sd,1.)+rain(q,dir,170.,uP2.y*.8,.35,sd,2.)*.6;
    col+=vec3(.78,.83,.9)*s*uP2.x*(.5+.8*I);
  } else if(uW==1){
    float g=dot(col, vec3(.3,.59,.11));
    col=mix(col, vec3(g)*vec3(.94,.98,1.06)+.05, uP2.y);
    if(uP1.z>0.){ float gst=smoothstep(.35,.8, fbm((q - dir*uT*uP1.y*.6)*1.8)); col=mix(col, vec3(.9,.93,.97), gst*uP1.z*I); }
    if(uP1.w>0.){ float fr=smoothstep(.55,.75, fbm(q*18.)*.85+fbm(q*4.)*.25-.05)*.6; col=mix(col, vec3(.92,.95,1.), fr*uP1.w); }
    vec2 r=vec2(dot(q,ac), dot(q,dir)*uP2.x); float sp=uP1.y*uP2.x; float fd=uP1.x*(.4+.8*I);
    float s=flake(r,16.,vec2(0,sp*1.3),1.,.12,fd,.0)*.8+flake(r,28.,vec2(0,sp),2.,.1,fd,.35)+flake(r,46.,vec2(0,sp*.7),3.,.1,fd,.5)*.7;
    col=mix(col, vec3(.97,.98,1.), clamp(s,0.,1.)*.9);
    col=mix(col, vec3(.9,.92,.95), .32*C);
  } else if(uW==2){
    float d=uP2.x; vec2 m=(q - dir*uT*d)*2.2;
    vec2 w=vec2(fbm(m+vec2(0.,uT*d*.5)), fbm(m+vec2(5.2,1.3)-vec2(uT*d*.4,0.)));
    float c=fbm(m+w*1.2)+uP1.x;
    col*=1.-uP1.y*smoothstep(.36,.62,c);
    float gap=1.-smoothstep(.24,.42,c);
    col+=vec3(1.,.86,.62)*uP1.z*gap;
    if(uBeams>0.){ vec2 sd=normalize(vec2(.55,1.)); float acr=dot(q,vec2(-sd.y,sd.x)), alo=dot(q,sd);
      float bm=smoothstep(.45,.75, an(vec2(acr*4.+uT*.03, alo*.3-uT*.01)))*smoothstep(.25,.6, an(vec2(alo*1.2-uT*.04, acr*.8)));
      col+=vec3(1.,.9,.68)*bm*.45*uBeams*(.35+.65*gap); }
  }
  if(uLines>0. && uGustA>0.){ vec2 gd=q-uGustC; float gm=uGustA*smoothstep(1.,.35,length(vec2(dot(gd,WD)/.32, dot(gd,wp)/.14))); float u=dot(q,WD), v=dot(q,wp); float N=28.; float row=floor(v*N); float r=h21(vec2(row,3.7));
    float uu=(u - uT*(.2+.08*r))/.35 + r*10.; float r2=h21(vec2(row,floor(uu)+.5)); float along=(fract(uu)-.3)/.4;
    if(0.<gm && r2<.55 && 0.<along && along<1.){ float fv=fract(v*N)-.5-(r2/.55-.5)*.6+sin(u*14.+uT*1.1+r*6.)*.1*along;
      col=mix(col, vec3(.95,.97,1.), smoothstep(.13,.0,abs(fv))*sin(3.14159*along)*.45*gm); } }
  col=mix(col, base, inRoom);
  float dk=uDark*(.75+.25*uInt+.4*C); float lum=dot(col, vec3(.3,.59,.11));
  col=mix(col, vec3(lum), uDark*.5); col*=1.-dk;
  col*=1.-uDark*.9*smoothstep(.35,1.,length((uv-.5)*vec2(uAspect,1.))*1.15);
  col=mix(col, col*1.6+vec3(.08,.09,.12), uFlash);
  col=mix(base, col, uStr);
  float cov=uOverlay>.5 ? clamp(max(abs(col.r-base.r),max(abs(col.g-base.g),abs(col.b-base.b)))*3.,0.,1.) : 1.;
  float a=uAlpha*cov;
  if(uOverlay>.5){
    vec3 m=base/.5; float mn=min(min(min(m.r,m.g),m.b),1.);
    float at=(1.-mn)*uFloor; vec3 pt=.5*(m-mn)*uFloor;
    gl_FragColor=vec4(pt*(1.-a)+col*a, 1.-(1.-at)*(1.-a));
  } else if(uFloor>.5) gl_FragColor=vec4(mix(base, col, a), mapTex(uv).a);
  else gl_FragColor=vec4(col*a, a);
}
`;
