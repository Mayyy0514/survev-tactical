const patternCache = new Map();

function createOffscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Generates a rich 256x256 procedural terrain texture pixel-by-pixel via ImageData
 * plus organic grass blades, clovers, pebbles, and soil cracks.
 */
export function getGrassPattern(ctx, biome) {
  const key = `grass_256_${biome.id}`;
  if (patternCache.has(key)) return patternCache.get(key);

  const c = createOffscreen(256, 256);
  const g = c.getContext('2d');
  const base = hexToRgb(biome.bg || '#4b6e35');

  const imgData = g.createImageData(256, 256);
  const data = imgData.data;
  let seed = (biome.id.charCodeAt(0) * 1337 + 91) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed & 0xffff) / 0xffff;
  };

  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const idx = (y * 256 + x) * 4;
      const wave = Math.sin(x * 0.07) * Math.cos(y * 0.07) * 8;
      const grain = (rand() - 0.5) * 14;
      const delta = wave + grain;
      data[idx] = Math.max(0, Math.min(255, base.r + delta));
      data[idx + 1] = Math.max(0, Math.min(255, base.g + delta));
      data[idx + 2] = Math.max(0, Math.min(255, base.b + delta));
      data[idx + 3] = 255;
    }
  }
  g.putImageData(imgData, 0, 0);

  // Organic turf patches
  for (let i = 0; i < 28; i++) {
    const px = rand() * 256;
    const py = rand() * 256;
    const pr = 12 + rand() * 22;
    g.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
    g.beginPath();
    g.arc(px, py, pr, 0, Math.PI * 2);
    g.fill();
  }

  // Individual grass blades, clovers, and micro pebbles
  g.lineWidth = 1.3;
  for (let i = 0; i < 110; i++) {
    const bx = rand() * 250 + 3;
    const by = rand() * 250 + 3;
    g.strokeStyle = i % 3 === 0 ? 'rgba(20, 40, 12, 0.32)' : 'rgba(255, 255, 255, 0.12)';
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx - 2 + rand() * 4, by - 5 - rand() * 4);
    g.stroke();
  }

  // Clover clusters & small pebbles
  for (let i = 0; i < 24; i++) {
    const cx = rand() * 246 + 5;
    const cy = rand() * 246 + 5;
    if (i % 2 === 0) {
      g.fillStyle = 'rgba(30, 65, 22, 0.35)';
      g.beginPath();
      g.arc(cx - 2, cy, 2.2, 0, Math.PI * 2);
      g.arc(cx + 2, cy, 2.2, 0, Math.PI * 2);
      g.arc(cx, cy - 2, 2.2, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = 'rgba(148, 163, 184, 0.28)';
      g.beginPath();
      g.arc(cx, cy, 1.8 + rand() * 1.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  const pat = ctx.createPattern(c, 'repeat') || biome.bg;
  patternCache.set(key, pat);
  return pat;
}

export function getSandPattern(ctx, biome) {
  const key = `sand_256_${biome.id}`;
  if (patternCache.has(key)) return patternCache.get(key);

  const c = createOffscreen(256, 256);
  const g = c.getContext('2d');
  const base = hexToRgb(biome.sand || '#c9b37e');

  const imgData = g.createImageData(256, 256);
  const data = imgData.data;
  let seed = 7719;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed & 0xffff) / 0xffff;
  };

  for (let i = 0; i < data.length; i += 4) {
    const grain = (rand() - 0.5) * 16;
    data[i] = Math.max(0, Math.min(255, base.r + grain));
    data[i + 1] = Math.max(0, Math.min(255, base.g + grain));
    data[i + 2] = Math.max(0, Math.min(255, base.b + grain));
    data[i + 3] = 255;
  }
  g.putImageData(imgData, 0, 0);

  // Sand ripples & shells/pebbles
  g.strokeStyle = 'rgba(0, 0, 0, 0.07)';
  g.lineWidth = 1.5;
  for (let y = 24; y < 256; y += 36) {
    g.beginPath();
    g.moveTo(12, y);
    g.quadraticCurveTo(128, y + 8, 244, y);
    g.stroke();
  }

  const pat = ctx.createPattern(c, 'repeat') || biome.sand;
  patternCache.set(key, pat);
  return pat;
}

export function getBunkerPattern(ctx) {
  const key = 'bunker_metal_128';
  if (patternCache.has(key)) return patternCache.get(key);

  const c = createOffscreen(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#1e293b';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#0f172a';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 64, 64);
  g.strokeRect(64, 0, 64, 64);
  g.strokeRect(0, 64, 64, 64);
  g.strokeRect(64, 64, 64, 64);

  // Diamond plate tread & rivets
  g.fillStyle = '#334155';
  for (let y = 8; y < 128; y += 16) {
    for (let x = 8; x < 128; x += 16) {
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  }

  const pat = ctx.createPattern(c, 'repeat') || '#1e293b';
  patternCache.set(key, pat);
  return pat;
}
