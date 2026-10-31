import test from 'node:test';
import assert from 'node:assert/strict';
import {
  circleIntersectsRect,
  pushCircleOutOfRect,
  computeWaveComposition,
  createZombieInstance,
  applyAdrenalineTick,
  segmentIntersectsRect,
  segmentIntersectsCircle,
  raycastObstacles,
  resolveEntityCollisions,
  computePlayerAimAngle,
  lerpAngle,
  computeSmartSteerAngle,
  distSq,
  getMaxInventoryCapacity,
  getMaxAmmoReserve,
  getItemWeight,
  computeInventoryUsage,
} from './gameLogic.js';
import { MELEE_WEAPONS, WEAPONS } from '../config/constants.js';

test('computePlayerAimAngle calculates exact PC aim relative to camera + canvas center and lerps to walk direction on mobile', () => {
  const player = { x: 10000, y: 10000, angle: 0 };
  const camera = { x: 10000, y: 10000 };
  const now = 5000;

  const pcAngle = computePlayerAimAngle({
    player,
    camera,
    mouse: { screenX: 840, screenY: 360, down: false, lastMovedAt: 4900 },
    canvasWidth: 1280,
    canvasHeight: 720,
    zoom: 1.0,
    aimJoy: { active: false, dist: 0, angle: 0 },
    vx: 0,
    vy: 0,
    dt: 0.016,
    now,
  });
  assert.ok(Math.abs(pcAngle - 0) < 0.001, 'Mouse right of center aims at 0 radians');

  player.x = 12500;
  camera.x = 12500;
  const pcAngleAfterWalk = computePlayerAimAngle({
    player,
    camera,
    mouse: { screenX: 840, screenY: 360, down: false, lastMovedAt: 4900 },
    canvasWidth: 1280,
    canvasHeight: 720,
    zoom: 1.0,
    aimJoy: { active: false, dist: 0, angle: 0 },
    vx: 220,
    vy: 0,
    dt: 0.016,
    now,
  });
  assert.ok(Math.abs(pcAngleAfterWalk - 0) < 0.001, 'Camera offset prevents aim from locking onto old world origin');

  const walkAngle = computePlayerAimAngle({
    player: { x: 10000, y: 10000, angle: 0 },
    camera,
    mouse: { screenX: 640, screenY: 360, down: false, lastMovedAt: 0 },
    canvasWidth: 1280,
    canvasHeight: 720,
    zoom: 1.0,
    aimJoy: { active: false, dist: 0, angle: 0 },
    vx: 0,
    vy: 240,
    dt: 0.1,
    now,
  });
  assert.ok(walkAngle > 0.5, 'Character rotates smoothly toward walking direction');
});

test('lerpAngle wraps shortest arc across -PI and +PI', () => {
  const res = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
  assert.ok(Math.abs(Math.abs(res) - Math.PI) < 0.15);
});

test('segmentIntersectsRect detects bullet ray hitting building wall and prevents wall penetration', () => {
  const hit = segmentIntersectsRect(50, 120, 180, 120, 100, 50, 20, 200);
  assert.equal(hit.hit, true);
  assert.ok(Math.abs(hit.ix - 100) < 0.001);
  assert.equal(hit.nx, -1);

  const miss = segmentIntersectsRect(50, 10, 180, 10, 100, 50, 20, 200);
  assert.equal(miss.hit, false);
});

test('segmentIntersectsCircle detects bullet ray hitting zombie hitbox accurately', () => {
  const hit = segmentIntersectsCircle(100, 100, 260, 100, 200, 100, 19);
  assert.equal(hit.hit, true);
  assert.ok(Math.abs(hit.ix - 181) < 0.5);
});

test('raycastObstacles stops bullet at closest wall, shatters windows without stopping bullets, and hits closed doors/solid furniture', () => {
  const win = { id: 'win_1', x: 1100, y: 1050, w: 12, h: 48, hp: 35, maxHp: 35, shattered: false };
  const furn = { id: 'furn_1', x: 1180, y: 1055, w: 30, h: 30, hp: 80, maxHp: 80, solid: true, destroyed: false };
  const mockWorld = {
    buildings: [
      {
        x: 1090,
        y: 1000,
        w: 200,
        h: 200,
        walls: [{ x: 1100, y: 1000, w: 16, h: 45 }],
        windows: [win],
        doors: [],
        furniture: [furn],
      },
    ],
    crates: [],
    stones: [],
    trees: [],
    bridges: [],
  };

  // Bullet shot through window at y=1070 shatters window and continues until hitting furniture at x=1180
  const shatteredWindows = [];
  const bulletRes = raycastObstacles(1020, 1070, 1250, 1070, mockWorld, false, {
    isBullet: true,
    shatteredWindows,
  });
  assert.equal(shatteredWindows.length, 1, 'Window is recorded to shatter on bullet pass-through');
  assert.ok(bulletRes && bulletRes.hit, 'Bullet continues past window and hits interior furniture');
  assert.equal(bulletRes.refType, 'furniture');
  assert.ok(Math.abs(bulletRes.ix - 1180) < 0.01);

  // Intact window blocks entity collision
  const unit = { x: 1095, y: 1070, r: 16 };
  resolveEntityCollisions(unit, mockWorld, false);
  assert.ok(unit.x < 1090, 'Intact window blocks unit');
});

