# Fog Animation Approaches

Research notes for improving Evermist's fog-of-war animation beyond simple linear drift.

## 1. Multi-layer drift with varied parameters (current baseline)

Stack 3-5 semi-transparent cloud texture layers drifting at different speeds, directions, and scales. The eye breaks the repetition because the layers overlap differently over time.

- **Status**: Implemented. Works but monotonous — each layer moves in one direction forever.
- **Perf**: Cheapest option. 3 fillRect calls per compositing pass.

## 2. Oscillating drift / breathing / rotation (REJECTED)

Modulate drift velocity with sine waves, pulse scale/alpha, slowly rotate each pass.

- **Status**: Tried and rejected. Rigid transforms on full-screen textures create a whirlpool/seasick effect. Rotation is especially bad — even at 0.008 rad/s, the entire cloud layer visibly spins. Scale pulsing creates a zoom-in/out sensation.
- **Takeaway**: Global rigid-body transforms don't approximate real atmospheric motion. Per-pixel deformation is needed for organic results.

## 3. 3D noise slice animation (gold standard, expensive)

Sample a 3D Perlin/simplex noise field where the Z axis is time. Incrementing Z by tiny amounts (0.001-0.005/frame) produces smooth, non-repeating evolution — fog patches grow, shrink, merge, split organically.

- **Perf concern**: Per-pixel noise evaluation in JS at full res is too slow. Workaround: evaluate at very low res (64x64 or 128x128) and let Canvas bilinear scaling smooth it.
- **When to consider**: If pre-rendered frames (option 5) look too repetitive after extended viewing.

## 4. Domain warping / fbm-of-fbm (Inigo Quilez technique)

Instead of `noise(p + time)`, compute `noise(p + noise(p + time))`. The inner noise distorts the outer's sampling coordinates, producing swirling atmospheric turbulence. 2x the noise calls but combined with low-res evaluation, still viable.

- **Can be pre-computed**: Generate N frames offline (at startup), then cycle through them at runtime.
- **Reference**: https://iquilezles.org/articles/warp/

## 5. Pre-rendered domain-warped frame cycling with crossfade (CURRENT IMPLEMENTATION)

Generate 8-12 frames of domain-warped Perlin noise at startup into 512x512 offscreen canvases. At runtime, crossfade between consecutive frames using `lighter` blend mode. Each of the 3 cloud passes still drifts spatially (keeps spatial movement), while the texture itself morphs over time (adds organic evolution).

- **Startup cost**: ~200-500ms to generate frames (acceptable).
- **Runtime cost**: One 512x512 canvas blend per frame + pattern creation. Negligible.
- **Memory**: ~10 canvases at 512x512 RGBA = ~10MB.
- **Time looping**: Circular time coordinates (cos/sin) ensure seamless wrap when the animation cycles.

## 6. Texture-sheet cycling (simpler variant of 5)

Pre-render frames but without domain warping — just plain noise at different random seeds. Crossfade between them. Simpler to implement but less organic-looking since frames aren't temporally coherent.

- **When to consider**: If domain warping generation is too slow or the warping looks wrong.

## 7. Local UV perturbation (tile-based)

Split the texture into a grid of tiles (4x4 or 8x8), give each tile its own slowly-varying drift offset sampled from low-frequency noise. Produces organic swirling without rigid-body artifacts.

- **Complexity**: Moderate. Needs per-tile transform management and careful seam handling.
- **When to consider**: If frame cycling doesn't provide enough spatial variation.

## References

- Inigo Quilez — Domain Warping: https://iquilezles.org/articles/warp/
- The Book of Shaders — FBM: https://thebookofshaders.com/13/
- Varun Vachhar — Noise in Creative Coding: https://varun.ca/noise/
