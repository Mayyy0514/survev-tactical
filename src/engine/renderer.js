import { BIOMES, WEAPONS, MELEE_WEAPONS, AMMO_COLORS, MEDICAL_ITEMS, THROWABLES } from '../config/constants.js';
import { getGrassPattern, getSandPattern, getBunkerPattern } from './textures.js';
import { clamp, distSq } from './gameLogic.js';

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

export function renderGameCanvas(ctx, engine, width, height) {
  const {
    world,
    player,
    allies,
    remotePlayers,
    zombies,
    bullets,
    acidProjectiles,
    grenades,
    turrets,
    drones,
    decals,
    particles,
    airstrikes,
    muzzleFlashes,
    shells,
    camera,
    biomeId,
  } = engine;

  const biome = BIOMES[biomeId] || BIOMES.forest;
  const zoom = engine.getCameraZoom ? engine.getCameraZoom() : 1.0;

  ctx.save();
  ctx.fillStyle = player.inBunker ? '#090d16' : biome.waterDeep;
  ctx.fillRect(0, 0, width, height);

  ctx.translate(width / 2, height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-camera.x, -camera.y);

  const halfW = (width / 2) / zoom + 240;
  const halfH = (height / 2) / zoom + 240;
  const minX = camera.x - halfW;
  const maxX = camera.x + halfW;
  const minY = camera.y - halfH;
  const maxY = camera.y + halfH;

  if (player.inBunker) {
    renderUndergroundBunker(ctx, world.bunker);
  } else {
    renderSurfaceTerrain(ctx, world, biome, minX, maxX, minY, maxY);
  }

  // Blood decals & explosion scorches
  for (const d of decals) {
    if (d.inBunker !== player.inBunker) continue;
    if (d.x + d.r < minX || d.x - d.r > maxX || d.y + d.r < minY || d.y - d.r > maxY) continue;
    ctx.save();
    ctx.globalAlpha = clamp(d.ttl / (d.maxTtl || 8), 0, 0.82);
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (!player.inBunker) {
    // Driveable & Parked Vehicles
    if (world.vehicles) {
      for (const veh of world.vehicles) {
        if (veh.x + 80 < minX || veh.x - 80 > maxX || veh.y + 80 < minY || veh.y - 80 > maxY) continue;
        renderVehicle(ctx, veh, player);
      }
    }

    // 110+ Multi-Room Buildings (Floors, Detailed Furniture, Walls, Windows, Doors)
    for (const b of world.buildings) {
      if (b.x + b.w < minX || b.x > maxX || b.y + b.h < minY || b.y > maxY) continue;
      renderBuildingInterior(ctx, b);
    }

    // Interactive Supply Crates
    for (const c of world.crates) {
      if (c.hp <= 0 || c._destroyed) continue;
      if (c.x + c.w < minX || c.x > maxX || c.y + c.h < minY || c.y > maxY) continue;
      renderCrate(ctx, c);
    }

    // 14 Vendor Stations
    for (const v of world.vendors || [world.vendor]) {
      if (v.x + 110 < minX || v.x - 110 > maxX || v.y + 110 < minY || v.y - 110 > maxY) continue;
      renderVendor(ctx, v, player);
    }

    // 5 Underground Bunker Entrances
    for (const st of world.bunkerEntrances || [world.bunkerStairsSurface]) {
      if (st.x + st.w < minX || st.x > maxX || st.y + st.h < minY || st.y > maxY) continue;
      renderBunkerEntrance(ctx, st, player);
    }
  }

  // Deployed Barricades (4-Way Rotatable + Destructible with HP Bar)
  if (world.barricades) {
    for (const bar of world.barricades) {
      if (bar.destroyed || bar.hp <= 0 || Boolean(bar.inBunker) !== Boolean(player.inBunker)) continue;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.36)';
      ctx.fillRect(bar.x + 3, bar.y + 3, bar.w, bar.h);

      ctx.fillStyle = '#334155';
      ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.strokeRect(bar.x, bar.y, bar.w, bar.h);

      // Steel reinforcement ribs along orientation
      ctx.fillStyle = '#64748b';
      if (bar.w >= bar.h) {
        for (let rx = bar.x + 8; rx < bar.x + bar.w - 6; rx += 16) {
          ctx.fillRect(rx, bar.y + 3, 6, bar.h - 6);
        }
      } else {
        for (let ry = bar.y + 8; ry < bar.y + bar.h - 6; ry += 16) {
          ctx.fillRect(bar.x + 3, ry, bar.w - 6, 6);
        }
      }

      const maxHp = bar.maxHp || 380;
      if (bar.hp < maxHp) {
        const pct = clamp(bar.hp / maxHp, 0, 1);
        const bw = Math.max(34, bar.w);
        const bx = bar.x + bar.w * 0.5 - bw * 0.5;
        const by = bar.y - 9;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(bx, by, bw, 4);
        ctx.fillStyle = pct > 0.4 ? '#f59e0b' : '#ef4444';
        ctx.fillRect(bx, by, bw * pct, 4);
      }
      ctx.restore();
    }
  }

  // Detailed Vector Floor Loot (filtered by surface or active bunker ID)
  for (const item of world.loot) {
    if (item.inBunker !== player.inBunker) continue;
    if (player.inBunker && item.bunkerId && player.activeBunkerId && item.bunkerId !== player.activeBunkerId) continue;
    if (item.x + 50 < minX || item.x - 50 > maxX || item.y + 50 < minY || item.y - 50 > maxY) continue;
    renderDetailedFloorLoot(ctx, item, player);
  }

  // Ejected Brass Shell Casings
  if (shells) {
    for (const s of shells) {
      if (s.inBunker !== player.inBunker) continue;
      if (s.x < minX || s.x > maxX || s.y < minY || s.y > maxY) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.globalAlpha = clamp(s.ttl / 1.4, 0, 0.95);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-3.2, -1.3, 6.4, 2.6);
      ctx.fillStyle = '#b45309';
      ctx.fillRect(-3.2, -1.3, 1.8, 2.6);
      ctx.restore();
    }
  }

  // Faceted Stones (Destructible)
  if (!player.inBunker) {
    for (const s of world.stones) {
      if (!s || s.destroyed || s.hp <= 0) continue;
      if (s.x + s.r < minX || s.x - s.r > maxX || s.y + s.r < minY || s.y - s.r > maxY) continue;
      renderStone(ctx, s, biome);
    }
  }

  // Deployed Auto-Turrets & Combat Drones
  for (const t of turrets) {
    if (t.inBunker !== player.inBunker) continue;
    renderTurret(ctx, t);
  }
  if (drones) {
    for (const dr of drones) {
      renderCombatDrone(ctx, dr);
    }
  }

  // Bullets & Acid Projectiles
  for (const b of bullets) {
    if (b.inBunker !== player.inBunker) continue;
    ctx.save();
    ctx.strokeStyle = b.color || '#fef08a';
    ctx.lineWidth = b.thickness || 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - Math.cos(b.angle) * 24, b.y - Math.sin(b.angle) * 24);
    ctx.stroke();
    ctx.restore();
  }

  for (const ap of acidProjectiles) {
    if (ap.inBunker !== player.inBunker) continue;
    ctx.save();
    ctx.fillStyle = '#a3e635';
    ctx.beginPath();
    ctx.arc(ap.x, ap.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Muzzle Flashes (Star-shaped flash at barrel tip)
  if (muzzleFlashes) {
    for (const mf of muzzleFlashes) {
      if (mf.inBunker !== player.inBunker) continue;
      ctx.save();
      ctx.translate(mf.x, mf.y);
      ctx.rotate(mf.angle);
      ctx.globalAlpha = clamp(mf.ttl / 0.06, 0, 1);

      const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, mf.size);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.4, '#fde047');
      grad.addColorStop(0.8, '#f97316');
      grad.addColorStop(1, 'rgba(249,115,22,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(4, 0, mf.size, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.moveTo(0, -3.5);
      ctx.lineTo(mf.size * 1.45, 0);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(mf.size * 0.45, -mf.size * 0.65);
      ctx.lineTo(mf.size * 0.2, 0);
      ctx.lineTo(mf.size * 0.45, mf.size * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Grenades & Airstrikes
  for (const g of grenades) {
    if (g.inBunker !== player.inBunker) continue;
    if (g.smokeActive) {
      ctx.save();
      ctx.fillStyle = 'rgba(203, 213, 225, 0.52)';
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = g.color || '#15803d';
      ctx.beginPath();
      ctx.arc(g.x, g.y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  for (const s of airstrikes) {
    if (s.inBunker !== player.inBunker) continue;
    ctx.save();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
    ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Anatomical Zombies
  for (const z of zombies) {
    if (z.inBunker !== player.inBunker) continue;
    if (player.inBunker && z.bunkerId && player.activeBunkerId && z.bunkerId !== player.activeBunkerId) continue;
    if (z.x + 60 < minX || z.x - 60 > maxX || z.y + 60 < minY || z.y - 60 > maxY) continue;
    renderZombie(ctx, z);
  }

  // AI Squad Allies
  for (const bot of allies) {
    if (bot.inBunker !== player.inBunker) continue;
    renderSoldier(ctx, bot, false);
  }

  // Remote Co-op Players
  if (remotePlayers && remotePlayers.size > 0) {
    for (const rp of remotePlayers.values()) {
      if (Boolean(rp.inBunker) !== player.inBunker) continue;
      renderSoldier(ctx, rp, false, true);
    }
  }

  // Local Player
  renderSoldier(ctx, player, true);

  if (!player.inBunker) {
    // Building Roofs (Fade smoothly when player enters building)
    for (const b of world.buildings) {
      if (b.x + b.w < minX || b.x > maxX || b.y + b.h < minY || b.y > maxY) continue;
      const inside =
        player.x >= b.x - 16 &&
        player.x <= b.x + b.w + 16 &&
        player.y >= b.y - 16 &&
        player.y <= b.y + b.h + 16;
      b.roofAlpha = b.roofAlpha ?? 1;
      const targetAlpha = inside ? 0.05 : 1.0;
      b.roofAlpha += (targetAlpha - b.roofAlpha) * 0.2;
      if (b.roofAlpha > 0.06) {
        renderBuildingRoof(ctx, b, b.roofAlpha);
      }
    }

    // Streetlights
    if (world.streetlights) {
      for (const lamp of world.streetlights) {
        if (lamp.x + 40 < minX || lamp.x - 40 > maxX || lamp.y + 40 < minY || lamp.y - 40 > maxY) continue;
        renderStreetlight(ctx, lamp);
      }
    }

    // Multi-lobed Organic Trees (Destructible)
    for (const t of world.trees) {
      if (!t || t.destroyed || t.hp <= 0) continue;
      if (t.x + t.crownR < minX || t.x - t.crownR > maxX || t.y + t.crownR < minY || t.y - t.crownR > maxY) continue;
      const under = distSq(player.x, player.y, t.x, t.y) < t.crownR * t.crownR;
      renderTree(ctx, t, biome, under ? 0.42 : 0.96);
    }
  }

  // Impact Sparks & Blood Particles
  for (const pt of particles) {
    if (pt.inBunker !== player.inBunker) continue;
    ctx.save();
    ctx.globalAlpha = clamp(pt.ttl / (pt.maxTtl || 0.3), 0, 1);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Roblox-Style Floating Chat Bubbles Above AI Companions
  renderAiChatBubbles(ctx, allies, player.inBunker);

  ctx.restore();

  // Continuous Smoothstep Solar Cycle, Radial Flashlights & Weather
  renderEnvironmentAndWeather(ctx, engine, width, height, zoom);
}

// ============================================================================
// SURFACE TERRAIN, RIVER, BRIDGES & ROADS
// ============================================================================
function renderSurfaceTerrain(ctx, world, biome, minX, maxX, minY, maxY) {
  const sandPat = getSandPattern(ctx, biome);
  const grassPat = getGrassPattern(ctx, biome);

  const sX = Math.max(320, minX);
  const sY = Math.max(320, minY);
  const sW = Math.min(world.size - 320, maxX) - sX;
  const sH = Math.min(world.size - 320, maxY) - sY;
  if (sW > 0 && sH > 0) {
    ctx.fillStyle = sandPat;
    ctx.fillRect(sX, sY, sW, sH);
  }

  const gX = Math.max(660, minX);
  const gY = Math.max(660, minY);
  const gW = Math.min(world.size - 660, maxX) - gX;
  const gH = Math.min(world.size - 660, maxY) - gY;
  if (gW > 0 && gH > 0) {
    ctx.fillStyle = grassPat;
    ctx.fillRect(gX, gY, gW, gH);
  }

  // ==========================================================================
  // 1. TWO-PASS GLOBAL ROAD NETWORK (Zero overlapping "sausage" caps!)
  // ==========================================================================
  if (world.dirtRoads && world.dirtRoads.length > 0) {
    const traceRoadSegment = (road) => {
      if (road.points && road.points.length > 1) {
        road.points.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      } else if (typeof road.x1 === 'number') {
        const rMinX = Math.min(road.x1, road.cx, road.x2) - 240;
        const rMaxX = Math.max(road.x1, road.cx, road.x2) + 240;
        const rMinY = Math.min(road.y1, road.cy, road.y2) - 240;
        const rMaxY = Math.max(road.y1, road.cy, road.y2) + 240;
        if (rMaxX < minX || rMinX > maxX || rMaxY < minY || rMinY > maxY) return;
        ctx.moveTo(road.x1, road.y1);
        ctx.quadraticCurveTo(road.cx, road.cy, road.x2, road.y2);
      }
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // PASS 1: Unified outer gravel/compacted border for ALL roads in one single path
    ctx.strokeStyle = '#4a3b2c';
    ctx.lineWidth = 84;
    ctx.beginPath();
    for (const road of world.dirtRoads) {
      traceRoadSegment(road);
    }
    ctx.stroke();

    // PASS 2: Unified inner dirt/asphalt surface for ALL roads in one single path
    ctx.strokeStyle = '#63513d';
    ctx.lineWidth = 72;
    ctx.beginPath();
    for (const road of world.dirtRoads) {
      traceRoadSegment(road);
    }
    ctx.stroke();

    // PASS 3: Dashed center lane markings on main ring road & arterial highways
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.34)';
    ctx.lineWidth = 2.4;
    ctx.setLineDash([18, 22]);
    ctx.beginPath();
    for (const road of world.dirtRoads) {
      if (road.isMainHighway) {
        traceRoadSegment(road);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ==========================================================================
  // 2. THREE-LAYER RIVER WITH ANIMATED WATER CURRENTS
  // ==========================================================================
  const visibleRiver = [];
  for (let i = 0; i < world.riverPoints.length; i++) {
    const p = world.riverPoints[i];
    if (p.x >= minX - 950 && p.x <= maxX + 950 && p.y >= minY - 950 && p.y <= maxY + 950) {
      visibleRiver.push(p);
    }
  }
  if (visibleRiver.length > 1) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const traceRiver = () => {
      visibleRiver.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    };

    // Layer 1: Wide wet sand beach bank (lineWidth = 440)
    ctx.strokeStyle = biome.sand;
    ctx.lineWidth = 440;
    ctx.beginPath();
    traceRiver();
    ctx.stroke();

    // Subtle shoreline foam edge
    ctx.strokeStyle = 'rgba(224, 242, 254, 0.38)';
    ctx.lineWidth = 368;
    ctx.beginPath();
    traceRiver();
    ctx.stroke();

    // Layer 2: Light shallow water shore (lineWidth = 360)
    ctx.strokeStyle = biome.water;
    ctx.lineWidth = 360;
    ctx.beginPath();
    traceRiver();
    ctx.stroke();

    // Layer 3: Deep central channel (lineWidth = 260)
    ctx.strokeStyle = biome.waterDeep;
    ctx.lineWidth = 260;
    ctx.beginPath();
    traceRiver();
    ctx.stroke();

    // Animated flowing current lines inside the deep channel
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.22)';
    ctx.lineWidth = 12;
    ctx.setLineDash([32, 48]);
    ctx.lineDashOffset = -((performance.now() * 0.045) % 80);
    ctx.beginPath();
    traceRiver();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ==========================================================================
  // 3. ENGINEERED BRIDGES (Shadow Pillars, Paved Ramps, Deck & Metal Railings)
  // ==========================================================================
  for (const br of world.bridges) {
    if (br.x + br.w + 40 < minX || br.x - 40 > maxX || br.y + br.h + 40 < minY || br.y - 40 > maxY) continue;
    ctx.save();

    // Drop shadow over water
    ctx.fillStyle = 'rgba(9, 13, 22, 0.45)';
    ctx.fillRect(br.x - 6, br.y + 12, br.w + 12, br.h);

    // Concrete cylindrical support pillars in the water
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    const pillarXs = [br.x + br.w * 0.22, br.x + br.w * 0.5, br.x + br.w * 0.78];
    for (const px of pillarXs) {
      ctx.beginPath();
      ctx.arc(px, br.y - 4, 10, 0, Math.PI * 2);
      ctx.arc(px, br.y + br.h + 4, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Paved approach ramps on both ends
    ctx.fillStyle = '#475569';
    ctx.fillRect(br.x - 24, br.y + 4, 26, br.h - 8);
    ctx.fillRect(br.x + br.w - 2, br.y + 4, 26, br.h - 8);

    // Bridge main concrete/timber deck
    ctx.fillStyle = '#57534e';
    ctx.fillRect(br.x, br.y, br.w, br.h);
    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = 2;
    ctx.strokeRect(br.x, br.y, br.w, br.h);

    // Expansion joints / transverse deck slabs
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.42)';
    ctx.lineWidth = 2.2;
    for (let x = br.x + 24; x < br.x + br.w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, br.y + 8);
      ctx.lineTo(x, br.y + br.h - 8);
      ctx.stroke();
    }

    // Center dashed yellow traffic line across bridge
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.65)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([14, 14]);
    ctx.beginPath();
    ctx.moveTo(br.x - 16, br.y + br.h * 0.5);
    ctx.lineTo(br.x + br.w + 16, br.y + br.h * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // Solid Metallic Side Guardrails (with collision in gameLogic)
    const railings = br.railings || [
      { x: br.x, y: br.y - 8, w: br.w, h: 10 },
      { x: br.x, y: br.y + br.h - 2, w: br.w, h: 10 },
    ];
    for (const rl of railings) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(rl.x, rl.y, rl.w, rl.h);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.8;
      ctx.strokeRect(rl.x, rl.y, rl.w, rl.h);

      // Steel stanchion posts along guardrail
      ctx.fillStyle = '#cbd5e1';
      for (let rx = rl.x + 8; rx < rl.x + rl.w - 4; rx += 32) {
        ctx.fillRect(rx, rl.y - 1, 6, rl.h + 2);
      }
    }

    ctx.restore();
  }
}

function renderUndergroundBunker(ctx, bunker) {
  if (!bunker) return;
  ctx.save();
  ctx.fillStyle = getBunkerPattern(ctx);
  ctx.fillRect(bunker.x, bunker.y, bunker.w, bunker.h);

  // Distinct bunker room floor styling
  if (bunker.rooms && bunker.rooms.length > 0) {
    for (const rm of bunker.rooms) {
      ctx.fillStyle = rm.color || '#1e293b';
      ctx.fillRect(rm.x, rm.y, rm.w, rm.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1.2;
      for (let gx = rm.x + 40; gx < rm.x + rm.w; gx += 40) {
        ctx.beginPath();
        ctx.moveTo(gx, rm.y);
        ctx.lineTo(gx, rm.y + rm.h);
        ctx.stroke();
      }
      for (let gy = rm.y + 40; gy < rm.y + rm.h; gy += 40) {
        ctx.beginPath();
        ctx.moveTo(rm.x, gy);
        ctx.lineTo(rm.x + rm.w, gy);
        ctx.stroke();
      }
    }
  }

  // Bunker Furniture
  if (bunker.furniture) {
    for (const f of bunker.furniture) {
      drawDetailedFurniture(ctx, f);
    }
  }

  // Bunker Supply Crates
  if (bunker.crates) {
    for (const c of bunker.crates) {
      if (c.hp <= 0 || c._destroyed) continue;
      renderCrate(ctx, c);
    }
  }

  const ex = bunker.stairsExit;
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(ex.x, ex.y, ex.w, ex.h);
  ctx.strokeStyle = '#090d16';
  ctx.lineWidth = 2;
  ctx.strokeRect(ex.x, ex.y, ex.w, ex.h);
  ctx.fillStyle = '#fde047';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SALIDA A SUPERFICIE [F]', ex.x + ex.w * 0.5, ex.y - 10);

  if (bunker.name) {
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(bunker.name, bunker.x + bunker.w * 0.5, bunker.y - 14);
  }

  ctx.fillStyle = '#334155';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  for (const w of bunker.walls) {
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeRect(w.x, w.y, w.w, w.h);
  }
  ctx.restore();
}

// ============================================================================
// BUILDINGS, MULTI-ROOM FLOORS, WINDOWS & DETAILED FURNITURE
// ============================================================================
function renderBuildingInterior(ctx, b) {
  ctx.save();

  // Building drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.36)';
  ctx.fillRect(b.x + 8, b.y + 8, b.w, b.h);

  // Base floor fallback
  ctx.fillStyle = b.floorColor || '#6e5239';
  ctx.fillRect(b.x, b.y, b.w, b.h);

  // Differentiated multi-room floor patterns
  if (b.rooms && b.rooms.length > 0) {
    for (const rm of b.rooms) {
      if (rm.floorStyle === 'wood') {
        ctx.fillStyle = rm.color || '#734f34';
        ctx.fillRect(rm.x, rm.y, rm.w, rm.h);
        ctx.strokeStyle = 'rgba(0,0,0,0.16)';
        ctx.lineWidth = 1;
        for (let py = rm.y + 14; py < rm.y + rm.h; py += 16) {
          ctx.beginPath();
          ctx.moveTo(rm.x, py);
          ctx.lineTo(rm.x + rm.w, py);
          ctx.stroke();
        }
      } else if (rm.floorStyle === 'ceramic') {
        ctx.fillStyle = rm.color || '#cbd5e1';
        ctx.fillRect(rm.x, rm.y, rm.w, rm.h);
        const tileSize = 22;
        ctx.fillStyle = 'rgba(100, 116, 139, 0.25)';
        for (let ty = rm.y; ty < rm.y + rm.h; ty += tileSize) {
          for (let tx = rm.x; tx < rm.x + rm.w; tx += tileSize) {
            if ((Math.floor((tx - rm.x) / tileSize) + Math.floor((ty - rm.y) / tileSize)) % 2 === 0) {
              ctx.fillRect(
                tx,
                ty,
                Math.min(tileSize, rm.x + rm.w - tx),
                Math.min(tileSize, rm.y + rm.h - ty)
              );
            }
          }
        }
      } else {
        ctx.fillStyle = rm.color || '#475569';
        ctx.fillRect(rm.x, rm.y, rm.w, rm.h);
        ctx.strokeStyle = 'rgba(15,23,42,0.22)';
        ctx.lineWidth = 1.2;
        for (let gx = rm.x + 36; gx < rm.x + rm.w; gx += 36) {
          ctx.beginPath();
          ctx.moveTo(gx, rm.y);
          ctx.lineTo(gx, rm.y + rm.h);
          ctx.stroke();
        }
      }
    }
  }

  // Detailed Interior Furniture
  if (b.furniture) {
    for (const f of b.furniture) {
      drawDetailedFurniture(ctx, f);
    }
  }

  // Exterior & Interior Partition Walls with 3D Bevel
  if (b.walls) {
    for (const w of b.walls) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(w.x + 3, w.y + 3, w.w, w.h);
      ctx.fillStyle = b.wallColor || '#94a3b8';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x, w.y, w.w, w.h);

      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(w.x + 2, w.y + 2, Math.max(0, w.w - 4), 3);
    }
  }

  // Framed Glass Windows on Exterior Walls (Intact vs Shattered state)
  if (b.windows) {
    for (const win of b.windows) {
      ctx.save();
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(win.x - 1, win.y - 1, win.w + 2, win.h + 2);
      if (!win.shattered) {
        ctx.fillStyle = 'rgba(125, 211, 252, 0.78)';
        ctx.fillRect(win.x + 1, win.y + 1, Math.max(2, win.w - 2), Math.max(2, win.h - 2));
        ctx.strokeStyle = 'rgba(255,255,255,0.82)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(win.x + 2, win.y + 2);
        ctx.lineTo(win.x + win.w - 2, win.y + win.h - 2);
        ctx.stroke();
      } else {
        // Shattered window frame with jagged glass shards
        ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
        ctx.fillRect(win.x + 1, win.y + 1, Math.max(2, win.w - 2), Math.max(2, win.h - 2));
        ctx.fillStyle = 'rgba(186, 230, 253, 0.85)';
        ctx.beginPath();
        ctx.arc(win.x + win.w * 0.25, win.y + win.h * 0.35, 2.2, 0, Math.PI * 2);
        ctx.arc(win.x + win.w * 0.75, win.y + win.h * 0.65, 2.0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Doors (Closed, Open, or Destroyed splinters)
  if (b.doors) {
    for (const d of b.doors) {
      ctx.save();
      if (d.destroyed) {
        // Broken wood splinters on threshold
        ctx.fillStyle = 'rgba(120, 53, 15, 0.55)';
        ctx.fillRect(d.x + 2, d.y + 2, Math.max(4, d.w * 0.35), Math.max(4, d.h * 0.35));
        ctx.fillRect(d.x + d.w * 0.55, d.y + d.h * 0.45, Math.max(4, d.w * 0.3), Math.max(4, d.h * 0.3));
      } else {
        ctx.fillStyle = d.open ? 'rgba(120, 53, 15, 0.32)' : '#78350f';
        ctx.fillRect(d.x, d.y, d.w, d.h);
        ctx.strokeStyle = '#451a03';
        ctx.lineWidth = 1.8;
        ctx.strokeRect(d.x, d.y, d.w, d.h);
        // Brass doorknob
        if (!d.open) {
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(d.x + d.w * 0.8, d.y + d.h * 0.5, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  ctx.restore();
}

export function drawDetailedFurniture(ctx, f) {
  if (f.destroyed) {
    // Subtle broken debris remnants on floor
    ctx.save();
    ctx.fillStyle = 'rgba(69, 26, 3, 0.38)';
    ctx.fillRect(f.x + f.w * 0.2, f.y + f.h * 0.25, f.w * 0.28, f.h * 0.22);
    ctx.fillRect(f.x + f.w * 0.52, f.y + f.h * 0.48, f.w * 0.24, f.h * 0.2);
    ctx.restore();
    return;
  }

  const x = f.x;
  const y = f.y;
  const w = f.w;
  const h = f.h;
  const type = f.kind || f.type;

  ctx.save();

  // Slightly shrink damaged furniture when taking hits
  if (typeof f.hp === 'number' && typeof f.maxHp === 'number' && f.hp < f.maxHp && f.maxHp > 0) {
    const scale = 0.88 + 0.12 * clamp(f.hp / f.maxHp, 0, 1);
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }

  if (type === 'rug') {
    ctx.fillStyle = f.color || '#7c2d12';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 4, y + 4, Math.max(2, w - 8), Math.max(2, h - 8));
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.strokeRect(x + 8, y + 8, Math.max(2, w - 16), Math.max(2, h - 16));
    ctx.restore();
    return;
  }

  // Drop shadow for 3D depth
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.fillRect(x + 3, y + 3, w, h);

  switch (type) {
    case 'bed':
    case 'medbed': {
      ctx.fillStyle = type === 'medbed' ? '#475569' : '#451a03';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x + 3, y + 4, w - 6, h - 8);
      ctx.fillStyle = f.color || (type === 'medbed' ? '#0284c7' : '#be123c');
      ctx.fillRect(x + 3, y + h * 0.36, w - 6, h * 0.58);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(x + 3, y + h * 0.32, w - 6, 5);
      // Pillows
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      if (w > 46) {
        ctx.fillRect(x + 6, y + 6, w / 2 - 8, 10);
        ctx.strokeRect(x + 6, y + 6, w / 2 - 8, 10);
        ctx.fillRect(x + w / 2 + 2, y + 6, w / 2 - 8, 10);
        ctx.strokeRect(x + w / 2 + 2, y + 6, w / 2 - 8, 10);
      } else {
        ctx.fillRect(x + 6, y + 6, w - 12, 10);
        ctx.strokeRect(x + 6, y + 6, w - 12, 10);
      }
      break;
    }

    case 'couch': {
      ctx.fillStyle = f.color || '#7f1d1d';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.26)';
      ctx.fillRect(x, y, w, 6);
      ctx.fillRect(x, y, 6, h);
      ctx.fillRect(x + w - 6, y, 6, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.42)';
      ctx.lineWidth = 1.4;
      const cw = (w - 12) / 3;
      for (let i = 0; i < 3; i++) {
        ctx.strokeRect(x + 6 + i * cw, y + 6, cw, h - 8);
      }
      break;
    }

    case 'dining_table':
    case 'coffee_table': {
      if (type === 'dining_table') {
        ctx.fillStyle = '#451a03';
        ctx.fillRect(x + 8, y - 5, 14, 6);
        ctx.fillRect(x + w - 22, y - 5, 14, 6);
        ctx.fillRect(x + 8, y + h - 1, 14, 6);
        ctx.fillRect(x + w - 22, y + h - 1, 14, 6);
      }
      ctx.fillStyle = f.color || '#78350f';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#f1f5f9';
      ctx.beginPath();
      ctx.arc(x + w * 0.28, y + h * 0.5, 4.5, 0, Math.PI * 2);
      ctx.arc(x + w * 0.72, y + h * 0.5, 4.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'stove': {
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
      const burners = [
        [x + w * 0.28, y + h * 0.3],
        [x + w * 0.72, y + h * 0.3],
        [x + w * 0.28, y + h * 0.72],
        [x + w * 0.72, y + h * 0.72],
      ];
      burners.forEach(([bx, by], i) => {
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fill();
        if (i === 0) {
          ctx.fillStyle = '#1e293b';
          ctx.beginPath();
          ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(bx + 5, by);
          ctx.lineTo(bx + 10, by + 3);
          ctx.stroke();
        }
      });
      break;
    }

    case 'fridge': {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(x + 2, y + h - 5, w - 4, 3);
      ctx.fillStyle = '#334155';
      ctx.fillRect(x + w - 6, y + h - 8, 3, 5);
      break;
    }

    case 'sink':
    case 'washbasin': {
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#475569';
      ctx.fillRect(x + w / 2 - 2, y + 1, 4, 5);
      break;
    }

    case 'toilet': {
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.fillRect(x + 2, y, w - 4, 8);
      ctx.strokeRect(x + 2, y, w - 4, 8);
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h * 0.62, w * 0.42, h * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#bae6fd';
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h * 0.64, w * 0.24, h * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'bathtub': {
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#e0f2fe';
      ctx.fillRect(x + 5, y + 5, w - 10, h - 10);
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.arc(x + w - 9, y + h / 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'desk':
    case 'tv_stand': {
      ctx.fillStyle = f.color || '#334155';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#090d16';
      ctx.fillRect(x + w * 0.22, y + 3, w * 0.56, 5);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(x + w * 0.25, y + 4, w * 0.5, 2);
      if (type === 'desk') {
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(x + w * 0.3, y + h - 8, w * 0.4, 5);
      }
      break;
    }

    case 'bookshelf':
    case 'wardrobe':
    case 'nightstand':
    case 'counter': {
      ctx.fillStyle = f.color || '#5c3a21';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#2e1d10';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
      if (type === 'bookshelf') {
        const bookColors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'];
        for (let by = y + 3; by < y + h - 5; by += 6) {
          ctx.fillStyle = bookColors[Math.floor(by) % bookColors.length];
          ctx.fillRect(x + 3, by, w - 6, 4);
        }
      }
      break;
    }

    case 'gun_rack':
    case 'locker': {
      ctx.fillStyle = f.color || '#1e293b';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.8;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#64748b';
      for (let gx = x + 5; gx < x + w - 4; gx += 8) {
        ctx.fillRect(gx, y + 3, 3, h - 6);
      }
      break;
    }

    case 'generator': {
      ctx.fillStyle = '#b45309';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#334155';
      ctx.fillRect(x + 5, y + 5, w - 10, h - 10);
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(x + w - 7, y + 7, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'barrel_explosive': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const r = Math.min(w, h) / 2;
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#450a0a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'plant': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const r = Math.min(w, h) / 2;
      ctx.fillStyle = '#9a3412';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#15803d';
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * (r * 0.45), cy + Math.sin(a) * (r * 0.45), r * 0.48, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    default: {
      ctx.fillStyle = f.color || '#64748b';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
    }
  }

  ctx.restore();
}

function renderBuildingRoof(ctx, b, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = b.roofColor || '#7f1d1d';
  ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);

  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(b.x, b.y, b.w, b.h * 0.5);

  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(b.x - 2, b.y + b.h * 0.5);
  ctx.lineTo(b.x + b.w + 2, b.y + b.h * 0.5);
  ctx.stroke();
  ctx.restore();
}

function renderVehicle(ctx, veh, player) {
  ctx.save();
  ctx.translate(veh.x, veh.y);

  const w = veh.w || 74;
  const h = veh.h || 36;
  const isDestroyed = Boolean(veh.destroyed || (typeof veh.hp === 'number' && veh.hp <= 0));

  ctx.save();
  ctx.rotate(veh.angle || 0);

  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(-w / 2 + 4, -h / 2 + 4, w, h);

  ctx.fillStyle = '#090d16';
  ctx.fillRect(-w * 0.36, -h / 2 - 3, 14, 4);
  ctx.fillRect(w * 0.2, -h / 2 - 3, 14, 4);
  ctx.fillRect(-w * 0.36, h / 2 - 1, 14, 4);
  ctx.fillRect(w * 0.2, h / 2 - 1, 14, 4);

  ctx.fillStyle = isDestroyed ? '#1c1917' : veh.color || '#2563eb';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = isDestroyed ? '#44403c' : '#0f172a';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = isDestroyed ? '#090d16' : '#1e293b';
  ctx.fillRect(w * 0.08, -h * 0.38, w * 0.18, h * 0.76);
  ctx.fillRect(-w * 0.34, -h * 0.36, w * 0.14, h * 0.72);

  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(-w * 0.18, -h * 0.38, w * 0.24, h * 0.76);

  if (!isDestroyed) {
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(w / 2 - 3, -h * 0.38, 3, 6);
    ctx.fillRect(w / 2 - 3, h * 0.38 - 6, 3, 6);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-w / 2, -h * 0.38, 3, 6);
    ctx.fillRect(-w / 2, h * 0.38 - 6, 3, 6);
  }
  ctx.restore();

  if (!isDestroyed && veh.driveable) {
    const maxHp = veh.maxHp || 420;
    if (veh.hp < maxHp) {
      const pct = clamp(veh.hp / maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(-26, -h * 0.75 - 8, 52, 4);
      ctx.fillStyle = pct > 0.35 ? '#22c55e' : '#ef4444';
      ctx.fillRect(-26, -h * 0.75 - 8, 52 * pct, 4);
    }

    if (player && !player.drivingVehicleId && distSq(player.x, player.y, veh.x, veh.y) < 115 * 115) {
      ctx.font = 'bold 10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fde047';
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 2.5;
      const prompt = `[F] CONDUCIR ${(veh.name || 'VEHÍCULO').toUpperCase()}`;
      ctx.strokeText(prompt, 0, -h * 0.75 - 14);
      ctx.fillText(prompt, 0, -h * 0.75 - 14);
    }
  }

  ctx.restore();
}

function renderStreetlight(ctx, lamp) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(lamp.x + 3, lamp.y + 3, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.arc(lamp.x, lamp.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.arc(lamp.x, lamp.y, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderCrate(ctx, c) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.fillRect(c.x + 4, c.y + 4, c.w, c.h);

  const isMetal = c.type === 'metal' || c.tier >= 3;
  ctx.fillStyle = isMetal ? '#365314' : '#92400e';
  ctx.fillRect(c.x, c.y, c.w, c.h);
  ctx.strokeStyle = isMetal ? '#1a2e05' : '#451a03';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(c.x, c.y, c.w, c.h);

  ctx.beginPath();
  ctx.moveTo(c.x + 5, c.y + 5);
  ctx.lineTo(c.x + c.w - 5, c.y + c.h - 5);
  ctx.moveTo(c.x + c.w - 5, c.y + 5);
  ctx.lineTo(c.x + 5, c.y + c.h - 5);
  ctx.stroke();

  if (isMetal) {
    ctx.fillStyle = '#eab308';
    ctx.fillRect(c.x + c.w * 0.5 - 6, c.y + c.h * 0.5 - 6, 12, 12);
  }
  ctx.restore();
}

function renderVendor(ctx, v, player) {
  const isNear = Boolean(player && distSq(player.x, player.y, v.x, v.y) <= 210 * 210);
  ctx.save();
  ctx.strokeStyle = isNear ? 'rgba(250, 204, 21, 0.72)' : 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = isNear ? 2.8 : 2;
  ctx.beginPath();
  ctx.arc(v.x, v.y, 68, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(v.x - 36, v.y - 22, 72, 44);
  ctx.strokeStyle = isNear ? '#fde047' : '#38bdf8';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(v.x - 36, v.y - 22, 72, 44);

  ctx.fillStyle = '#0284c7';
  ctx.fillRect(v.x - 30, v.y - 16, 60, 14);

  ctx.fillStyle = '#e0f2fe';
  ctx.font = 'bold 10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(v.name || 'TIENDA TÁCTICA', v.x, v.y - 28);

  if (isNear) {
    ctx.fillStyle = '#fde047';
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 2.5;
    ctx.strokeText('🛒 [B] / [F] ABRIR TIENDA', v.x, v.y + 38);
    ctx.fillText('🛒 [B] / [F] ABRIR TIENDA', v.x, v.y + 38);
  }
  ctx.restore();
}

function renderBunkerEntrance(ctx, st, player) {
  ctx.save();
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(st.x, st.y, st.w, st.h);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 3;
  ctx.strokeRect(st.x, st.y, st.w, st.h);

  ctx.fillStyle = '#0f172a';
  for (let y = st.y + 12; y < st.y + st.h - 10; y += 14) {
    ctx.fillRect(st.x + 12, y, st.w - 24, 8);
  }

  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(st.name || 'BÚNKER', st.x + st.w * 0.5, st.y - 8);
  if (distSq(player.x, player.y, st.x + st.w * 0.5, st.y + st.h * 0.5) < 110 * 110) {
    ctx.fillStyle = '#4ade80';
    ctx.fillText('[F] ENTRAR BÚNKER', st.x + st.w * 0.5, st.y + st.h + 15);
  }
  ctx.restore();
}

// ============================================================================
// DETAILED VECTOR FLOOR LOOT
// ============================================================================
function renderDetailedFloorLoot(ctx, item, player) {
  ctx.save();
  ctx.translate(item.x, item.y);

  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fill();

  let ringColor = '#38bdf8';
  let label = '';

  if (item.kind === 'weapon') {
    const w = WEAPONS[item.weaponId] || WEAPONS.m416;
    ringColor = w.tier >= 3 ? '#f59e0b' : '#38bdf8';
    label = w.name;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.rotate(-0.32);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-13, -2.5, 7, 5);
    ctx.fillStyle = w.color || '#64748b';
    ctx.fillRect(-6, -3.5, 12, 7);
    ctx.fillStyle = '#090d16';
    ctx.fillRect(-1, 3, 4, 5);
    ctx.fillRect(6, -1.5, 10, 3);
    ctx.rotate(0.32);
  } else if (item.kind === 'ammo') {
    ringColor = AMMO_COLORS[item.ammoType] || '#eab308';
    label = `${item.ammoType} x${item.amount}`;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = ringColor;
    ctx.fillRect(-11, -8, 22, 16);
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-11, -8, 22, 16);
    ctx.fillStyle = '#090d16';
    ctx.font = 'bold 7.5px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(item.ammoType, 0, 3);
  } else if (item.kind === 'med') {
    const med = MEDICAL_ITEMS[item.medId] || { name: 'Botiquín', color: '#22c55e' };
    ringColor = '#22c55e';
    label = med.name;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    if (item.medId === 'bandage') {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-9, -6, 18, 12);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-2, -4, 4, 8);
      ctx.fillRect(-4, -2, 8, 4);
    } else if (item.medId === 'medkit') {
      ctx.fillStyle = '#16a34a';
      ctx.fillRect(-11, -8, 22, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-2.5, -5, 5, 10);
      ctx.fillRect(-5, -2.5, 10, 5);
    } else if (item.medId === 'soda') {
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(-6, -9, 12, 18);
      ctx.fillStyle = '#e0f2fe';
      ctx.fillRect(-6, -2, 12, 4);
    } else {
      ctx.fillStyle = '#ea580c';
      ctx.fillRect(-6, -7, 12, 14);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-7, -10, 14, 4);
    }
  } else if (item.kind === 'gear') {
    ringColor = '#a855f7';
    label = `${item.gearType.toUpperCase()} Nv.${item.level}`;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
  } else if (item.kind === 'scope') {
    ringColor = '#fde047';
    label = `Mira ${item.scope}x`;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.stroke();
  } else if (item.kind === 'melee') {
    const m = MELEE_WEAPONS[item.meleeId] || MELEE_WEAPONS.machete;
    ringColor = '#f43f5e';
    label = m.name;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.rotate(-0.45);
    drawVectorMeleeWeapon(ctx, m.id, 0, 0, 0.9);
    ctx.rotate(0.45);
  } else if (item.kind === 'throwable') {
    const th = THROWABLES[item.throwableId] || THROWABLES.frag;
    ringColor = '#10b981';
    label = th.name;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.fillStyle = th.color || '#10b981';
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  if (player && distSq(player.x, player.y, item.x, item.y) < 92 * 92 && label) {
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 9.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`[F] ${label}`, 0, -23);
  }

  ctx.restore();
}

// Helper to draw vector melee weapons both on floor loot and in soldier's right hand
function drawVectorMeleeWeapon(ctx, meleeId, originX = 0, originY = 0, scale = 1.0) {
  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(scale, scale);

  if (meleeId === 'fireAxe') {
    // Wooden handle + red fire-axe head with silver blade edge
    ctx.fillStyle = '#78350f';
    ctx.fillRect(-2, -2, 22, 3.6);
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(14, -8, 6, 13);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(18, -8, 3, 13);
  } else if (meleeId === 'katana') {
    // Wrapped hilt + brass tsuba guard + long curved steel blade
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-4, -1.8, 8, 3.6);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(4, -4, 2.2, 8);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(6, -1.5, 24, 3);
  } else if (meleeId === 'pan') {
    // Cast-iron armoured frying pan
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-2, -1.8, 10, 3.6);
    ctx.beginPath();
    ctx.arc(14, 0, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.8;
    ctx.stroke();
  } else if (meleeId === 'nailBat') {
    // Wooden baseball bat with protruding steel nails
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    ctx.moveTo(-2, -1.6);
    ctx.lineTo(20, -3.5);
    ctx.lineTo(20, 3.5);
    ctx.lineTo(-2, 1.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(13, -6, 1.6, 12);
    ctx.fillRect(17, -6, 1.6, 12);
  } else if (meleeId === 'karambit') {
    // Finger ring + curved claw blade
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(3, -1.5);
    ctx.quadraticCurveTo(11, -5, 14, 3);
    ctx.quadraticCurveTo(9, 1, 3, 1.5);
    ctx.closePath();
    ctx.fill();
  } else if (meleeId === 'machete') {
    // Dark grip + broad cleaver/machete steel blade
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-2, -2, 6, 4);
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(4, -2.2);
    ctx.lineTo(21, -3.4);
    ctx.lineTo(23, 0.5);
    ctx.lineTo(4, 2.2);
    ctx.closePath();
    ctx.fill();
  } else {
    // Military bayonet / combat knife
    ctx.fillStyle = '#365314';
    ctx.fillRect(-2, -2, 6, 4);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(4, -3.5, 2, 7);
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(6, -2);
    ctx.lineTo(17, 0);
    ctx.lineTo(6, 2);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

// ============================================================================
// ANATOMICAL MILITARY SOLDIER (0.62x Proportional Guns + Slot 3 Fists/Melee + Slot 4 Throwables)
// ============================================================================
function renderSoldier(ctx, unit, isLocal, isRemote = false) {
  ctx.save();
  ctx.translate(unit.x, unit.y);

  if (unit.downed) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.stroke();

    if (unit.reviveProgress > 0) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * unit.reviveProgress);
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.rotate(unit.angle || 0);

  const activeSlot = unit.activeSlot || 1;
  const wId = isLocal
    ? unit.slots?.[activeSlot === 2 ? 2 : 1]?.weaponId || 'm416'
    : unit.weaponId || 'm416';
  const wep = WEAPONS[wId] || WEAPONS.m416;
  const isReloading = (unit.reloading || 0) > 0 && (activeSlot === 1 || activeSlot === 2);
  const reloadAnimOffset = isReloading ? Math.sin(performance.now() * 0.016) * 4.0 : 0;

  const swingTimer = unit.meleeSwingTimer || 0;
  const swingPhase = swingTimer > 0 ? Math.sin((1 - swingTimer / 0.24) * Math.PI) : 0;

  // 1. Tactical Multi-Pocket Backpack
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#090d16';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(-18, -10.5, 9.5, 21, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#334155';
  ctx.fillRect(-16, -7.5, 4.5, 6.5);
  ctx.fillRect(-16, 1, 4.5, 6.5);

  // 2. Anatomical Military Torso & Broad Shoulders
  const bodyColor = isLocal ? '#eab308' : isRemote ? '#38bdf8' : unit.color || '#22c55e';
  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = '#090d16';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(-2, 0, 11.5, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 3. Tactical Plate Carrier Vest + Magazine Pouches
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.roundRect(-7.5, -10.5, 12.5, 21, 4);
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = '#475569';
  ctx.fillRect(0, -7.5, 3.8, 4.2);
  ctx.fillRect(0, -2.0, 3.8, 4.2);
  ctx.fillRect(0, 3.5, 3.8, 4.2);

  // 4. Slot-Aware Arms & Equipped Item (Slot 1/2 Firearm vs Slot 3 Fists/Melee vs Slot 4 Throwable)
  if (activeSlot === 3) {
    // SLOT 3: TACTICAL GLOVED FISTS OR MELEE WEAPON (NO FIREARM DRAWN!)
    const meleeId = unit.meleeId || 'fists';
    const punchExtend = swingPhase * 9;
    const rightHandX = 14 + punchExtend;
    const rightHandY = 6 - swingPhase * 5;
    const leftHandX = 13;
    const leftHandY = -7;

    // Right & Left Arms
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 6.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 11.5);
    ctx.lineTo(8, 9.5);
    ctx.lineTo(rightHandX, rightHandY);
    ctx.moveTo(0, -11.5);
    ctx.lineTo(8, -9.5);
    ctx.lineTo(leftHandX, leftHandY);
    ctx.stroke();

    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(0, 11.5);
    ctx.lineTo(8, 9.5);
    ctx.lineTo(rightHandX, rightHandY);
    ctx.moveTo(0, -11.5);
    ctx.lineTo(8, -9.5);
    ctx.lineTo(leftHandX, leftHandY);
    ctx.stroke();

    // Tactical Knuckle Gloves
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(rightHandX, rightHandY, 3.8, 0, Math.PI * 2);
    ctx.arc(leftHandX, leftHandY, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // If equipped with a melee blade/blunt weapon, draw it in the right hand with swing arc
    if (meleeId !== 'fists') {
      ctx.save();
      ctx.translate(rightHandX, rightHandY);
      ctx.rotate(-0.35 + swingPhase * 1.15);
      drawVectorMeleeWeapon(ctx, meleeId, 0, 0, 1.0);
      ctx.restore();
    }
  } else if (activeSlot === 4) {
    // SLOT 4: THROWABLE / DEPLOYABLE IN RIGHT HAND (NO FIREARM DRAWN!)
    const thId = unit.throwableId || 'frag';
    const th = THROWABLES[thId] || THROWABLES.frag;
    const rightHandX = 14;
    const rightHandY = 6.5;
    const leftHandX = 12;
    const leftHandY = -7.5;

    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 6.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 11.5);
    ctx.lineTo(9, 9.5);
    ctx.lineTo(rightHandX, rightHandY);
    ctx.moveTo(0, -11.5);
    ctx.lineTo(8, -9.5);
    ctx.lineTo(leftHandX, leftHandY);
    ctx.stroke();

    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(0, 11.5);
    ctx.lineTo(9, 9.5);
    ctx.lineTo(rightHandX, rightHandY);
    ctx.moveTo(0, -11.5);
    ctx.lineTo(8, -9.5);
    ctx.lineTo(leftHandX, leftHandY);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(rightHandX, rightHandY, 3.6, 0, Math.PI * 2);
    ctx.arc(leftHandX, leftHandY, 3.6, 0, Math.PI * 2);
    ctx.fill();

    // Draw grenade / turret kit in right hand
    ctx.fillStyle = th.color || '#15803d';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(rightHandX + 3, rightHandY - 1, 4.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    // SLOTS 1 & 2: PROPORTIONAL 0.62x FIREARM IN HANDS
    const gunLen = wep.length || 24;
    const gunWid = wep.width || 5;
    const rightHandX = 12.5;
    const rightHandY = 2.4;
    const leftHandX = isReloading ? 11 + reloadAnimOffset : Math.min(20, 10 + gunLen * 0.36);
    const leftHandY = isReloading ? -2.5 + reloadAnimOffset * 0.4 : -1.0;

    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 6.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 11.5);
    ctx.lineTo(8.5, 8.2);
    ctx.lineTo(rightHandX, rightHandY);
    ctx.moveTo(0, -11.5);
    ctx.lineTo(9.5, -8.2);
    ctx.lineTo(leftHandX, leftHandY);
    ctx.stroke();

    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(0, 11.5);
    ctx.lineTo(8.5, 8.2);
    ctx.lineTo(rightHandX, rightHandY);
    ctx.moveTo(0, -11.5);
    ctx.lineTo(9.5, -8.2);
    ctx.lineTo(leftHandX, leftHandY);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(rightHandX, rightHandY, 3.3, 0, Math.PI * 2);
    ctx.arc(leftHandX, leftHandY, 3.3, 0, Math.PI * 2);
    ctx.fill();

    // Proportional 0.62x Vector Weapon (Tilts during reload)
    ctx.save();
    if (isReloading) {
      ctx.rotate(-0.26);
    }
    // Stock
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(6, -2.0, 5.5, 4.0);
    // Receiver body
    ctx.fillStyle = wep.color || '#334155';
    ctx.fillRect(10.5, -gunWid * 0.5, Math.max(9, gunLen * 0.56), gunWid);
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(10.5, -gunWid * 0.5, Math.max(9, gunLen * 0.56), gunWid);
    // Rifled barrel & muzzle brake
    ctx.fillStyle = '#090d16';
    ctx.fillRect(10.5 + gunLen * 0.56, -1.3, gunLen * 0.44, 2.6);
    ctx.restore();
  }

  // 6. Ballistic Helmet with Visor
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#090d16';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 10.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.arc(-1, 0, 8.0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#38bdf8';
  ctx.strokeStyle = '#090d16';
  ctx.lineWidth = 1.2;
  ctx.fillRect(5.8, -6.2, 4.0, 12.4);
  ctx.strokeRect(5.8, -6.2, 4.0, 12.4);

  ctx.restore();

  // 7. Visual Reload or Medical Usage Progress Ring Above Soldier
  if (unit.activeHeal && unit.activeHeal.total > 0) {
    const progress = clamp(1 - unit.activeHeal.timer / unit.activeHeal.total, 0, 1);
    const labelText = `${unit.activeHeal.label || 'CURANDO'} (${Math.max(0, unit.activeHeal.timer).toFixed(1)}s)`;

    ctx.save();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.arc(0, -36, 10.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(0, -36, 10.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();

    ctx.font = 'bold 8.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#4ade80';
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 2.5;
    ctx.strokeText(labelText, 0, -51);
    ctx.fillText(labelText, 0, -51);
    ctx.restore();
  } else if (isReloading) {
    const total = unit.reloadTotal || wep.reloadTime || 1.8;
    const progress = clamp(1 - unit.reloading / total, 0, 1);

    ctx.save();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.arc(0, -36, 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(0, -36, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();

    ctx.font = 'bold 8.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 2.5;
    ctx.strokeText('RECARGANDO...', 0, -50);
    ctx.fillText('RECARGANDO...', 0, -50);
    ctx.restore();
  } else if (!isLocal && unit.name) {
    ctx.font = 'bold 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 2.5;
    ctx.strokeText(unit.name, 0, -26);
    ctx.fillText(unit.name, 0, -26);

    const hpPct = clamp((unit.hp || 0) / (unit.maxHp || 100), 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(-16, -22, 32, 4);
    ctx.fillStyle = hpPct > 0.4 ? '#22c55e' : '#ef4444';
    ctx.fillRect(-16, -22, 32 * hpPct, 4);
  }

  ctx.restore();
}

// ============================================================================
// ANATOMICAL ZOMBIE (Torn Torso, Asymmetric Shoulders, Animated Claws)
// ============================================================================
function renderZombie(ctx, z) {
  ctx.save();
  ctx.translate(z.x, z.y);

  ctx.save();
  ctx.rotate(z.angle || 0);

  const r = z.r || 18;
  const swipe = Math.sin(performance.now() * 0.009 + z.x * 0.05) * 3.2;
  const skinColor = z.skin || '#65a30d';

  // 1. Torn Tattered Shoulders & Torso
  ctx.fillStyle = z.outfit || '#1e293b';
  ctx.strokeStyle = '#090d16';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(-2, 0, r * 0.72, r * 0.98, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Necrotic blood stain on shoulder
  ctx.fillStyle = '#7f1d1d';
  ctx.beginPath();
  ctx.arc(-3, 5, r * 0.42, 0, Math.PI * 2);
  ctx.fill();

  // 2. Articulated Extended Zombie Arms & Hooked Claws
  ctx.strokeStyle = '#090d16';
  ctx.lineWidth = 6.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.75);
  ctx.lineTo(r * 0.75, -r * 0.62 + swipe * 0.5);
  ctx.lineTo(r * 1.28 + swipe, -r * 0.38);
  ctx.moveTo(0, r * 0.75);
  ctx.lineTo(r * 0.75, r * 0.62 - swipe * 0.5);
  ctx.lineTo(r * 1.28 - swipe, r * 0.38);
  ctx.stroke();

  ctx.strokeStyle = skinColor;
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.75);
  ctx.lineTo(r * 0.75, -r * 0.62 + swipe * 0.5);
  ctx.lineTo(r * 1.28 + swipe, -r * 0.38);
  ctx.moveTo(0, r * 0.75);
  ctx.lineTo(r * 0.75, r * 0.62 - swipe * 0.5);
  ctx.lineTo(r * 1.28 - swipe, r * 0.38);
  ctx.stroke();

  ctx.fillStyle = '#991b1b';
  ctx.beginPath();
  ctx.arc(r * 1.28 + swipe, -r * 0.38, 3.2, 0, Math.PI * 2);
  ctx.arc(r * 1.28 - swipe, r * 0.38, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // 3. Zombie Head & Glowing Infected Eyes
  ctx.fillStyle = skinColor;
  ctx.strokeStyle = '#090d16';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(1, 0, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = z.isBoss || z.explodes ? '#fde047' : '#ef4444';
  ctx.beginPath();
  ctx.arc(r * 0.38, -3.5, 2.2, 0, Math.PI * 2);
  ctx.arc(r * 0.38, 3.5, 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  if (z.hp < z.maxHp || z.isBoss || z.isVip) {
    const wBar = z.isBoss ? 46 : 26;
    const pct = clamp(z.hp / z.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(-wBar / 2, -r - 11, wBar, 4);
    ctx.fillStyle = z.isVip ? '#fde047' : z.isBoss ? '#a855f7' : '#ef4444';
    ctx.fillRect(-wBar / 2, -r - 11, wBar * pct, 4);
  }

  ctx.restore();
}

// ============================================================================
// FACETED POLYGON STONES & MULTI-LOBED ORGANIC TREES
// ============================================================================
function renderStone(ctx, s, biome) {
  ctx.save();
  ctx.translate(s.x, s.y);

  const maxHp = s.maxHp || 220;
  const isDamaged = typeof s.hp === 'number' && s.hp < maxHp;
  if (isDamaged) {
    const scale = 0.85 + 0.15 * clamp(s.hp / maxHp, 0, 1);
    ctx.scale(scale, scale);
  }

  const verts = s.vertices;
  if (verts && verts.length >= 5) {
    // 1. Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    verts.forEach((v, i) => (i === 0 ? ctx.moveTo(v.dx + 4, v.dy + 4) : ctx.lineTo(v.dx + 4, v.dy + 4)));
    ctx.closePath();
    ctx.fill();

    // 2. Dark outer rock base
    ctx.fillStyle = biome.stoneColor || '#64748b';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    verts.forEach((v, i) => (i === 0 ? ctx.moveTo(v.dx, v.dy) : ctx.lineTo(v.dx, v.dy)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 3. Mid-tone inner facet
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    verts.forEach((v, i) =>
      i === 0 ? ctx.moveTo(v.dx * 0.7 - 2, v.dy * 0.7 - 2) : ctx.lineTo(v.dx * 0.7 - 2, v.dy * 0.7 - 2)
    );
    ctx.closePath();
    ctx.fill();

    // 4. Upper ridge highlight
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    verts.slice(0, 5).forEach((v, i) =>
      i === 0 ? ctx.moveTo(v.dx * 0.42 - 3, v.dy * 0.42 - 3) : ctx.lineTo(v.dx * 0.42 - 3, v.dy * 0.42 - 3)
    );
    ctx.closePath();
    ctx.fill();

    if (s.mossy) {
      ctx.fillStyle = 'rgba(34, 197, 94, 0.32)';
      ctx.beginPath();
      ctx.arc(-s.r * 0.25, s.r * 0.2, s.r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = biome.stoneColor || '#64748b';
    ctx.beginPath();
    ctx.arc(0, 0, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (isDamaged) {
    const pct = clamp(s.hp / maxHp, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(-16, -s.r - 10, 32, 4);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(-16, -s.r - 10, 32 * pct, 4);
  }

  ctx.restore();
}

function renderTree(ctx, t, biome, alpha) {
  ctx.save();
  ctx.translate(t.x, t.y);

  const maxHp = t.maxHp || 140;
  const isDamaged = typeof t.hp === 'number' && t.hp < maxHp;
  if (isDamaged) {
    const scale = 0.86 + 0.14 * clamp(t.hp / maxHp, 0, 1);
    ctx.scale(scale, scale);
  }

  const r = t.crownR || 64;

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.arc(7, 7, r * 0.9, 0, Math.PI * 2);
  ctx.fill();

  // Solid wooden trunk
  ctx.fillStyle = '#451a03';
  ctx.strokeStyle = '#290f02';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, t.trunkR || 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Multi-lobed organic canopy
  ctx.globalAlpha = alpha;
  const lobes = t.lobes || [];
  ctx.fillStyle = biome.treeCrown || '#264419';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  for (const l of lobes) {
    ctx.beginPath();
    ctx.arc(l.dx, l.dy, l.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = biome.treeHighlight || '#335922';
  for (const l of lobes) {
    ctx.beginPath();
    ctx.arc(l.dx * 0.72, l.dy * 0.72, l.r * 0.76, 0, Math.PI * 2);
    ctx.fill();
  }

  const grad = ctx.createRadialGradient(-r * 0.12, -r * 0.12, r * 0.05, 0, 0, r * 0.55);
  grad.addColorStop(0, biome.treeHighlight || '#335922');
  grad.addColorStop(1, biome.treeCrown || '#264419');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(-r * 0.05, -r * 0.05, r * 0.48, 0, Math.PI * 2);
  ctx.fill();

  if (isDamaged) {
    ctx.globalAlpha = 1;
    const pct = clamp(t.hp / maxHp, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(-16, -24, 32, 4);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(-16, -24, 32 * pct, 4);
  }

  ctx.restore();
}

function renderTurret(ctx, t) {
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 16, Math.sin(a) * 16);
    ctx.stroke();
  }
  ctx.rotate(t.angle || 0);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(6, -3, 18, 6);
  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderCombatDrone(ctx, dr) {
  ctx.save();
  ctx.translate(dr.x, dr.y);
  ctx.fillStyle = '#0284c7';
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e0f2fe';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

// ============================================================================
// CONTINUOUS SMOOTHSTEP SOLAR CYCLE & RADIAL FLASHLIGHTS
// ============================================================================
function renderEnvironmentAndWeather(ctx, engine, width, height, zoom) {
  const { player, allies, world, camera } = engine;
  const tod = engine.timeOfDay ?? 0.22;

  // 1. Continuous Golden/Orange Sunset Tint (tod 0.32 -> 0.47 -> 0.62)
  let sunsetAlpha = 0;
  if (tod >= 0.30 && tod <= 0.64) {
    if (tod < 0.47) {
      sunsetAlpha = smoothstep(0.30, 0.47, tod) * 0.26;
    } else {
      sunsetAlpha = (1.0 - smoothstep(0.47, 0.64, tod)) * 0.26;
    }
  }
  if (sunsetAlpha > 0.002 && !player.inBunker) {
    ctx.save();
    ctx.fillStyle = `rgba(249, 115, 22, ${sunsetAlpha.toFixed(4)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  // 2. Continuous Smoothstep Night Darkness (rises 0.48 -> 0.68, falls 0.84 -> 1.0)
  let nightAlpha = 0;
  if (tod >= 0.46 && tod < 0.68) {
    nightAlpha = smoothstep(0.46, 0.68, tod) * 0.74;
  } else if (tod >= 0.68 && tod < 0.84) {
    nightAlpha = 0.74;
  } else if (tod >= 0.84) {
    nightAlpha = (1.0 - smoothstep(0.84, 1.0, tod)) * 0.74;
  }

  if (nightAlpha > 0.005 && !player.inBunker) {
    ctx.save();
    ctx.fillStyle = `rgba(4, 9, 24, ${nightAlpha.toFixed(4)})`;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'lighter';
    const lightIntensity = clamp(nightAlpha / 0.74, 0, 1);

    const drawFlashlight = (unit, coneLen, radius) => {
      if (!unit || unit.downed) return;
      const sx = width / 2 + (unit.x - camera.x) * zoom;
      const sy = height / 2 + (unit.y - camera.y) * zoom;

      const ambGrad = ctx.createRadialGradient(sx, sy, 4, sx, sy, radius * zoom);
      ambGrad.addColorStop(0, `rgba(254, 243, 199, ${(0.22 * lightIntensity).toFixed(3)})`);
      ambGrad.addColorStop(1, 'rgba(254, 243, 199, 0)');
      ctx.fillStyle = ambGrad;
      ctx.beginPath();
      ctx.arc(sx, sy, radius * zoom, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(unit.angle || 0);
      const len = coneLen * zoom;
      const coneGrad = ctx.createRadialGradient(10, 0, 4, len * 0.55, 0, len);
      coneGrad.addColorStop(0, `rgba(254, 249, 195, ${(0.34 * lightIntensity).toFixed(3)})`);
      coneGrad.addColorStop(0.6, `rgba(253, 224, 71, ${(0.16 * lightIntensity).toFixed(3)})`);
      coneGrad.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.arc(0, 0, len, -0.42, 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    drawFlashlight(player, 340, 95);
    for (const bot of allies) {
      drawFlashlight(bot, 260, 70);
    }

    if (world.streetlights) {
      for (const lamp of world.streetlights) {
        const sx = width / 2 + (lamp.x - camera.x) * zoom;
        const sy = height / 2 + (lamp.y - camera.y) * zoom;
        if (sx < -200 || sx > width + 200 || sy < -200 || sy > height + 200) continue;
        const r = 135 * zoom;
        const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, r);
        g.addColorStop(0, `rgba(253, 224, 71, ${(0.28 * lightIntensity).toFixed(3)})`);
        g.addColorStop(1, 'rgba(253, 224, 71, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // 3. Natural Multi-Density Fog Overlay (Gradual Transition & Radial Player Visibility)
  const fogDensity = clamp(engine.fogDensity || 0, 0, 1);
  if (fogDensity > 0.01 && !player.inBunker) {
    ctx.save();
    const px = width / 2 + (player.x - camera.x) * zoom;
    const py = height / 2 + (player.y - camera.y) * zoom;
    const clearRadius = Math.max(95, (195 - fogDensity * 45) * zoom);
    const outerRadius = Math.max(width, height) * 0.78;

    const isNightMist = nightAlpha > 0.35;
    const fogR = isNightMist ? 148 : 203;
    const fogG = isNightMist ? 163 : 213;
    const fogB = isNightMist ? 184 : 225;

    const fogGrad = ctx.createRadialGradient(px, py, clearRadius * 0.45, px, py, outerRadius);
    fogGrad.addColorStop(0, `rgba(${fogR}, ${fogG}, ${fogB}, ${(0.06 * fogDensity).toFixed(3)})`);
    fogGrad.addColorStop(0.38, `rgba(${fogR}, ${fogG}, ${fogB}, ${(0.24 * fogDensity).toFixed(3)})`);
    fogGrad.addColorStop(0.75, `rgba(${fogR}, ${fogG}, ${fogB}, ${(0.48 * fogDensity).toFixed(3)})`);
    fogGrad.addColorStop(1, `rgba(${fogR}, ${fogG}, ${fogB}, ${(0.64 * fogDensity).toFixed(3)})`);

    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, 0, width, height);

    // Subtle drifting organic mist banks (multi-density patches)
    const driftTime = performance.now() * 0.00018;
    for (let i = 0; i < 6; i++) {
      const mx = ((i * 317 + driftTime * (120 + i * 25) - camera.x * 0.25 * zoom) % (width + 420)) - 210;
      const my = ((i * 193 + Math.sin(driftTime * 2 + i) * 45 - camera.y * 0.25 * zoom) % (height + 320)) - 160;
      const mr = (160 + (i % 3) * 65) * Math.max(0.8, zoom);
      const bankGrad = ctx.createRadialGradient(mx, my, mr * 0.1, mx, my, mr);
      bankGrad.addColorStop(0, `rgba(${fogR}, ${fogG}, ${fogB}, ${(0.18 * fogDensity).toFixed(3)})`);
      bankGrad.addColorStop(1, `rgba(${fogR}, ${fogG}, ${fogB}, 0)`);
      ctx.fillStyle = bankGrad;
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // 4. Realistic Multi-Layer Rain & Ground Splash Ripples
  const rainIntensity = clamp(
    engine.rainIntensity ?? (engine.weather === 'storm' ? 1 : engine.weather === 'rain' ? 0.65 : 0),
    0,
    1
  );
  if (rainIntensity > 0.01 && !player.inBunker) {
    ctx.save();
    const now = performance.now();
    const isStorm = engine.weather === 'storm' || rainIntensity > 0.8;
    const windDx = isStorm ? -14 : -9;
    const dropDy = isStorm ? 30 : 23;

    // Ground splash ripples (subtle expanding ellipses on terrain)
    const splashCount = Math.floor(22 * rainIntensity);
    ctx.strokeStyle = `rgba(224, 242, 254, ${(0.22 * rainIntensity).toFixed(3)})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < splashCount; i++) {
      const cycle = ((now * 0.0022 + i * 0.37) % 1);
      const sx = ((i * 197 + Math.floor(now * 0.0022 + i * 0.37) * 83) % Math.max(100, width));
      const sy = ((i * 311 + Math.floor(now * 0.0022 + i * 0.37) * 149) % Math.max(100, height));
      const rx = (2 + cycle * 6.5) * Math.max(0.75, zoom * 0.85);
      const ry = rx * 0.48;
      ctx.globalAlpha = (1 - cycle) * 0.45 * rainIntensity;
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Background fine rain layer (depth layer 1)
    ctx.globalAlpha = 1;
    ctx.strokeStyle = `rgba(186, 230, 253, ${(0.22 * rainIntensity).toFixed(3)})`;
    ctx.lineWidth = 1.0;
    const tFar = now * 0.68;
    const farDrops = Math.floor(55 * rainIntensity);
    ctx.beginPath();
    for (let i = 0; i < farDrops; i++) {
      const rx = ((i * 151 - tFar * 0.38) % (width + 120) + (width + 120)) % (width + 120) - 60;
      const ry = ((i * 271 + tFar * 1.45) % (height + 120)) - 60;
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + windDx * 0.72, ry + dropDy * 0.72);
    }
    ctx.stroke();

    // Foreground faster rain layer (depth layer 2)
    ctx.strokeStyle = `rgba(224, 242, 254, ${(0.38 * rainIntensity).toFixed(3)})`;
    ctx.lineWidth = 1.45;
    const tNear = now * 0.98;
    const nearDrops = Math.floor(48 * rainIntensity);
    ctx.beginPath();
    for (let i = 0; i < nearDrops; i++) {
      const rx = ((i * 179 - tNear * 0.46) % (width + 140) + (width + 140)) % (width + 140) - 70;
      const ry = ((i * 337 + tNear * 1.85) % (height + 140)) - 70;
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + windDx, ry + dropDy);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (engine.lightningTimer > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(248, 250, 252, ${(engine.lightningTimer * 2.2).toFixed(2)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

// ============================================================================
// ROBLOX-STYLE FLOATING CHAT BUBBLES ABOVE AI COMPANIONS
// ============================================================================
function renderAiChatBubbles(ctx, allies, playerInBunker) {
  if (!allies || allies.length === 0) return;

  const activeBots = allies
    .filter(
      (b) =>
        b &&
        b.inBunker === playerInBunker &&
        b.chatBubble &&
        b.chatBubble.timer > 0 &&
        b.chatBubble.text
    )
    .slice(0, 3); // Max 3 simultaneous bubbles to avoid visual clutter

  if (activeBots.length === 0) return;

  ctx.save();
  ctx.font = 'bold 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const placedPositions = [];

  for (const bot of activeBots) {
    const bubble = bot.chatBubble;
    const rawText = String(bubble.text).trim();
    const displayText = rawText.length > 54 ? rawText.slice(0, 51) + '...' : rawText;

    // Smooth fade-in and fade-out
    const fadeOut = clamp(bubble.timer / 0.55, 0, 1);
    const elapsed = (bubble.maxTimer || 3.8) - bubble.timer;
    const fadeIn = clamp(elapsed / 0.16, 0.2, 1);
    const alpha = Math.min(fadeIn, fadeOut);

    const textWidth = ctx.measureText(displayText).width;
    const padX = 11;
    const boxW = clamp(textWidth + padX * 2, 68, 250);
    const boxH = 26;

    // Prevent vertical overlap if two companions stand close together
    let baseY = bot.y - (bot.r || 20) - 38;
    for (const prev of placedPositions) {
      if (Math.abs(bot.x - prev.x) < (boxW + prev.w) * 0.48 && Math.abs(baseY - prev.y) < 30) {
        baseY = prev.y - 31;
      }
    }
    placedPositions.push({ x: bot.x, y: baseY, w: boxW });

    const boxX = bot.x - boxW / 2;
    const boxY = baseY - boxH / 2;

    ctx.save();
    ctx.globalAlpha = alpha * 0.96;

    // Soft drop shadow
    ctx.fillStyle = 'rgba(15, 23, 42, 0.38)';
    ctx.beginPath();
    ctx.roundRect(boxX + 1.5, boxY + 2.5, boxW, boxH, 8);
    ctx.fill();

    // Main Roblox-style speech bubble body (clean light slate/white with dark border)
    ctx.fillStyle = 'rgba(248, 250, 252, 0.95)';
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 8);
    ctx.fill();
    ctx.stroke();

    // Pointer triangle tail pointing down to the companion
    const tailY = boxY + boxH;
    ctx.beginPath();
    ctx.moveTo(bot.x - 5.5, tailY - 0.8);
    ctx.lineTo(bot.x, tailY + 6.5);
    ctx.lineTo(bot.x + 5.5, tailY - 0.8);
    ctx.closePath();
    ctx.fillStyle = 'rgba(248, 250, 252, 0.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(bot.x - 5.5, tailY);
    ctx.lineTo(bot.x, tailY + 6.5);
    ctx.lineTo(bot.x + 5.5, tailY);
    ctx.stroke();

    // Small companion name tag pill at top-left of bubble
    const tagW = Math.min(boxW - 12, 48);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(boxX + 6, boxY - 7, tagW, 11, 4);
    ctx.fill();
    ctx.font = 'bold 7.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(bot.name, boxX + 6 + tagW / 2, boxY - 1.5);

    // Speech text
    ctx.font = 'bold 10.5px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(displayText, bot.x, boxY + boxH / 2 + 1);

    ctx.restore();
  }

  ctx.restore();
}

