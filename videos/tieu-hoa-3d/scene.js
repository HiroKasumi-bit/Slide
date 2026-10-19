// scene.js — procedural 3D digestive system for the HyperFrames "three" adapter.
// Everything is a pure function of time t (seconds): renderAt(t) is called on every
// hf-seek, so any frame can be rendered in any order.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const W = 1920;
const H = 1080;

// Shot boundaries (seconds) — read everywhere, never re-typed as literals
export const SHOT = { intro: 0, mouth: 6, esophagus: 13, stomach: 20, small: 31, villi: 43, large: 54, recap: 64, end: 72 };

// ---------------------------------------------------------------- helpers
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const range = (t, a, b) => smooth((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const window01 = (t, a, b, fade = 0.5) => Math.min(range(t, a, a + fade), 1 - range(t, b - fade, b));

function mulberry32(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(8);

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04131a);
scene.fog = new THREE.FogExp2(0x04131a, 0.03);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, W / H, 0.03, 300);

scene.add(new THREE.HemisphereLight(0x9ff5ff, 0x240c10, 1.1));
const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
key.position.set(3, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0x5fe8ff, 2.2);
rim.position.set(-4, 2, -3);
scene.add(rim);

// Gradient dome + floating dust for depth
const dome = new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 16),
    new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {},
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying vec3 vP; void main(){ float k = clamp(vP.y*0.5+0.5, 0.0, 1.0); vec3 c = mix(vec3(0.01,0.05,0.07), vec3(0.03,0.16,0.19), k); gl_FragColor = vec4(c,1.0); }',
    }),
);
scene.add(dome);

const dustGeo = new THREE.BufferGeometry();
const dustCount = 700;
const dustBase = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
    dustBase[i * 3] = (rand() - 0.5) * 16;
    dustBase[i * 3 + 1] = (rand() - 0.5) * 10;
    dustBase[i * 3 + 2] = (rand() - 0.5) * 12 - 2;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustBase.slice(), 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x7ff0ff, size: 0.025, transparent: true, opacity: 0.55, depthWrite: false }));
scene.add(dust);

// ---------------------------------------------------------------- swept tubes
// A tube whose radius can change per frame: r(s, theta) with s in [0,1] along the curve.
function makeSweep(curve, segs, radial) {
    const pts = curve.getSpacedPoints(segs);
    const frames = curve.computeFrenetFrames(segs, false);
    const count = (segs + 1) * (radial + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const idx = [];
    for (let i = 0; i < segs; i++) {
        for (let j = 0; j < radial; j++) {
            const a = i * (radial + 1) + j;
            const b = (i + 1) * (radial + 1) + j;
            idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    geo.setIndex(idx);
    geo.userData = { pts, frames, segs, radial };
    return geo;
}

function updateSweep(geo, radius) {
    const { pts, frames, segs, radial } = geo.userData;
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    let k = 0;
    for (let i = 0; i <= segs; i++) {
        const s = i / segs;
        const p = pts[i];
        const N = frames.normals[i];
        const B = frames.binormals[i];
        for (let j = 0; j <= radial; j++) {
            const th = (j / radial) * Math.PI * 2;
            const c = Math.cos(th);
            const sn = Math.sin(th);
            const nx = c * N.x + sn * B.x;
            const ny = c * N.y + sn * B.y;
            const nz = c * N.z + sn * B.z;
            const r = radius(s, th);
            pos[k] = p.x + nx * r; pos[k + 1] = p.y + ny * r; pos[k + 2] = p.z + nz * r;
            nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
            k += 3;
        }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere();
}

const organ = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 0.38, metalness: 0, envMapIntensity: 0.5, emissive: color, emissiveIntensity: 0.05, ...extra,
});

function blob(radius, scale, noise, seed, detail = 5) {
    const g = new THREE.SphereGeometry(radius, 16 * detail, 12 * detail);
    const r = mulberry32(seed);
    const ph = [r() * 6, r() * 6, r() * 6];
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const v = v3(p.getX(i), p.getY(i), p.getZ(i));
        const n = Math.sin(v.x * 5 + ph[0]) * Math.sin(v.y * 4 + ph[1]) * Math.sin(v.z * 6 + ph[2]);
        v.multiplyScalar(1 + noise * n);
        p.setXYZ(i, v.x * scale[0], v.y * scale[1], v.z * scale[2]);
    }
    g.computeVertexNormals();
    return g;
}

// ---------------------------------------------------------------- anatomy
const body = new THREE.Group();
scene.add(body);

// Hologram silhouette (fresnel rim, additive)
const holoMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0x3fe0d0) }, uAlpha: { value: 0.55 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2); gl_FragColor = vec4(uColor * f * 1.4, f * uAlpha); }',
});
const torsoProfile = [[0.0, -2.45], [0.8, -2.4], [1.02, -1.7], [0.92, -0.7], [0.86, 0.2], [1.0, 1.2], [1.22, 1.85], [1.08, 2.22], [0.36, 2.36], [0.27, 2.5], [0.25, 2.62]].map(([x, y]) => new THREE.Vector2(x, y));
const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 64), holoMat);
torso.scale.set(1, 1, 0.55);
body.add(torso);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 32), holoMat);
head.scale.set(0.85, 1.05, 0.95);
head.position.set(0, 3.05, 0.05);
body.add(head);

