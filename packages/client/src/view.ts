// Pixi renderer. Reads the sim every frame and never mutates it.
//
// Isometric terrain is a mesh of shaded triangles, built once per game. The
// rest (roads, buildings, flags, carriers) is redrawn every frame, depth
// sorted back to front so tall things hide what is behind them. Buildings are
// placeholder cubes with roofs; swap `drawBuilding` for sprites with real art.

import { Application, Container, Culler, FillGradient, Graphics, Matrix, Sprite, Text, Texture } from 'pixi.js';
import {
  BState,
  BuilderState,
  GeoPhase,
  BuildingSize,
  BURN_TICKS,
  BuildingType,
  FLAG_SLOTS,
  FIELD_TICKS,
  GROW_TICKS,
  MapObject,
  OreKind,
  Res,
  SIGN_TICKS,
  TState,
  MOUNTAIN_LEVEL,
  SEA_LEVEL,
  Terrain,
  buildingSize,
  checkBuilding,
  isStore,
  oreKindOf,
  planRoad,
  signIsSmall,
  signKind,
  type Building,
  type Game,
  type Road,
} from '@sett/sim';
import type { App } from './app.ts';
import { BUILDING_LABEL, COLORS, OBJECT_COLORS, ORE_COLOR, RES_COLOR, WORKER_LETTER } from './palette.ts';
import { LAND, seaColor, clamp, dirtColor, fbm2, forestFloorColor, grassColor, hash2, leafColors, lerpColor, rockColor, sandColor, scaleColor, screeColor, slopeLight, snowAmount, speciesAt, waterColor, type Species } from './art.ts';
import { GROUNDS, paintGround, type Ground } from './textures.ts';
import { clipBand, contourSegment, distanceField, polyArea, wavyOutline, type Vert } from './coast.ts';
import { blob, outline, roadMesh, smoothPath, type RoadMesh } from './roads.ts';
import { drawBuildingArt } from './buildings.ts';
import { drawPerson, tradeOf, type Trade } from './people.ts';
import { ROW_H, S, flatY, gridBounds, pickHex, posToWorld, toWorld, type Pt } from './projection.ts';

/** Samples per tile on a road's smooth curve (the curve the road is drawn along). */
const CURVE_K = 4;

interface RoadGeometry {
  pts: Pt[]; // projected, with terrain height
  flat: number[]; // depth keys per point (flat y)
  curve: Pt[]; // the same path smoothed, CURVE_K samples to a tile
  curveFlat: number[]; // depth keys along the curve
}

interface Drawable {
  key: number; // flat y: larger = nearer the viewer = drawn later
  draw: () => void;
}

/** How big each ground texture is drawn (1 = one texture pixel per world pixel). */
const GROUND_SCALE: Record<Ground, number> = { grass: 1.5, forest: 1.3, dirt: 1.3, sand: 1.1, scree: 1.1, rock: 1.7, snow: 1.9, water: 1.4 };
/** The tiles are a little darker than white; the colour is lifted by this much to make up. */
const GROUND_GAIN: Record<Ground, number> = { grass: 1.22, forest: 1.4, dirt: 1.22, sand: 1.13, scree: 1.38, rock: 1.4, snow: 1.07, water: 1.2 };

const SEAM = 1.2; // world px each terrain triangle is grown by

const SIZES: Record<'small' | 'large' | 'castle', { w: number; h: number }> = {
  small: { w: 34, h: 24 },
  large: { w: 58, h: 34 },
  castle: { w: 62, h: 46 },
};

const sizeKey = (type: BuildingType): 'small' | 'large' | 'castle' =>
  type === BuildingType.Castle ? 'castle' : buildingSize(type) === BuildingSize.Large ? 'large' : 'small';

export class View {
  private pixi = new Application();
  private world = new Container();
  private terrain = new Container(); // the ground, in blocks of cells that are skipped when off screen
  private ocean = new Container(); // the sea around the island: one baked picture
  private sea: { minX: number; minY: number; scale: number; w: number; h: number; dist: Float32Array } = { minX: 0, minY: 0, scale: 8, w: 0, h: 0, dist: new Float32Array(0) }; // its size and the distance from the island at each pixel
  private gCoast = new Graphics(); // foam on the shore and the beach round the map's edge
  private gClouds = new Graphics(); // slow cloud shadows
  private gAtmos = new Graphics(); // haze and vignette over the screen
  private atmosSize = '';
  private coastRuns: { x: number; y: number }[][] = []; // the outer foam line, in runs, for the pulse
  private gWater = new Graphics();
  private gRoads = new Graphics();
  private ground = new Map<Ground, { texture: Texture; matrix: Matrix }>();
  private depth: Uint8Array = new Uint8Array(0); // per point: steps to the nearest land for water points, 0 on land
  private time = 0; // seconds, for the water and the wind only
  private gSites = new Graphics();
  private gObjects = new Graphics();
  private labelLayer = new Container();
  private gOverlay = new Graphics();
  private labels = new Map<number, Text>();
  private roadGeo = new Map<number, RoadGeometry>();
  private walkerTags = new Map<number, Text>(); // letter over each walking worker, by building
  private walks = new Map<number, { key: string; geo: RoadGeometry | null }>();
  private app!: App;
  private builtFor: Game | null = null;
  private roadsKey = ''; // what the road picture was last drawn for
  private geoVersion = -1; // layoutVersion the cached road geometry belongs to
  private siteCache: { key: string; positions: number[] } = { key: '', positions: [] };

  /** Mount the canvas into `host` and start drawing `app`. */
  async init(host: HTMLElement, app: App): Promise<void> {
    this.app = app;
    await this.pixi.init({
      background: COLORS.background,
      antialias: true,
      resizeTo: host,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    host.appendChild(this.pixi.canvas);
    for (const kind of GROUNDS) {
      const canvas = document.createElement('canvas');
      paintGround(kind, canvas);
      const texture = Texture.from(canvas);
      texture.source.style.addressMode = 'repeat';
      texture.source.style.scaleMode = 'linear';
      texture.source.autoGenerateMipmaps = true;
      this.ground.set(kind, { texture, matrix: new Matrix().scale(GROUND_SCALE[kind], GROUND_SCALE[kind]) });
    }
    this.world.addChild(this.ocean, this.terrain, this.gCoast, this.gWater, this.gClouds, this.gRoads, this.gSites, this.gObjects, this.labelLayer, this.gOverlay);
    this.pixi.stage.addChild(this.world, this.gAtmos);
    this.bindInput();
    this.pixi.ticker.add((ticker) => {
      this.time += ticker.deltaMS / 1000;
      app.frame(ticker.deltaMS);
      Culler.shared.cull(this.pixi.stage, this.pixi.screen);
      this.draw();
    });
  }

  // ---- camera ----------------------------------------------------------

  /** Scale and centre the camera so the whole map is visible. */
  fit(): void {
    const b = gridBounds(this.app.game);
    const w = this.pixi.screen.width;
    const h = this.pixi.screen.height;
    const scale = Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY));
    this.world.scale.set(scale);
    this.world.position.set(w / 2 - ((b.minX + b.maxX) / 2) * scale, h / 2 - ((b.minY + b.maxY) / 2) * scale);
  }

  /** Centre the camera on the castle (or fit the map if there is none yet). */
  home(scale = 0.9): void {
    const game = this.app.game;
    if (game.castle < 0) {
      this.fit();
      return;
    }
    const c = this.buildingCentre(game, game.buildings[game.castle]!);
    this.world.scale.set(scale);
    this.world.position.set(this.pixi.screen.width / 2 - c.x * scale, this.pixi.screen.height / 2 - c.y * scale);
  }

  /** Where a map point is on the page (CSS px), for tools and tests. */
  screenOf(pos: number): { x: number; y: number } {
    const w = posToWorld(this.app.game, pos);
    const rect = this.pixi.canvas.getBoundingClientRect();
    return { x: rect.left + this.world.x + w.x * this.world.scale.x, y: rect.top + this.world.y + w.y * this.world.scale.y };
  }

  // ---- input -----------------------------------------------------------