test('computeSmartSteerAngle steers around a blocking wall toward target', () => {
  const mockWorld = {
    buildings: [
      {
        x: 90,
        y: 60,
        w: 40,
        h: 80,
        walls: [{ x: 100, y: 60, w: 20, h: 80 }],
        windows: [],
        doors: [],
        furniture: [],
      },
    ],
    crates: [],
    stones: [],
    trees: [],
    bridges: [],
  };
  const zombie = { x: 60, y: 100, r: 18, angle: 0 };
  const steer = computeSmartSteerAngle(zombie, 180, 100, mockWorld, false);
  assert.ok(Math.abs(steer) > 0.2, 'Steer angle deflects away from 0 rad to bypass the wall');
});

test('circleIntersectsRect & pushCircleOutOfRect resolve wall collisions cleanly', () => {
  const wall = { x: 100, y: 100, w: 200, h: 20 };
  const player = { x: 150, y: 92 };
  const r = 16;

  assert.equal(circleIntersectsRect(player.x, player.y, r, wall.x, wall.y, wall.w, wall.h), true);
  pushCircleOutOfRect(player, r, wall);
  assert.equal(circleIntersectsRect(player.x, player.y, r, wall.x, wall.y, wall.w, wall.h), false);
});

test('computeWaveComposition scales zombie count, HP multiplier, and difficulty', () => {
  const w1 = computeWaveComposition(1, 1, 1.0);
  const w3Nightmare = computeWaveComposition(3, 2, 2.0);

  assert.ok(w3Nightmare.totalCount > w1.totalCount);
  assert.ok(w3Nightmare.hpMultiplier > w1.hpMultiplier * 2);
  assert.equal(w3Nightmare.queue.includes('behemoth'), true);
});

test('createZombieInstance & applyAdrenalineTick work accurately', () => {
  const z = createZombieInstance('armored', 500, 600, 1.5, 1.1, 't1');
  assert.equal(z.type, 'armored');
  assert.ok(z.maxHp > 250);

  const player = { hp: 60, maxHp: 100, adrenaline: 80 };
  const boost = applyAdrenalineTick(player, 1.0);
  assert.ok(boost > 1.1);
  assert.ok(player.hp > 60);
});

test('generateWorld creates 110+ ordered buildings with >90px door clearance, ring road, bridges, and 8 melee weapons', async () => {
  const { generateWorld } = await import('./worldGen.js');
  const world = generateWorld(4092);
  assert.ok(world.buildings.length >= 110, `Expected >= 110 buildings, got ${world.buildings.length}`);
  assert.ok(world.ringRoadPoints && world.ringRoadPoints.length >= 20, 'World includes continuous Ring Road');
  assert.ok(world.bridges.length >= 3 && world.bridges[0].railings.length === 2, 'Bridges include solid side railings');
  assert.equal(Object.keys(MELEE_WEAPONS).length, 8, 'All 8 melee weapons are configured');
  assert.ok(WEAPONS.m416.length <= 28, 'Firearm dimensions are proportionally scaled (0.62x)');

  // Verify no solid furniture blocks any door (< 90px distance)
  for (const b of world.buildings) {
    for (const d of b.doors) {
      const dCx = d.x + d.w * 0.5;
      const dCy = d.y + d.h * 0.5;
      for (const f of b.furniture) {
        if (!f.solid) continue;
        const fCx = f.x + f.w * 0.5;
        const fCy = f.y + f.h * 0.5;
        const dist = Math.sqrt(distSq(dCx, dCy, fCx, fCy));
        assert.ok(dist >= 90, `Furniture ${f.id} too close to door (${dist.toFixed(1)}px)`);
      }
    }
  }
});

test('damageZombie on a single exploder marks it dead before exploding, prevents recursion, and awards exact rewards once', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.zombies = [];
  engine.decals = [];
  engine.particles = [];

  const startCredits = engine.player.credits;
  const startScore = engine.player.score;
  const startKills = engine.player.kills;

  const expZ = createZombieInstance('exploder', 10000, 10000, 1.0, 1.0, 'single');
  engine.zombies.push(expZ);

  // Deal fatal damage to the exploder zombie
  engine.damageZombie(expZ, 0, 500, true);

  assert.equal(expZ._dead, true, 'Exploder is marked _dead');
  assert.equal(expZ.explodes, false, 'Exploder flag is cleared after detonation');
  assert.equal(engine.zombies.length, 0, 'Exploder is removed from engine.zombies');
  assert.equal(engine.player.credits, startCredits + expZ.credits, 'Exact credits awarded once');
  assert.equal(engine.player.score, startScore + expZ.score, 'Exact score awarded once');
  assert.equal(engine.player.kills, startKills + 1, 'Exact kill count incremented once');

  // Calling damageZombie again on the already-dead zombie must be a no-op
  const decalsAfterDeath = engine.decals.length;
  engine.damageZombie(expZ, 0, 500, true);
  assert.equal(engine.player.credits, startCredits + expZ.credits, 'Dead zombie cannot grant duplicate credits');
  assert.equal(engine.player.kills, startKills + 1, 'Dead zombie cannot grant duplicate kills');
  assert.equal(engine.decals.length, decalsAfterDeath, 'Dead zombie does not spawn extra decals or explosions');
});

