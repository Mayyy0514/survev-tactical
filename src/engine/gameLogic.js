import {
  ZOMBIE_TYPES,
  BACKPACK_CAPACITIES,
  AMMO_MAX_RESERVE_BY_BACKPACK,
  ITEM_WEIGHTS,
  WEAPONS,
} from '../config/constants.js';

export function getMaxInventoryCapacity(backpackLevel = 0) {
  return BACKPACK_CAPACITIES[backpackLevel] ?? BACKPACK_CAPACITIES[0] ?? 38;
}

export function getMaxAmmoReserve(backpackLevel = 0, ammoType = '5.56') {
  const table = AMMO_MAX_RESERVE_BY_BACKPACK[backpackLevel] || AMMO_MAX_RESERVE_BY_BACKPACK[0];
  return table?.[ammoType] ?? 120;
}

export function getItemWeight(kind, id, amount = 1) {
  if (kind === 'ammo') {
    return Number(((ITEM_WEIGHTS.ammo[id] ?? 0.06) * amount).toFixed(2));
  }
  if (kind === 'med') {
    return Number(((ITEM_WEIGHTS.meds[id] ?? 1.5) * amount).toFixed(2));
  }
  if (kind === 'throwable') {
    return Number(((ITEM_WEIGHTS.throwables[id] ?? 2.5) * amount).toFixed(2));
  }
  if (kind === 'weapon') {
    const w = WEAPONS[id];
    const cat = w?.category || 'rifle';
    return Number(((ITEM_WEIGHTS.weapons[cat] ?? 3.0) * amount).toFixed(2));
  }
  return 0;
}