  private bindInput(): void {
    const canvas = this.pixi.canvas;
    let down: { x: number; y: number; wx: number; wy: number; button: number } | null = null;
    let dragged = false;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, wx: this.world.x, wy: this.world.y, button: e.button };
      dragged = false;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (down) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        if (dragged || Math.hypot(dx, dy) > 5) {
          dragged = true;
          this.world.position.set(down.wx + dx, down.wy + dy);
        }
      }
      this.app.hover = this.hexAt(e);
    });
    canvas.addEventListener('pointerup', (e) => {
      const wasClick = down && !dragged && down.button === 0;
      down = null;
      canvas.releasePointerCapture(e.pointerId);
      if (!wasClick) return;
      const hex = this.hexAt(e);
      if (hex) this.app.click(hex.x, hex.y);
    });
    canvas.addEventListener('pointerleave', () => {
      this.app.hover = null;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const k = Math.exp(-e.deltaY * 0.0015);
        const next = clamp(this.world.scale.x * k, 0.2, 3);
        const f = next / this.world.scale.x;
        this.world.position.set(px - (px - this.world.x) * f, py - (py - this.world.y) * f);
        this.world.scale.set(next);
      },
      { passive: false },
    );
  }

  private hexAt(e: PointerEvent): { x: number; y: number } | null {
    const rect = this.pixi.canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left - this.world.x) / this.world.scale.x;
    const wy = (e.clientY - rect.top - this.world.y) / this.world.scale.y;
    return pickHex(this.app.game, wx, wy);
  }

  // ---- frame -----------------------------------------------------------

  private draw(): void {
    const game = this.app.game;
    if (this.builtFor !== game) this.rebuild(game);
    this.drawWater(game);
    this.drawSky();
    this.drawRoads(game);
    this.drawSites(game);
    this.drawScene(game);
    this.drawOverlay(game);
  }

  /** Called when the game object is replaced (new scenario). */
  private rebuild(game: Game): void {
    this.builtFor = game;
    this.roadGeo.clear();
    this.geoVersion = -1;
    this.roadsKey = '';
    this.siteCache = { key: '', positions: [] };
    for (const t of this.labels.values()) t.destroy();
    this.labels.clear();
    this.buildTerrain(game);
    this.home();
  }

  // ---- terrain ---------------------------------------------------------

  /**
   * The ground, drawn once per game: every half cell is split into four
   * triangles, each classed (water, sand, grass, rock, snow) from its own
   * interpolated height, so shores and snow lines run smoothly between map
   * points. Colour comes from the height, the slope's light and soft noise
   * patches; grass tufts, flowers and boulders are scattered on top.
   */
  private buildTerrain(game: Game): void {
    for (const c of this.terrain.removeChildren()) c.destroy();
    const blocks = new Map<number, Graphics>();

    const blockOf = (x: number, y: number): Graphics => {
      const key = (y >> 3) * 1000 + (x >> 3);
      let b = blocks.get(key);
      if (!b) {
        b = new Graphics();
        b.cullable = true;
        blocks.set(key, b);
        this.terrain.addChild(b);
      }
      return b;
    };
    let g = blockOf(0, 0); // the block the current cell belongs to
    const t = game.terrain;
    const C = game.cols;
    const R = game.rows;
    const h = (x: number, y: number): number => t.heightAt(y * C + x);
    this.depth = waterDepths(game);
    // how wooded the ground is, 0 to 1 per point: trees count for themselves and their neighbours
    const wood = new Float32Array(C * R);
    const trees = game.objects;
    if (trees) {
      for (let p = 0; p < wood.length; p++) {
        if (trees.kind[p] !== MapObject.Tree) continue;
        wood[p]! += 1;
        for (let d = 0; d < 6; d++) {
          const nx = (p % C) + [1, 1, 0, -1, -1, 0][d]!;
          const ny = Math.floor(p / C) + [0, 1, 1, 0, -1, -1][d]!;
          if (nx >= 0 && ny >= 0 && nx < C && ny < R) wood[ny * C + nx]! += 0.55;
        }
      }
    }
    const forestAt = (cx: number, cy: number): number => {
      const x = clamp(Math.round(cx), 0, C - 1);
      const y = clamp(Math.round(cy), 0, R - 1);
      return clamp(wood[y * C + x]! / 3, 0, 1);
    };
    const depthOf = (x: number, y: number): number => this.depth[y * C + x]!;
    // A softened height for cutting the shore: a point counts for three, each neighbour for one, so the
    // waterline curves between points instead of running in straight facets.
    const soft = new Float32Array(C * R);
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < C; x++) {
        let sum = 3 * h(x, y);
        let wsum = 3;
        for (let d = 0; d < 6; d++) {
          const nx = x + [1, 1, 0, -1, -1, 0][d]!;
          const ny = y + [0, 1, 1, 0, -1, -1][d]!;
          if (nx < 0 || ny < 0 || nx >= C || ny >= R) continue;
          sum += h(nx, ny);
          wsum++;
        }
        soft[y * C + x] = sum / wsum;
      }
    }

    type V = Vert;
    const vert = (x: number, y: number): V => ({ x, y, h: h(x, y), d: depthOf(x, y), s: soft[y * C + x]! });
    const mid = (a: V, b: V): V => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, h: (a.h + b.h) / 2, d: (a.d + b.d) / 2, s: (a.s! + b.s!) / 2 });

    // The ground changes kind at these heights; a triangle that crosses one is cut exactly there.
    const T1S = SEA_LEVEL + 0.62; // the same cut in softened height
    const T2 = SEA_LEVEL + 1.35; // beach to meadow
    const T3 = MOUNTAIN_LEVEL - 0.6; // meadow to rock

    const paint = (band: 'water' | 'sand' | 'meadow' | 'rock', poly: Vert[], gx: number, gy: number, steep: number, cx: number, cy: number): void => {
      let wx = 0;
      let wy = 0;
      let hc = 0;
      let dd = 0;
      for (const v of poly) {
        wx += v.x;
        wy += v.y;
        hc += v.h;
        dd += v.d;
      }
      wx /= poly.length;
      wy /= poly.length;
      hc /= poly.length;
      dd /= poly.length;
      const n = fbm2(wx / 150, (wy + hc * 30) / 100, 3);
      const m = hash2(Math.round(cx * 4), Math.round(cy * 4), 9);
      let color: number;
      let ground: Ground;
      if (band === 'water') {
        ground = 'water';
        color = waterColor(dd, n);
      } else if (band === 'sand') {
        ground = 'sand';
        color = scaleColor(sandColor(clamp((T2 - hc) / 1.1, 0, 1), m), slopeLight(gx, gy, 0.05));
      } else if (band === 'rock') {
        const lit = slopeLight(gx, gy, 0.15);
        if (snowAmount(hc, steep) > 0.5) {
          ground = 'snow';
          color = scaleColor(rockColor(hc, steep, n, m), lit);
        } else if (hc < 18.5) {
          ground = 'scree'; // loose gravel on the lower slopes
          color = scaleColor(lerpColor(screeColor(n, m), rockColor(hc, steep, n, m), clamp((hc - 15) / 6, 0, 1)), lit);
        } else {
          ground = 'rock';
          color = scaleColor(rockColor(hc, steep, n, m), lit);
        }
      } else {
        const lit = slopeLight(gx, gy, 0.08);
        const grass = grassColor(hc, n, m);
        const forest = forestAt(cx, cy);
        const bare = clamp((fbm2(wx / 160, wy / 110, 77) - 0.6) * 3.2, 0, 1) + clamp((steep - 2.4) * 0.3, 0, 0.5);
        // The ground kind (its texture) changes only where one is plainly the stronger; colour blends
        // smoothly in between, so stands of trees and bare patches have soft edges.
        const floor = lerpColor(grass, forestFloorColor(m), clamp(forest * 0.55, 0, 0.55));
        const earth = dirtColor(clamp((hc - 6) / 8, 0, 1), m);
        if (forest > 0.9) {
          ground = 'forest';
          color = scaleColor(floor, lit);
        } else if (bare > 0.85) {
          ground = 'dirt';
          color = scaleColor(lerpColor(floor, earth, clamp(bare * 0.8, 0, 0.8)), lit);
        } else {
          ground = 'grass';
          color = scaleColor(lerpColor(floor, earth, clamp(bare * 0.55, 0, 0.45)), lit);
        }
      }
      // Grow the polygon a hair outward so neighbours overlap: no hairline seams.
      const flat: number[] = [];
      for (const v of poly) {
        const d = Math.hypot(v.x - wx, v.y - wy) || 1;
        flat.push(v.x + ((v.x - wx) / d) * SEAM, v.y + ((v.y - wy) / d) * SEAM);
      }
      const tex = this.ground.get(ground)!;
      g.poly(flat).fill({
        color: scaleColor(color, GROUND_GAIN[ground]),
        texture: tex.texture,
        textureSpace: 'global',
        matrix: tex.matrix,
      });
      const kind: Prop['kind'] = ground === 'grass' ? 'grass' : ground === 'sand' ? 'sand' : ground === 'rock' || ground === 'scree' ? 'rock' : ground === 'water' ? 'water' : 'none';
      props.push({ g, kind, wx, wy, m, n, steep, hc });
    };

    const shore: [{ x: number; y: number }, { x: number; y: number }][] = [];
    const piece = (a: V, b: V, c: V): void => {
      const cx = (a.x + b.x + c.x) / 3;
      const cy = (a.y + b.y + c.y) / 3;
      // height plane through the three corners: gradient per grid step
      const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y) || 1;
      const gx = ((b.h - a.h) * (c.y - a.y) - (c.h - a.h) * (b.y - a.y)) / det;
      const gy = ((b.x - a.x) * (c.h - a.h) - (c.x - a.x) * (b.h - a.h)) / det;
      const steep = Math.hypot(gx, gy);
      const corners: Vert[] = [a, b, c].map((v) => {
        const w = toWorld(v.x, v.y, v.h);
        return { x: w.x, y: w.y, h: v.h, d: v.d, s: v.s };
      });
      // water: softened height up to the waterline; sand: above it and up to the meadow; then meadow and rock by true height
      const parts: ['water' | 'sand' | 'meadow' | 'rock', Vert[]][] = [
        ['water', clipBand(corners, -Infinity, T1S, 's')],
        ['sand', clipBand(clipBand(corners, T1S, Infinity, 's'), -Infinity, T2)],
        ['meadow', clipBand(clipBand(corners, T1S, Infinity, 's'), T2, T3)],
        ['rock', clipBand(corners, T3, Infinity)],
      ];
      for (const [band, part] of parts) if (part.length >= 3 && polyArea(part) > 0.3) paint(band, part, gx, gy, steep, cx, cy);
      const line = contourSegment(corners[0]!, corners[1]!, corners[2]!, T1S, 's');
      if (line) shore.push(line);
    };

    interface Prop { g: Graphics; kind: 'water' | 'sand' | 'grass' | 'rock' | 'none'; wx: number; wy: number; m: number; n: number; steep: number; hc: number }
    const props: Prop[] = [];
    // Four triangles per triangle, so colour and slope change gently from point to point.
    const cell = (a: V, b: V, c: V): void => {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      piece(a, ab, ca);
      piece(ab, b, bc);
      piece(ca, bc, c);
      piece(ab, bc, ca);
    };
    for (let y = 0; y < R - 1; y++) {
      for (let x = 0; x < C - 1; x++) {
        g = blockOf(x, y);
        // the cell is split along its DownRight diagonal into two triangles
        cell(vert(x, y), vert(x + 1, y), vert(x + 1, y + 1));
        cell(vert(x, y), vert(x + 1, y + 1), vert(x, y + 1));
      }
    }

    // details on top: tufts and flowers on the grass, hatching and boulders on the rock, wet sand edges
    for (const q of props) {
      const g = q.g;
      if (q.kind === 'grass') {
        if (q.m < 0.2) {
          const dark = scaleColor(grassColor(q.hc, q.n, 0.3), 0.72);
          const x = q.wx + (q.m * 91 % 1 - 0.5) * 18;
          const y = q.wy + (q.m * 57 % 1 - 0.5) * 6;
          g.moveTo(x - 2, y).lineTo(x - 3.5, y - 5)
            .moveTo(x, y).lineTo(x, y - 6.5)
            .moveTo(x + 2, y).lineTo(x + 3.5, y - 5)
            .stroke({ width: 1.1, color: dark, alpha: 0.75, cap: 'round' });
        } else if (q.m > 0.986) {
          const x = q.wx + (q.m * 31 % 1 - 0.5) * 16;
          const y = q.wy + (q.m * 17 % 1 - 0.5) * 6;
          const petal = [0xffffff, 0xffe066, 0xff8fb1, 0xb59bff][Math.floor(q.m * 4000) % 4]!;
          g.circle(x, y, 1.7).fill({ color: petal });
        }
      } else if (q.kind === 'rock') {
        if (q.steep > 2.2 && q.m < 0.5) {
          g.moveTo(q.wx - 5, q.wy - 1).lineTo(q.wx + 4, q.wy + 1.5).stroke({ width: 1.2, color: 0x2a2624, alpha: 0.22 });
        }
        if (q.m > 0.955 && q.hc < 24) {
          const r = 3 + (q.m * 100 % 1) * 3;
          g.poly([q.wx - r, q.wy + 1, q.wx - r * 0.4, q.wy - r, q.wx + r * 0.6, q.wy - r * 0.8, q.wx + r, q.wy + 1])
            .fill({ color: scaleColor(LAND.rockCool, 0.8 + (q.m * 13 % 1) * 0.3) })
            .stroke({ width: 1, color: 0x000000, alpha: 0.25 });
        }
      }
    }
    this.buildCoast(game, shore);
  }

  // ---- coast, sea, sky ---------------------------------------------------

  /**
   * The shore and the sea: a smooth foam line along the waterline, a ring of
   * sea round the island that goes from turquoise at the beach to deep blue
   * far out, and a wavy beach along the map's edge so the island does not end in
   * a straight cut. Drawn once per game.
   */
  private buildCoast(game: Game, shore: [{ x: number; y: number }, { x: number; y: number }][]): void {
    const C = game.cols;
    const R = game.rows;
    const t = game.terrain;
    const gc = this.gCoast;
    gc.clear();
    // foam along the waterline: a wide soft band, a narrower one, a bright line
    for (const [width, alpha] of [[16, 0.1], [7, 0.22], [2.4, 0.6]] as const) {
      for (const [p, q] of shore) gc.moveTo(p.x, p.y).lineTo(q.x, q.y);
      gc.stroke({ width, color: 0xffffff, alpha, cap: 'round', join: 'round' });
    }

    // the map's outline, clockwise on screen, finely sampled
    const edge: { x: number; y: number; h: number }[] = [];
    const at = (x: number, y: number): void => {
      const h = t.heightAt(y * C + x);
      const w = toWorld(x, y, h);
      edge.push({ x: w.x, y: w.y, h });
    };
    for (let x = 0; x < C; x++) at(x, 0);
    for (let y = 1; y < R; y++) at(C - 1, y);
    for (let x = C - 2; x >= 0; x--) at(x, R - 1);
    for (let y = R - 2; y >= 1; y--) at(0, y);
    const fine: { x: number; y: number; h: number }[] = [];
    const STEP = 4;
    for (let i = 0; i < edge.length; i++) {
      const a = edge[i]!;
      const b = edge[(i + 1) % edge.length]!;
      for (let k = 0; k < STEP; k++) {
        const u = k / STEP;
        fine.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, h: a.h + (b.h - a.h) * u });
      }
    }
    const base = fine.map((p) => ({ x: p.x, y: p.y }));

    // beach and foam where the edge is land (not where a lake runs off the map)
    const beach = wavyOutline(base, 6, 11, 31);
    const surf = wavyOutline(base, 36, 13, 47);
    this.buildSea(beach);
    const land = fine.map((p) => p.h > SEA_LEVEL + 0.8);
    const runs: { x: number; y: number }[][] = [];
    const sandRuns: { x: number; y: number }[][] = [];
    let cur: number[] = [];
    const flush = (): void => {
      if (cur.length > 2) {
        sandRuns.push(cur.map((i) => beach[i]!));
        runs.push(cur.map((i) => surf[i]!));
      }
      cur = [];
    };
    for (let i = 0; i < fine.length; i++) {
      if (land[i]) cur.push(i);
      else flush();
    }
    flush();
    for (const [width, alpha] of [[84, 0.16], [52, 0.24], [26, 0.34]] as const) {
      for (const run of sandRuns) {
        gc.moveTo(run[0]!.x, run[0]!.y);
        for (let i = 1; i < run.length; i++) gc.lineTo(run[i]!.x, run[i]!.y);
      }
      gc.stroke({ width, color: LAND.sand, alpha, cap: 'round', join: 'round' });
    }
    for (const [width, alpha] of [[16, 0.1], [3.2, 0.55]] as const) {
      for (const run of runs) {
        gc.moveTo(run[0]!.x, run[0]!.y);
        for (let i = 1; i < run.length; i++) gc.lineTo(run[i]!.x, run[i]!.y);
      }
      gc.stroke({ width, color: 0xffffff, alpha, cap: 'round', join: 'round' });
    }
    this.coastRuns = runs;
  }

  /**
   * The sea, baked once into a picture a few times smaller than the screen and
   * stretched back up, so it is one smooth gradient with no bands. Each pixel is
   * coloured by its distance from the island (turquoise at the beach, deep navy
   * far out) with broad mottling and swells that run along the coast.
   */
  private buildSea(island: { x: number; y: number }[]): void {
    for (const c of this.ocean.removeChildren()) c.destroy();
    const S = 8; // world pixels per picture pixel
    const MARGIN = 1400; // far enough out that the sea is the plain deep colour
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of island) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    minX -= MARGIN;
    minY -= MARGIN;
    const W = Math.ceil((maxX + MARGIN - minX) / S);
    const H = Math.ceil((maxY + MARGIN - minY) / S);
    // which pixels are island: fill its outline on a scratch canvas
    const mask = document.createElement('canvas');
    mask.width = W;
    mask.height = H;
    const mctx = mask.getContext('2d')!;
    mctx.fillStyle = '#fff';
    mctx.beginPath();
    island.forEach((p, i) => {
      const x = (p.x - minX) / S;
      const y = (p.y - minY) / S;
      if (i === 0) mctx.moveTo(x, y);
      else mctx.lineTo(x, y);
    });
    mctx.closePath();
    mctx.fill();
    const alpha = mctx.getImageData(0, 0, W, H).data;
    const land = new Uint8Array(W * H);
    for (let i = 0; i < land.length; i++) land[i] = alpha[i * 4 + 3]! > 127 ? 1 : 0;
    const dist = distanceField(land, W, H);
    const pic = document.createElement('canvas');
    pic.width = W;
    pic.height = H;
    const pctx = pic.getContext('2d')!;
    const img = pctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const wx = minX + x * S;
        const wy = minY + y * S;
        const c = seaColor(dist[i]! * S, fbm2(wx / 260, wy / 180, 5));
        img.data[i * 4] = (c >> 16) & 0xff;
        img.data[i * 4 + 1] = (c >> 8) & 0xff;
        img.data[i * 4 + 2] = c & 0xff;
        img.data[i * 4 + 3] = 255;
      }
    }
    pctx.putImageData(img, 0, 0);
    const sprite = new Sprite(Texture.from(pic));
    sprite.position.set(minX, minY);
    sprite.scale.set(S);
    this.ocean.addChild(sprite);
    this.sea = { minX, minY, scale: S, w: W, h: H, dist };
  }

  /** Shadows of clouds drifting over the land, only where the screen is looking, and a haze at the top of the screen. */
  private drawSky(): void {
    const scale = this.world.scale.x;
    const x0 = -this.world.x / scale - 300;
    const y0 = -this.world.y / scale - 300;
    const x1 = (this.pixi.screen.width - this.world.x) / scale + 300;
    const y1 = (this.pixi.screen.height - this.world.y) / scale + 300;
    const g = this.gClouds;
    g.clear();
    const t = this.time;
    const span = 5200; // clouds wrap round a field this wide
    for (let i = 0; i < 9; i++) {
      const w = 420 + hash2(i, 1, 61) * 380;
      const hgt = w * 0.34;
      const cy = 80 + hash2(i, 2, 61) * 1700;
      let cx = hash2(i, 3, 61) * span + t * (9 + hash2(i, 4, 61) * 7);
      cx = ((cx % span) + span) % span - 400;
      if (cx + w < x0 || cx - w > x1 || cy + hgt < y0 || cy - hgt > y1) continue;
      for (const [dx, dy, k] of [[0, 0, 1], [-0.45, 0.08, 0.7], [0.5, -0.06, 0.75], [0.1, 0.15, 0.55]] as const) {
        g.ellipse(cx + dx * w, cy + dy * hgt, w * 0.5 * k, hgt * 0.5 * k).fill({ color: 0x0a1a2a, alpha: 0.05 });
      }
    }
    // screen-space haze (brighter at the top, like distance) and a soft vignette
    const sw = this.pixi.screen.width;
    const sh = this.pixi.screen.height;
    const key = `${sw}x${sh}`;
    if (key !== this.atmosSize) {
      this.atmosSize = key;
      const a = this.gAtmos;
      a.clear();
      a.rect(0, 0, sw, sh * 0.34).fill(new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: 'rgba(214,232,250,0.2)' }, { offset: 1, color: 'rgba(214,232,250,0)' }] }));
      const v = Math.min(sw, sh) * 0.28;
      a.rect(0, 0, v, sh).fill(new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, colorStops: [{ offset: 0, color: 'rgba(4,10,18,0.32)' }, { offset: 1, color: 'rgba(4,10,18,0)' }] }));
      a.rect(sw - v, 0, v, sh).fill(new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, colorStops: [{ offset: 0, color: 'rgba(4,10,18,0)' }, { offset: 1, color: 'rgba(4,10,18,0.32)' }] }));
      a.rect(0, sh - v, sw, v).fill(new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: 'rgba(4,10,18,0)' }, { offset: 1, color: 'rgba(4,10,18,0.3)' }] }));
    }
  }

  // ---- water -----------------------------------------------------------

  /** Glints on the open water and rings of foam at the shore, only where the screen is looking. */
  private drawWater(game: Game): void {
    const g = this.gWater;
    g.clear();
    const scale = this.world.scale.x;
    const x0 = -this.world.x / scale - 60;
    const y0 = -this.world.y / scale - 100;
    const x1 = (this.pixi.screen.width - this.world.x) / scale + 60;
    const y1 = (this.pixi.screen.height - this.world.y) / scale + 60;
    const t = this.time;
    // the surf round the island breathes in and out
    for (const run of this.coastRuns) {
      g.moveTo(run[0]!.x, run[0]!.y);
      for (let i = 1; i < run.length; i++) g.lineTo(run[i]!.x, run[i]!.y);
    }
    if (this.coastRuns.length > 0) g.stroke({ width: 10, color: 0xffffff, alpha: 0.1 + 0.1 * Math.sin(t * 1.4), cap: 'round', join: 'round' });
    // glints on the open sea: bright dashes that come and go, thinning out far from the island
    const sea = this.sea;
    if (sea.w > 0) {
      const CELL = 130;
      for (let cy = Math.floor(y0 / CELL); cy <= Math.ceil(y1 / CELL); cy++) {
        for (let cx = Math.floor(x0 / CELL); cx <= Math.ceil(x1 / CELL); cx++) {
          const a = hash2(cx, cy, 71);
          if (a > 0.5) continue;
          const x = (cx + hash2(cx, cy, 72)) * CELL;
          const y = (cy + hash2(cx, cy, 73)) * CELL;
          const px = Math.floor((x - sea.minX) / sea.scale);
          const py = Math.floor((y - sea.minY) / sea.scale);
          if (px < 0 || py < 0 || px >= sea.w || py >= sea.h) continue;
          const dist = sea.dist[py * sea.w + px]! * sea.scale;
          if (dist < 40) continue; // under the island
          const glint = Math.max(0, Math.sin(t * 0.9 + a * 60)) ** 3 * 0.42 * clamp(1.1 - dist / 1000, 0.1, 1);
          if (glint < 0.03) continue;
          const len = 8 + hash2(cx, cy, 74) * 12;
          g.moveTo(x - len, y).lineTo(x + len, y).stroke({ width: 2, color: 0xffffff, alpha: glint, cap: 'round' });
        }
      }
    }
    for (let p = 0; p < this.depth.length; p++) {
      if (game.terrain.kindAt(p) !== Terrain.Water) continue;
      const w = posToWorld(game, p);
      if (w.x < x0 || w.x > x1 || w.y < y0 || w.y > y1) continue;
      const depth = this.depth[p]!;
      const a = hash2(p, 1, 5);
      if (depth <= 1) {
        const ph = (t * 0.45 + a) % 1;
        const r = 12 + ph * 16;
        g.ellipse(w.x, w.y, r, r * 0.5).stroke({ width: 1.6, color: 0xffffff, alpha: 0.4 * (1 - ph) });
      }
      if (a < 0.55) {
        const glint = Math.max(0, Math.sin(t * 1.2 + a * 40)) ** 3 * 0.5;
        if (glint > 0.04) {
          const x = w.x + (hash2(p, 2, 5) - 0.5) * 44;
          const y = w.y + (hash2(p, 3, 5) - 0.5) * 18;
          const len = 4 + hash2(p, 4, 5) * 7;
          g.moveTo(x - len, y).lineTo(x + len, y).stroke({ width: 1.4, color: 0xffffff, alpha: glint, cap: 'round' });
        }
      }
    }
  }

  // ---- roads -----------------------------------------------------------

  private geometryOf(game: Game, r: Road): RoadGeometry {
    let geo = this.roadGeo.get(r.index);
    if (!geo) {
      let pos = game.flags[r.flag[0]]!.pos;
      const pts = [posToWorld(game, pos)];
      const flat = [flatY(Math.floor(pos / game.cols))];
      for (const d of r.dirs) {
        pos = game.move(pos, d);
        pts.push(posToWorld(game, pos));
        flat.push(flatY(Math.floor(pos / game.cols)));
      }
      const curve = smoothPath(pts, CURVE_K);
      const curveFlat = curve.map((_, i) => {
        const a = Math.min(flat.length - 1, Math.floor(i / CURVE_K));
        const b = Math.min(flat.length - 1, a + 1);
        return flat[a]! + (flat[b]! - flat[a]!) * ((i / CURVE_K) - a);
      });
      geo = { pts, flat, curve, curveFlat };
      this.roadGeo.set(r.index, geo);
    }
    return geo;
  }

  /** Heights of a road's map points, vertex by vertex. */
  private vertexHeights(game: Game, r: Road): number[] {
    let pos = game.flags[r.flag[0]]!.pos;
    const out = [game.terrain.heightAt(pos)];
    for (const d of r.dirs) {
      pos = game.move(pos, d);
      out.push(game.terrain.heightAt(pos));
    }
    return out;
  }

  /**
   * Roads and the little paths from each door to its flag, worn into the ground:
   * smooth curves with edges that wander, a worn fringe, a dark rim, a dirt
   * surface (sand on the beach, gravel on the rock) with wheel ruts, pebbles and
   * tufts at the edge, and a trodden patch at every flag. Drawn only when roads,
   * flags or buildings change.
   */
  private drawRoads(game: Game): void {
    if (this.geoVersion !== game.layoutVersion) {
      this.roadGeo.clear(); // roads were added or cut: their paths changed
      this.geoVersion = game.layoutVersion;
    }
    let buildings = 0;
    for (const b of game.buildings) if (!b.removed) buildings++;
    let roads = 0;
    for (const r of game.roads) if (!r.removed) roads++;
    let flags = 0;
    for (const f of game.flags) if (!f.removed) flags++;
    const key = `${game.layoutVersion}:${buildings}:${roads}:${flags}`;
    if (key === this.roadsKey) return;
    this.roadsKey = key;

    const g = this.gRoads;
    g.clear();
    interface Way { mesh: RoadMesh; height: (u: number) => number; seed: number; door: boolean }
    const ways: Way[] = [];
    for (const r of game.roads) {
      if (r.removed) continue;
      const hv = this.vertexHeights(game, r);
      const { pts } = this.geometryOf(game, r);
      ways.push({
        mesh: roadMesh(pts, 100 + r.index * 13),
        height: (u) => {
          const i = Math.max(0, Math.min(hv.length - 2, Math.floor(u)));
          return hv[i]! + (hv[i + 1]! - hv[i]!) * Math.max(0, Math.min(1, u - i));
        },
        seed: r.index,
        door: false,
      });
    }
    for (const b of game.buildings) {
      if (b.removed) continue;
      const centre = this.buildingCentre(game, b);
      const door = posToWorld(game, game.flags[b.flag]!.pos);
      const mid = { x: (centre.x + door.x) / 2, y: (centre.y + door.y) / 2 };
      const bend = (hash2(b.index, 4, 81) - 0.5) * 8;
      const hgt = game.terrain.heightAt(game.flags[b.flag]!.pos);
      ways.push({
        mesh: roadMesh([centre, { x: mid.x + bend, y: mid.y }, door], 500 + b.index * 7, 3.1, 1.3, 4),
        height: () => hgt,
        seed: 1000 + b.index,
        door: true,
      });
    }

    const tone = (h: number): { color: number; ground: Ground } => {
      const sand = clamp((SEA_LEVEL + 2.2 - h) / 1.4, 0, 1); // 1 at the water's edge, 0 inland
      const rock = clamp((h - (MOUNTAIN_LEVEL - 1.4)) / 1.6, 0, 1);
      const earth = lerpColor(lerpColor(0xe2c283, 0xf6ecca, sand), 0xd4c39a, rock);
      return { color: earth, ground: rock > 0.55 ? 'scree' : sand > 0.55 ? 'sand' : 'dirt' };
    };

    // 1. the trodden fringe, a soft pale halo round every way and every flag's patch (no hard border)
    for (const w of ways) g.poly(outline(w.mesh, w.door ? 2.2 : 3.4)).fill({ color: 0xd8c690, alpha: w.door ? 0.14 : 0.2 });
    for (const f of game.flags) if (!f.removed) g.poly(blob(posToWorld(game, f.pos).x, posToWorld(game, f.pos).y, 12, 5.8, f.index + 3)).fill({ color: 0xd8c690, alpha: 0.22 });
    // 2. the surface, in strips so the colour can follow the ground, textured with its own tile
    for (const w of ways) {
      const m = w.mesh;
      for (let i = 0; i + 1 < m.c.length; i++) {
        const t = tone(w.height((m.u[i]! + m.u[i + 1]!) / 2));
        const shade = 0.93 + 0.12 * hash2(i, w.seed, 83);
        const tex = this.ground.get(t.ground)!;
        g.poly([m.l[i]!.x, m.l[i]!.y, m.l[i + 1]!.x, m.l[i + 1]!.y, m.r[i + 1]!.x, m.r[i + 1]!.y, m.r[i]!.x, m.r[i]!.y]).fill({
          color: scaleColor(t.color, shade * GROUND_GAIN[t.ground] * 1.03),
          texture: tex.texture,
          textureSpace: 'global',
          matrix: tex.matrix,
        });
      }
    }
    for (const f of game.flags) {
      if (f.removed) continue;
      const q = posToWorld(game, f.pos);
      const t = tone(game.terrain.heightAt(f.pos));
      const tex = this.ground.get(t.ground)!;
      g.poly(blob(q.x, q.y, 8.6, 4.2, f.index + 3)).fill({ color: scaleColor(t.color, GROUND_GAIN[t.ground] * 1.03), texture: tex.texture, textureSpace: 'global', matrix: tex.matrix });
    }
    // 3. wheel ruts, pebbles, stones at the edge, tufts of grass beside it
    for (const w of ways) {
      const m = w.mesh;
      if (!w.door) {
        for (const side of [1, -1] as const) {
          g.moveTo(m.c[0]!.x + m.n[0]!.x * side * 0.36 * (side > 0 ? m.wl[0]! : m.wr[0]!), m.c[0]!.y + m.n[0]!.y * side * 0.36 * (side > 0 ? m.wl[0]! : m.wr[0]!));
          for (let i = 1; i < m.c.length; i++) {
            const off = side * 0.36 * (side > 0 ? m.wl[i]! : m.wr[i]!);
            g.lineTo(m.c[i]!.x + m.n[i]!.x * off, m.c[i]!.y + m.n[i]!.y * off);
          }
          g.stroke({ width: 1.1, color: 0x7a6440, alpha: 0.16, join: 'round' });
        }
      }
      for (let i = 1; i + 1 < m.c.length; i++) {
        const hsh = hash2(i, w.seed, 85);
        const h = w.height(m.u[i]!);
        if (hsh < 0.22) {
          const across = (hash2(i, w.seed, 86) - 0.5) * (m.wl[i]! + m.wr[i]!) * 0.7;
          const x = m.c[i]!.x + m.n[i]!.x * across;
          const y = m.c[i]!.y + m.n[i]!.y * across;
          g.circle(x, y, 0.7 + hash2(i, w.seed, 87) * 0.9).fill({ color: hash2(i, w.seed, 88) > 0.5 ? 0xe4d9bd : 0x7a6a50, alpha: 0.7 });
        } else if (hsh > 0.965) {
          const side = hash2(i, w.seed, 89) > 0.5 ? 1 : -1;
          const dist = (side > 0 ? m.wl[i]! : m.wr[i]!) + 0.4;
          g.circle(m.c[i]!.x + m.n[i]!.x * side * dist, m.c[i]!.y + m.n[i]!.y * side * dist, 1.2 + hash2(i, w.seed, 90)).fill({ color: 0x8d877b, alpha: 0.9 });
        } else if (hsh > 0.9 && h > SEA_LEVEL + 1.6 && h < MOUNTAIN_LEVEL - 0.6 && !w.door) {
          const side = hash2(i, w.seed, 91) > 0.5 ? 1 : -1;
          const dist = (side > 0 ? m.wl[i]! : m.wr[i]!) + 2.2;
          const x = m.c[i]!.x + m.n[i]!.x * side * dist;
          const y = m.c[i]!.y + m.n[i]!.y * side * dist;
          g.moveTo(x - 1.6, y).lineTo(x - 2.6, y - 4).moveTo(x, y).lineTo(x, y - 5.2).moveTo(x + 1.6, y).lineTo(x + 2.6, y - 4).stroke({ width: 1, color: 0x3f6d30, alpha: 0.8, cap: 'round' });
        }
      }
    }
  }

  // ---- build sites -----------------------------------------------------

  /** Every point where the active building tool could build, cached by layout. */
  private sitePositions(game: Game): number[] {
    const type = this.app.buildType;
    if (type === null) return [];
    const key = `${game.layoutVersion}:${type}`;
    if (this.siteCache.key !== key) {
      const positions: number[] = [];
      for (let p = 0; p < game.cols * game.rows; p++) {
        if (checkBuilding(game, type, p).ok) positions.push(p);
      }
      this.siteCache = { key, positions };
    }
    return this.siteCache.positions;
  }

  private drawSites(game: Game): void {
    const g = this.gSites;
    g.clear();
    const type = this.app.buildType;
    if (type === null) return;
    const rx = buildingSize(type) === BuildingSize.Large ? 11 : 7;
    for (const p of this.sitePositions(game)) {
      const w = posToWorld(game, p);
      g.ellipse(w.x, w.y, rx, rx / 2).fill({ color: COLORS.ghostOk, alpha: 0.55 });
    }
  }

  // ---- scene -----------------------------------------------------------

  /** Centre of a building's ground plot. Large ones reach up-left of their point. */
  private buildingCentre(game: Game, b: Building): Pt {
    const p = b.pos >= 0 ? posToWorld(game, b.pos) : posToWorld(game, game.flags[b.flag]!.pos);
    return buildingSize(b.type) === BuildingSize.Large ? { x: p.x - S * 0.25, y: p.y - ROW_H * 0.5 } : p;
  }

  private drawScene(game: Game): void {
    const g = this.gObjects;
    g.clear();
    const alpha = this.app.alpha;
    const scene: Drawable[] = [];

    for (const b of game.buildings) {
      if (b.removed) {
        this.dropLabel(b.index);
        continue;
      }
      const pos = b.pos >= 0 ? b.pos : game.flags[b.flag]!.pos;
      scene.push({ key: flatY(Math.floor(pos / game.cols)), draw: () => this.drawBuilding(g, game, b) });
    }
    for (const f of game.flags) {
      if (f.removed) continue;
      scene.push({ key: flatY(Math.floor(f.pos / game.cols)) + 1, draw: () => this.drawFlag(g, game, f.index) });
    }
    for (const t of game.transporters) {
      if (t.gone) continue;
      const r = game.roads[t.road]!;
      const geo = this.geometryOf(game, r);
      const n = r.length;
      let u: number; // distance along the road in tiles, from flag[0]
      if (t.state === TState.Walking) {
        const total = r.ticks[t.at]!; // this road's walking time from where it started
        const remaining = Math.max(0, t.counter - alpha * game.speed);
        const progress = 1 - remaining / total;
        u = t.at === 0 ? progress * n : (1 - progress) * n;
      } else {
        u = t.at === 0 ? 0.4 : n - 0.4; // idle: stands just inside its end
      }
      const p = pointAt(geo.curve, u * CURVE_K);
      const key = valueAt(geo.flat, u) + 0.5;
      if (t.state === TState.Arriving) {
        const e = geo.pts[t.at === 0 ? 0 : n]!;
        scene.push({
          key,
          draw: () => g.ellipse(e.x, e.y, 16, 8).stroke({ width: 2, color: COLORS.carrierArriving }),
        });
        continue;
      }
      const walking = t.state === TState.Walking;
      const ahead = pointAt(geo.curve, (u + (t.at === 0 ? 0.15 : -0.15)) * CURVE_K);
      const facing: 1 | -1 = ahead.x >= p.x ? 1 : -1;
      const phase = walking ? (u * S) / 8 : game.tick * 0.03 + t.road * 1.7;
      const load = t.item.type >= 0 ? RES_COLOR[t.item.type]! : null;
      scene.push({
        key,
        draw: () => drawPerson(g, p.x, p.y, { action: walking ? 'walk' : 'idle', phase, facing, trade: 'carrier', load }),
      });
    }

    this.addObjects(game, scene, g);
    this.addWorkers(game, scene, g, alpha);
    this.addArrivals(game, scene, g, alpha);

    scene.sort((a, b) => a.key - b.key);
    for (const d of scene) d.draw();
  }

  /** Trees and rocks, only those that are on screen. */
  private addObjects(game: Game, scene: Drawable[], g: Graphics): void {
    const o = game.objects;
    if (!o) return;
    const scale = this.world.scale.x;
    const margin = 60;
    const x0 = -this.world.x / scale - margin;
    const y0 = -this.world.y / scale - margin - 40;
    const x1 = (this.pixi.screen.width - this.world.x) / scale + margin;
    const y1 = (this.pixi.screen.height - this.world.y) / scale + margin;
    for (let p = 0; p < o.kind.length; p++) {
      const kind = o.kind[p]!;
      const sign = kind === MapObject.None ? o.sign[p]! : 0;
      if (kind === MapObject.None && sign === 0) continue;
      const w = posToWorld(game, p);
      if (w.x < x0 || w.x > x1 || w.y < y0 || w.y > y1) continue;
      const key = flatY(Math.floor(p / game.cols)) + 0.3;
      if (sign > 0) scene.push({ key: key - 0.2, draw: () => drawSign(g, w, sign, o.signLeft[p]! / SIGN_TICKS) });
      else if (kind === MapObject.Field) scene.push({ key: key - 0.1, draw: () => drawField(g, w, 1 - o.growth[p]! / FIELD_TICKS, p) });
      else if (kind === MapObject.Wheat) scene.push({ key: key - 0.1, draw: () => drawField(g, w, 1, p) });
      else if (kind === MapObject.Tree) scene.push({ key, draw: () => drawTree(g, w, p, speciesAt(p % game.cols, Math.floor(p / game.cols), game.terrain.heightAt(p)), this.time) });
      else if (kind === MapObject.Sapling) scene.push({ key, draw: () => drawSapling(g, w, o.growth[p]! / GROW_TICKS) });
      else scene.push({ key, draw: () => drawRock(g, w, o.amountAt(p)) });
    }
  }

  /** Harvesters on their way to a tree or rock, working there, and coming back. */
  /**
   * The road path from flag `from` to flag `to` as one polyline, with the
   * ground plot of building `start` added at the front and `end` at the back
   * (-1: none). Null if there is no way. Cached per walk.
   */
  private walkGeometry(game: Game, id: number, from: number, to: number, start: number, end: number): RoadGeometry | null {
    const key = `${from}:${to}:${start}:${end}:${game.layoutVersion}`;
    const cached = this.walks.get(id);
    if (cached && cached.key === key) return cached.geo;
    let geo: RoadGeometry | null = null;
    const route = game.walkRoute(from, to);
    if (route) {
      geo = { pts: [], flat: [], curve: [], curveFlat: [] };
      for (let i = 0; i + 1 < route.length; i++) {
        const u = route[i]!;
        const v = route[i + 1]!;
        const r = game.roads.find((x) => !x.removed && ((x.flag[0] === u && x.flag[1] === v) || (x.flag[0] === v && x.flag[1] === u)));
        if (!r) continue;
        const rg = this.geometryOf(game, r);
        const pts = r.flag[0] === u ? rg.curve : rg.curve.slice().reverse();
        const flat = r.flag[0] === u ? rg.curveFlat : rg.curveFlat.slice().reverse();
        const first = geo.pts.length === 0 ? 0 : 1; // the joint is already there
        for (let k = first; k < pts.length; k++) {
          geo.pts.push(pts[k]!);
          geo.flat.push(flat[k]!);
        }
      }
      const rowOf = (x: Building) => Math.floor((x.pos >= 0 ? x.pos : game.flags[x.flag]!.pos) / game.cols);
      if (geo.pts.length > 0) {
        if (start >= 0) {
          const sb = game.buildings[start]!;
          geo.pts.unshift(this.buildingCentre(game, sb));
          geo.flat.unshift(flatY(rowOf(sb)));
        }
        if (end >= 0) {
          const eb = game.buildings[end]!;
          geo.pts.push(this.buildingCentre(game, eb));
          geo.flat.push(flatY(rowOf(eb)));
        }
      }
      if (geo.pts.length < 2) geo = null;
    }
    this.walks.set(id, { key, geo });
    return geo;
  }

  /** A new worker on his way from the storage to a finished building, with his trade's letter. */
  private addArrivals(game: Game, scene: Drawable[], g: Graphics, alpha: number): void {
    const used = new Set<number>();
    for (const b of game.buildings) {
      if (b.removed || b.builderHome < 0 || b.walkTicks <= 0) continue;
      const builder = b.constructing;
      if (builder ? b.builder !== BuilderState.Walking : b.state !== BState.Arriving) continue;
      const geo = this.walkGeometry(game, b.index, game.buildings[b.builderHome]!.flag, b.flag, b.builderHome, b.index);
      if (!geo) continue;
      const remaining = Math.max(0, b.counter - alpha * game.speed);
      const progress = clamp(1 - remaining / b.walkTicks, 0, 1);
      const u = progress * (geo.pts.length - 1);
      const p = pointAt(geo.pts, u);
      const letter = builder ? 'Bu' : WORKER_LETTER[b.type];
      const trade: Trade | null = builder ? 'builder' : tradeOf(b.type);
      const ahead = pointAt(geo.pts, u + 1.2);
      const facing: 1 | -1 = ahead.x >= p.x ? 1 : -1;
      if (letter) {
        let t = this.walkerTags.get(b.index);
        if (!t) {
          t = new Text({
            text: letter,
            style: { fill: 0xffffff, fontSize: 15, fontWeight: '700', fontFamily: 'system-ui, sans-serif', stroke: { color: 0x000000, width: 3 } },
          });
          t.anchor.set(0.5, 1);
          this.labelLayer.addChild(t);
          this.walkerTags.set(b.index, t);
        }
        if (t.text !== letter) t.text = letter;
        t.position.set(p.x, p.y - 28);
        used.add(b.index);
      }
      scene.push({
        key: valueAt(geo.flat, u) + 0.6,
        draw: () => drawPerson(g, p.x, p.y, { action: 'walk', phase: (u * S) / (8 * CURVE_K), facing, trade: trade ?? 'carrier' }),
      });
    }
    // geologists: along the roads to the flag, then spot to spot over the rock, probing, then home
    for (const geo of game.geologists) {
      const id = 1_000_000 + geo.id;
      const home = game.buildings[geo.home]!;
      const remaining = Math.max(0, geo.counter - alpha * game.speed);
      const progress = geo.total > 0 ? clamp(1 - remaining / geo.total, 0, 1) : 1;
      let p: Pt;
      let row: number;
      let action: 'walk' | 'work' = 'walk';
      let phaseArg = 0;
      let facing: 1 | -1 = 1;
      if (geo.phase === GeoPhase.Coming) {
        const geoPath = this.walkGeometry(game, id, home.flag, geo.flag, geo.home, -1);
        used.add(id);
        if (!geoPath) continue;
        const u = progress * (geoPath.pts.length - 1);
        p = pointAt(geoPath.pts, u);
        row = valueAt(geoPath.flat, u);
        const ahead = pointAt(geoPath.pts, u + 1.2);
        facing = ahead.x >= p.x ? 1 : -1;
        phaseArg = (u * S) / (8 * CURVE_K);
      } else {
        const from = posToWorld(game, geo.pos);
        const to = geo.phase === GeoPhase.Home ? this.buildingCentre(game, home) : posToWorld(game, geo.target >= 0 ? geo.target : geo.pos);
        const k = geo.phase === GeoPhase.Out || geo.phase === GeoPhase.Home ? progress : 1;
        p = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
        row = flatY(Math.floor((geo.phase === GeoPhase.Probing ? geo.target : geo.pos) / game.cols)) + 1;
        facing = to.x >= from.x ? 1 : -1;
        if (geo.phase === GeoPhase.Probing) {
          action = 'work';
          phaseArg = this.time * 7;
        } else phaseArg = (Math.hypot(to.x - from.x, to.y - from.y) * k) / 8;
      }
      let tag = this.walkerTags.get(id);
      if (!tag) {
        tag = new Text({
          text: 'Ge',
          style: { fill: 0xffffff, fontSize: 15, fontWeight: '700', fontFamily: 'system-ui, sans-serif', stroke: { color: 0x000000, width: 3 } },
        });
        tag.anchor.set(0.5, 1);
        this.labelLayer.addChild(tag);
        this.walkerTags.set(id, tag);
      }
      tag.position.set(p.x, p.y - 30);
      used.add(id);
      const at = p;
      scene.push({
        key: row + 0.6,
        draw: () => drawPerson(g, at.x, at.y, { action, phase: phaseArg, facing, trade: 'geologist' }),
      });
    }
    // spare carriers walking back to a storage
    game.homebound.forEach((h, n) => {
      const [storage, left, from, total] = h;
      if (from < 0 || total <= 0) return;
      const id = -1 - n; // keeps clear of building indices in the cache
      const geo = this.walkGeometry(game, id, from, game.buildings[storage]!.flag, -1, storage);
      used.add(id);
      if (!geo) return;
      const progress = clamp(1 - Math.max(0, left - alpha * game.speed) / total, 0, 1);
      const u = progress * (geo.pts.length - 1);
      const p = pointAt(geo.pts, u);
      const ahead = pointAt(geo.pts, u + 1.2);
      const facing: 1 | -1 = ahead.x >= p.x ? 1 : -1;
      scene.push({
        key: valueAt(geo.flat, u) + 0.5,
        draw: () => drawPerson(g, p.x, p.y, { action: 'walk', phase: (u * S) / (8 * CURVE_K), facing, trade: 'carrier' }),
      });
    });
    for (const [i, t] of this.walkerTags) {
      if (used.has(i)) continue;
      t.destroy();
      this.walkerTags.delete(i);
    }
    for (const i of [...this.walks.keys()]) if (!used.has(i)) this.walks.delete(i);
  }

  private addWorkers(game: Game, scene: Drawable[], g: Graphics, alpha: number): void {
    for (const b of game.buildings) {
      if (b.removed || b.constructing || b.target < 0 || b.state !== BState.Working || b.workTotal <= 0) continue;
      const home = this.buildingCentre(game, b);
      const dest = posToWorld(game, b.target);
      const remaining = Math.max(0, b.counter - alpha * game.speed);
      const elapsed = b.workTotal - remaining;
      const walk = b.walkTicks;
      const work = b.workTotal - 2 * walk;
      let t: number; // 0 at the building, 1 at the target
      let phase: 'out' | 'work' | 'back';
      if (elapsed < walk) {
        t = elapsed / walk;
        phase = 'out';
      } else if (elapsed < walk + work) {
        t = 1;
        phase = 'work';
      } else {
        t = 1 - (elapsed - walk - work) / walk;
        phase = 'back';
      }
      const p = { x: home.x + (dest.x - home.x) * t, y: home.y + (dest.y - home.y) * t };
      const homeRow = Math.floor((b.pos >= 0 ? b.pos : game.flags[b.flag]!.pos) / game.cols);
      const row = homeRow + (Math.floor(b.target / game.cols) - homeRow) * t;
      const carry =
        phase !== 'back' ? Res.None
        : b.type === BuildingType.Lumberjack ? Res.Lumber
        : b.type === BuildingType.Stonecutter ? Res.Stone
        : b.type === BuildingType.Farm && game.objectAtPos(b.target) === MapObject.Wheat ? Res.Wheat
        : Res.None;
      const trade = tradeOf(b.type) ?? 'lumberjack';
      const toward: 1 | -1 = dest.x >= home.x ? 1 : -1;
      const facing: 1 | -1 = phase === 'back' ? (toward === 1 ? -1 : 1) : toward;
      const px = Math.hypot(dest.x - home.x, dest.y - home.y) * t;
      const swing = phase === 'work';
      const load = carry !== Res.None ? RES_COLOR[carry]! : null;
      scene.push({
        key: flatY(row) + 0.6,
        draw: () =>
          drawPerson(g, p.x, p.y, {
            action: swing ? 'work' : 'walk',
            phase: swing ? elapsed * 0.09 : px / 8,
            facing,
            trade,
            load,
          }),
      });
    }
  }

  private drawFlag(g: Graphics, game: Game, index: number): void {
    const fl = game.flags[index]!;
    const p = posToWorld(game, fl.pos);
    g.ellipse(p.x, p.y, 7, 3.5).fill({ color: 0x000000, alpha: 0.3 });
    g.moveTo(p.x, p.y).lineTo(p.x, p.y - 22).stroke({ width: 2, color: 0x2b2b2b });
    g.poly([p.x, p.y - 22, p.x + 13, p.y - 18, p.x, p.y - 13]).fill({ color: COLORS.flag }).stroke({ width: 1, color: 0x222222 });
    for (let i = 0; i < FLAG_SLOTS; i++) {
      const it = fl.slot[i]!;
      if (it.type < 0) continue;
      const a = (i / FLAG_SLOTS) * Math.PI * 2 - Math.PI / 2;
      g.rect(p.x + Math.cos(a) * 16 - 3, p.y + Math.sin(a) * 8 - 6, 6, 6)
        .fill({ color: RES_COLOR[it.type]! })
        .stroke({ width: 1, color: 0x000000, alpha: 0.6 });
    }
  }

  private drawBuilding(g: Graphics, game: Game, b: Building): void {
    const c = this.buildingCentre(game, b);
    if (b.burning > 0) {
      this.drawBurning(g, game, b, c);
      return;
    }
    const kind = sizeKey(b.type);
    const { w, h } = SIZES[kind];

    let used = 0;
    let need = 0;
    for (let r = 0; r < b.need.length; r++) {
      used += b.used[r]!;
      need += b.need[r]!;
    }
    drawBuildingArt(g, {
      type: b.type,
      cx: c.x,
      cy: c.y,
      w,
      h,
      time: this.time,
      working: !b.constructing && b.state === BState.Working,
      progress: b.constructing ? Math.min(0.99, used / Math.max(1, need)) : 1,
      planks: b.stock[Res.Plank],
      stones: b.stock[Res.Stone],
      seed: b.index,
      ore: oreKindOf(b.type),
    });
    if (b.constructing) {
      const bw = w * 0.9;
      g.rect(c.x - bw / 2, c.y + w / 4 + 8, bw, 5).fill({ color: 0x000000, alpha: 0.55 });
      g.rect(c.x - bw / 2, c.y + w / 4 + 8, (bw * used) / Math.max(1, need), 5).fill({ color: COLORS.ghostOk });
      if (b.builder === BuilderState.Working) {
        // hammers away beside the site while a unit is being worked in
        const busy = b.unitRes !== Res.None;
        drawPerson(g, c.x + w / 2 + 10, c.y + 5, {
          action: busy ? 'work' : 'idle',
          phase: busy ? game.tick * 0.06 : game.tick * 0.03,
          facing: -1,
          trade: 'builder',
        });
      }
    } else if (!isStore(b)) {
      const trade = tradeOf(b.type);
      if (trade && b.state === BState.Working && b.target < 0) {
        // an indoor trade shows its worker busy beside the door
        drawPerson(g, c.x - w / 2 - 8, c.y + 5, { action: 'work', phase: game.tick * 0.05 + b.index, facing: 1, trade });
      }
      const dot = b.state === BState.OutputBlocked ? 0xff4d4d : b.state === BState.Working ? 0x7cff8a : 0x8a8a8a;
      g.circle(c.x + w / 2 + 4, c.y - h - 14, 4).fill({ color: dot }).stroke({ width: 1, color: 0x000000, alpha: 0.5 });
    }
    this.label(b.index, BUILDING_LABEL[b.type]!, { x: c.x, y: c.y + w * 0.3 + 12 }, b.constructing ? 0.55 : 0.8);
  }

  /** A demolished building: the walls sink as the fire burns down. */
  private drawBurning(g: Graphics, game: Game, b: Building, c: Pt): void {
    const { w, h } = SIZES[sizeKey(b.type)];
    const left = Math.min(1, b.burning / BURN_TICKS);
    g.ellipse(c.x, c.y + 4, w * 0.62, w * 0.28).fill({ color: 0x000000, alpha: 0.25 });
    cube(g, c.x, c.y, w, h * (0.3 + 0.7 * left), 0x3a2c28, 1, 0x1a1210);
    for (let i = -1; i <= 1; i++) {
      const flick = ((game.tick >> 4) + i * 5 + b.index) % 3;
      const fx = c.x + i * (w / 3.2);
      const top = c.y - h * (0.3 + 0.7 * left) - 6 - flick * 5 - 10 * left;
      g.poly([fx - 6, c.y - 2, fx, top, fx + 6, c.y - 2]).fill({ color: flick === 0 ? 0xffb347 : 0xff6b2b, alpha: 0.9 });
    }
    this.label(b.index, '', { x: c.x, y: c.y }, 0);
  }

  private dropLabel(index: number): void {
    const t = this.labels.get(index);
    if (!t) return;
    t.destroy();
    this.labels.delete(index);
  }

  private label(index: number, text: string, at: Pt, alpha: number): void {
    let t = this.labels.get(index);
    if (!t) {
      t = new Text({
        text,
        style: { fill: 0xffffff, fontSize: 11, fontWeight: '700', fontFamily: 'system-ui, sans-serif', stroke: { color: 0x000000, width: 2.5 } },
      });
      t.anchor.set(0.5);
      this.labelLayer.addChild(t);
      this.labels.set(index, t);
    }
    t.position.set(at.x, at.y);
    t.alpha = alpha;
  }

  // ---- overlay ---------------------------------------------------------

  private drawOverlay(game: Game): void {
    const g = this.gOverlay;
    g.clear();
    const app = this.app;
    const sel = app.selection;
    if (sel) {
      if (sel.kind === 'flag') {
        const p = posToWorld(game, game.flags[sel.index]!.pos);
        g.ellipse(p.x, p.y, 17, 8.5).stroke({ width: 3, color: COLORS.selected });
      } else if (sel.kind === 'building') {
        const b = game.buildings[sel.index]!;
        const c = this.buildingCentre(game, b);
        const big = b.type === BuildingType.Castle ? 52 : buildingSize(b.type) === BuildingSize.Large ? 40 : 24;
        g.ellipse(c.x, c.y + 2, big, big / 2).stroke({ width: 3, color: COLORS.selected });
        if (b.target >= 0) {
          // the tree or rock this harvester has claimed
          const t = posToWorld(game, b.target);
          g.ellipse(t.x, t.y, 14, 7).stroke({ width: 3, color: COLORS.carrierArriving });
          g.moveTo(c.x, c.y).lineTo(t.x, t.y).stroke({ width: 1.5, color: COLORS.carrierArriving, alpha: 0.6 });
        }
      } else {
        const { pts } = this.geometryOf(game, game.roads[sel.index]!);
        g.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
        g.stroke({ width: 16, color: COLORS.selected, alpha: 0.4, cap: 'round', join: 'round' });
      }
    }

    const hover = app.hover;
    if (!hover) return;
    const pos = game.index(hover.x, hover.y);
    const hp = posToWorld(game, pos);
    g.ellipse(hp.x, hp.y, 14, 7).stroke({ width: 2, color: COLORS.hover, alpha: 0.75 });
    const tool = app.tool;

    if (tool === 'flag') {
      const col = app.canFlagAt(hover.x, hover.y) ? COLORS.ghostOk : COLORS.ghostBad;
      g.moveTo(hp.x, hp.y).lineTo(hp.x, hp.y - 22).stroke({ width: 2, color: col });
      g.poly([hp.x, hp.y - 22, hp.x + 13, hp.y - 18, hp.x, hp.y - 13]).fill({ color: col, alpha: 0.8 });
    } else if (tool === 'road') {
      if (game.roadAtPos(pos) && game.flagAtPos(pos) < 0) {
        // a point on a road: a flag here would cut it and let a branch start
        const col = app.canFlagAt(hover.x, hover.y) ? COLORS.ghostOk : COLORS.ghostBad;
        g.moveTo(hp.x, hp.y).lineTo(hp.x, hp.y - 22).stroke({ width: 2, color: col });
        g.poly([hp.x, hp.y - 22, hp.x + 13, hp.y - 18, hp.x, hp.y - 13]).fill({ color: col, alpha: 0.8 });
      }
      if (app.roadStart >= 0) {
        const start = posToWorld(game, game.flags[app.roadStart]!.pos);
        g.ellipse(start.x, start.y, 16, 8).stroke({ width: 3, color: COLORS.ghostOk });
        const target = game.flagAtPos(pos);
        if (target >= 0 && target !== app.roadStart) {
          const path = planRoad(game, app.roadStart, pos);
          if (path) {
            let p = game.flags[app.roadStart]!.pos;
            g.moveTo(start.x, start.y);
            for (const d of path) {
              p = game.move(p, d);
              const w = posToWorld(game, p);
              g.lineTo(w.x, w.y);
            }
            g.stroke({ width: 8, color: COLORS.ghostOk, alpha: 0.7, cap: 'round', join: 'round' });
          } else {
            g.moveTo(start.x, start.y).lineTo(hp.x, hp.y).stroke({ width: 3, color: COLORS.ghostBad, alpha: 0.7 });
          }
        }
      }
    } else if (tool === 'demolish') {
      this.drawDemolishMark(g, game, pos);
    } else if (app.buildType !== null) {
      this.drawBuildGhost(g, game, app.buildType, pos);
    }
  }

  /** The thing the demolish tool would remove, in red (grey if it can't be). */
  private drawDemolishMark(g: Graphics, game: Game, pos: number): void {
    const t = this.app.demolishTargetAt(pos);
    if (!t) return;
    const col = t.ok ? COLORS.ghostBad : 0x9a9a9a;
    if (t.kind === 'building') {
      const c = this.buildingCentre(game, game.buildings[t.index]!);
      const { w, h } = SIZES[sizeKey(game.buildings[t.index]!.type)];
      cube(g, c.x, c.y, w, h, col, 0.45, null);
    } else if (t.kind === 'flag') {
      const p = posToWorld(game, game.flags[t.index]!.pos);
      g.ellipse(p.x, p.y, 17, 8.5).stroke({ width: 3, color: col });
    } else {
      const { pts } = this.geometryOf(game, game.roads[t.index]!);
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
      g.stroke({ width: 14, color: col, alpha: 0.55, cap: 'round', join: 'round' });
    }
  }

  /** Footprint, door flag and a see-through building, green if allowed, red if not. */
  private drawBuildGhost(g: Graphics, game: Game, type: BuildingType, pos: number): void {
    const check = checkBuilding(game, type, pos);
    const col = check.ok ? COLORS.ghostOk : COLORS.ghostBad;
    const covered = check.footprint.length ? check.footprint : [pos];
    for (const q of covered) {
      const w = posToWorld(game, q);
      g.ellipse(w.x, w.y, 13, 6.5).fill({ color: col, alpha: 0.35 });
    }
    if (check.flagPos >= 0) {
      const f = posToWorld(game, check.flagPos);
      g.moveTo(f.x, f.y).lineTo(f.x, f.y - 22).stroke({ width: 2, color: col });
      g.poly([f.x, f.y - 22, f.x + 13, f.y - 18, f.x, f.y - 13]).fill({ color: col, alpha: 0.8 });
    }
    const p = posToWorld(game, pos);
    const c = buildingSize(type) === BuildingSize.Large ? { x: p.x - S * 0.25, y: p.y - ROW_H * 0.5 } : p;
    const { w, h } = SIZES[sizeKey(type)];
    cube(g, c.x, c.y, w, h, col, 0.4, null);
  }

  dispose(): void {
    this.pixi.destroy(true, { children: true });
  }
}