// Esophagus
const esoCurve = new THREE.CatmullRomCurve3([v3(0, 2.58, 0.26), v3(0, 2.25, 0.13), v3(0, 1.65, 0.06), v3(0.02, 1.05, 0.06), v3(0.12, 0.64, 0.12)]);
const esoGeo = makeSweep(esoCurve, 160, 18);
body.add(new THREE.Mesh(esoGeo, organ(0xe0786d)));

// Stomach (J shape, radius bulges in the middle)
const stoCurve = new THREE.CatmullRomCurve3([v3(0.12, 0.64, 0.12), v3(0.32, 0.66, 0.2), v3(0.53, 0.45, 0.22), v3(0.6, 0.1, 0.25), v3(0.5, -0.2, 0.25), v3(0.26, -0.34, 0.25), v3(0.02, -0.28, 0.22), v3(-0.12, -0.2, 0.2)]);
const stoGeo = makeSweep(stoCurve, 160, 28);
body.add(new THREE.Mesh(stoGeo, organ(0xe36f69)));

// Duodenum + small intestine (meandering coil) ending at the caecum
const siPts = [v3(-0.12, -0.2, 0.2), v3(-0.3, -0.3, 0.18), v3(-0.33, -0.55, 0.18), v3(-0.16, -0.7, 0.2), v3(0.08, -0.7, 0.28)];
for (let i = 1; i <= 120; i++) {
    const s = i / 120;
    siPts.push(v3(0.5 * Math.sin(s * Math.PI * 7), -0.78 - s * 0.9 + 0.05 * Math.sin(s * Math.PI * 28), 0.36 + 0.1 * Math.cos(s * Math.PI * 7) + 0.04 * Math.sin(s * Math.PI * 17)));
}
siPts.push(v3(-0.22, -1.72, 0.32), v3(-0.45, -1.74, 0.3));
const siCurve = new THREE.CatmullRomCurve3(siPts);
const siGeo = makeSweep(siCurve, 1100, 14);
body.add(new THREE.Mesh(siGeo, organ(0xec8a78)));

// Large intestine: caecum → ascending → transverse → descending → sigmoid → rectum → anus
const colonCurve = new THREE.CatmullRomCurve3([
    v3(-0.5, -1.82, 0.28), v3(-0.74, -1.62, 0.25), v3(-0.8, -1.1, 0.25), v3(-0.76, -0.62, 0.3), v3(-0.5, -0.47, 0.42),
    v3(0, -0.44, 0.5), v3(0.5, -0.47, 0.42), v3(0.78, -0.62, 0.3), v3(0.82, -1.1, 0.25), v3(0.76, -1.6, 0.25),
    v3(0.5, -1.86, 0.25), v3(0.2, -1.92, 0.2), v3(0.04, -2.06, 0.15), v3(0, -2.32, 0.1),
]);
const colonGeo = makeSweep(colonCurve, 520, 22);
body.add(new THREE.Mesh(colonGeo, organ(0xc4744a)));