test('chain of 6 exploder zombies resolves iteratively via queue without recursion or duplicate rewards', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.zombies = [];
  engine.decals = [];

  const startCredits = engine.player.credits;
  const startScore = engine.player.score;

  // Create a chain of 6 overlapping/adjacent exploder zombies with 30 HP each (blast damage = 42)
  const chainZombies = [];
  let expectedCredits = 0;
  let expectedScore = 0;
  for (let i = 0; i < 6; i++) {
    const z = createZombieInstance('exploder', 10000 + i * 40, 10000, 1.0, 1.0, `chain_${i}`);
    z.hp = 30;
    expectedCredits += z.credits;
    expectedScore += z.score;
    chainZombies.push(z);
    engine.zombies.push(z);
  }

  // Kill the first exploder in the chain
  engine.damageZombie(chainZombies[0], 0, 100, true);

  assert.equal(engine.zombies.length, 0, 'All 6 exploders in the chain are eliminated');
  assert.equal(engine._explosionQueue.length, 0, 'Explosion queue is completely drained');
  assert.equal(engine._processingExplosions, false, 'Explosion processor flag is reset');
  assert.equal(engine.player.kills, 6, 'All 6 kills are counted exactly once');
  assert.equal(engine.player.credits, startCredits + expectedCredits, 'Credits match exact sum of the 6 exploders');
  assert.equal(engine.player.score, startScore + expectedScore, 'Score matches exact sum of the 6 exploders');
});

test('explosive barrels (barrel_explosive) chain iteratively with exploder zombies without repeating barrel explosions', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.zombies = [];
  engine.decals = [];

  const barrel1 = {
    id: 'test_barrel_1',
    kind: 'barrel_explosive',
    x: 10000,
    y: 10000,
    w: 28,
    h: 28,
    hp: 60,
    maxHp: 60,
    solid: true,
    material: 'metal',
    destroyed: false,
  };
  const barrel2 = {
    id: 'test_barrel_2',
    kind: 'barrel_explosive',
    x: 10050,
    y: 10000,
    w: 28,
    h: 28,
    hp: 60,
    maxHp: 60,
    solid: true,
    material: 'metal',
    destroyed: false,
  };

  engine.world.buildings.push({
    id: 'test_b_barrels',
    x: 9950,
    y: 9950,
    w: 250,
    h: 250,
    walls: [],
    doors: [],
    windows: [],
    furniture: [barrel1, barrel2],
  });

  const zExploder = createZombieInstance('exploder', 10080, 10000, 1.0, 1.0, 'near_barrel');
  zExploder.hp = 80;
  const zWalker = createZombieInstance('walker', 10110, 10000, 1.0, 1.0, 'near_exploder');
  zWalker.hp = 100;
  engine.zombies.push(zExploder, zWalker);

  const startCredits = engine.player.credits;

  // Destroy barrel1 -> triggers barrel2 (115 dmg) + kills zExploder (which deals 42 dmg) -> kills zWalker
  engine.damageFurniture(barrel1, 100, false);

  assert.equal(barrel1.destroyed, true, 'Barrel 1 is destroyed');
  assert.equal(barrel1._exploded, true, 'Barrel 1 is marked _exploded');
  assert.equal(barrel2.destroyed, true, 'Barrel 2 is destroyed by Barrel 1');
  assert.equal(barrel2._exploded, true, 'Barrel 2 is marked _exploded');
  assert.equal(engine.zombies.length, 0, 'Both zombies in the barrel + exploder chain are killed');
  assert.equal(
    engine.player.credits,
    startCredits + zExploder.credits + zWalker.credits,
    'Exact zombie credits awarded from barrel chain'
  );

  // Attempting to damage barrel1 or barrel2 again does NOT trigger another explosion
  const decalsCount = engine.decals.length;
  engine.damageFurniture(barrel1, 100, false);
  engine.damageFurniture(barrel2, 100, false);
  assert.equal(engine.decals.length, decalsCount, 'Destroyed barrels cannot explode again');
});

test('multi-zombie explosion removes only zombies in blast radius by reference and never deletes wrong zombies at shifted indices', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.zombies = [];

  // Interleave far zombies (outside blast) and near zombies (inside blast) in engine.zombies
  const zFar0 = createZombieInstance('walker', 5000, 5000, 1.0, 1.0, 'far_0');
  const zBlast1 = createZombieInstance('exploder', 10000, 10000, 1.0, 1.0, 'blast_1');
  zBlast1.hp = 40;
  const zFar2 = createZombieInstance('runner', 6000, 6000, 1.0, 1.0, 'far_2');
  const zBlast3 = createZombieInstance('walker', 10020, 10000, 1.0, 1.0, 'blast_3');
  zBlast3.hp = 40;
  const zBlast4 = createZombieInstance('exploder', 10035, 10000, 1.0, 1.0, 'blast_4');
  zBlast4.hp = 40;
  const zFar5 = createZombieInstance('armored', 7000, 7000, 1.0, 1.0, 'far_5');
  const zBlast6 = createZombieInstance('runner', 10050, 10000, 1.0, 1.0, 'blast_6');
  zBlast6.hp = 40;
  const zFar7 = createZombieInstance('walker', 8000, 8000, 1.0, 1.0, 'far_7');

  engine.zombies.push(zFar0, zBlast1, zFar2, zBlast3, zBlast4, zFar5, zBlast6, zFar7);

  const startCredits = engine.player.credits;
  const startScore = engine.player.score;
  const expectedCredits = zBlast1.credits + zBlast3.credits + zBlast4.credits + zBlast6.credits;
  const expectedScore = zBlast1.score + zBlast3.score + zBlast4.score + zBlast6.score;

  // Trigger explosion at (10025, 10000) with radius 120 and damage 80
  engine.triggerExplosion(10025, 10000, 120, 80, false);

  // Verify the 4 blast zombies are dead and removed
  assert.equal(zBlast1._dead, true);
  assert.equal(zBlast3._dead, true);
  assert.equal(zBlast4._dead, true);
  assert.equal(zBlast6._dead, true);

  // Verify the 4 far zombies were NOT removed or damaged despite index shifting
  assert.equal(engine.zombies.length, 4, 'Exactly 4 far zombies remain in engine.zombies');
  assert.deepEqual(
    engine.zombies.map((z) => z.id),
    [zFar0.id, zFar2.id, zFar5.id, zFar7.id],
    'Exact surviving zombie references preserved in order'
  );
  for (const surv of engine.zombies) {
    assert.equal(surv.hp, surv.maxHp, `Surviving zombie ${surv.id} took zero damage`);
  }

  // Verify rewards are exact and never duplicated
  assert.equal(engine.player.kills, 4, 'Exactly 4 kills recorded');
  assert.equal(engine.player.credits, startCredits + expectedCredits, 'Exact credits for the 4 killed zombies');
  assert.equal(engine.player.score, startScore + expectedScore, 'Exact score for the 4 killed zombies');
});