export function computeInventoryUsage(player) {
  if (!player) return 0;
  let used = 0;

  if (player.ammo) {
    for (const [cal, count] of Object.entries(player.ammo)) {
      if (count > 0) {
        used += (ITEM_WEIGHTS.ammo[cal] ?? 0.06) * count;
      }
    }
  }

  if (player.meds) {
    for (const [medId, count] of Object.entries(player.meds)) {
      if (count > 0) {
        used += (ITEM_WEIGHTS.meds[medId] ?? 1.5) * count;
      }
    }
  }

  if (player.throwableCount) {
    for (const [thId, count] of Object.entries(player.throwableCount)) {
      if (count > 0) {
        used += (ITEM_WEIGHTS.throwables[thId] ?? 2.5) * count;
      }
    }
  }

  if (player.slots) {
    for (const slotKey of [1, 2]) {
      const wId = player.slots[slotKey]?.weaponId;
      if (wId && WEAPONS[wId]) {
        const cat = WEAPONS[wId].category || 'rifle';
        used += ITEM_WEIGHTS.weapons[cat] ?? 3.0;
      }
    }
  }

  return Number(used.toFixed(1));
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function distSq(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/**
 * Shortest-arc angular interpolation (handles -PI / +PI wrap-around cleanly).
 */
export function lerpAngle(current, target, t) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * clamp(t, 0, 1);
}

/**
 * Exact mathematical Aim formula for PC & Mobile:
 * - On Mobile / Right Joystick (aimJoy.dist > 8): returns aimJoy.angle.
 * - On PC (when mouse was recently moved or held down): computes worldMouseX/Y from camera + screen offset / zoom.
 * - When walking with WASD or Left Joystick without aiming on Right Joystick / active mouse: smoothly lerps toward walk direction Math.atan2(vy, vx).
 */
export function computePlayerAimAngle({
  player,
  camera,
  mouse,
  canvasWidth,
  canvasHeight,
  zoom,
  aimJoy,
  vx,
  vy,
  dt,
  now = performance.now(),
}) {
  if (aimJoy && aimJoy.active && aimJoy.dist > 8) {
    return aimJoy.angle;
  }

  const moveSpeed = Math.hypot(vx, vy);
  const mouseRecentlyActive =
    mouse &&
    (mouse.down || (typeof mouse.lastMovedAt === 'number' && now - mouse.lastMovedAt < 1400));

  if (mouseRecentlyActive && canvasWidth > 0 && canvasHeight > 0) {
    const safeZoom = zoom || 1;
    const worldMouseX = camera.x + (mouse.screenX - canvasWidth / 2) / safeZoom;
    const worldMouseY = camera.y + (mouse.screenY - canvasHeight / 2) / safeZoom;
    return Math.atan2(worldMouseY - player.y, worldMouseX - player.x);
  }

  if (moveSpeed > 0.05) {
    const targetWalkAngle = Math.atan2(vy, vx);
    return lerpAngle(player.angle || 0, targetWalkAngle, dt * 12);
  }

  if (mouse && canvasWidth > 0 && canvasHeight > 0 && mouse.lastMovedAt > 0) {
    const safeZoom = zoom || 1;
    const worldMouseX = camera.x + (mouse.screenX - canvasWidth / 2) / safeZoom;
    const worldMouseY = camera.y + (mouse.screenY - canvasHeight / 2) / safeZoom;
    return Math.atan2(worldMouseY - player.y, worldMouseX - player.x);
  }

  return player.angle || 0;
}

export function circleIntersectsRect(cx, cy, r, rx, ry, rw, rh) {
  const closestX = clamp(cx, rx, rx + rw);
  const closestY = clamp(cy, ry, ry + rh);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

export function segmentIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
  const dx = x2 - x1;
  const dy = y2 - y1;

  let tmin = 0;
  let tmax = 1;
  let nx = 0;
  let ny = 0;

  if (Math.abs(dx) < 1e-8) {
    if (x1 < rx || x1 > rx + rw) return { hit: false, t: 1, ix: x2, iy: y2, nx: 0, ny: 0 };
  } else {
    const invX = 1 / dx;
    let t1 = (rx - x1) * invX;
    let t2 = (rx + rw - x1) * invX;
    let signX = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      signX = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = signX;
      ny = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return { hit: false, t: 1, ix: x2, iy: y2, nx: 0, ny: 0 };
  }

  if (Math.abs(dy) < 1e-8) {
    if (y1 < ry || y1 > ry + rh) return { hit: false, t: 1, ix: x2, iy: y2, nx: 0, ny: 0 };
  } else {
    const invY = 1 / dy;
    let t1 = (ry - y1) * invY;
    let t2 = (ry + rh - y1) * invY;
    let signY = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      signY = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = signY;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return { hit: false, t: 1, ix: x2, iy: y2, nx: 0, ny: 0 };
  }

  if (tmin < 0 || tmin > 1) {
    return { hit: false, t: 1, ix: x2, iy: y2, nx: 0, ny: 0 };
  }

  return {
    hit: true,
    t: tmin,
    ix: x1 + dx * tmin,
    iy: y1 + dy * tmin,
    nx,
    ny,
  };
}

export function segmentIntersectsCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;

  const a = dx * dx + dy * dy;
  if (fx * fx + fy * fy <= r * r) {
    return { hit: true, t: 0, ix: x1, iy: y1 };
  }
  if (a < 1e-8) {
    return { hit: false, t: 1, ix: x2, iy: y2 };
  }

  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return { hit: false, t: 1, ix: x2, iy: y2 };
  }

  discriminant = Math.sqrt(discriminant);
  const t1 = (-b - discriminant) / (2 * a);
  const t2 = (-b + discriminant) / (2 * a);

  if (t1 >= 0 && t1 <= 1) {
    return { hit: true, t: t1, ix: x1 + dx * t1, iy: y1 + dy * t1 };
  }
  if (t2 >= 0 && t2 <= 1) {
    return { hit: true, t: t2, ix: x1 + dx * t2, iy: y1 + dy * t2 };
  }
  return { hit: false, t: 1, ix: x2, iy: y2 };
}

/**
 * Raycasts obstacles in the world.
 * - Windows (`b.windows`): Bullets (`options.isBullet = true`) DO NOT stop at windows;
 *   if the window still has intact glass (`!win.shattered`), the bullet shatters it (`win.shattered = true`),
 *   records it in `options.shatteredWindows`, and continues along its path!
 */