/**
 * An isometric box standing on the ground at (cx, cy), `w` wide and `h` tall,
 * lit from the left. With a roof colour it gets a pyramid roof.
 */
function cube(g: Graphics, cx: number, cy: number, w: number, h: number, color: number, alpha: number, roof: number | null): void {
  const hw = w / 2;
  const hd = w / 4;
  g.poly([cx - hw, cy - h, cx, cy - h + hd, cx, cy + hd, cx - hw, cy]).fill({ color: scaleColor(color, 0.82), alpha });
  g.poly([cx, cy - h + hd, cx + hw, cy - h, cx + hw, cy, cx, cy + hd]).fill({ color: scaleColor(color, 0.62), alpha });
  if (roof === null) {
    g.poly([cx, cy - h - hd, cx + hw, cy - h, cx, cy - h + hd, cx - hw, cy - h]).fill({ color: scaleColor(color, 1.12), alpha });
  } else {
    const apex = cy - h - hd - w * 0.32;
    g.poly([cx - hw, cy - h, cx, cy - h + hd, cx, apex]).fill({ color: scaleColor(roof, 1.15), alpha });
    g.poly([cx, cy - h + hd, cx + hw, cy - h, cx, apex]).fill({ color: scaleColor(roof, 0.8), alpha });
  }
  g.poly([cx - hw, cy - h, cx, cy - h + hd, cx + hw, cy - h]).stroke({ width: 1, color: 0x000000, alpha: 0.25 * alpha });
}

