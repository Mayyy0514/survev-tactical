import { WEAPONS } from '../config/constants.js';
import {
  distSq,
  resolveEntityCollisions,
  applyAdrenalineTick,
  raycastObstacles,
  computeSmartSteerAngle,
  lerpAngle,
  clamp,
} from './gameLogic.js';

const BOT_PROFILES = [
  { id: 'bot_1', name: 'LOGAN', role: 'Asalto', weaponId: 'm416', color: '#38bdf8' },
  { id: 'bot_2', name: 'WYATT', role: 'Médico', weaponId: 'mp5', color: '#4ade80' },
  { id: 'bot_3', name: 'NOLAN', role: 'Artillero', weaponId: 'ak47', color: '#f97316' },
  { id: 'bot_4', name: 'BRODY', role: 'Tirador', weaponId: 'm870', color: '#c084fc' },
];

export function createAISquad(centerX, centerY, count = 4) {
  const offsets = [
    { dx: -160, dy: -140 },
    { dx: 160, dy: -140 },
    { dx: -160, dy: 140 },
    { dx: 160, dy: 140 },
  ];

  return BOT_PROFILES.slice(0, count).map((prof, idx) => {
    const w = WEAPONS[prof.weaponId] || WEAPONS.m416;
    return {
      id: prof.id,
      name: prof.name,
      role: prof.role,
      color: prof.color,
      x: centerX + offsets[idx].dx,
      y: centerY + offsets[idx].dy,
      lastCheckX: centerX + offsets[idx].dx,
      lastCheckY: centerY + offsets[idx].dy,
      stuckCheckTimer: 0.6,
      unstuckTimer: 0,
      unstuckAngle: 0,
      vx: 0,
      vy: 0,
      r: 20,
      angle: 0,
      moveAngle: 0,
      hp: 120,
      maxHp: 120,
      adrenaline: 55,
      armorLevel: 2,
      helmetLevel: 2,
      weaponId: prof.weaponId,
      mag: w.magSize,
      reloading: 0,
      reloadTotal: w.reloadTime,
      fireTimer: 0,
      downed: false,
      reviveProgress: 0,
      inBunker: false,
      medkits: 3,
      bandages: 5,
      sodas: 2,
      pills: 2,
      roamTarget: null,
      roamTimer: 0,
      holdPos: null,
      crateHitTimer: 0,
      chatBubble: null,
      calloutCooldown: 2 + idx * 1.5,
    };
  });
}

export function setBotChatBubble(bot, text, duration = 4.2) {
  if (!bot || !text) return;
  const cleanText = String(text).trim().slice(0, 76);
  if (!cleanText) return;
  bot.chatBubble = {
    id: `bub_${Date.now()}_${Math.random()}`,
    text: cleanText,
    timer: duration,
    maxTimer: duration,
  };
}