test('Waves 1-10 scale gradually and fairly without runaway HP or speed spikes', () => {
  const w1 = computeWaveComposition(1, 1, 1.0);
  const w3 = computeWaveComposition(3, 1, 1.0);
  const w6 = computeWaveComposition(6, 1, 1.0);
  const w10 = computeWaveComposition(10, 1, 1.0);

  assert.equal(w1.hpMultiplier, 1.0);
  assert.ok(w3.hpMultiplier <= 1.3, `Wave 3 HP multiplier (${w3.hpMultiplier}) is gentle for early exploration`);
  assert.ok(w6.hpMultiplier <= 1.7, `Wave 6 HP multiplier (${w6.hpMultiplier}) is fair and playable`);
  assert.ok(w10.hpMultiplier <= 2.2, `Wave 10 HP multiplier (${w10.hpMultiplier}) is demanding but fair`);
  assert.ok(w10.speedMultiplier <= 1.25, `Wave 10 speed multiplier (${w10.speedMultiplier}) is capped`);
  assert.equal(w1.queue.includes('spitter'), false, 'Wave 1 has no acid spitters');
  assert.equal(w1.queue.includes('exploder'), false, 'Wave 1 has no exploders');
});

test('performMeleeAttack enforces per-weapon maxTargets cap (1 for fists, 2 for machete, 3 for katana)', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.zombies = [];
  engine.player.x = 10000;
  engine.player.y = 10000;
  engine.player.angle = 0;

  // Place 5 walkers directly in front of the player within melee range
  for (let i = 0; i < 5; i++) {
    const z = createZombieInstance('walker', 10028 + i * 2, 10000, 1.0, 1.0, `m_${i}`);
    z.hp = 200;
    z.maxHp = 200;
    engine.zombies.push(z);
  }

  // 1. Fists (maxTargets = 1) should only damage 1 zombie
  engine.player.meleeId = 'fists';
  engine.performMeleeAttack();
  const damagedByFists = engine.zombies.filter((z) => z.hp < 200).length;
  assert.equal(damagedByFists, 1, 'Fists only hit 1 target per swing');

  // Reset zombie HP
  engine.zombies.forEach((z) => {
    z.hp = 200;
    z.x = 10028;
    z.y = 10000;
  });

  // 2. Machete (maxTargets = 2) should only damage 2 zombies
  engine.player.meleeId = 'machete';
  engine.performMeleeAttack();
  const damagedByMachete = engine.zombies.filter((z) => z.hp < 200).length;
  assert.equal(damagedByMachete, 2, 'Machete only hits 2 targets per swing');

  // Reset zombie HP
  engine.zombies.forEach((z) => {
    z.hp = 200;
    z.x = 10028;
    z.y = 10000;
  });

  // 3. Katana (maxTargets = 3) should damage 3 zombies
  engine.player.meleeId = 'katana';
  engine.performMeleeAttack();
  const damagedByKatana = engine.zombies.filter((z) => z.hp < 200).length;
  assert.equal(damagedByKatana, 3, 'Katana hits up to 3 targets per swing');
});

test('Stamina exhaustion locks sprinting at 0 stamina and only re-enables sprinting at >= 25 stamina', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.status = 'playing';
  engine.keys['KeyD'] = true;
  engine.keys['ShiftLeft'] = true;

  // Drain stamina to 0
  engine.player.stamina = 1.0;
  engine.updatePlayer(0.1);
  assert.equal(engine.player.stamina, 0, 'Stamina hits 0');
  assert.equal(engine.player.staminaExhausted, true, 'staminaExhausted lockout activates at 0 stamina');

  // Next frame while still holding Shift: player cannot sprint and stamina recovers instead of flickering
  engine.updatePlayer(0.5);
  assert.ok(engine.player.stamina > 5 && engine.player.stamina < 25, 'Stamina recovers while locked out');
  assert.equal(engine.player.staminaExhausted, true, 'Lockout remains active below 25% stamina');

  // Recover past 25% stamina
  engine.updatePlayer(1.2);
  assert.ok(engine.player.stamina >= 25, 'Stamina reached >= 25');
  assert.equal(engine.player.staminaExhausted, false, 'Lockout clears once stamina reaches >= 25%');
});

test('Medical item usage channels with progress, cancels on attack without consuming item, and heals on completion', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.status = 'playing';
  engine.player.hp = 40;
  engine.player.meds.medkit = 1;

  // Start using medkit (3.5s useTime)
  engine.useMedicalItem('medkit');
  assert.ok(engine.player.activeHeal, 'activeHeal is started');
  assert.equal(engine.player.activeHeal.id, 'medkit');
  assert.equal(engine.player.meds.medkit, 1, 'Medkit is not consumed before channeling completes');

  // Interrupt by melee attack
  engine.performMeleeAttack();
  assert.equal(engine.player.activeHeal, null, 'Attacking cancels medical channeling');
  assert.equal(engine.player.meds.medkit, 1, 'Medkit is preserved in inventory when interrupted');
  assert.equal(engine.player.hp, 40, 'No healing applied when interrupted');

  // Start using medkit again and let timer complete
  engine.useMedicalItem('medkit');
  engine.updatePlayer(3.6);
  assert.equal(engine.player.activeHeal, null, 'Channeling finishes');
  assert.equal(engine.player.meds.medkit, 0, 'Medkit is consumed on completion');
  assert.equal(engine.player.hp, 100, 'Player is healed to 100 HP on completion');
});