export function raycastObstacles(x1, y1, x2, y2, world, inBunker = false, options = {}) {
  let bestHit = null;

  const checkRect = (rx, ry, rw, rh, material = 'concrete', refObj = null, refType = 'wall') => {
    const res = segmentIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh);
    if (res.hit && (!bestHit || res.t < bestHit.t)) {
      bestHit = { ...res, material, refObj, refType };
    }
  };

  const checkCircle = (cx, cy, r, material = 'stone', refObj = null, refType = 'prop') => {
    const res = segmentIntersectsCircle(x1, y1, x2, y2, cx, cy, r);
    if (res.hit && (!bestHit || res.t < bestHit.t)) {
      bestHit = { ...res, material, refObj, refType };
    }
  };

  if (inBunker && world?.bunker) {
    for (const w of world.bunker.walls) {
      checkRect(w.x, w.y, w.w, w.h, 'metal', w, 'bunker_wall');
    }
    if (world.bunker.furniture) {
      for (const f of world.bunker.furniture) {
        if (f.solid && !f.destroyed && (f.hp ?? 100) > 0) {
          checkRect(f.x, f.y, f.w, f.h, f.material || 'metal', f, 'furniture');
        }
      }
    }
    if (world.bunker.crates) {
      for (const c of world.bunker.crates) {
        if (c.hp > 0 && !c._destroyed) {
          checkRect(c.x, c.y, c.w, c.h, c.type === 'metal' ? 'metal' : 'wood', c, 'crate');
        }
      }
    }
    if (world.barricades) {
      for (const bar of world.barricades) {
        if (!bar.inBunker || bar.hp <= 0 || bar.destroyed) continue;
        checkRect(bar.x, bar.y, bar.w, bar.h, 'metal', bar, 'barricade');
      }
    }
    return bestHit;
  }

  if (!world) return null;

  const minX = Math.min(x1, x2) - 90;
  const maxX = Math.max(x1, x2) + 90;
  const minY = Math.min(y1, y2) - 90;
  const maxY = Math.max(y1, y2) + 90;

  if (world.buildings) {
    for (const b of world.buildings) {
      if (b.x + b.w < minX || b.x > maxX || b.y + b.h < minY || b.y > maxY) continue;
      for (const w of b.walls) {
        checkRect(w.x, w.y, w.w, w.h, 'concrete', w, 'wall');
      }
      if (b.doors) {
        for (const d of b.doors) {
          if (!d.open && !d.destroyed && (d.hp ?? 120) > 0) {
            checkRect(d.x, d.y, d.w, d.h, 'wood', d, 'door');
          }
        }
      }
      if (b.furniture) {
        for (const f of b.furniture) {
          if (f.solid && !f.destroyed && (f.hp ?? 100) > 0) {
            checkRect(f.x, f.y, f.w, f.h, 'wood', f, 'furniture');
          }
        }
      }
      // Windows: bullets pass through and shatter intact glass; all non-bullet rays (steering, grenades, etc.) are blocked by window frames
      if (b.windows) {
        if (options.isBullet) {
          for (const win of b.windows) {
            if (!win.shattered && (win.hp ?? 35) > 0) {
              const wRes = segmentIntersectsRect(x1, y1, x2, y2, win.x, win.y, win.w, win.h);
              if (wRes.hit) {
                if (!options.shatteredWindows) options.shatteredWindows = [];
                options.shatteredWindows.push({ win, ix: wRes.ix, iy: wRes.iy, t: wRes.t });
              }
            }
          }
        } else {
          for (const win of b.windows) {
            checkRect(win.x, win.y, win.w, win.h, 'metal', win, 'window');
          }
        }
      }
    }
  }

  if (world.bridges) {
    for (const br of world.bridges) {
      if (br.x + br.w < minX || br.x > maxX || br.y + br.h < minY || br.y > maxY) continue;
      if (br.railings) {
        for (const rail of br.railings) {
          checkRect(rail.x, rail.y, rail.w, rail.h, 'metal', rail, 'railing');
        }
      }
    }
  }

  if (world.crates) {
    for (const c of world.crates) {
      if (c.hp <= 0 || c._destroyed) continue;
      if (c.x + c.w < minX || c.x > maxX || c.y + c.h < minY || c.y > maxY) continue;
      checkRect(c.x, c.y, c.w, c.h, c.type === 'metal' ? 'metal' : 'wood', c, 'crate');
    }
  }

  if (world.barricades) {
    for (const bar of world.barricades) {
      if (bar.inBunker || bar.hp <= 0 || bar.destroyed) continue;
      checkRect(bar.x, bar.y, bar.w, bar.h, 'metal', bar, 'barricade');
    }
  }

  if (world.stones) {
    for (const s of world.stones) {
      if (s.destroyed || (typeof s.hp === 'number' && s.hp <= 0)) continue;
      if (s.x + s.r < minX || s.x - s.r > maxX || s.y + s.r < minY || s.y - s.r > maxY) continue;
      checkCircle(s.x, s.y, s.r * 0.88, 'stone', s, 'stone');
    }
  }

  if (world.trees) {
    for (const t of world.trees) {
      if (t.destroyed || (typeof t.hp === 'number' && t.hp <= 0)) continue;
      if (t.x + t.trunkR < minX || t.x - t.trunkR > maxX || t.y + t.trunkR < minY || t.y - t.trunkR > maxY) continue;
      checkCircle(t.x, t.y, t.trunkR, 'wood', t, 'tree');
    }
  }

  return bestHit;
}