/** Steps from each water point to the nearest land (1 at the shore); 0 on land. */
function waterDepths(game: Game): Uint8Array {
  const n = game.cols * game.rows;
  const depth = new Uint8Array(n);
  const dist = new Int16Array(n).fill(-1);
  const queue: number[] = [];
  for (let p = 0; p < n; p++) {
    if (game.terrain.kindAt(p) !== Terrain.Water) {
      dist[p] = 0;
      queue.push(p);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head]!;
    for (let d = 0; d < 6; d++) {
      const x = (p % game.cols) + [1, 1, 0, -1, -1, 0][d]!;
      const y = Math.floor(p / game.cols) + [0, 1, 1, 0, -1, -1][d]!;
      if (!game.inside(x, y)) continue;
      const q = game.index(x, y);
      if (dist[q] !== -1) continue;
      dist[q] = dist[p]! + 1;
      queue.push(q);
    }
  }
  for (let p = 0; p < n; p++) depth[p] = Math.min(255, Math.max(0, dist[p]!)); // all-water maps stay 0
  return depth;
}

/** Cosmetic variety from the point number alone, so a tree looks the same every frame. */
const variety = (p: number): number => (Math.imul(p + 1, 2654435761) >>> 0) / 4294967296;

/**
 * A clump of 2-5 trees on one point, big enough that neighbouring clumps run together into a forest. Count, spots and sizes come from the
 * point alone, so a clump looks the same every frame. Spots stay within about
 * most of a tile around the point; back ones are drawn first.
 */