test('5 distinct furnished bunkers, 4-way rotatable/destructible barricades, destructible trees/stones, and driveable vehicles work cleanly', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.status = 'playing';

  // 1. Verify all 5 distinct underground bunkers exist with distinct furniture and loot
  const bunkerIds = ['bunker_hydra', 'bunker_alpha', 'bunker_echo', 'bunker_delta', 'bunker_omega'];
  for (const bid of bunkerIds) {
    const b = engine.world.bunkersById[bid];
    assert.ok(b, `Bunker ${bid} exists in world.bunkersById`);
    assert.ok(b.furniture && b.furniture.length >= 4, `Bunker ${bid} has interior furniture`);
    assert.ok(b.crates && b.crates.length >= 2, `Bunker ${bid} has supply crates`);
    const bLoot = engine.world.loot.filter((item) => item.inBunker && item.bunkerId === bid);
    assert.ok(bLoot.length >= 4, `Bunker ${bid} has its own thematic loot`);
  }

  // 2. Verify 4-way barricade rotation (0 -> 90 -> 180 -> 270) and destruction
  engine.player.throwableId = 'barricade';
  engine.player.throwableCount.barricade = 2;
  assert.equal(engine.player.barricadeRotation, 0);
  engine.rotateBarricade();
  assert.equal(engine.player.barricadeRotation, 90);
  engine.throwActiveGrenade();
  assert.equal(engine.world.barricades.length, 1);
  const bar = engine.world.barricades[0];
  assert.equal(bar.rotation, 90);
  assert.equal(bar.w, 26, '90-degree barricade has vertical width 26');
  assert.equal(bar.h, 84, '90-degree barricade has vertical height 84');

  engine.damageBarricade(bar, 500, false);
  assert.equal(bar.destroyed, true);
  assert.equal(engine.world.barricades.length, 0, 'Destroyed barricade is removed from world.barricades');

  // 3. Verify destructible trees and stones
  const treeCountBefore = engine.world.trees.length;
  const targetTree = engine.world.trees[0];
  engine.damageTree(targetTree, 200);
  assert.equal(targetTree.destroyed, true);
  assert.equal(engine.world.trees.length, treeCountBefore - 1, 'Destroyed tree is removed from world.trees');

  const stoneCountBefore = engine.world.stones.length;
  const targetStone = engine.world.stones[0];
  engine.damageStone(targetStone, 300);
  assert.equal(targetStone.destroyed, true);
  assert.equal(engine.world.stones.length, stoneCountBefore - 1, 'Destroyed stone is removed from world.stones');

  // 4. Verify entering, driving, ramming a zombie, and exiting a driveable vehicle
  const veh = engine.world.vehicles[0];
  assert.equal(veh.driveable, true);
  engine.player.x = veh.x + 20;
  engine.player.y = veh.y;
  engine.interact();
  assert.equal(engine.player.drivingVehicleId, veh.id, 'Player enters nearby vehicle on interact()');

  // Place a zombie ahead of the vehicle and drive forward
  engine.zombies = [];
  const ramTarget = createZombieInstance('walker', veh.x + 45, veh.y, 1.0, 1.0, 'ram_z');
  engine.zombies.push(ramTarget);
  veh.angle = 0;
  veh.speed = 320;
  engine.keys['KeyD'] = true;
  engine.updatePlayer(0.05);
  assert.equal(engine.zombies.length, 0, 'Ramming zombie at high vehicle speed eliminates walker');

  engine.exitVehicle();
  assert.equal(engine.player.drivingVehicleId, null, 'Player exits vehicle cleanly');
});