// Liver, gallbladder, pancreas, salivary glands, tongue, teeth
const liver = new THREE.Mesh(blob(1, [0.78, 0.4, 0.42], 0.06, 3), organ(0x8e2f2a, { roughness: 0.3 }));
liver.position.set(-0.42, 0.52, 0.12);
liver.rotation.z = -0.28;
body.add(liver);
const gall = new THREE.Mesh(blob(1, [0.07, 0.14, 0.07], 0.05, 4, 3), organ(0x4fa043));
gall.position.set(-0.3, 0.14, 0.44);
gall.rotation.z = 0.5;
body.add(gall);
const pancCurve = new THREE.CatmullRomCurve3([v3(-0.12, -0.36, 0.02), v3(0.18, -0.25, -0.02), v3(0.48, -0.14, 0), v3(0.7, -0.05, 0.02)]);
const pancGeo = makeSweep(pancCurve, 80, 14);
updateSweep(pancGeo, (s) => lerp(0.085, 0.04, s) * (1 + 0.08 * Math.sin(s * 40)));
body.add(new THREE.Mesh(pancGeo, organ(0xe2ad45)));
const salivary = [];
for (const sx of [-1, 1]) {
    for (const [x, y, z, r] of [[0.36, 2.86, 0.06, 0.08], [0.24, 2.55, 0.16, 0.06]]) {
        const g = new THREE.Mesh(blob(r, [1, 1.3, 1], 0.12, 9 + salivary.length, 3), organ(0xbf8f3a, { emissiveIntensity: 0, envMapIntensity: 0.3 }));
        g.position.set(x * sx, y, z);
        body.add(g);
        salivary.push(g);
    }
}
const tongue = new THREE.Mesh(blob(1, [0.17, 0.05, 0.2], 0.04, 7, 3), organ(0xe2707a));
tongue.position.set(0, 2.6, 0.32);
body.add(tongue);
const teethUpper = new THREE.Group();
const teethLower = new THREE.Group();
const toothGeo = new THREE.BoxGeometry(0.045, 0.06, 0.04);
const toothMat = organ(0xd9cfbd, { emissiveIntensity: 0, roughness: 0.35, envMapIntensity: 0.3 });
for (let i = 0; i < 10; i++) {
    const a = (i / 9 - 0.5) * 2.2;
    for (const [grp, y] of [[teethUpper, 0.03], [teethLower, -0.03]]) {
        const tooth = new THREE.Mesh(toothGeo, toothMat);
        tooth.position.set(Math.sin(a) * 0.2, y, Math.cos(a) * 0.2);
        tooth.rotation.y = a;
        grp.add(tooth);
    }
}
teethUpper.position.set(0, 2.69, 0.24);
teethLower.position.set(0, 2.66, 0.24);
body.add(teethUpper, teethLower);

// ---------------------------------------------------------------- food: bolus, trail, chyme, secretions
const bolus = new THREE.Mesh(blob(0.11, [1, 0.9, 1], 0.12, 21, 4), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xff9a3c, emissiveIntensity: 0.22, roughness: 0.45 }));
scene.add(bolus);

const TRAIL = 40;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ color: 0xffc45a, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
scene.add(trail);

// Chyme / enzyme particles that swirl in the stomach
const CHYME = 90;
const chyme = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffd38a, emissive: 0xffa53c, emissiveIntensity: 1.2 }), CHYME);
const chymeSeed = Array.from({ length: CHYME }, () => [rand() * 6.28, rand() * 6.28, 0.6 + rand() * 0.8, rand()]);
const enzymeColors = [new THREE.Color(0xb48cff), new THREE.Color(0x7dffb0), new THREE.Color(0xffd38a)];
for (let i = 0; i < CHYME; i++) chyme.setColorAt(i, enzymeColors[i % 3]);
scene.add(chyme);

// Bile (green) and pancreatic juice (yellow) droplets flowing into the duodenum
const DROPS = 40;
const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.1 }), DROPS);
const bilePath = new THREE.CatmullRomCurve3([v3(-0.3, 0.1, 0.46), v3(-0.25, -0.12, 0.36), v3(-0.3, -0.32, 0.22)]);
const pancPath = new THREE.CatmullRomCurve3([v3(0.4, -0.15, 0.04), v3(0.05, -0.3, 0.1), v3(-0.28, -0.42, 0.2)]);
for (let i = 0; i < DROPS; i++) drops.setColorAt(i, new THREE.Color(i % 2 ? 0x8cff6a : 0xffd84d));
scene.add(drops);

// Recap sparks that race along the whole tract
const SPARKS = 6;
const sparks = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffc04a, emissiveIntensity: 2 }), SPARKS);
scene.add(sparks);