function drawTree(g: Graphics, w: Pt, p: number, species: Species, time: number): void {
  const n = 2 + Math.floor(variety(p + 31) * 4); // 2..5
  const spots: { dx: number; dy: number; size: number; v: number; species: Species; phase: number }[] = [];
  for (let i = 0; i < n; i++) {
    // fixed ring of slots, shuffled per point, so trees never overlap into one blob
    const a = ((i + variety(p + 13)) / n) * Math.PI * 2;
    const r = n === 2 ? 0.85 : 0.5 + 0.45 * variety(p * 3 + i);
    const mix = variety(p * 11 + i * 29);
    spots.push({
      dx: Math.cos(a) * r * 24,
      dy: Math.sin(a) * r * 9,
      size: 0.78 + 0.22 * variety(p * 5 + i * 11),
      v: variety(p * 7 + i * 17),
      // a stand is mostly one species, with the odd stranger
      species: mix < 0.14 ? (species === 'oak' ? 'birch' : 'oak') : species,
      phase: variety(p * 13 + i * 3) * 6.28,
    });
  }
  spots.sort((x, y) => x.dy - y.dy);
  for (const t of spots) drawOneTree(g, { x: w.x + t.dx, y: w.y + t.dy }, t.size, t.v, t.species, Math.sin(time * 1.3 + t.phase));
}