test('Real backpack capacity system enforces level limits, blocks pickups/purchases when full, and frees capacity on drop', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.status = 'playing';

  assert.equal(getMaxInventoryCapacity(0), 38);
  assert.equal(getMaxInventoryCapacity(1), 60);
  assert.equal(getMaxInventoryCapacity(2), 90);
  assert.equal(getMaxInventoryCapacity(3), 130);

  // Starting player has backpackLevel = 1 (capacity 60)
  const initialUsed = computeInventoryUsage(engine.player);
  assert.ok(initialUsed > 25 && initialUsed < 60, `Initial usage (${initialUsed}) fits inside Lv.1 backpack (60)`);

  // Upgrading backpack to Level 2 increases max capacity to 90
  assert.equal(engine.equipBackpack(2), true);
  assert.equal(engine.player.backpackLevel, 2);
  assert.equal(engine.getPlayerMaxCapacity(), 90);

  // Fill inventory with medical kits so usage exceeds Level 1 capacity (60) but fits Level 2 (90)
  engine.player.meds.medkit = 7;
  const heavyUsage = computeInventoryUsage(engine.player);
  assert.ok(heavyUsage > 60 && heavyUsage <= 90, `Heavy usage (${heavyUsage}) exceeds Lv.1 (60) but fits Lv.2 (90)`);

  // Attempting to downgrade to Level 1 backpack is blocked while carrying > 60 weight
  assert.equal(engine.equipBackpack(1), false, 'Cannot equip smaller backpack when current items exceed its capacity');
  assert.equal(engine.player.backpackLevel, 2, 'Backpack remains Level 2');

  // Fill backpack to near-full capacity (90)
  engine.player.meds.medkit = 8;
  engine.player.meds.pills = 3;
  const nearFullUsage = computeInventoryUsage(engine.player);
  const remainingSpace = 90 - nearFullUsage;
  assert.ok(remainingSpace < getItemWeight('med', 'medkit', 1), 'Less space remaining than 1 medkit (5.0)');

  // Place a medkit on the ground and attempt pickup -> must be blocked without deleting the ground item
  const groundMedkit = {
    id: 'test_medkit_full',
    kind: 'med',
    medId: 'medkit',
    amount: 1,
    x: engine.player.x,
    y: engine.player.y,
    inBunker: false,
  };
  engine.world.loot.push(groundMedkit);
  const medkitsBefore = engine.player.meds.medkit;
  engine.pickupLootItem(groundMedkit, engine.world.loot.indexOf(groundMedkit));
  assert.equal(engine.player.meds.medkit, medkitsBefore, 'Medkit pickup blocked when backpack is full');
  assert.equal(engine.world.loot.includes(groundMedkit), true, 'Blocked ground item is NOT lost from world.loot');

  // Drop medkits and bandages to free space, then pick up the ground medkit (note: maxStack for medkit is 4)
  engine.player.meds.medkit = 2;
  engine.dropInventoryItem('med', 'medkit');
  assert.ok(computeInventoryUsage(engine.player) + getItemWeight('med', 'medkit', 1) <= 90, 'Dropping items frees space');
  engine.pickupLootItem(groundMedkit, engine.world.loot.indexOf(groundMedkit));
  assert.equal(engine.world.loot.includes(groundMedkit), false, 'Ground medkit picked up once space is freed');
});

test('World contains exactly 2 driveable vehicles with moderately reduced HP (280 and 230) and no respawn on destruction', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();

  assert.equal(engine.world.vehicles.length, 2, 'Exactly 2 driveable vehicles exist on the entire map');
  const [v1, v2] = engine.world.vehicles;
  assert.equal(v1.hp, 280, 'Command Humvee has 280 HP');
  assert.equal(v1.maxHp, 280);
  assert.equal(v2.hp, 230, 'Patrol Cruiser has 230 HP');
  assert.equal(v2.maxHp, 230);

  // Destroy first vehicle and verify only 1 remains with no automatic respawn
  engine.damageVehicle(v1, 500, false);
  assert.equal(v1.destroyed, true);
  assert.equal(engine.world.vehicles.length, 1, 'Destroyed vehicle is permanently removed');
});

test('Shop stock restocks ONLY upon completing every 5th wave (Waves 5, 10, 15...) and not on intermediate waves', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.status = 'playing';

  // Deplete med_bundle and ammo_pack stock in Wave 1
  engine.shopStock.med_bundle = 0;
  engine.shopStock.ammo_pack = 1;

  // Completing Waves 1, 2, 3, 4 must NOT restock the shop
  for (let w = 1; w <= 4; w++) {
    engine.wave = w;
    engine.completeWave();
    assert.equal(engine.shopStock.med_bundle, 0, `Shop does NOT restock after completing Wave ${w}`);
    assert.equal(engine.shopStock.ammo_pack, 1, `Ammo stock unchanged after Wave ${w}`);
  }

  // Completing Wave 5 MUST restock the shop
  engine.wave = 5;
  engine.completeWave();
  assert.equal(engine.shopStock.med_bundle, 4, 'Shop restocks med_bundle to maxStock (4) upon completing Wave 5');
  assert.equal(engine.shopStock.ammo_pack, 5, 'Ammo pack restocks to maxStock (5) upon completing Wave 5');

  // Deplete again and verify Waves 6..9 do not restock, then Wave 10 restocks
  engine.shopStock.med_bundle = 0;
  for (let w = 6; w <= 9; w++) {
    engine.wave = w;
    engine.completeWave();
    assert.equal(engine.shopStock.med_bundle, 0, `Shop does NOT restock after completing Wave ${w}`);
  }
  engine.wave = 10;
  engine.completeWave();
  assert.equal(engine.shopStock.med_bundle, 4, 'Shop restocks again upon completing Wave 10');
});

test('Weapon-specific ammo refill calculates and purchases exact missing rounds up to max reserve and blocks when full', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.status = 'playing';
  engine.player.credits = 2000;
  engine.player.backpackLevel = 2; // 5.56 maxReserve = 240
  engine.player.slots[1] = { weaponId: 'm416', mag: 30 };
  engine.player.ammo['5.56'] = 190; // Missing 50 rounds

  const quote = engine.getWeaponAmmoRefillQuote(1);
  assert.ok(quote, 'Quote returned for Slot 1 firearm');
  assert.equal(quote.ammoType, '5.56');
  assert.equal(quote.maxReserve, getMaxAmmoReserve(2, '5.56'));
  assert.equal(quote.missingReserve, 50, 'Detects exact 50 missing rounds');
  assert.equal(quote.roundsToBuy, 50, 'Purchases exact 50 rounds needed');
  assert.equal(quote.canRefill, true);

  const bought = engine.buyWeaponAmmoRefill(1);
  assert.equal(bought, true, 'Refill purchase succeeds');
  assert.equal(engine.player.ammo['5.56'], 240, 'Reserve is topped off to exact maximum (240)');

  // Now that reserve is at 240/240, quote must block further refill
  const fullQuote = engine.getWeaponAmmoRefillQuote(1);
  assert.equal(fullQuote.canRefill, false, 'Cannot refill when reserve is already at maximum');
  assert.equal(engine.buyWeaponAmmoRefill(1), false, 'Refill purchase blocked when full');
});