/**
 * 8-Direction Radial Sensor Steering & Tangential Wall Avoidance for Zombies & Bots.
 * Prevents units from getting stuck vibrating against building walls or furniture.
 */
export function computeSmartSteerAngle(unit, targetX, targetY, world, inBunker = false) {
  const directAngle = Math.atan2(targetY - unit.y, targetX - unit.x);
  const probeDist = (unit.r || 19) + 34;

  const isAngleClear = (ang, distCheck) => {
    const px = unit.x + Math.cos(ang) * distCheck;
    const py = unit.y + Math.sin(ang) * distCheck;
    const hit = raycastObstacles(unit.x, unit.y, px, py, world, inBunker);
    return !hit || !hit.hit;
  };

  if (isAngleClear(directAngle, probeDist)) {
    return directAngle;
  }

  const candidateOffsets = [
    0.58, -0.58,
    1.08, -1.08,
    1.57, -1.57,
    2.15, -2.15,
  ];

  // Prefer the side that matches the unit's current heading to prevent left-right oscillation
  const currentHeading = unit.moveAngle ?? unit.angle ?? directAngle;
  candidateOffsets.sort((a, b) => {
    const angA = directAngle + a;
    const angB = directAngle + b;
    const diffA = Math.abs( Math.atan2(Math.sin(angA - currentHeading), Math.cos(angA - currentHeading)) );
    const diffB = Math.abs( Math.atan2(Math.sin(angB - currentHeading), Math.cos(angB - currentHeading)) );
    return diffA - diffB;
  });

  for (const offset of candidateOffsets) {
    const testAng = directAngle + offset;
    if (isAngleClear(testAng, probeDist)) {
      return testAng;
    }
  }

  return directAngle + 1.57;
}