/** One tree. `sway` in [-1, 1] bends the crown a little in the wind. */
function drawOneTree(g: Graphics, w: Pt, size: number, v: number, species: Species, sway: number): void {
  const { dark, light } = leafColors(species, v);
  const trunkColor = species === 'birch' ? 0xe8e4d8 : 0x6b4a2b;
  g.ellipse(w.x + 2 * size, w.y, 10 * size, 4.8 * size).fill({ color: 0x000000, alpha: 0.24 });
  if (species === 'pine') {
    const h = (28 + v * 12) * size;
    const lean = sway * 1.6 * size;
    g.rect(w.x - 1.7 * size, w.y - 7 * size, 3.4 * size, 7 * size).fill({ color: trunkColor });
    // four tiers, widest at the bottom; each is lit on the left and shaded on the right
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const f0 = i / tiers;
      const f1 = (i + 1.55) / tiers;
      const yb = w.y - 6 * size - (h - 6 * size) * f0 * 0.82;
      const yt = w.y - 6 * size - (h - 6 * size) * Math.min(1, f1) * 0.98;
      const half = (12 - i * 2.4) * size;
      const lx = lean * (1 - f0);
      const tx = w.x + lean * Math.min(1, f1);
      g.poly([w.x - half + lx * 0.3, yb, w.x + lx * 0.3, yb + 1.5 * size, tx, yt]).fill({ color: light });
      g.poly([w.x + lx * 0.3, yb + 1.5 * size, w.x + half + lx * 0.3, yb, tx, yt]).fill({ color: dark });
    }
  } else if (species === 'oak') {
    const h = (24 + v * 8) * size;
    const lean = sway * 1.4 * size;
    g.poly([w.x - 2.6 * size, w.y, w.x - 1.6 * size, w.y - 12 * size, w.x + 1.6 * size, w.y - 12 * size, w.x + 2.6 * size, w.y]).fill({ color: trunkColor });
    const cy = w.y - h * 0.62;
    for (const [ox, oy, r] of [[-7, 3, 8.5], [7, 3, 8.5], [0, -2, 10.5]] as const) {
      g.circle(w.x + ox * size + lean * 0.6, cy + oy * size, r * size).fill({ color: dark });
    }
    for (const [ox, oy, r] of [[-7, 1, 6.2], [0, -5, 7.4], [6, 1, 5.2]] as const) {
      g.circle(w.x + ox * size + lean, cy + oy * size, r * size).fill({ color: light });
    }
  } else {
    const h = (26 + v * 8) * size;
    const lean = sway * 1.8 * size;
    g.poly([w.x - 1.6 * size, w.y, w.x - 1 * size, w.y - h * 0.62, w.x + 1 * size, w.y - h * 0.62, w.x + 1.6 * size, w.y]).fill({ color: trunkColor });
    g.rect(w.x - 1.1 * size, w.y - 6 * size, 2.2 * size, 1.1 * size).fill({ color: 0x2a2a2a, alpha: 0.7 });
    g.rect(w.x - 1.1 * size, w.y - 11 * size, 2.2 * size, 1.1 * size).fill({ color: 0x2a2a2a, alpha: 0.7 });
    g.ellipse(w.x + lean * 0.7, w.y - h * 0.72, 7 * size, 11 * size).fill({ color: dark });
    g.ellipse(w.x - 1.5 * size + lean, w.y - h * 0.78, 4.8 * size, 8.2 * size).fill({ color: light });
  }
}