// ---------------------------------------------------------------- villi close-up (separate set far away)
const villi = new THREE.Group();
villi.position.set(40, 0, 0);
scene.add(villi);
const wallGeo = new THREE.PlaneGeometry(10, 6, 140, 80);
wallGeo.rotateX(-Math.PI / 2);
{
    const p = wallGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        p.setY(i, 0.35 * Math.sin(x * 1.2) * Math.cos(z * 0.9) + 0.12 * Math.sin(z * 3.1));
    }
    wallGeo.computeVertexNormals();
}
villi.add(new THREE.Mesh(wallGeo, organ(0xa9474e, { roughness: 0.55 })));
const wallHeight = (x, z) => 0.35 * Math.sin(x * 1.2) * Math.cos(z * 0.9) + 0.12 * Math.sin(z * 3.1);

const villusGeo = new THREE.CapsuleGeometry(0.11, 0.62, 6, 14);
villusGeo.translate(0, 0.42, 0);
const VILLI = 150;
const villusMesh = new THREE.InstancedMesh(villusGeo, organ(0xd8716c, { emissiveIntensity: 0.06, roughness: 0.5 }), VILLI);
const villusSeed = [];
for (let i = 0; i < VILLI; i++) {
    const x = -4 + (i % 15) * 0.56 + (rand() - 0.5) * 0.2;
    const z = -2.4 + Math.floor(i / 15) * 0.5 + (rand() - 0.5) * 0.2;
    villusSeed.push([x, z, rand() * 6.28, 0.8 + rand() * 0.4]);
}
villi.add(villusMesh);
// capillaries glowing under the surface
for (let k = 0; k < 4; k++) {
    const z = -2 + k * 1.3;
    const c = new THREE.CatmullRomCurve3(Array.from({ length: 12 }, (_, i) => v3(-5 + i * 0.9, wallHeight(-5 + i * 0.9, z) - 0.05, z + 0.15 * Math.sin(i))));
    const g = makeSweep(c, 120, 8);
    updateSweep(g, () => 0.04);
    villi.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: k % 2 ? 0xff4a5a : 0x5a7dff, emissive: k % 2 ? 0xff2a3a : 0x3a5aff, emissiveIntensity: 0.9 })));
}
const NUTRI = 160;
const nutri = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.05, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.3 }), NUTRI);
const nutriSeed = [];
const nutriColors = [new THREE.Color(0x7dffb0), new THREE.Color(0xffe066), new THREE.Color(0xffa04a)]; // amino acid, đường đơn, acid béo
for (let i = 0; i < NUTRI; i++) {
    const target = villusSeed[Math.floor(rand() * VILLI)];
    nutriSeed.push([target, (rand() - 0.5) * 1.6, 1.4 + rand() * 1.4, (rand() - 0.5) * 1.2, rand() * 9]);
    nutri.setColorAt(i, nutriColors[i % 3]);
}
villi.add(nutri);

// ---------------------------------------------------------------- timeline helpers
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = v3(0, 1, 0);

// Where the bolus is (curve + s), per time — the single source for food, waves and camera
function foodAt(t) {
    if (t < SHOT.mouth + 0.3) return null;
    if (t < 12.4) return { curve: null, pos: v3(0, 2.62, 0.33), scale: 1 + 0.12 * Math.sin(t * 9) };
    if (t < SHOT.stomach) return { curve: esoCurve, geo: esoGeo, s: range(t, 12.4, 19.6), scale: 1 };
    if (t < SHOT.small) {
        const s = t < 24 ? range(t, 20, 24) * 0.55 : t < 28 ? 0.55 + 0.05 * Math.sin((t - 24) * 2.4) : lerp(0.55, 1, range(t, 28, 30.8));
        return { curve: stoCurve, geo: stoGeo, s, scale: lerp(1, 0.55, range(t, 23, 28)) };
    }
    if (t < SHOT.villi) return { curve: siCurve, geo: siGeo, s: range(t, 31.2, 42.8), scale: 0.55 };
    if (t < SHOT.large) return null;
    if (t < SHOT.recap) return { curve: colonCurve, geo: colonGeo, s: range(t, 54.4, 62.4) * 0.995, scale: lerp(0.95, 0.8, range(t, 54, 62)), exit: range(t, 62.4, 63.6) };
    return null;
}

