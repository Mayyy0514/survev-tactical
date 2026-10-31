import { WORLD_SIZE, WEAPONS, MELEE_WEAPONS } from '../config/constants.js';

function createSeededRng(seedInput = 1337) {
  let s = 0;
  if (typeof seedInput === 'string') {
    for (let i = 0; i < seedInput.length; i++) {
      s = (s * 31 + seedInput.charCodeAt(i)) >>> 0;
    }
    if (s === 0) s = 1337;
  } else {
    s = (seedInput >>> 0) || 1337;
  }
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * Splits a horizontal or vertical wall segment to insert a framed glass window opening
 * so bullets pass through windows (shattering the glass) while entities are blocked by intact windows.
 */
function pushWallWithWindow(walls, windows, idPrefix, x, y, len, wallT, orientation, hasWindow) {
  const winLen = 48;
  if (!hasWindow || len < 126) {
    if (len > 4) {
      walls.push(
        orientation === 'h'
          ? { x, y, w: len, h: wallT }
          : { x, y, w: wallT, h: len }
      );
    }
    return;
  }

  const beforeLen = Math.floor((len - winLen) * 0.5);
  const afterLen = len - beforeLen - winLen;

  if (orientation === 'h') {
    if (beforeLen > 4) walls.push({ x, y, w: beforeLen, h: wallT });
    windows.push({
      id: `${idPrefix}_win_${windows.length}`,
      x: x + beforeLen,
      y: y + 2,
      w: winLen,
      h: wallT - 4,
      orientation: 'h',
      hp: 35,
      maxHp: 35,
      shattered: false,
    });
    if (afterLen > 4) walls.push({ x: x + beforeLen + winLen, y, w: afterLen, h: wallT });
  } else {
    if (beforeLen > 4) walls.push({ x, y, w: wallT, h: beforeLen });
    windows.push({
      id: `${idPrefix}_win_${windows.length}`,
      x: x + 2,
      y: y + beforeLen,
      w: wallT - 4,
      h: winLen,
      orientation: 'v',
      hp: 35,
      maxHp: 35,
      shattered: false,
    });
    if (afterLen > 4) walls.push({ x, y: y + beforeLen + winLen, w: wallT, h: afterLen });
  }
}

/**
 * Generates a realistic multi-room building (3 to 5 rooms) with:
 * - Framed glass windows in exterior walls (`hp: 35, shattered: false`)
 * - Destructible doors (`hp: 120, destroyed: false`)
 * - Destructible furniture (`hp: 70..140, destroyed: false`)
 * - Strict > 95px clearance from ALL exterior doors and interior hallway openings!
 */
function buildStructure(id, x, y, w, h, type, rng, rotation = 0) {
  const wallT = 16;
  const doorW = 82;
  const isRotated = rotation === 90 || rotation === 270;
  const bw = isRotated ? h : w;
  const bh = isRotated ? w : h;

  const walls = [];
  const windows = [];
  const doors = [];
  const rooms = [];
  const furniture = [];
  const doorAndHallCenters = [];

  // Compute interior partition lines first so exterior doors are centered in rooms and NEVER touch partition walls
  const midX = x + Math.floor(bw * 0.44);
  const rightSplitX = x + Math.floor(bw * 0.72);
  const midY = y + Math.floor(bh * 0.52);

  const topDoorX = x + Math.max(wallT + 14, Math.floor((midX - x) * 0.5 - doorW * 0.5));
  const botDoorX = midX + Math.max(20, Math.floor((x + bw - midX) * 0.5 - doorW * 0.5));
  const leftDoorY = y + Math.max(wallT + 12, Math.floor((midY - y) * 0.5 - doorW * 0.5));
  const rightDoorY = midY + Math.max(18, Math.floor((y + bh - midY) * 0.5 - doorW * 0.5));

  // Exterior Top Wall with doorway + framed glass windows
  const topLeftW = Math.max(16, topDoorX - x);
  const topRightW = Math.max(16, x + bw - (topDoorX + doorW));
  pushWallWithWindow(walls, windows, id, x, y, topLeftW, wallT, 'h', true);
  pushWallWithWindow(walls, windows, id, topDoorX + doorW, y, topRightW, wallT, 'h', true);
  doors.push({
    id: `${id}_d_top`,
    x: topDoorX,
    y: y - 2,
    w: doorW,
    h: wallT + 4,
    open: rng() > 0.35,
    orientation: 'h',
    hp: 160,
    maxHp: 160,
    destroyed: false,
  });
  doorAndHallCenters.push({ x: topDoorX + doorW * 0.5, y: y + wallT * 0.5 });

  // Exterior Bottom Wall with doorway + framed glass windows
  const botLeftW = Math.max(16, botDoorX - x);
  const botRightW = Math.max(16, x + bw - (botDoorX + doorW));
  pushWallWithWindow(walls, windows, id, x, y + bh - wallT, botLeftW, wallT, 'h', true);
  pushWallWithWindow(walls, windows, id, botDoorX + doorW, y + bh - wallT, botRightW, wallT, 'h', true);
  doors.push({
    id: `${id}_d_bot`,
    x: botDoorX,
    y: y + bh - wallT - 2,
    w: doorW,
    h: wallT + 4,
    open: rng() > 0.35,
    orientation: 'h',
    hp: 160,
    maxHp: 160,
    destroyed: false,
  });
  doorAndHallCenters.push({ x: botDoorX + doorW * 0.5, y: y + bh - wallT * 0.5 });

  // Exterior Left Wall
  if (bh >= 330 && leftDoorY + doorW < midY - 12) {
    pushWallWithWindow(walls, windows, id, x, y + wallT, leftDoorY - (y + wallT), wallT, 'v', true);
    pushWallWithWindow(
      walls,
      windows,
      id,
      x,
      leftDoorY + doorW,
      y + bh - wallT - (leftDoorY + doorW),
      wallT,
      'v',
      true
    );
    doors.push({
      id: `${id}_d_left`,
      x: x - 2,
      y: leftDoorY,
      w: wallT + 4,
      h: doorW,
      open: rng() > 0.4,
      orientation: 'v',
      hp: 160,
      maxHp: 160,
      destroyed: false,
    });
    doorAndHallCenters.push({ x: x + wallT * 0.5, y: leftDoorY + doorW * 0.5 });
  } else {
    pushWallWithWindow(walls, windows, id, x, y + wallT, bh - wallT * 2, wallT, 'v', true);
  }

  // Exterior Right Wall
  if (bw >= 370 && rightDoorY > midY + 14 && rightDoorY + doorW < y + bh - wallT - 12) {
    pushWallWithWindow(walls, windows, id, x + bw - wallT, y + wallT, rightDoorY - (y + wallT), wallT, 'v', true);
    pushWallWithWindow(
      walls,
      windows,
      id,
      x + bw - wallT,
      rightDoorY + doorW,
      y + bh - wallT - (rightDoorY + doorW),
      wallT,
      'v',
      true
    );
    doors.push({
      id: `${id}_d_right`,
      x: x + bw - wallT - 2,
      y: rightDoorY,
      w: wallT + 4,
      h: doorW,
      open: rng() > 0.4,
      orientation: 'v',
      hp: 160,
      maxHp: 160,
      destroyed: false,
    });
    doorAndHallCenters.push({ x: x + bw - wallT * 0.5, y: rightDoorY + doorW * 0.5 });
  } else {
    pushWallWithWindow(walls, windows, id, x + bw - wallT, y + wallT, bh - wallT * 2, wallT, 'v', true);
  }

  // Multi-Room Interior Partitioning (3 to 5 distinct rooms with interior doorway gaps)
  const innerGap = 78;

  const vGap1Y = y + Math.floor(bh * 0.25);
  const vGap2Y = y + Math.floor(bh * 0.72);
  walls.push({ x: midX, y: y + wallT, w: 12, h: Math.max(14, vGap1Y - (y + wallT)) });
  walls.push({
    x: midX,
    y: vGap1Y + innerGap,
    w: 12,
    h: Math.max(14, vGap2Y - (vGap1Y + innerGap)),
  });
  walls.push({
    x: midX,
    y: vGap2Y + innerGap,
    w: 12,
    h: Math.max(14, y + bh - wallT - (vGap2Y + innerGap)),
  });
  doorAndHallCenters.push({ x: midX + 6, y: vGap1Y + innerGap * 0.5 });
  doorAndHallCenters.push({ x: midX + 6, y: vGap2Y + innerGap * 0.5 });

  // Horizontal partition in Left Wing
  const hGapLeftX = x + Math.floor((midX - x) * 0.42);
  walls.push({ x: x + wallT, y: midY, w: Math.max(14, hGapLeftX - (x + wallT)), h: 12 });
  walls.push({
    x: hGapLeftX + innerGap,
    y: midY,
    w: Math.max(14, midX - (hGapLeftX + innerGap)),
    h: 12,
  });
  doorAndHallCenters.push({ x: hGapLeftX + innerGap * 0.5, y: midY + 6 });

  // Horizontal partition in Right Wing
  const hGapRightX = midX + 12 + Math.floor((x + bw - wallT - (midX + 12)) * 0.36);
  walls.push({ x: midX + 12, y: midY, w: Math.max(14, hGapRightX - (midX + 12)), h: 12 });
  walls.push({
    x: hGapRightX + innerGap,
    y: midY,
    w: Math.max(14, x + bw - wallT - (hGapRightX + innerGap)),
    h: 12,
  });
  doorAndHallCenters.push({ x: hGapRightX + innerGap * 0.5, y: midY + 6 });

  const hasFifthRoom = bw >= 460;
  if (hasFifthRoom) {
    const v5GapY = y + wallT + Math.floor((midY - (y + wallT)) * 0.42);
    walls.push({ x: rightSplitX, y: y + wallT, w: 12, h: Math.max(12, v5GapY - (y + wallT)) });
    walls.push({
      x: rightSplitX,
      y: v5GapY + 68,
      w: 12,
      h: Math.max(12, midY - (v5GapY + 68)),
    });
    doorAndHallCenters.push({ x: rightSplitX + 6, y: v5GapY + 34 });
  }

  // Differentiated Room Floors
  rooms.push({
    name: 'Dormitorio',
    x: x + wallT,
    y: y + wallT,
    w: midX - (x + wallT),
    h: midY - (y + wallT),
    floorStyle: type === 'warehouse' ? 'concrete' : 'wood',
    color: type === 'warehouse' ? '#475569' : '#734f34',
  });
  rooms.push({
    name: 'Sala',
    x: x + wallT,
    y: midY + 12,
    w: midX - (x + wallT),
    h: y + bh - wallT - (midY + 12),
    floorStyle: type === 'military' ? 'concrete' : 'wood',
    color: type === 'military' ? '#334155' : '#65432a',
  });
  rooms.push({
    name: type === 'military' || type === 'police' ? 'Armería' : 'Cocina',
    x: midX + 12,
    y: y + wallT,
    w: (hasFifthRoom ? rightSplitX : x + bw - wallT) - (midX + 12),
    h: midY - (y + wallT),
    floorStyle: type === 'military' || type === 'warehouse' ? 'concrete' : 'ceramic',
    color: type === 'military' ? '#3f3f46' : '#cbd5e1',
  });
  rooms.push({
    name: type === 'hospital' ? 'Quirófano' : 'Baño',
    x: midX + 12,
    y: midY + 12,
    w: x + bw - wallT - (midX + 12),
    h: y + bh - wallT - (midY + 12),
    floorStyle: 'ceramic',
    color: '#e2e8f0',
  });
  if (hasFifthRoom) {
    rooms.push({
      name: 'Estudio',
      x: rightSplitX + 12,
      y: y + wallT,
      w: x + bw - wallT - (rightSplitX + 12),
      h: midY - (y + wallT),
      floorStyle: 'wood',
      color: '#5c3d26',
    });
  }

  // Helper that enforces > 95px clearance from ANY door or hallway opening before placing solid furniture
  const candidateFurniture = [
    // Room 1 (Top-Left Bedroom)
    { x: x + wallT + 6, y: y + wallT + 6, w: 54, h: 36, kind: 'bed', color: type === 'military' ? '#15803d' : '#be123c', solid: true, hp: 110 },
    { x: x + wallT + 64, y: y + wallT + 6, w: 20, h: 20, kind: 'nightstand', color: '#78350f', solid: true, hp: 70 },
    { x: x + wallT + 6, y: midY - 30, w: 46, h: 20, kind: 'wardrobe', color: '#5c3a21', solid: true, hp: 120 },
    { x: x + wallT + 64, y: y + wallT + 50, w: 52, h: 34, kind: 'rug', color: '#991b1b', solid: false, hp: 60 },

    // Room 2 (Bottom-Left Living Room)
    { x: x + wallT + 8, y: y + bh - wallT - 30, w: 62, h: 24, kind: 'couch', color: '#7f1d1d', solid: true, hp: 110 },
    { x: x + wallT + 18, y: y + bh - wallT - 60, w: 42, h: 22, kind: 'coffee_table', color: '#92400e', solid: true, hp: 80 },
    { x: x + wallT + 8, y: midY + 16, w: 48, h: 18, kind: 'tv_stand', color: '#1e293b', solid: true, hp: 85 },
    { x: midX - 26, y: y + bh - wallT - 54, w: 18, h: 42, kind: 'bookshelf', color: '#78350f', solid: true, hp: 100 },
    { x: x + wallT + 76, y: y + bh - wallT - 26, w: 18, h: 18, kind: 'plant', color: '#15803d', solid: true, hp: 65 },
  ];

  if (type === 'military' || type === 'police') {
    candidateFurniture.push(
      { x: midX + 20, y: y + wallT + 6, w: 58, h: 20, kind: 'gun_rack', color: '#334155', solid: true, hp: 135 },
      { x: midX + 84, y: y + wallT + 6, w: 48, h: 20, kind: 'locker', color: '#475569', solid: true, hp: 130 },
      { x: midX + 22, y: midY - 40, w: 52, h: 28, kind: 'desk', color: '#334155', solid: true, hp: 95 },
      { x: x + bw - wallT - 36, y: y + wallT + 10, w: 24, h: 24, kind: 'barrel_explosive', color: '#dc2626', solid: true, hp: 75 }
    );
  } else {
    candidateFurniture.push(
      { x: midX + 18, y: y + wallT + 6, w: 32, h: 24, kind: 'stove', color: '#334155', solid: true, hp: 115 },
      { x: midX + 52, y: y + wallT + 6, w: 34, h: 24, kind: 'sink', color: '#94a3b8', solid: true, hp: 105 },
      { x: midX + 90, y: y + wallT + 6, w: 26, h: 26, kind: 'fridge', color: '#f8fafc', solid: true, hp: 140 },
      { x: midX + 42, y: midY - 48, w: 54, h: 34, kind: 'dining_table', color: '#92400e', solid: true, hp: 95 }
    );
  }

  if (type === 'hospital') {
    candidateFurniture.push(
      { x: midX + 22, y: midY + 18, w: 54, h: 30, kind: 'medbed', color: '#e2e8f0', solid: true, hp: 110 },
      { x: x + bw - wallT - 66, y: midY + 18, w: 54, h: 30, kind: 'medbed', color: '#e2e8f0', solid: true, hp: 110 },
      { x: x + bw - wallT - 60, y: y + bh - wallT - 34, w: 48, h: 24, kind: 'desk', color: '#475569', solid: true, hp: 90 }
    );
  } else {
    candidateFurniture.push(
      { x: x + bw - wallT - 30, y: midY + 18, w: 22, h: 26, kind: 'toilet', color: '#f8fafc', solid: true, hp: 85 },
      { x: x + bw - wallT - 64, y: midY + 16, w: 28, h: 20, kind: 'washbasin', color: '#e2e8f0', solid: true, hp: 80 },
      { x: x + bw - wallT - 62, y: y + bh - wallT - 32, w: 52, h: 24, kind: 'bathtub', color: '#f1f5f9', solid: true, hp: 125 },
      { x: midX + 20, y: y + bh - wallT - 32, w: 40, h: 24, kind: 'generator', color: '#ca8a04', solid: true, hp: 135 }
    );
  }

  if (hasFifthRoom) {
    candidateFurniture.push(
      { x: rightSplitX + 18, y: y + wallT + 8, w: 46, h: 24, kind: 'desk', color: '#475569', solid: true, hp: 90 },
      { x: x + bw - wallT - 26, y: y + wallT + 8, w: 18, h: 18, kind: 'plant', color: '#15803d', solid: true, hp: 65 }
    );
  }

  for (let fIdx = 0; fIdx < candidateFurniture.length; fIdx++) {
    const item = candidateFurniture[fIdx];
    const fCx = item.x + item.w * 0.5;
    const fCy = item.y + item.h * 0.5;

    let blocksDoor = false;
    if (item.solid) {
      for (const dh of doorAndHallCenters) {
        if (Math.hypot(fCx - dh.x, fCy - dh.y) < 96) {
          blocksDoor = true;
          break;
        }
      }
    }

    if (!blocksDoor) {
      furniture.push({
        ...item,
        id: `${id}_furn_${fIdx}`,
        maxHp: item.hp || 100,
        destroyed: false,
      });
    }
  }

  const floorColors = {
    cabin: '#6b4c35',
    warehouse: '#4b5563',
    military: '#374151',
    hospital: '#cbd5e1',
    police: '#334155',
    mansion: '#7c2d12',
  };

  const roofColors = {
    cabin: '#5c3a21',
    warehouse: '#334155',
    military: '#1f2937',
    hospital: '#94a3b8',
    police: '#1e293b',
    mansion: '#451a03',
  };

  // Post-build geometric verification: ensure NO wall segment ever overlaps any doorway opening + 28px clearance
  const safeWalls = walls.filter((wSeg) => {
    for (const d of doors) {
      const padX = d.orientation === 'v' ? 28 : 4;
      const padY = d.orientation === 'h' ? 28 : 4;
      const dx1 = d.x - padX;
      const dy1 = d.y - padY;
      const dx2 = d.x + d.w + padX;
      const dy2 = d.y + d.h + padY;
      const overlaps =
        wSeg.x < dx2 &&
        wSeg.x + wSeg.w > dx1 &&
        wSeg.y < dy2 &&
        wSeg.y + wSeg.h > dy1;
      if (overlaps) return false;
    }
    return true;
  });

  return {
    id,
    type,
    rotation,
    x,
    y,
    w: bw,
    h: bh,
    floorColor: floorColors[type] || '#57534e',
    roofColor: roofColors[type] || '#3f3f46',
    rooms,
    walls: safeWalls,
    windows,
    doors,
    doorAndHallCenters,
    furniture,
    lightX: x + bw * 0.5,
    lightY: y + bh * 0.5,
  };
}

function buildingsOverlap(a, b, padding = 220) {
  return !(
    a.x + a.w + padding < b.x ||
    a.x > b.x + b.w + padding ||
    a.y + a.h + padding < b.y ||
    a.y > b.y + b.h + padding
  );
}

export const SPAWN_PROTECTED_RADIUS = 860;

export function generateWorld(seedInput = 4092) {
  const rng = createSeededRng(seedInput);
  const center = WORLD_SIZE / 2; // 10,000, 10,000

  // 1. Sinuous 3-Layer River across 20,000 x 20,000
  const riverPoints = [];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const rx = t * WORLD_SIZE;
    const ry = center + 1850 + Math.sin(t * Math.PI * 2.8) * 1250 + Math.cos(t * Math.PI * 1.4) * 580;
    riverPoints.push({ x: rx, y: ry, width: 360 });
  }

  // 3 Detailed Bridges with Solid Side Railings & Access Ramps
  const bridgeTs = [0.22, 0.50, 0.78];
  const bridges = bridgeTs.map((bt, idx) => {
    const bx = WORLD_SIZE * bt - 150;
    const ry = center + 1850 + Math.sin(bt * Math.PI * 2.8) * 1250 + Math.cos(bt * Math.PI * 1.4) * 580;
    const by = ry - 260;
    const bw = 300;
    const bh = 520;
    return {
      id: `bridge_${idx}`,
      x: bx,
      y: by,
      w: bw,
      h: bh,
      railings: [
        { x: bx, y: by + 24, w: 16, h: bh - 48 },
        { x: bx + bw - 16, y: by + 24, w: 16, h: bh - 48 },
      ],
    };
  });

  // 2. 16 Organic Settlements across the 20,000 x 20,000 Island
  const settlements = [
    { name: 'Puesto Comando Central', x: center, y: center - 980, radius: 1650, count: 7, types: ['military', 'police', 'warehouse', 'hospital', 'cabin', 'military', 'mansion'] },
    { name: 'Aldea del Bosque Norte', x: 3500, y: 3100, radius: 1950, count: 8, types: ['cabin', 'cabin', 'mansion', 'warehouse', 'hospital', 'cabin', 'police', 'mansion'] },
    { name: 'Base Militar Echo', x: 16500, y: 3300, radius: 2050, count: 8, types: ['military', 'military', 'warehouse', 'police', 'hospital', 'military', 'warehouse', 'military'] },
    { name: 'Polígono Industrial Oeste', x: 3000, y: 9200, radius: 1950, count: 8, types: ['warehouse', 'warehouse', 'police', 'cabin', 'mansion', 'warehouse', 'hospital', 'cabin'] },
    { name: 'Complejo Médico Este', x: 16900, y: 9100, radius: 1950, count: 8, types: ['hospital', 'hospital', 'police', 'mansion', 'warehouse', 'cabin', 'hospital', 'police'] },
    { name: 'Granjas del Sur', x: 4100, y: 16500, radius: 2000, count: 8, types: ['cabin', 'mansion', 'warehouse', 'cabin', 'cabin', 'police', 'mansion', 'warehouse'] },
    { name: 'Fuerte Costero Delta', x: 15900, y: 16300, radius: 2050, count: 8, types: ['military', 'warehouse', 'police', 'hospital', 'military', 'mansion', 'military', 'warehouse'] },
    { name: 'Refugio Sierra Norte', x: 10000, y: 2700, radius: 1850, count: 7, types: ['mansion', 'cabin', 'police', 'hospital', 'warehouse', 'cabin', 'mansion'] },
    { name: 'Puerto Fluvial Sur', x: 10200, y: 16800, radius: 1950, count: 8, types: ['warehouse', 'military', 'cabin', 'hospital', 'police', 'warehouse', 'mansion', 'cabin'] },
    { name: 'Guarnición Noroeste', x: 6600, y: 6000, radius: 1800, count: 7, types: ['military', 'cabin', 'police', 'warehouse', 'mansion', 'hospital', 'cabin'] },
    { name: 'Avanzada Noreste', x: 13600, y: 6100, radius: 1800, count: 7, types: ['police', 'hospital', 'cabin', 'warehouse', 'military', 'mansion', 'cabin'] },
    { name: 'Valle Suroeste', x: 6400, y: 13600, radius: 1800, count: 7, types: ['cabin', 'warehouse', 'mansion', 'police', 'cabin', 'hospital', 'warehouse'] },
    { name: 'Cuartel Sureste', x: 13800, y: 13800, radius: 1800, count: 7, types: ['military', 'police', 'warehouse', 'hospital', 'military', 'cabin', 'mansion'] },
    { name: 'Villa del Río Oeste', x: 4800, y: 11200, radius: 1650, count: 6, types: ['cabin', 'mansion', 'warehouse', 'police', 'cabin', 'hospital'] },
    { name: 'Astillero del Este', x: 15200, y: 11300, radius: 1650, count: 6, types: ['warehouse', 'warehouse', 'military', 'police', 'cabin', 'hospital'] },
    { name: 'Cruce Estratégico Sur', x: 10000, y: 14100, radius: 1650, count: 6, types: ['police', 'military', 'hospital', 'warehouse', 'mansion', 'cabin'] },
  ];

  // 3. Clean Ring Road (Carretera Principal Anular) + Secondary Settlement Branches (ZERO center bunching!)
  const ringRoadPoints = [];
  const ringSteps = 48;
  const baseRingR = 5400;
  for (let i = 0; i <= ringSteps; i++) {
    const a = (i / ringSteps) * Math.PI * 2;
    const modR = baseRingR + Math.sin(a * 3) * 420 + Math.cos(a * 2) * 340;
    ringRoadPoints.push({
      x: center + Math.cos(a) * modR,
      y: center + Math.sin(a) * modR,
    });
  }

  const dirtRoads = [
    // Main Ring Road loop
    { points: ringRoadPoints, width: 78, isMainHighway: true },
    // North-South Central Artery passing through Central Bridge
    {
      points: [
        { x: 10000, y: 2700 },
        { x: 10000, y: 6200 },
        { x: 10000, y: 9800 },
        { x: bridges[1].x + bridges[1].w * 0.5, y: bridges[1].y + bridges[1].h * 0.5 },
        { x: 10100, y: 14100 },
        { x: 10200, y: 16800 },
      ],
      width: 74,
      isMainHighway: true,
    },
  ];

  // Connect each settlement smoothly to its nearest Ring Road node (never all converging at one point)
  for (const hub of settlements) {
    let nearestPt = ringRoadPoints[0];
    let minD = Infinity;
    for (const rp of ringRoadPoints) {
      const d = Math.hypot(hub.x - rp.x, hub.y - rp.y);
      if (d < minD) {
        minD = d;
        nearestPt = rp;
      }
    }
    if (minD > 350) {
      const midX = (hub.x + nearestPt.x) * 0.5 + (rng() - 0.5) * 420;
      const midY = (hub.y + nearestPt.y) * 0.5 + (rng() - 0.5) * 420;
      dirtRoads.push({
        x1: nearestPt.x,
        y1: nearestPt.y,
        cx: midX,
        cy: midY,
        x2: hub.x,
        y2: hub.y,
        width: 72,
        isMainHighway: false,
      });
    }
  }

  const buildings = [];
  const crates = [];
  const loot = [];
  const streetlights = [];
  const vehicles = [];
  const weaponKeys = Object.keys(WEAPONS);
  const meleeKeys = Object.keys(MELEE_WEAPONS).filter((k) => k !== 'fists');
  const cardinalRotations = [0, 90, 180, 270];

  const isNearRiver = (px, py, margin = 340) => {
    for (let i = 0; i < riverPoints.length; i++) {
      const rp = riverPoints[i];
      if (Math.abs(px - rp.x) < 420 && Math.abs(py - rp.y) < margin) {
        return true;
      }
    }
    return false;
  };

  const isInsideSpawnExclusion = (px, py, extraRadius = 0) => {
    return Math.hypot(px - center, py - center) < SPAWN_PROTECTED_RADIUS + extraRadius;
  };

  const addBuildingCratesAndLoot = (candidate, idx, bType) => {
    // 2 to 4 interior supply crates placed in room corners with > 95px door clearance
    const crateSpots = [
      { x: candidate.x + 22, y: candidate.y + 56 },
      { x: candidate.x + candidate.w - 68, y: candidate.y + 56 },
      { x: candidate.x + 22, y: candidate.y + candidate.h - 102 },
      { x: candidate.x + candidate.w - 68, y: candidate.y + candidate.h - 102 },
    ];
    const crateCount = 2 + Math.floor(rng() * 3);
    for (let cIdx = 0; cIdx < crateCount; cIdx++) {
      const sp = crateSpots[cIdx % crateSpots.length];
      const cCx = sp.x + 22;
      const cCy = sp.y + 22;
      if (isInsideSpawnExclusion(cCx, cCy)) continue;
      let nearDoor = false;
      for (const dh of candidate.doorAndHallCenters || []) {
        if (Math.hypot(cCx - dh.x, cCy - dh.y) < 96) {
          nearDoor = true;
          break;
        }
      }
      if (!nearDoor) {
        crates.push({
          id: `crate_in_${idx}_${cIdx}`,
          x: sp.x,
          y: sp.y,
          w: 44,
          h: 44,
          hp: 85,
          maxHp: 85,
          type: bType === 'military' && cIdx === 0 ? 'metal' : 'wood',
          tier: bType === 'military' ? 3 : 2,
        });
      }
    }

    // Interior floor loot (Tier-gated by building type for balanced progression, outside spawn exclusion)
    const tier1Pool = ['m9', 'g18c', 'mp5', 'm870', 'famas'];
    const tier2Pool = ['g18c', 'mp5', 'spas12', 'm416', 'ak47', 'famas', 'mosin', 'vector', 'saiga12'];
    const tier3Pool = ['m416', 'ak47', 'scarH', 'dp28', 'saiga12', 'sv98', 'vector'];
    const pool =
      bType === 'military'
        ? tier3Pool
        : bType === 'police' || bType === 'warehouse' || bType === 'mansion'
        ? tier2Pool
        : tier1Pool;
    const wKey = pool[Math.floor(rng() * pool.length)];
    const wData = WEAPONS[wKey] || WEAPONS.m9;

    const wx = candidate.x + candidate.w * 0.28;
    const wy = candidate.y + candidate.h * 0.30;
    if (!isInsideSpawnExclusion(wx, wy)) {
      loot.push(
        {
          id: `loot_b_${idx}_w`,
          kind: 'weapon',
          weaponId: wKey,
          x: wx,
          y: wy,
          inBunker: false,
        },
        {
          id: `loot_b_${idx}_a`,
          kind: 'ammo',
          ammoType: wData.ammoType,
          amount: wData.magSize * 2,
          x: wx + 38,
          y: wy + 12,
          inBunker: false,
        }
      );
    }

    const mx = candidate.x + candidate.w * 0.72;
    const my = candidate.y + candidate.h * 0.72;
    if (!isInsideSpawnExclusion(mx, my)) {
      loot.push({
        id: `loot_b_${idx}_m`,
        kind: 'med',
        medId: bType === 'hospital' || rng() > 0.65 ? 'medkit' : rng() > 0.45 ? 'soda' : 'bandage',
        amount: 1,
        x: mx,
        y: my,
        inBunker: false,
      });
    }

    // Spawn melee weapon or upgraded backpack in buildings (outside spawn exclusion)
    const mlx = candidate.x + candidate.w * 0.68;
    const mly = candidate.y + candidate.h * 0.28;
    if (!isInsideSpawnExclusion(mlx, mly)) {
      if (idx % 2 === 0) {
        const mKey =
          bType === 'military'
            ? meleeKeys[idx % meleeKeys.length]
            : ['bayonet', 'karambit', 'machete', 'nailBat', 'fireAxe', 'pan'][idx % 6];
        loot.push({
          id: `loot_b_${idx}_melee`,
          kind: 'melee',
          meleeId: mKey,
          x: mlx,
          y: mly,
          inBunker: false,
        });
      } else if (idx % 3 === 0) {
        loot.push({
          id: `loot_b_${idx}_pack`,
          kind: 'gear',
          gearType: 'backpack',
          level: bType === 'military' ? 3 : 2,
          x: mlx,
          y: mly,
          inBunker: false,
        });
      }
    }

    streetlights.push({
      id: `lamp_${idx}`,
      x: candidate.x - 32,
      y: candidate.y - 32,
    });
  };

  let bIndex = 0;
  for (const hub of settlements) {
    for (let i = 0; i < hub.count; i++) {
      const bType = hub.types[i % hub.types.length];
      const baseW = bType === 'warehouse' || bType === 'military' ? 490 : bType === 'mansion' ? 450 : 390;
      const baseH = bType === 'warehouse' ? 350 : 320;
      const rot = cardinalRotations[Math.floor(rng() * cardinalRotations.length)];

      let placed = false;
      for (let attempt = 0; attempt < 65 && !placed; attempt++) {
        const ring = Math.floor(attempt / 10);
        const angle = (i / hub.count) * Math.PI * 2 + (rng() - 0.5) * 0.95 + attempt * 0.45;
        const dist = 280 + ring * 290 + rng() * hub.radius;
        const bx = Math.round(hub.x + Math.cos(angle) * dist - baseW * 0.5);
        const by = Math.round(hub.y + Math.sin(angle) * dist - baseH * 0.5);

        if (isInsideSpawnExclusion(bx + baseW * 0.5, by + baseH * 0.5, 220)) continue;
        if (bx < 950 || bx + baseW > WORLD_SIZE - 950 || by < 950 || by + baseH > WORLD_SIZE - 950) continue;
        if (isNearRiver(bx + baseW * 0.5, by + baseH * 0.5, 410)) continue;

        const candidate = buildStructure(`b_${bIndex}`, bx, by, baseW, baseH, bType, rng, rot);
        let overlaps = false;
        for (const existing of buildings) {
          if (buildingsOverlap(candidate, existing, 220)) {
            overlaps = true;
            break;
          }
        }
        if (!overlaps) {
          buildings.push(candidate);
          addBuildingCratesAndLoot(candidate, bIndex, bType);
          bIndex++;
          placed = true;
        }
      }
    }
  }

  // Add rural compounds & outposts across the island with strict 220px separation until >= 112 buildings
  for (let i = 0; i < 180 && buildings.length < 115; i++) {
    const bType = i % 4 === 0 ? 'military' : i % 3 === 0 ? 'mansion' : i % 2 === 0 ? 'cabin' : 'warehouse';
    const baseW = 400;
    const baseH = 320;
    const rot = cardinalRotations[Math.floor(rng() * cardinalRotations.length)];
    for (let attempt = 0; attempt < 55; attempt++) {
      const bx = Math.round(1050 + rng() * (WORLD_SIZE - 2100));
      const by = Math.round(1050 + rng() * (WORLD_SIZE - 2100));
      if (isInsideSpawnExclusion(bx + baseW * 0.5, by + baseH * 0.5, 220)) continue;
      if (isNearRiver(bx + baseW * 0.5, by + baseH * 0.5, 410)) continue;
      const candidate = buildStructure(`b_iso_${bIndex}`, bx, by, baseW, baseH, bType, rng, rot);
      let overlaps = false;
      for (const existing of buildings) {
        if (buildingsOverlap(candidate, existing, 220)) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        buildings.push(candidate);
        addBuildingCratesAndLoot(candidate, bIndex, bType);
        bIndex++;
        break;
      }
    }
  }

  // EXACTLY 2 Driveable Tactical Vehicles across the entire map with moderately reduced HP (no auto-respawn)
  vehicles.push(
    {
      id: 'veh_command_humvee',
      x: center - 320,
      y: center - 190,
      w: 86,
      h: 46,
      angle: 0,
      speed: 0,
      vx: 0,
      vy: 0,
      maxSpeed: 380,
      hp: 280,
      maxHp: 280,
      driveable: true,
      destroyed: false,
      kind: 'humvee',
      name: 'Humvee Blindado',
      color: '#3f6212',
    },
    {
      id: 'veh_command_cruiser',
      x: center + 320,
      y: center - 190,
      w: 84,
      h: 44,
      angle: Math.PI,
      speed: 0,
      vx: 0,
      vy: 0,
      maxSpeed: 415,
      hp: 230,
      maxHp: 230,
      driveable: true,
      destroyed: false,
      kind: 'cruiser',
      name: 'Patrulla Táctica',
      color: '#1e3a8a',
    }
  );

  // Outdoor crates (strictly outside SPAWN_PROTECTED_RADIUS)
  for (let i = 0; i < 160; i++) {
    const cx = 1400 + rng() * (WORLD_SIZE - 2800);
    const cy = 1400 + rng() * (WORLD_SIZE - 2800);
    if (isInsideSpawnExclusion(cx, cy)) continue;
    if (isNearRiver(cx, cy, 260)) continue;
    let insideB = false;
    for (const b of buildings) {
      if (cx > b.x - 40 && cx < b.x + b.w + 40 && cy > b.y - 40 && cy < b.y + b.h + 40) {
        insideB = true;
        break;
      }
    }
    if (insideB) continue;

    const isMetal = rng() > 0.78;
    crates.push({
      id: `crate_w_${i}`,
      x: cx,
      y: cy,
      w: isMetal ? 56 : 48,
      h: isMetal ? 56 : 48,
      hp: isMetal ? 130 : 70,
      maxHp: isMetal ? 130 : 70,
      type: isMetal ? 'metal' : 'wood',
      tier: isMetal ? 3 : 1,
    });
  }

  // Multi-lobe Destructible Trees (hp: 160) and 9-vertex Faceted Destructible Stones (hp: 240)
  const trees = [];
  const stones = [];
  for (let i = 0; i < 420; i++) {
    const tx = 1100 + rng() * (WORLD_SIZE - 2200);
    const ty = 1100 + rng() * (WORLD_SIZE - 2200);
    if (Math.hypot(tx - center, ty - center) < 420) continue;
    if (isNearRiver(tx, ty, 250)) continue;
    let blocked = false;
    for (const b of buildings) {
      if (tx > b.x - 90 && tx < b.x + b.w + 90 && ty > b.y - 90 && ty < b.y + b.h + 90) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    const crownR = 60 + rng() * 28;
    const lobes = [];
    for (let l = 0; l < 6; l++) {
      const la = (l * Math.PI * 2) / 6 + (rng() - 0.5) * 0.4;
      const ld = crownR * (0.38 + rng() * 0.16);
      lobes.push({
        dx: Math.cos(la) * ld,
        dy: Math.sin(la) * ld,
        r: crownR * (0.52 + rng() * 0.14),
      });
    }
    trees.push({
      id: `tree_${i}`,
      x: tx,
      y: ty,
      trunkR: 17,
      crownR,
      lobes,
      hp: 160,
      maxHp: 160,
      destroyed: false,
    });
  }

  for (let i = 0; i < 210; i++) {
    const sx = 1100 + rng() * (WORLD_SIZE - 2200);
    const sy = 1100 + rng() * (WORLD_SIZE - 2200);
    if (Math.hypot(sx - center, sy - center) < 420) continue;
    if (isNearRiver(sx, sy, 230)) continue;
    let blocked = false;
    for (const b of buildings) {
      if (sx > b.x - 80 && sx < b.x + b.w + 80 && sy > b.y - 80 && sy < b.y + b.h + 80) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    const r = 28 + rng() * 22;
    const vCount = 9;
    const vertices = [];
    for (let v = 0; v < vCount; v++) {
      const va = (v / vCount) * Math.PI * 2;
      const vr = r * (0.78 + rng() * 0.34);
      vertices.push({ dx: Math.cos(va) * vr, dy: Math.sin(va) * vr });
    }
    stones.push({
      id: `stone_${i}`,
      x: sx,
      y: sy,
      r,
      vertices,
      mossy: rng() > 0.45,
      hp: 240,
      maxHp: 240,
      destroyed: false,
    });
  }

  // 5 Underground Bunker Entrances
  const bunkerEntrances = [
    { id: 'bunker_hydra', name: 'BÚNKER HYDRA (ARSENAL)', x: center + 440, y: center - 340, w: 96, h: 96 },
    { id: 'bunker_alpha', name: 'BÚNKER ALPHA (MÉDICO)', x: 4400, y: 4000, w: 96, h: 96 },
    { id: 'bunker_echo', name: 'BÚNKER ECHO (LABORATORIO)', x: 15400, y: 4300, w: 96, h: 96 },
    { id: 'bunker_delta', name: 'BÚNKER DELTA (DEPÓSITO)', x: 15000, y: 15400, w: 96, h: 96 },
    { id: 'bunker_omega', name: 'BÚNKER OMEGA (ALTO RIESGO)', x: 5000, y: 15600, w: 96, h: 96 },
  ];

  const baseOuterWalls = [
    { x: center - 720, y: center - 540, w: 1440, h: 24 },
    { x: center - 720, y: center + 516, w: 1440, h: 24 },
    { x: center - 720, y: center - 540, w: 24, h: 1080 },
    { x: center + 696, y: center - 540, w: 24, h: 1080 },
  ];

  // 5 Distinct Furnished Underground Bunkers
  const bunkersById = {
    bunker_hydra: {
      id: 'bunker_hydra',
      name: 'BÚNKER HYDRA — ARSENAL MILITAR',
      themeColor: '#f59e0b',
      floorTint: '#1e293b',
      x: center - 720,
      y: center - 540,
      w: 1440,
      h: 1080,
      stairsExit: { x: center - 600, y: center - 420, w: 96, h: 96 },
      rooms: [
        { name: 'Vestíbulo Táctico', x: center - 696, y: center - 516, w: 556, h: 1032, color: '#1e293b' },
        { name: 'Armería Norte', x: center - 116, y: center - 516, w: 812, h: 490, color: '#273549' },
        { name: 'Barracones Sur', x: center - 116, y: center - 2, w: 812, h: 518, color: '#1f2937' },
      ],
      walls: [
        ...baseOuterWalls,
        { x: center - 140, y: center - 540, w: 24, h: 380 },
        { x: center - 140, y: center + 80, w: 24, h: 460 },
        { x: center - 116, y: center - 26, w: 340, h: 20 },
        { x: center + 360, y: center - 26, w: 336, h: 20 },
      ],
      furniture: [
        { id: 'hyd_f1', x: center - 660, y: center + 380, w: 54, h: 32, kind: 'generator', color: '#ca8a04', solid: true, hp: 140, maxHp: 140, material: 'metal' },
        { id: 'hyd_f2', x: center - 80, y: center - 490, w: 84, h: 22, kind: 'gun_rack', color: '#334155', solid: true, hp: 150, maxHp: 150, material: 'metal' },
        { id: 'hyd_f3', x: center + 40, y: center - 490, w: 84, h: 22, kind: 'gun_rack', color: '#334155', solid: true, hp: 150, maxHp: 150, material: 'metal' },
        { id: 'hyd_f4', x: center + 540, y: center - 490, w: 68, h: 24, kind: 'locker', color: '#475569', solid: true, hp: 130, maxHp: 130, material: 'metal' },
        { id: 'hyd_f5', x: center + 520, y: center + 430, w: 64, h: 38, kind: 'bed', color: '#15803d', solid: true, hp: 110, maxHp: 110, material: 'wood' },
        { id: 'hyd_f6', x: center + 420, y: center + 430, w: 64, h: 38, kind: 'bed', color: '#15803d', solid: true, hp: 110, maxHp: 110, material: 'wood' },
        { id: 'hyd_f7', x: center - 70, y: center + 430, w: 64, h: 32, kind: 'desk', color: '#334155', solid: true, hp: 100, maxHp: 100, material: 'metal' },
        { id: 'hyd_f8', x: center + 630, y: center - 120, w: 28, h: 28, kind: 'barrel_explosive', color: '#dc2626', solid: true, hp: 75, maxHp: 75, material: 'metal' },
      ],
      crates: [
        { id: 'hyd_c1', x: center + 580, y: center - 380, w: 50, h: 50, hp: 120, maxHp: 120, type: 'metal', tier: 3 },
        { id: 'hyd_c2', x: center + 580, y: center + 260, w: 48, h: 48, hp: 90, maxHp: 90, type: 'wood', tier: 2 },
      ],
    },

    bunker_alpha: {
      id: 'bunker_alpha',
      name: 'BÚNKER ALPHA — INSTALACIÓN MÉDICA SUBTERRÁNEA',
      themeColor: '#22c55e',
      floorTint: '#1e3a3a',
      x: center - 720,
      y: center - 540,
      w: 1440,
      h: 1080,
      stairsExit: { x: center - 600, y: center - 420, w: 96, h: 96 },
      rooms: [
        { name: 'Recepción de Triaje', x: center - 696, y: center - 516, w: 516, h: 1032, color: '#1f2e3d' },
        { name: 'Pabellón Quirúrgico', x: center - 156, y: center - 516, w: 852, h: 510, color: '#243b4a' },
        { name: 'Farmacia y Reservas', x: center - 156, y: center + 18, w: 852, h: 498, color: '#1b323b' },
      ],
      walls: [
        ...baseOuterWalls,
        { x: center - 180, y: center - 540, w: 24, h: 360 },
        { x: center - 180, y: center + 60, w: 24, h: 480 },
        { x: center - 156, y: center - 6, w: 420, h: 20 },
        { x: center + 410, y: center - 6, w: 286, h: 20 },
      ],
      furniture: [
        { id: 'alp_f1', x: center + 40, y: center - 470, w: 66, h: 34, kind: 'medbed', color: '#0284c7', solid: true, hp: 110, maxHp: 110, material: 'metal' },
        { id: 'alp_f2', x: center + 160, y: center - 470, w: 66, h: 34, kind: 'medbed', color: '#0284c7', solid: true, hp: 110, maxHp: 110, material: 'metal' },
        { id: 'alp_f3', x: center + 280, y: center - 470, w: 66, h: 34, kind: 'medbed', color: '#0284c7', solid: true, hp: 110, maxHp: 110, material: 'metal' },
        { id: 'alp_f4', x: center + 540, y: center - 470, w: 62, h: 26, kind: 'desk', color: '#475569', solid: true, hp: 95, maxHp: 95, material: 'metal' },
        { id: 'alp_f5', x: center + 40, y: center + 430, w: 72, h: 24, kind: 'locker', color: '#38bdf8', solid: true, hp: 120, maxHp: 120, material: 'metal' },
        { id: 'alp_f6', x: center + 160, y: center + 430, w: 72, h: 24, kind: 'locker', color: '#38bdf8', solid: true, hp: 120, maxHp: 120, material: 'metal' },
        { id: 'alp_f7', x: center - 650, y: center + 410, w: 54, h: 32, kind: 'generator', color: '#ca8a04', solid: true, hp: 140, maxHp: 140, material: 'metal' },
      ],
      crates: [
        { id: 'alp_c1', x: center + 580, y: center + 360, w: 48, h: 48, hp: 90, maxHp: 90, type: 'wood', tier: 2 },
        { id: 'alp_c2', x: center + 580, y: center + 280, w: 48, h: 48, hp: 90, maxHp: 90, type: 'wood', tier: 2 },
      ],
    },

    bunker_echo: {
      id: 'bunker_echo',
      name: 'BÚNKER ECHO — LABORATORIO CIENTÍFICO',
      themeColor: '#38bdf8',
      floorTint: '#172554',
      x: center - 720,
      y: center - 540,
      w: 1440,
      h: 1080,
      stairsExit: { x: center - 600, y: center - 420, w: 96, h: 96 },
      rooms: [
        { name: 'Esclusa de Descontaminación', x: center - 696, y: center - 516, w: 490, h: 1032, color: '#1e293b' },
        { name: 'Centro de Cómputo y Radares', x: center - 182, y: center - 516, w: 878, h: 500, color: '#172554' },
        { name: 'Laboratorio de Bio-Contención', x: center - 182, y: center + 8, w: 878, h: 508, color: '#1e3a5f' },
      ],
      walls: [
        ...baseOuterWalls,
        { x: center - 206, y: center - 540, w: 24, h: 350 },
        { x: center - 206, y: center + 50, w: 24, h: 490 },
        { x: center - 182, y: center - 16, w: 360, h: 20 },
        { x: center + 330, y: center - 16, w: 366, h: 20 },
      ],
      furniture: [
        { id: 'ech_f1', x: center - 90, y: center - 480, w: 74, h: 30, kind: 'desk', color: '#0284c7', solid: true, hp: 105, maxHp: 105, material: 'metal' },
        { id: 'ech_f2', x: center + 30, y: center - 480, w: 74, h: 30, kind: 'desk', color: '#0284c7', solid: true, hp: 105, maxHp: 105, material: 'metal' },
        { id: 'ech_f3', x: center + 150, y: center - 480, w: 74, h: 30, kind: 'desk', color: '#0284c7', solid: true, hp: 105, maxHp: 105, material: 'metal' },
        { id: 'ech_f4', x: center + 520, y: center - 480, w: 60, h: 34, kind: 'generator', color: '#38bdf8', solid: true, hp: 150, maxHp: 150, material: 'metal' },
        { id: 'ech_f5', x: center + 40, y: center + 430, w: 66, h: 34, kind: 'medbed', color: '#38bdf8', solid: true, hp: 110, maxHp: 110, material: 'metal' },
        { id: 'ech_f6', x: center + 560, y: center + 420, w: 28, h: 28, kind: 'barrel_explosive', color: '#dc2626', solid: true, hp: 75, maxHp: 75, material: 'metal' },
      ],
      crates: [
        { id: 'ech_c1', x: center + 580, y: center - 320, w: 52, h: 52, hp: 130, maxHp: 130, type: 'metal', tier: 3 },
        { id: 'ech_c2', x: center + 580, y: center + 280, w: 48, h: 48, hp: 100, maxHp: 100, type: 'wood', tier: 2 },
      ],
    },

    bunker_delta: {
      id: 'bunker_delta',
      name: 'BÚNKER DELTA — DEPÓSITO LOGÍSTICO MILITAR',
      themeColor: '#a3e635',
      floorTint: '#1c2826',
      x: center - 720,
      y: center - 540,
      w: 1440,
      h: 1080,
      stairsExit: { x: center - 600, y: center - 420, w: 96, h: 96 },
      rooms: [
        { name: 'Bahía de Carga', x: center - 696, y: center - 516, w: 540, h: 1032, color: '#27272a' },
        { name: 'Almacén de Ingenieros', x: center - 132, y: center - 516, w: 828, h: 1032, color: '#1f2937' },
      ],
      walls: [
        ...baseOuterWalls,
        { x: center - 156, y: center - 540, w: 24, h: 380 },
        { x: center - 156, y: center + 80, w: 24, h: 460 },
      ],
      furniture: [
        { id: 'del_f1', x: center - 60, y: center - 480, w: 82, h: 24, kind: 'gun_rack', color: '#365314', solid: true, hp: 140, maxHp: 140, material: 'metal' },
        { id: 'del_f2', x: center + 60, y: center - 480, w: 82, h: 24, kind: 'locker', color: '#475569', solid: true, hp: 140, maxHp: 140, material: 'metal' },
        { id: 'del_f3', x: center + 540, y: center - 470, w: 58, h: 34, kind: 'generator', color: '#ca8a04', solid: true, hp: 140, maxHp: 140, material: 'metal' },
        { id: 'del_f4', x: center + 540, y: center + 430, w: 58, h: 34, kind: 'generator', color: '#ca8a04', solid: true, hp: 140, maxHp: 140, material: 'metal' },
        { id: 'del_f5', x: center - 60, y: center + 440, w: 64, h: 36, kind: 'bed', color: '#15803d', solid: true, hp: 110, maxHp: 110, material: 'wood' },
        { id: 'del_f6', x: center + 610, y: center, w: 28, h: 28, kind: 'barrel_explosive', color: '#dc2626', solid: true, hp: 75, maxHp: 75, material: 'metal' },
      ],
      crates: [
        { id: 'del_c1', x: center + 460, y: center - 340, w: 52, h: 52, hp: 120, maxHp: 120, type: 'metal', tier: 3 },
        { id: 'del_c2', x: center + 530, y: center - 340, w: 48, h: 48, hp: 90, maxHp: 90, type: 'wood', tier: 2 },
        { id: 'del_c3', x: center + 460, y: center + 280, w: 52, h: 52, hp: 120, maxHp: 120, type: 'metal', tier: 3 },
      ],
    },

    bunker_omega: {
      id: 'bunker_omega',
      name: 'BÚNKER OMEGA — COMANDO CENTRAL DE ALTO RIESGO',
      themeColor: '#ef4444',
      floorTint: '#2a1215',
      highRisk: true,
      guardsSpawned: false,
      x: center - 720,
      y: center - 540,
      w: 1440,
      h: 1080,
      stairsExit: { x: center - 600, y: center - 420, w: 96, h: 96 },
      rooms: [
        { name: 'Zona de Seguridad Omega', x: center - 696, y: center - 516, w: 500, h: 1032, color: '#1f161b' },
        { name: 'Bóveda de Armas Míticas', x: center - 172, y: center - 516, w: 868, h: 500, color: '#2d161d' },
        { name: 'Sala de Guerra Estratégica', x: center - 172, y: center + 8, w: 868, h: 508, color: '#1e1b2e' },
      ],
      walls: [
        ...baseOuterWalls,
        { x: center - 196, y: center - 540, w: 24, h: 360 },
        { x: center - 196, y: center + 60, w: 24, h: 480 },
        { x: center - 172, y: center - 16, w: 380, h: 20 },
        { x: center + 360, y: center - 16, w: 336, h: 20 },
      ],
      furniture: [
        { id: 'omg_f1', x: center - 80, y: center - 485, w: 90, h: 24, kind: 'gun_rack', color: '#991b1b', solid: true, hp: 160, maxHp: 160, material: 'metal' },
        { id: 'omg_f2', x: center + 50, y: center - 485, w: 90, h: 24, kind: 'gun_rack', color: '#991b1b', solid: true, hp: 160, maxHp: 160, material: 'metal' },
        { id: 'omg_f3', x: center + 530, y: center - 480, w: 64, h: 34, kind: 'generator', color: '#dc2626', solid: true, hp: 160, maxHp: 160, material: 'metal' },
        { id: 'omg_f4', x: center + 50, y: center + 430, w: 84, h: 32, kind: 'desk', color: '#1e293b', solid: true, hp: 120, maxHp: 120, material: 'metal' },
        { id: 'omg_f5', x: center + 610, y: center - 220, w: 28, h: 28, kind: 'barrel_explosive', color: '#dc2626', solid: true, hp: 75, maxHp: 75, material: 'metal' },
        { id: 'omg_f6', x: center + 610, y: center + 220, w: 28, h: 28, kind: 'barrel_explosive', color: '#dc2626', solid: true, hp: 75, maxHp: 75, material: 'metal' },
      ],
      crates: [
        { id: 'omg_c1', x: center + 560, y: center - 360, w: 56, h: 56, hp: 140, maxHp: 140, type: 'metal', tier: 4 },
        { id: 'omg_c2', x: center + 560, y: center + 340, w: 56, h: 56, hp: 140, maxHp: 140, type: 'metal', tier: 4 },
      ],
    },
  };

  const bunker = bunkersById.bunker_hydra;

  // Thematic loot for each of the 5 underground bunkers
  loot.push(
    // 1. Hydra (Military Arsenal)
    { id: 'bunker_hyd_scar', kind: 'weapon', weaponId: 'scarH', x: center + 160, y: center - 280, inBunker: true, bunkerId: 'bunker_hydra' },
    { id: 'bunker_hyd_dp28', kind: 'weapon', weaponId: 'dp28', x: center + 320, y: center - 280, inBunker: true, bunkerId: 'bunker_hydra' },
    { id: 'bunker_hyd_axe', kind: 'melee', meleeId: 'fireAxe', x: center + 240, y: center + 180, inBunker: true, bunkerId: 'bunker_hydra' },
    { id: 'bunker_hyd_a762', kind: 'ammo', ammoType: '7.62', amount: 90, x: center + 160, y: center - 190, inBunker: true, bunkerId: 'bunker_hydra' },
    { id: 'bunker_hyd_vest', kind: 'gear', gearType: 'vest', level: 3, x: center + 380, y: center + 180, inBunker: true, bunkerId: 'bunker_hydra' },

    // 2. Alpha (Medical Facility)
    { id: 'bunker_alp_med1', kind: 'med', medId: 'medkit', amount: 2, x: center + 120, y: center - 260, inBunker: true, bunkerId: 'bunker_alpha' },
    { id: 'bunker_alp_med2', kind: 'med', medId: 'bandage', amount: 4, x: center + 240, y: center - 260, inBunker: true, bunkerId: 'bunker_alpha' },
    { id: 'bunker_alp_pills', kind: 'med', medId: 'pills', amount: 2, x: center + 180, y: center + 180, inBunker: true, bunkerId: 'bunker_alpha' },
    { id: 'bunker_alp_soda', kind: 'med', medId: 'soda', amount: 3, x: center + 310, y: center + 180, inBunker: true, bunkerId: 'bunker_alpha' },
    { id: 'bunker_alp_m416', kind: 'weapon', weaponId: 'm416', x: center + 420, y: center - 240, inBunker: true, bunkerId: 'bunker_alpha' },

    // 3. Echo (Scientific Laboratory)
    { id: 'bunker_ech_vec', kind: 'weapon', weaponId: 'vector', x: center + 160, y: center - 250, inBunker: true, bunkerId: 'bunker_echo' },
    { id: 'bunker_ech_sv98', kind: 'weapon', weaponId: 'sv98', x: center + 320, y: center - 250, inBunker: true, bunkerId: 'bunker_echo' },
    { id: 'bunker_ech_sc4', kind: 'scope', scope: 4, x: center + 180, y: center + 190, inBunker: true, bunkerId: 'bunker_echo' },
    { id: 'bunker_ech_sc8', kind: 'scope', scope: 8, x: center + 310, y: center + 190, inBunker: true, bunkerId: 'bunker_echo' },
    { id: 'bunker_ech_kar', kind: 'melee', meleeId: 'karambit', x: center + 420, y: center + 190, inBunker: true, bunkerId: 'bunker_echo' },

    // 4. Delta (Military Supply Depot)
    { id: 'bunker_del_saiga', kind: 'weapon', weaponId: 'saiga12', x: center + 150, y: center - 220, inBunker: true, bunkerId: 'bunker_delta' },
    { id: 'bunker_del_turret', kind: 'throwable', throwableId: 'turret', amount: 2, x: center + 290, y: center - 220, inBunker: true, bunkerId: 'bunker_delta' },
    { id: 'bunker_del_bar', kind: 'throwable', throwableId: 'barricade', amount: 3, x: center + 180, y: center + 160, inBunker: true, bunkerId: 'bunker_delta' },
    { id: 'bunker_del_pack', kind: 'gear', gearType: 'backpack', level: 3, x: center + 330, y: center + 160, inBunker: true, bunkerId: 'bunker_delta' },
    { id: 'bunker_del_a12g', kind: 'ammo', ammoType: '12g', amount: 36, x: center + 430, y: center - 220, inBunker: true, bunkerId: 'bunker_delta' },

    // 5. Omega (High-Risk Command Installation — Best Mythic Loot)
    { id: 'bunker_omg_awm', kind: 'weapon', weaponId: 'awm', x: center + 180, y: center - 260, inBunker: true, bunkerId: 'bunker_omega' },
    { id: 'bunker_omg_m249', kind: 'weapon', weaponId: 'm249', x: center + 340, y: center - 260, inBunker: true, bunkerId: 'bunker_omega' },
    { id: 'bunker_omg_usas', kind: 'weapon', weaponId: 'usas12', x: center + 260, y: center + 200, inBunker: true, bunkerId: 'bunker_omega' },
    { id: 'bunker_omg_potato', kind: 'weapon', weaponId: 'potatoCannon', x: center + 420, y: center + 200, inBunker: true, bunkerId: 'bunker_omega' },
    { id: 'bunker_omg_katana', kind: 'melee', meleeId: 'katana', x: center + 140, y: center + 200, inBunker: true, bunkerId: 'bunker_omega' },
    { id: 'bunker_omg_a50', kind: 'ammo', ammoType: '.50', amount: 25, x: center + 260, y: center - 170, inBunker: true, bunkerId: 'bunker_omega' },
    { id: 'bunker_omg_helm', kind: 'gear', gearType: 'helmet', level: 3, x: center + 440, y: center - 260, inBunker: true, bunkerId: 'bunker_omega' }
  );

  // 14 Tactical Vendor Stations (🛒)
  const vendors = [
    { id: 'v_0', x: center - 240, y: center + 140, r: 40, name: 'ARMERÍA CENTRAL' },
    { id: 'v_1', x: 4200, y: 3600, r: 40, name: 'TIENDA BOSQUE NORTE' },
    { id: 'v_2', x: 15600, y: 3900, r: 40, name: 'TIENDA BASE ECHO' },
    { id: 'v_3', x: 3600, y: 9600, r: 40, name: 'TIENDA OESTE' },
    { id: 'v_4', x: 16200, y: 9300, r: 40, name: 'TIENDA CLÍNICA ESTE' },
    { id: 'v_5', x: 4800, y: 15600, r: 40, name: 'TIENDA GRANJAS SUR' },
    { id: 'v_6', x: 15200, y: 15400, r: 40, name: 'TIENDA FUERTE DELTA' },
    { id: 'v_7', x: 10000, y: 3200, r: 40, name: 'TIENDA SIERRA' },
    { id: 'v_8', x: 10200, y: 15700, r: 40, name: 'TIENDA PUERTO SUR' },
    { id: 'v_9', x: 6800, y: 6400, r: 40, name: 'TIENDA NOROESTE' },
    { id: 'v_10', x: 13400, y: 6500, r: 40, name: 'TIENDA NORESTE' },
    { id: 'v_11', x: 7200, y: 12800, r: 40, name: 'TIENDA PUENTE OESTE' },
    { id: 'v_12', x: 12800, y: 12700, r: 40, name: 'TIENDA PUENTE ESTE' },
    { id: 'v_13', x: 10000, y: 11600, r: 40, name: 'TIENDA RÍO CENTRAL' },
  ];

  return {
    size: WORLD_SIZE,
    seed: seedInput,
    center,
    settlements,
    ringRoadPoints,
    dirtRoads,
    riverPoints,
    bridges,
    buildings,
    crates,
    barricades: [],
    streetlights,
    vehicles,
    trees,
    stones,
    loot,
    bunkerStairsSurface: bunkerEntrances[0],
    bunkerEntrances,
    bunkersById,
    bunker,
    vendor: vendors[0],
    vendors,
  };
}