/** A young tree: it grows from a sprout towards a tree as `left` falls from 1 to 0. */
/** A geologist's sign: a post with a plate showing the ore (large plate for plenty, small for a little), or a cross for nothing. It fades out in its last stretch. */
function drawSign(g: Graphics, w: Pt, sign: number, left: number): void {
  const alpha = clamp(left / 0.15, 0, 1);
  const small = signIsSmall(sign);
  const kind = signKind(sign);
  const pw = small ? 10 : 15;
  const ph = small ? 8 : 11;
  const top = w.y - 21;
  g.ellipse(w.x + 1, w.y, 4, 2).fill({ color: 0x000000, alpha: 0.25 * alpha });
  g.rect(w.x - 1.2, top, 2.4, 21).fill({ color: 0x6b4a2b, alpha });
  const color = kind === OreKind.None ? 0xd9d2c0 : ORE_COLOR[kind]!;
  g.roundRect(w.x - pw / 2, top - ph + 3, pw, ph, 1.2).fill({ color, alpha }).stroke({ width: 1, color: 0x2a2418, alpha: 0.85 * alpha });
  if (kind === OreKind.None) {
    const cx = w.x;
    const cy = top - ph / 2 + 3;
    g.moveTo(cx - 2.5, cy - 2).lineTo(cx + 2.5, cy + 2).moveTo(cx + 2.5, cy - 2).lineTo(cx - 2.5, cy + 2).stroke({ width: 1.2, color: 0x7a2a2a, alpha });
  }
}