// Peristaltic wave: bulge at the bolus, squeeze just behind it
const wave = (s, sb, active) => (active ? 0.55 * Math.exp(-(((s - sb) / 0.035) ** 2)) - 0.3 * Math.exp(-(((s - sb + 0.06) / 0.03) ** 2)) : 0);

function updateOrgans(t, food) {
    const on = (geo) => food && food.geo === geo;
    updateSweep(esoGeo, (s) => 0.07 * (1 + wave(s, food?.s ?? -1, on(esoGeo)) * 1.4));
    const churn = window01(t, SHOT.stomach, SHOT.small, 1);
    updateSweep(stoGeo, (s, th) => {
        const base = 0.085 + 0.27 * Math.pow(Math.sin(Math.PI * clamp(s * 1.05)), 0.7);
        return base * (1 + churn * 0.09 * Math.sin(t * 3.2 - s * 14 + th * 2));
    });
    updateSweep(siGeo, (s) => (s < 0.04 ? 0.08 : 0.068) * (1 + wave(s, food?.s ?? -1, on(siGeo)) * 0.9));
    updateSweep(colonGeo, (s) => {
        const taper = s > 0.9 ? lerp(1, 0.6, (s - 0.9) / 0.1) : 1;
        return 0.135 * taper * (1 + 0.1 * Math.sin(s * 120)) * (1 + wave(s, food?.s ?? -1, on(colonGeo)) * 0.6);
    });
    // chewing
    const chew = window01(t, SHOT.mouth, 12.6, 0.4);
    teethLower.position.y = 2.66 - chew * (0.025 + 0.025 * Math.sin(t * 9));
    tongue.position.y = 2.6 - chew * 0.012 * Math.sin(t * 9 + 1);
    salivary.forEach((g, i) => g.scale.setScalar(1 + chew * 0.08 * Math.sin(t * 6 + i)));
}

function updateFood(t, food) {
    if (!food) { bolus.visible = false; trail.visible = false; return; }
    bolus.visible = true;
    trail.visible = true;
    const posAt = (tt) => {
        const f = foodAt(tt);
        if (!f) return null;
        return f.curve ? f.curve.getPointAt(clamp(f.s)) : f.pos.clone();
    };
    const p = posAt(t);
    if (food.exit) p.y -= food.exit * 0.4;
    bolus.position.copy(p);
    bolus.scale.setScalar(food.scale * (1 - (food.exit || 0)));
    bolus.rotation.set(t * 1.3, t * 0.9, 0);
    const color = t > SHOT.large ? 0xa0673a : t > SHOT.small ? 0xd8ff7a : 0xffd27a;
    bolus.material.color.setHex(color);
    bolus.material.emissive.setHex(t > SHOT.large ? 0x5a3010 : t > SHOT.small ? 0x9cff3c : 0xff9a3c);
    const arr = trailGeo.attributes.position.array;
    for (let i = 0; i < TRAIL; i++) {
        const q = posAt(t - i * 0.035) || p;
        arr[i * 3] = q.x; arr[i * 3 + 1] = q.y; arr[i * 3 + 2] = q.z;
    }
    trailGeo.attributes.position.needsUpdate = true;
}