export function updateAISquad(engine, dt) {
  const { player, allies, zombies, world } = engine;
  const cmd = engine.squadCommand || 'free';

  const formationOffsets = [
    { x: -115, y: -95 },
    { x: 115, y: -95 },
    { x: -135, y: 105 },
    { x: 135, y: 105 },
  ];

  for (let idx = 0; idx < allies.length; idx++) {
    const bot = allies[idx];
    bot.inBunker = player.inBunker;

    if (bot.chatBubble) {
      bot.chatBubble.timer -= dt;
      if (bot.chatBubble.timer <= 0) {
        bot.chatBubble = null;
      }
    }
    if (bot.calloutCooldown > 0) {
      bot.calloutCooldown = Math.max(0, bot.calloutCooldown - dt);
    }

    // 1. If bot is downed, wait for player or another bot to revive
    if (bot.downed) {
      bot.vx = 0;
      bot.vy = 0;
      if (!bot.chatBubble && (bot.calloutCooldown || 0) <= 0) {
        setBotChatBubble(bot, '¡Estoy caído! ¡Necesito reanimación!', 3.8);
        bot.calloutCooldown = 9.0;
      }
      let reviverNear = distSq(bot.x, bot.y, player.x, player.y) < 75 * 75 && !player.downed;
      if (!reviverNear) {
        for (const other of allies) {
          if (other.id !== bot.id && !other.downed && distSq(bot.x, bot.y, other.x, other.y) < 75 * 75) {
            reviverNear = true;
            break;
          }
        }
      }
      if (reviverNear) {
        bot.reviveProgress += dt * 0.45;
        if (bot.reviveProgress >= 1) {
          bot.downed = false;
          bot.hp = Math.round(bot.maxHp * 0.6);
          bot.reviveProgress = 0;
          setBotChatBubble(bot, '¡De vuelta en pie! Gracias por el apoyo.', 3.6);
          bot.calloutCooldown = 5.0;
        }
      } else {
        bot.reviveProgress = Math.max(0, bot.reviveProgress - dt * 0.2);
      }
      continue;
    }

    const speedBoost = applyAdrenalineTick(bot, dt);
    bot.roamTimer = Math.max(0, (bot.roamTimer || 0) - dt);
    bot.crateHitTimer = Math.max(0, (bot.crateHitTimer || 0) - dt);
    bot.unstuckTimer = Math.max(0, (bot.unstuckTimer || 0) - dt);

    // 2. Self-heal or boost adrenaline when low
    if (bot.hp < 55 && bot.medkits > 0) {
      bot.medkits--;
      bot.hp = Math.min(bot.maxHp, bot.hp + 70);
      bot.adrenaline = Math.min(100, bot.adrenaline + 35);
      if ((bot.calloutCooldown || 0) <= 0) {
        setBotChatBubble(bot, 'Aplicando botiquín táctico, cubran mi sector.', 3.6);
        bot.calloutCooldown = 8.0;
      }
    } else if (bot.hp < 78 && bot.bandages > 0) {
      bot.bandages--;
      bot.hp = Math.min(bot.maxHp, bot.hp + 25);
    }

    const w = WEAPONS[bot.weaponId] || WEAPONS.m416;
    if (bot.fireTimer > 0) bot.fireTimer -= dt;
    if (bot.reloading > 0) {
      bot.reloading -= dt;
      if (bot.reloading <= 0) {
        bot.reloading = 0;
        bot.mag = w.magSize;
      }
    }

    // 3. Priority 1: Revive downed player or downed teammate
    let downedTarget = null;
    if (player.downed) {
      downedTarget = player;
    } else {
      for (const other of allies) {
        if (other.id !== bot.id && other.downed) {
          downedTarget = other;
          break;
        }
      }
    }

    if (downedTarget) {
      const dx = downedTarget.x - bot.x;
      const dy = downedTarget.y - bot.y;
      const d = Math.hypot(dx, dy);
      if (d > 48) {
        const steerAng = computeSmartSteerAngle(bot, downedTarget.x, downedTarget.y, world, bot.inBunker);
        bot.moveAngle = lerpAngle(bot.moveAngle || steerAng, steerAng, dt * 10);
        const moveSpd = 250 * speedBoost;
        bot.vx = Math.cos(bot.moveAngle) * moveSpd;
        bot.vy = Math.sin(bot.moveAngle) * moveSpd;
        bot.x += bot.vx * dt;
        bot.y += bot.vy * dt;
        resolveEntityCollisions(bot, world, bot.inBunker);
      } else {
        if (!bot.chatBubble && (bot.calloutCooldown || 0) <= 0) {
          setBotChatBubble(bot, `¡Aguanta ${downedTarget.name || 'bro'}, te estoy levantando!`, 3.5);
          bot.calloutCooldown = 6.0;
        }
        if (downedTarget === player) {
          player.reviveProgress = (player.reviveProgress || 0) + dt * 0.45;
          if (player.reviveProgress >= 1) {
            player.downed = false;
            player.hp = 60;
            player.reviveProgress = 0;
            setBotChatBubble(bot, '¡Listo bro, de vuelta al combate!', 3.6);
            bot.calloutCooldown = 5.0;
          }
        }
      }
      bot.angle = lerpAngle(bot.angle || 0, Math.atan2(dy, dx), dt * 10);
      continue;
    }

    // 4. Find nearest zombie
    let nearestZombie = null;
    let minZDistSq = Infinity;
    for (const z of zombies) {
      if (z.inBunker !== bot.inBunker) continue;
      const d2 = distSq(bot.x, bot.y, z.x, z.y);
      if (d2 < minZDistSq) {
        minZDistSq = d2;
        nearestZombie = z;
      }
    }

    if (nearestZombie && (nearestZombie.isBoss || nearestZombie.isVip) && minZDistSq < 580 * 580 && (bot.calloutCooldown || 0) <= 0) {
      setBotChatBubble(bot, `¡Cuidado! ¡${nearestZombie.name || 'Behemoth'} a la vista!`, 3.8);
      bot.calloutCooldown = 14.0;
    }

    // 5. Autonomous Goal Selection
    let goalX = bot.x;
    let goalY = bot.y;

    if (cmd === 'hold') {
      if (!bot.holdPos) {
        bot.holdPos = { x: bot.x, y: bot.y };
      }
      goalX = bot.holdPos.x;
      goalY = bot.holdPos.y;
    } else if (cmd === 'follow') {
      bot.holdPos = null;
      const fOff = formationOffsets[idx % formationOffsets.length];
      goalX = player.x + fOff.x;
      goalY = player.y + fOff.y;
    } else if (cmd === 'hunt' && nearestZombie) {
      bot.holdPos = null;
      goalX = nearestZombie.x;
      goalY = nearestZombie.y;
    } else {
      bot.holdPos = null;

      // Check nearby ground loot
      let bestLoot = null;
      let bestLootD2 = 520 * 520;
      for (let i = world.loot.length - 1; i >= 0; i--) {
        const item = world.loot[i];
        if (item.inBunker !== bot.inBunker) continue;
        const d2 = distSq(bot.x, bot.y, item.x, item.y);
        if (d2 < 52 * 52) {
          if (item.kind === 'weapon' && WEAPONS[item.weaponId]) {
            const candW = WEAPONS[item.weaponId];
            if ((candW.tier || 1) > (w.tier || 1)) {
              bot.weaponId = candW.id;
              bot.mag = candW.magSize;
              bot.reloadTotal = candW.reloadTime;
              world.loot.splice(i, 1);
              continue;
            }
          } else if (item.kind === 'med') {
            if (item.medId === 'medkit') bot.medkits = (bot.medkits || 0) + 1;
            else if (item.medId === 'bandage') bot.bandages = (bot.bandages || 0) + 1;
            else if (item.medId === 'soda') bot.sodas = (bot.sodas || 0) + 1;
            else if (item.medId === 'pills') bot.pills = (bot.pills || 0) + 1;
            world.loot.splice(i, 1);
            continue;
          }
        }
        if (d2 < bestLootD2 && (item.kind === 'weapon' || item.kind === 'med')) {
          bestLootD2 = d2;
          bestLoot = item;
        }
      }

      // Check nearby unbroken crates
      let nearestCrate = null;
      let nearestCrateD2 = 340 * 340;
      if (!bot.inBunker && world.crates) {
        for (const c of world.crates) {
          if (c.hp <= 0) continue;
          const cx = c.x + (c.w || 50) * 0.5;
          const cy = c.y + (c.h || 50) * 0.5;
          const d2 = distSq(bot.x, bot.y, cx, cy);
          if (d2 < nearestCrateD2) {
            nearestCrateD2 = d2;
            nearestCrate = { ref: c, cx, cy };
          }
        }
      }

      if (bestLoot) {
        goalX = bestLoot.x;
        goalY = bestLoot.y;
      } else if (nearestCrate) {
        goalX = nearestCrate.cx;
        goalY = nearestCrate.cy;
        if (nearestCrateD2 < 92 * 92 && bot.crateHitTimer <= 0) {
          bot.crateHitTimer = 0.38;
          nearestCrate.ref.hp -= 38;
          if (nearestCrate.ref.hp <= 0 && engine.spawnCrateLoot) {
            engine.spawnCrateLoot(nearestCrate.ref);
          }
        }
      } else {
        const reachedRoam =
          bot.roamTarget && distSq(bot.x, bot.y, bot.roamTarget.x, bot.roamTarget.y) < 95 * 95;

        if (!bot.roamTarget || bot.roamTimer <= 0 || reachedRoam) {
          const farBuildings = (world.buildings || []).filter((b) => {
            const bCx = b.x + b.w * 0.5;
            const bCy = b.y + b.h * 0.5;
            const dPlayer2 = distSq(player.x, player.y, bCx, bCy);
            const dBot2 = distSq(bot.x, bot.y, bCx, bCy);
            return dPlayer2 > 750 * 750 && dBot2 > 180 * 180 && dBot2 < 3800 * 3800;
          });

          if (farBuildings.length > 0) {
            const pick =
              farBuildings[(idx * 7 + Math.floor(Math.random() * farBuildings.length)) % farBuildings.length];
            const rooms = pick.rooms || [];
            const rm = rooms.length > 0 ? rooms[Math.floor(Math.random() * rooms.length)] : null;
            const tx = rm ? rm.x + rm.w * 0.5 : pick.x + pick.w * 0.5;
            const ty = rm ? rm.y + rm.h * 0.5 : pick.y + pick.h * 0.5;
            bot.roamTarget = { x: tx, y: ty, buildingId: pick.id };
            bot.roamTimer = 14 + Math.random() * 10;

            if (pick.doors) {
              for (const d of pick.doors) {
                d.open = true;
              }
            }
          } else {
            const sectorAngle = (idx * Math.PI) / 2 + (Math.random() - 0.5) * 0.7;
            const distAway = 1200 + Math.random() * 900;
            bot.roamTarget = {
              x: clamp(player.x + Math.cos(sectorAngle) * distAway, 900, world.size - 900),
              y: clamp(player.y + Math.sin(sectorAngle) * distAway, 900, world.size - 900),
            };
            bot.roamTimer = 12 + Math.random() * 8;
          }
        }

        goalX = bot.roamTarget.x;
        goalY = bot.roamTarget.y;
      }
    }

    // 6. Tactical Kiting when Zombie gets too close
    const zDist = Math.sqrt(minZDistSq);
    if (nearestZombie && zDist < 185 && cmd !== 'hold') {
      const awayX = bot.x - nearestZombie.x;
      const awayY = bot.y - nearestZombie.y;
      const len = Math.hypot(awayX, awayY) || 1;
      goalX = bot.x + (awayX / len) * 195;
      goalY = bot.y + (awayY / len) * 195;
    }

    // 7. Smart Unstuck Detection (< 15px moved in 0.6s while trying to move)
    bot.stuckCheckTimer = (bot.stuckCheckTimer || 0.6) - dt;
    if (bot.stuckCheckTimer <= 0) {
      bot.stuckCheckTimer = 0.6;
      const movedDist = Math.hypot(bot.x - (bot.lastCheckX ?? bot.x), bot.y - (bot.lastCheckY ?? bot.y));
      const wantedToMove = Math.hypot(goalX - bot.x, goalY - bot.y) > 45 && cmd !== 'hold';
      bot.lastCheckX = bot.x;
      bot.lastCheckY = bot.y;

      if (wantedToMove && movedDist < 15) {
        bot.unstuckTimer = 1.0;
        const sideSign = idx % 2 === 0 ? 1 : -1;
        bot.unstuckAngle = (bot.moveAngle || 0) + sideSign * (Math.PI * 0.55);

        // Break or open any door/furniture directly blocking the bot
        if (!bot.inBunker && world.buildings) {
          for (const b of world.buildings) {
            if (bot.x < b.x - 60 || bot.x > b.x + b.w + 60 || bot.y < b.y - 60 || bot.y > b.y + b.h + 60) continue;
            for (const d of b.doors || []) {
              if (!d.open && !d.destroyed && distSq(bot.x, bot.y, d.x + d.w * 0.5, d.y + d.h * 0.5) < 75 * 75) {
                d.open = true;
              }
            }
            for (const f of b.furniture || []) {
              if (f.solid && !f.destroyed && distSq(bot.x, bot.y, f.x + f.w * 0.5, f.y + f.h * 0.5) < 68 * 68) {
                if (engine.damageFurniture) engine.damageFurniture(f, 80);
                else {
                  f.hp = (f.hp || 80) - 80;
                  if (f.hp <= 0) f.destroyed = true;
                }
              }
            }
          }
        }
      }
    }

    // 8. Calculate Movement Vector (Using 8-direction smart steering + soft separation)
    const distGoal = Math.hypot(goalX - bot.x, goalY - bot.y);
    const moveSpd = 216 * speedBoost;

    let vx = 0;
    let vy = 0;
    if (distGoal > 22) {
      const targetMoveAngle =
        bot.unstuckTimer > 0
          ? bot.unstuckAngle
          : computeSmartSteerAngle(bot, goalX, goalY, world, bot.inBunker);
      bot.moveAngle = lerpAngle(bot.moveAngle ?? targetMoveAngle, targetMoveAngle, dt * 9);
      vx = Math.cos(bot.moveAngle) * moveSpd;
      vy = Math.sin(bot.moveAngle) * moveSpd;
    }

    // Repel away from player if NOT in 'follow' or 'hold' mode and within 380px
    const distToPlayer = Math.hypot(bot.x - player.x, bot.y - player.y);
    if (cmd !== 'follow' && cmd !== 'hold' && !player.downed && distToPlayer < 380 && distToPlayer > 1) {
      const repulse = ((380 - distToPlayer) / 380) * moveSpd * 1.1;
      vx += ((bot.x - player.x) / distToPlayer) * repulse;
      vy += ((bot.y - player.y) / distToPlayer) * repulse;
    }

    // Soft damped separation between bots (disabled when passing through doorways so they never wedge)
    for (const other of allies) {
      if (other.id === bot.id || other.downed) continue;
      const dOther = Math.hypot(bot.x - other.x, bot.y - other.y);
      if (dOther < 46 && dOther > 0.1) {
        const pushForce = ((46 - dOther) / 46) * 55;
        vx += ((bot.x - other.x) / dOther) * pushForce;
        vy += ((bot.y - other.y) / dOther) * pushForce;
      }
    }

    bot.vx = vx;
    bot.vy = vy;
    bot.x += bot.vx * dt;
    bot.y += bot.vy * dt;
    resolveEntityCollisions(bot, world, bot.inBunker);

    // 9. Smooth Aim Angle (`lerpAngle` separated from `moveAngle` so bots NEVER spin in place!)
    let desiredAimAngle = bot.angle || 0;
    if (nearestZombie && zDist <= w.range * 0.92 && cmd !== 'peace') {
      desiredAimAngle = Math.atan2(nearestZombie.y - bot.y, nearestZombie.x - bot.x);

      const wallCheck = raycastObstacles(bot.x, bot.y, nearestZombie.x, nearestZombie.y, world, bot.inBunker);
      const hasClearLOS = !wallCheck || !wallCheck.hit;

      if (hasClearLOS && bot.reloading <= 0 && bot.fireTimer <= 0) {
        if (bot.mag <= 0) {
          bot.reloading = w.reloadTime;
          bot.reloadTotal = w.reloadTime;
        } else {
          engine.spawnWeaponProjectiles(bot, w, false);
          bot.mag--;
          bot.fireTimer = w.fireRate * 1.22;
        }
      }
    } else if (Math.hypot(bot.vx, bot.vy) > 18) {
      desiredAimAngle = bot.moveAngle ?? Math.atan2(bot.vy, bot.vx);
    }

    bot.angle = lerpAngle(bot.angle || 0, desiredAimAngle, dt * 10);
  }
}