/** A sown plot: furrows with green shoots that grow tall and turn gold when ripe. */
function drawField(g: Graphics, w: Pt, ripeness: number, p: number): void {
  const k = Math.min(1, Math.max(0, ripeness));
  const ripe = k >= 1;
  g.poly([w.x - 17, w.y, w.x, w.y - 8, w.x + 17, w.y, w.x, w.y + 8]).fill({ color: ripe ? 0xb89a3c : 0x7a5a36, alpha: 0.85 });
  for (let row = -1; row <= 1; row++) {
    for (let i = -2; i <= 2; i++) {
      const x = w.x + i * 6 + row * 3;
      const y = w.y + row * 3.5 + i * 0.5;
      const h = 2 + k * 8 + ((p + i + row) & 1);
      g.moveTo(x, y).lineTo(x + (ripe ? 1 : 0), y - h).stroke({ width: 1.6, color: ripe ? 0xf2d04b : 0x5fae48, cap: 'round' });
      if (ripe) g.circle(x + 1, y - h, 1.3).fill({ color: 0xf8e08a });
    }
  }
}

function drawSapling(g: Graphics, w: Pt, left: number): void {
  const k = 1 - Math.min(1, left); // 0 = just planted, 1 = about to be a tree
  const h = 7 + k * 11;
  g.ellipse(w.x, w.y, 4 + k * 3, 2 + k * 1.5).fill({ color: 0x000000, alpha: 0.2 });
  g.rect(w.x - 1, w.y - h * 0.5, 2, h * 0.5).fill({ color: OBJECT_COLORS.trunk });
  g.poly([w.x - 3 - k * 4, w.y - h * 0.4, w.x + 3 + k * 4, w.y - h * 0.4, w.x, w.y - h]).fill({ color: OBJECT_COLORS.leafLight });
}

function drawRock(g: Graphics, w: Pt, units: number): void {
  const r = 5 + units; // bigger while there is more left to cut
  g.ellipse(w.x, w.y + 1, r + 2, (r + 2) / 2).fill({ color: 0x000000, alpha: 0.25 });
  g.poly([w.x - r, w.y, w.x - r * 0.6, w.y - r * 0.9, w.x + r * 0.2, w.y - r * 1.1, w.x + r, w.y - r * 0.3, w.x + r * 0.8, w.y])
    .fill({ color: scaleColor(OBJECT_COLORS.rock, 0.8) })
    .stroke({ width: 1, color: 0x000000, alpha: 0.4 });
  g.poly([w.x - r * 0.6, w.y - r * 0.9, w.x + r * 0.2, w.y - r * 1.1, w.x + r, w.y - r * 0.3, w.x + r * 0.1, w.y - r * 0.5])
    .fill({ color: scaleColor(OBJECT_COLORS.rock, 1.15) });
}

/** Point `u` tiles along a polyline of unit-spaced waypoints. */
function pointAt(pts: Pt[], u: number): Pt {
  const last = pts.length - 1;
  const c = clamp(u, 0, last);
  const i = Math.min(last - 1, Math.floor(c));
  const f = c - i;
  const a = pts[i]!;
  const b = pts[i + 1]!;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/** Linear interpolation along a list of per-waypoint values. */
function valueAt(values: number[], u: number): number {
  const last = values.length - 1;
  const c = clamp(u, 0, last);
  const i = Math.min(last - 1, Math.floor(c));
  return values[i]! + (values[i + 1]! - values[i]!) * (c - i);
}