function updateChyme(t) {
    const k = window01(t, 22.5, 31, 1.2);
    chyme.visible = k > 0;
    const c = stoCurve.getPointAt(0.55);
    for (let i = 0; i < CHYME; i++) {
        const [a, b, sp, r0] = chymeSeed[i];
        const ang = a + t * sp;
        const rr = 0.08 + r0 * 0.16;
        tmpP.set(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang * 0.7 + b) * rr * 0.9, c.z + Math.sin(ang) * rr * 0.6);
        tmpS.setScalar(k * (0.6 + r0 * 0.8));
        chyme.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    chyme.instanceMatrix.needsUpdate = true;

    const d = window01(t, 31.5, 37.5, 0.8);
    drops.visible = d > 0;
    for (let i = 0; i < DROPS; i++) {
        const path = i % 2 ? bilePath : pancPath;
        const s = ((t * 0.45 + i / DROPS * 4) % 1);
        tmpP.copy(path.getPointAt(s));
        tmpS.setScalar(d * Math.sin(Math.PI * s) * 1.2);
        drops.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    drops.instanceMatrix.needsUpdate = true;
}

// Whole-tract path for the recap sparks
const tract = [esoCurve, stoCurve, siCurve, colonCurve];
const tractLen = tract.map((c) => c.getLength());
const tractTotal = tractLen.reduce((a, b) => a + b, 0);
function tractPoint(u) {
    let d = clamp(u) * tractTotal;
    for (let i = 0; i < tract.length; i++) {
        if (d <= tractLen[i] || i === tract.length - 1) return tract[i].getPointAt(clamp(d / tractLen[i]));
        d -= tractLen[i];
    }
}
function updateSparks(t) {
    const k = window01(t, SHOT.recap + 0.5, SHOT.end + 1, 0.6);
    sparks.visible = k > 0;
    for (let i = 0; i < SPARKS; i++) {
        const u = ((t - SHOT.recap) * 0.16 - i * 0.035);
        tmpP.copy(tractPoint(clamp(u)));
        tmpS.setScalar(k * (u > 0 && u < 1 ? 1 - i * 0.12 : 0));
        sparks.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    sparks.instanceMatrix.needsUpdate = true;
}

function updateVilli(t) {
    const live = t >= SHOT.villi && t < SHOT.large;
    villi.visible = live;
    body.visible = !live;
    if (!live) return;
    const lt = t - SHOT.villi;
    for (let i = 0; i < VILLI; i++) {
        const [x, z, ph, h] = villusSeed[i];
        tmpP.set(x, wallHeight(x, z), z);
        tmpQ.setFromEuler(new THREE.Euler(0.18 * Math.sin(t * 1.4 + ph), 0, 0.14 * Math.cos(t * 1.1 + ph)));
        tmpS.set(1, h, 1);
        villusMesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    villusMesh.instanceMatrix.needsUpdate = true;
    tmpQ.identity();
    for (let i = 0; i < NUTRI; i++) {
        const [target, ox, oy, oz, delay] = nutriSeed[i];
        const [x, z, , h] = target;
        const tip = v3(x, wallHeight(x, z) + 0.42 + 0.31 * h * 2, z);
        const f = clamp((lt - delay * 0.9) / 3.2);
        let s = 1;
        if (f <= 0) { tmpP.set(x + ox, tip.y + oy, z + oz); }
        else if (f < 0.7) { const k = smooth(f / 0.7); tmpP.set(lerp(x + ox, tip.x, k), lerp(tip.y + oy, tip.y, k), lerp(z + oz, tip.z, k)); }
        else { const k = (f - 0.7) / 0.3; tmpP.set(tip.x, tip.y - k * 0.9, tip.z); s = 1 - k; }
        tmpP.y += 0.04 * Math.sin(t * 3 + i);
        tmpS.setScalar(s * window01(lt, 0, SHOT.large - SHOT.villi, 0.6));
        nutri.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    nutri.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- camera
// [time, position, lookAt, cut?] — a cut jumps instead of gliding from the previous key
const CAM = [
    [0, [4.6, 1.4, 6.3], [-1.6, 0.3, 0]],
    [5.6, [-2.0, 1.0, 6.8], [-1.5, 0.3, 0]],
    [7.4, [1.15, 2.98, 1.6], [0, 2.66, 0.3]],
    [12.4, [0.7, 2.82, 1.35], [0, 2.62, 0.3]],
    [14.2, [1.0, 2.3, 1.7], [0, 2.05, 0.12]],
    [19.6, [0.95, 0.95, 1.8], [0.05, 0.78, 0.12]],
    [21.4, [1.7, 0.62, 2.1], [0.3, 0.15, 0.2]],
    [30.4, [0.9, 0.3, 2.2], [0.25, 0.05, 0.2]],
    [32.2, [-1.25, -0.15, 2.05], [-0.18, -0.38, 0.2]],
    [36.2, [-0.4, -0.8, 2.5], [0, -1.0, 0.3]],
    [42.8, [0.55, -1.55, 2.3], [0, -1.4, 0.3]],
    [SHOT.villi, [40.2, 2.9, 3.6], [40, 0.2, -0.6], true],
    [53.8, [41.3, 1.5, 2.4], [40.3, 0.4, -0.2]],
    [SHOT.large, [-2.1, -0.9, 3.4], [-0.6, -1.1, 0.3], true],
    [58.8, [2.1, -1.1, 3.1], [0.6, -1.3, 0.3]],
    [63.6, [0.7, -2.0, 2.5], [0, -2.2, 0.1]],
    [65.4, [1.9, 0.0, 6.4], [1.5, 0.1, 0]],
    [SHOT.end, [0.4, 0.5, 8.6], [1.7, 0.25, 0]],
];
function cameraAt(t) {
    let i = 0;
    while (i < CAM.length - 1 && t >= CAM[i + 1][0]) i++;
    const a = CAM[i];
    const b = CAM[Math.min(i + 1, CAM.length - 1)];
    const k = b === a || b[3] ? 0 : smooth((t - a[0]) / (b[0] - a[0]));
    camera.position.set(lerp(a[1][0], b[1][0], k), lerp(a[1][1], b[1][1], k), lerp(a[1][2], b[1][2], k));
    camera.lookAt(lerp(a[2][0], b[2][0], k), lerp(a[2][1], b[2][1], k), lerp(a[2][2], b[2][2], k));
    // gentle hand-held drift
    camera.position.x += 0.02 * Math.sin(t * 0.7);
    camera.position.y += 0.015 * Math.sin(t * 0.9 + 1);
}

// ---------------------------------------------------------------- labels (3D anchors → screen)
const LABELS = [
    ['mieng', v3(0, 2.66, 0.45), [[SHOT.mouth, 12.8], [SHOT.recap + 1, SHOT.end]]],
    ['nuocbot', v3(0.38, 2.88, 0.1), [[7.2, 12.6], [SHOT.recap + 1.2, SHOT.end]]],
    ['thucquan', v3(0.02, 1.7, 0.1), [[13.6, 19.6], [SHOT.recap + 1.4, SHOT.end]]],
    ['daday', v3(0.64, 0.2, 0.32), [[20.6, 30.6], [SHOT.recap + 1.6, SHOT.end]]],
    ['gan', v3(-0.75, 0.62, 0.3), [[31.4, 36], [SHOT.recap + 1.8, SHOT.end]]],
    ['tuimat', v3(-0.3, 0.12, 0.52), [[31.6, 36]]],
    ['tuy', v3(0.62, -0.08, 0.08), [[31.8, 36], [SHOT.recap + 2, SHOT.end]]],
    ['ruotnon', v3(0.42, -1.15, 0.48), [[36.4, 42.8], [SHOT.recap + 2.2, SHOT.end]]],
    ['ruotgia', v3(-0.82, -1.0, 0.36), [[54.2, 60], [SHOT.recap + 2.4, SHOT.end]]],
    ['tructrang', v3(0.14, -2.0, 0.22), [[58.4, 63.6]]],
    ['haumon', v3(0, -2.34, 0.12), [[60.6, 63.8], [SHOT.recap + 2.6, SHOT.end]]],
].map(([id, anchor, windows]) => ({ el: document.getElementById('l-' + id), anchor, windows }));

function updateLabels(t) {
    for (const L of LABELS) {
        const a = Math.max(...L.windows.map(([s, e]) => window01(t, s, e, 0.45)));
        const p = L.anchor.clone().project(camera);
        const visible = a > 0.001 && p.z < 1;
        L.el.style.opacity = visible ? a.toFixed(3) : '0';
        if (visible) L.el.style.transform = `translate(${((p.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * H).toFixed(1)}px)`;
    }
}

// ---------------------------------------------------------------- post-processing + render
const composer = new EffectComposer(renderer);
composer.setPixelRatio(1);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.45, 0.4, 0.9));
composer.addPass(new OutputPass());

export function renderAt(t) {
    tmpQ.identity();
    const food = foodAt(t);
    cameraAt(t);
    updateOrgans(t, food);
    updateFood(t, food);
    updateChyme(t);
    updateSparks(t);
    updateVilli(t);
    holoMat.uniforms.uAlpha.value = lerp(0.55, 0.32, window01(t, SHOT.mouth, SHOT.recap, 1.2));
    const dp = dust.geometry.attributes.position.array;
    for (let i = 0; i < dustCount; i++) dp[i * 3 + 1] = dustBase[i * 3 + 1] + ((t * 0.05 + i * 0.37) % 1) * 0.4;
    dust.geometry.attributes.position.needsUpdate = true;
    camera.updateMatrixWorld();
    updateLabels(t);
    composer.render();
}