export function resolveEntityCollisions(entity, world, inBunker = false) {
  const r = entity.r || 18;

  if (inBunker && world.bunker) {
    const b = world.bunker;
    entity.x = clamp(entity.x, b.x + r + 24, b.x + b.w - r - 24);
    entity.y = clamp(entity.y, b.y + r + 24, b.y + b.h - r - 24);
    for (const w of b.walls) {
      if (circleIntersectsRect(entity.x, entity.y, r, w.x, w.y, w.w, w.h)) {
        pushCircleOutOfRect(entity, r, w);
      }
    }
    if (b.furniture) {
      for (const f of b.furniture) {
        if (f.solid && !f.destroyed && (f.hp ?? 100) > 0 && circleIntersectsRect(entity.x, entity.y, r, f.x, f.y, f.w, f.h)) {
          pushCircleOutOfRect(entity, r, f);
        }
      }
    }
    if (b.crates) {
      for (const c of b.crates) {
        if (c.hp > 0 && !c._destroyed && circleIntersectsRect(entity.x, entity.y, r, c.x, c.y, c.w, c.h)) {
          pushCircleOutOfRect(entity, r, c);
        }
      }
    }
    if (world.barricades) {
      for (const bar of world.barricades) {
        if (!bar.inBunker || bar.hp <= 0 || bar.destroyed) continue;
        if (circleIntersectsRect(entity.x, entity.y, r, bar.x, bar.y, bar.w, bar.h)) {
          pushCircleOutOfRect(entity, r, bar);
        }
      }
    }
    return;
  }

  const mapSize = world.size || 20000;
  entity.x = clamp(entity.x, r + 40, mapSize - r - 40);
  entity.y = clamp(entity.y, r + 40, mapSize - r - 40);

  for (const b of world.buildings) {
    if (
      entity.x + r < b.x - 24 ||
      entity.x - r > b.x + b.w + 24 ||
      entity.y + r < b.y - 24 ||
      entity.y - r > b.y + b.h + 24
    ) {
      continue;
    }
    for (const w of b.walls) {
      if (circleIntersectsRect(entity.x, entity.y, r, w.x, w.y, w.w, w.h)) {
        pushCircleOutOfRect(entity, r, w);
      }
    }
    if (b.windows) {
      for (const win of b.windows) {
        // Windows ALWAYS block players, AI companions, and zombies whether intact or shattered
        if (circleIntersectsRect(entity.x, entity.y, r, win.x, win.y, win.w, win.h)) {
          pushCircleOutOfRect(entity, r, win);
        }
      }
    }
    for (const d of b.doors) {
      if (!d.open && !d.destroyed && (d.hp ?? 120) > 0 && circleIntersectsRect(entity.x, entity.y, r, d.x, d.y, d.w, d.h)) {
        pushCircleOutOfRect(entity, r, d);
      }
    }
    for (const f of b.furniture) {
      if (f.solid && !f.destroyed && (f.hp ?? 100) > 0 && circleIntersectsRect(entity.x, entity.y, r, f.x, f.y, f.w, f.h)) {
        pushCircleOutOfRect(entity, r, f);
      }
    }
  }

  if (world.bridges) {
    for (const br of world.bridges) {
      if (
        entity.x + r < br.x - 20 ||
        entity.x - r > br.x + br.w + 20 ||
        entity.y + r < br.y - 20 ||
        entity.y - r > br.y + br.h + 20
      ) {
        continue;
      }
      if (br.railings) {
        for (const rail of br.railings) {
          if (circleIntersectsRect(entity.x, entity.y, r, rail.x, rail.y, rail.w, rail.h)) {
            pushCircleOutOfRect(entity, r, rail);
          }
        }
      }
    }
  }

  for (const c of world.crates) {
    if (c.hp <= 0 || c._destroyed) continue;
    if (circleIntersectsRect(entity.x, entity.y, r, c.x, c.y, c.w, c.h)) {
      pushCircleOutOfRect(entity, r, c);
    }
  }

  if (world.barricades) {
    for (const bar of world.barricades) {
      if (bar.inBunker || bar.hp <= 0 || bar.destroyed) continue;
      if (circleIntersectsRect(entity.x, entity.y, r, bar.x, bar.y, bar.w, bar.h)) {
        pushCircleOutOfRect(entity, r, bar);
      }
    }
  }

  for (const t of world.trees) {
    if (t.destroyed || (typeof t.hp === 'number' && t.hp <= 0)) continue;
    const dx = entity.x - t.x;
    const dy = entity.y - t.y;
    const minDist = r + t.trunkR;
    const d2 = dx * dx + dy * dy;
    if (d2 < minDist * minDist && d2 > 0.001) {
      const d = Math.sqrt(d2);
      const overlap = minDist - d;
      entity.x += (dx / d) * overlap;
      entity.y += (dy / d) * overlap;
    }
  }

  for (const s of world.stones) {
    if (s.destroyed || (typeof s.hp === 'number' && s.hp <= 0)) continue;
    const dx = entity.x - s.x;
    const dy = entity.y - s.y;
    const minDist = r + s.r * 0.85;
    const d2 = dx * dx + dy * dy;
    if (d2 < minDist * minDist && d2 > 0.001) {
      const d = Math.sqrt(d2);
      const overlap = minDist - d;
      entity.x += (dx / d) * overlap;
      entity.y += (dy / d) * overlap;
    }
  }
}