test('AI companions display Roblox-style floating chat bubbles on orders and radio messages and expire cleanly', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.status = 'playing';

  assert.equal(
    engine.allies.some((b) => b.chatBubble !== null),
    false,
    'Bots start with no active chat bubble'
  );

  // Issue squad order -> triggers floating chat bubble above one of the companions
  engine.issueSquadOrder('hold');
  const speakingBot = engine.allies.find((b) => b.chatBubble !== null);
  assert.ok(speakingBot, 'Companion receives floating chat bubble on squad order');
  assert.ok(speakingBot.chatBubble.text.length > 0, 'Bubble has non-empty dialogue text');
  assert.ok(speakingBot.chatBubble.timer > 2.5, 'Bubble has duration timer');

  // Advance AI update in 0.05s steps for 4.2s -> bubble expires cleanly
  for (let i = 0; i < 85; i++) {
    engine.update(0.05);
  }
  assert.equal(speakingBot.chatBubble, null, 'Floating chat bubble expires after timer completes');
});

test('Comprehensive melee rebalance ensures no melee weapon breaks doors, furniture, barricades, trees, or stones in 1 hit', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const engine = new TacticalStrikeEngine();
  engine.status = 'playing';

  // Verify every melee weapon deals less than 100% of a door (160 HP), barricade (480 HP), tree (160 HP), or stone (240 HP) in 1 hit
  for (const m of Object.values(MELEE_WEAPONS)) {
    const doorHit = Math.round(m.damage * (m.doorMult || 0.25));
    const furnHit = Math.round(m.damage * (m.furnitureMult || 0.3));
    const barHit = Math.round(m.damage * (m.barricadeMult || 0.2));
    const treeHit = Math.round(m.damage * (m.treeMult || 0.2));
    const stoneHit = Math.round(m.damage * (m.stoneMult || 0.1));

    assert.ok(doorHit < 160, `${m.name} cannot destroy a 160 HP door in 1 hit (${doorHit} dmg)`);
    assert.ok(furnHit < 85, `${m.name} cannot destroy standard furniture in 1 hit (${furnHit} dmg)`);
    assert.ok(barHit < 480, `${m.name} cannot destroy a 480 HP barricade in 1 hit (${barHit} dmg)`);
    assert.ok(treeHit < 160, `${m.name} cannot fell a 160 HP tree in 1 hit (${treeHit} dmg)`);
    assert.ok(stoneHit < 240, `${m.name} cannot shatter a 240 HP stone in 1 hit (${stoneHit} dmg)`);
  }

  // Verify heavy tools (fireAxe) deal more structural damage to doors/trees than katana, while katana excels vs zombies
  const katana = MELEE_WEAPONS.katana;
  const axe = MELEE_WEAPONS.fireAxe;
  assert.ok(katana.damage > axe.damage, 'Katana deals higher base anti-zombie damage than Fire Axe');
  assert.ok(
    axe.damage * axe.treeMult > katana.damage * katana.treeMult,
    'Fire Axe deals significantly more chopping damage to trees than Katana'
  );
  assert.ok(
    axe.damage * axe.doorMult > katana.damage * katana.doorMult,
    'Fire Axe breaches doors faster than Katana'
  );
});

test('Building doorways never intersect wall segments, windows always block characters even when shattered, and spawn zone has zero ground loot', async () => {
  const { generateWorld } = await import('./worldGen.js');
  const world = generateWorld(4092);

  // 1. Verify no wall segment overlaps any door opening across all buildings
  for (const b of world.buildings) {
    for (const d of b.doors) {
      const pad = 10;
      const dx1 = d.x - pad;
      const dy1 = d.y - pad;
      const dx2 = d.x + d.w + pad;
      const dy2 = d.y + d.h + pad;
      for (const w of b.walls) {
        const overlaps = dx1 < w.x + w.w && dx2 > w.x && dy1 < w.y + w.h && dy2 > w.y;
        assert.equal(overlaps, false, `Door ${d.id} in building ${b.id} is unobstructed by wall segments`);
      }
    }
  }

  // 2. Verify shattered windows STILL block players, bots, and zombies while allowing bullets through
  const sampleBuilding = world.buildings.find((b) => b.windows && b.windows.length > 0);
  assert.ok(sampleBuilding, 'Found building with windows');
  const win = sampleBuilding.windows[0];
  win.shattered = true;
  win.hp = 0;

  const testUnit = { x: win.x + win.w * 0.5, y: win.y + win.h * 0.5, r: 16 };
  resolveEntityCollisions(testUnit, { buildings: [sampleBuilding], crates: [], stones: [], trees: [], bridges: [] }, false);
  const stillOverlapping = circleIntersectsRect(testUnit.x, testUnit.y, 16, win.x, win.y, win.w, win.h);
  assert.equal(stillOverlapping, false, 'Shattered window still physically blocks character movement');

  // Non-bullet raycast (AI/zombie sight/path check) hits shattered window, whereas bullet raycast passes through
  const rayStartX = win.x - 40;
  const rayStartY = win.y + win.h * 0.5;
  const rayEndX = win.x + win.w + 40;
  const rayEndY = win.y + win.h * 0.5;
  const mockWinWorld = {
    buildings: [{ ...sampleBuilding, walls: [], doors: [], furniture: [], windows: [win] }],
    crates: [],
    stones: [],
    trees: [],
    bridges: [],
  };
  const nonBulletHit = raycastObstacles(rayStartX, rayStartY, rayEndX, rayEndY, mockWinWorld, false, { isBullet: false });
  assert.ok(nonBulletHit && nonBulletHit.hit && nonBulletHit.refType === 'window', 'Non-bullet ray is blocked by shattered window');
  const bulletHit = raycastObstacles(rayStartX, rayStartY, rayEndX, rayEndY, mockWinWorld, false, { isBullet: true });
  assert.equal(bulletHit, null, 'Bullet ray passes cleanly through shattered window');

  // 3. Verify spawn zone around (10000, 10000) within 860px is 100% free of surface ground loot and crates
  const surfaceSpawnLoot = world.loot.filter(
    (item) => !item.inBunker && Math.sqrt(distSq(item.x, item.y, 10000, 10000)) < 850
  );
  assert.equal(surfaceSpawnLoot.length, 0, 'Zero surface loot items spawn in the player spawn zone');

  const surfaceSpawnCrates = world.crates.filter(
    (c) => Math.sqrt(distSq(c.x + c.w * 0.5, c.y + c.h * 0.5, 10000, 10000)) < 850
  );
  assert.equal(surfaceSpawnCrates.length, 0, 'Zero supply crates spawn in the player spawn zone');
});