export function pushCircleOutOfRect(entity, r, rect) {
  const closestX = clamp(entity.x, rect.x, rect.x + rect.w);
  const closestY = clamp(entity.y, rect.y, rect.y + rect.h);
  let dx = entity.x - closestX;
  let dy = entity.y - closestY;
  const d2 = dx * dx + dy * dy;

  if (d2 === 0) {
    const left = Math.abs(entity.x - rect.x);
    const right = Math.abs(rect.x + rect.w - entity.x);
    const top = Math.abs(entity.y - rect.y);
    const bottom = Math.abs(rect.y + rect.h - entity.y);
    const minSide = Math.min(left, right, top, bottom);
    if (minSide === left) entity.x = rect.x - r;
    else if (minSide === right) entity.x = rect.x + rect.w + r;
    else if (minSide === top) entity.y = rect.y - r;
    else entity.y = rect.y + rect.h + r;
    return;
  }

  const d = Math.sqrt(d2);
  if (d < r) {
    const overlap = r - d;
    entity.x += (dx / d) * overlap;
    entity.y += (dy / d) * overlap;
  }
}

export function computeWaveComposition(waveNumber, playerCount = 1, difficultyMult = 1.0) {
  const w = Math.max(1, waveNumber);
  const scale = 1 + Math.max(0, playerCount - 1) * 0.3;
  const totalCount = Math.min(68, Math.round((6 + w * 3.5) * scale));
  const hpMultiplier = Number(((1 + (w - 1) * 0.12) * difficultyMult).toFixed(2));
  const speedMultiplier = Number(Math.min(1.32, 1 + (w - 1) * 0.02).toFixed(2));

  const queue = [];
  for (let i = 0; i < totalCount; i++) {
    let type = 'walker';
    const roll = (i * 37 + w * 13) % 100;
    if (w === 2) {
      if (roll < 18) type = 'runner';
      else if (roll >= 18 && roll < 26) type = 'armored';
    } else if (w === 3 || w === 4) {
      if (roll < 20) type = 'runner';
      else if (roll >= 20 && roll < 32) type = 'armored';
      else if (roll >= 32 && roll < 42) type = 'spitter';
      else if (roll >= 42 && roll < 50) type = 'exploder';
    } else if (w >= 5) {
      if (roll < 24) type = 'runner';
      else if (roll >= 24 && roll < 39) type = 'armored';
      else if (roll >= 39 && roll < 51) type = 'spitter';
      else if (roll >= 51 && roll < 62) type = 'exploder';
    }
    queue.push(type);
  }

  if (w % 3 === 0 || w >= 5) {
    queue.push('behemoth');
  }

  return {
    wave: w,
    totalCount: queue.length,
    hpMultiplier,
    speedMultiplier,
    queue,
  };
}

export function createZombieInstance(typeId, x, y, hpMult = 1, speedMult = 1, idSuffix = '') {
  const base = ZOMBIE_TYPES[typeId] || ZOMBIE_TYPES.walker;
  const maxHp = Math.round(base.hp * hpMult);
  return {
    id: `z_${typeId}_${Date.now()}_${idSuffix}`,
    type: base.id,
    name: base.name,
    x,
    y,
    r: base.radius,
    hp: maxHp,
    maxHp,
    speed: base.speed * speedMult,
    damage: base.damage,
    score: base.score,
    credits: base.credits,
    skin: base.skin,
    outfit: base.outfit,
    helmet: Boolean(base.helmet),
    vest: Boolean(base.vest),
    ranged: Boolean(base.ranged),
    range: base.range || 55,
    explodes: Boolean(base.explodes),
    explosionRadius: base.explosionRadius || 0,
    isBoss: Boolean(base.isBoss),
    isVip: false,
    attackCooldown: base.attackCooldown || 0.8,
    attackTimer: 0,
    angle: 0,
    moveAngle: 0,
    inBunker: false,
  };
}

export function applyAdrenalineTick(player, dt) {
  if (player.adrenaline > 0) {
    player.adrenaline = Math.max(0, player.adrenaline - dt * 2.1);
    const regenRate = player.adrenaline > 50 ? 4.8 : 2.4;
    if (player.hp > 0 && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + regenRate * dt);
    }
  }
  const speedBoost = player.adrenaline > 50 ? 1.16 : player.adrenaline > 0 ? 1.08 : 1.0;
  return speedBoost;
}