test('Host-Authoritative P2P Multiplayer (PeerJS 20Hz Tick Rate) correctly serializes and synchronizes game state', async () => {
  const { TacticalStrikeEngine } = await import('./gameEngine.js');
  const hostEngine = new TacticalStrikeEngine();
  const clientEngine = new TacticalStrikeEngine();

  // 1. Host creates room with 4-letter code and 'survev-room-XXXX' ID format
  hostEngine.createMultiplayerRoom('HOST-ALPHA', { biomeId: 'forest', squadSize: 2 });
  assert.equal(hostEngine.isHost, true);
  assert.equal(hostEngine.roomCode.length, 4);
  assert.ok(hostEngine.roomConfig.mapSeed > 0);

  // 2. Client joins with that 4-letter code
  clientEngine.joinMultiplayerRoom(hostEngine.roomCode, 'CLIENT-BRAVO');
  assert.equal(clientEngine.isHost, false);
  assert.equal(clientEngine.roomCode, hostEngine.roomCode);

  // 3. Start game with shared map seed
  const sharedSeed = hostEngine.roomConfig.mapSeed;
  hostEngine.startGame('forest', 2);
  assert.equal(hostEngine.status, 'playing');

  // Client receives room:started
  clientEngine.handleNetworkMessage({
    type: 'room:started',
    code: hostEngine.roomCode,
    seed: sharedSeed,
    biomeId: 'forest',
    squadSize: 2,
    roomConfig: hostEngine.roomConfig,
  });
  assert.equal(clientEngine.status, 'playing');
  assert.equal(clientEngine.isHost, false);

  // 4. Verify Host is authoritative: Host generates zombies, bullets, and loot
  hostEngine.zombies = [
    createZombieInstance('walker', 10100, 10100, 1.0, 1.0, 'z_host_1'),
    createZombieInstance('spitter', 10200, 10200, 1.0, 1.0, 'z_host_2'),
  ];
  hostEngine.bullets = [
    { x: 10050, y: 10050, angle: 0.5, inBunker: false, color: '#fef08a', thickness: 3 },
  ];

  // Intercept Host's 20Hz snapshot broadcast
  let capturedSnapshot = null;
  hostEngine.broadcastP2P = (payload) => {
    if (payload.type === 'host:snapshot') {
      capturedSnapshot = payload;
    }
  };

  hostEngine.broadcastHostTick();
  assert.ok(capturedSnapshot, 'Host broadcasts 20Hz snapshot');
  assert.equal(capturedSnapshot.type, 'host:snapshot');
  assert.equal(capturedSnapshot.zombies.length, 2, 'Snapshot contains active host zombies');
  assert.equal(capturedSnapshot.bullets.length, 1, 'Snapshot contains active bullets');
  assert.ok(capturedSnapshot.loot.length > 0, 'Snapshot contains authoritative floor loot');
  assert.equal(capturedSnapshot.wave, hostEngine.wave);

  // 5. Client receives Host snapshot and reconciles entities without simulating zombie AI
  clientEngine.applyHostSnapshot(capturedSnapshot);
  assert.equal(clientEngine.zombies.length, 2, 'Client directly renders Host zombies');
  assert.ok(clientEngine.zombies[0].id.includes('z_host_1'), 'Client zombie ID preserved from Host');
  assert.equal(clientEngine.bullets.length, 1, 'Client receives Host bullets');
  assert.equal(clientEngine.world.loot.length, capturedSnapshot.loot.length, 'Client floor loot matches Host');

  // 6. Client fires weapon: Client does NOT calculate zombie damage locally, sends client:fire to Host
  let clientFireEvent = null;
  clientEngine.broadcastP2P = (payload) => {
    if (payload.type === 'client:fire') {
      clientFireEvent = payload;
    }
  };
  clientEngine.keys = {};
  clientEngine.mouse.down = true;
  clientEngine.player.fireTimer = 0;
  clientEngine.player.reloading = 0;
  clientEngine.updatePlayer(0.016);
  assert.ok(clientFireEvent, 'Client sends client:fire to Host');
  assert.equal(clientFireEvent.type, 'client:fire');

  // Host receives client:fire and authoritatively spawns projectiles on Host
  const bulletsBefore = hostEngine.bullets.length;
  hostEngine.handleNetworkMessage(clientFireEvent);
  assert.ok(hostEngine.bullets.length > bulletsBefore, 'Host spawns authoritative bullets from client fire event');
});




