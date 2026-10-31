import Peer from 'peerjs';
import {
  WORLD_SIZE,
  WEAPONS,
  MELEE_WEAPONS,
  THROWABLES,
  MEDICAL_ITEMS,
  SCOPES,
  SHOP_ITEMS,
  BACKPACK_NAMES,
  ITEM_WEIGHTS,
  AMMO_SHOP_PRICES,
} from '../config/constants.js';
import { generateWorld } from './worldGen.js';
import {
  clamp,
  distSq,
  resolveEntityCollisions,
  computeWaveComposition,
  createZombieInstance,
  applyAdrenalineTick,
  raycastObstacles,
  segmentIntersectsCircle,
  computePlayerAimAngle,
  lerpAngle,
  computeSmartSteerAngle,
  getMaxInventoryCapacity,
  getMaxAmmoReserve,
  getItemWeight,
  computeInventoryUsage,
} from './gameLogic.js';
import { createAISquad, updateAISquad, setBotChatBubble } from './aiController.js';
import { soundEngine } from './sound.js';

const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
};

export class TacticalStrikeEngine {
  constructor(onHudSync) {
    this.onHudSync = onHudSync;
    this.biomeId = 'forest';
    this.squadSize = 4;
    this.status = 'menu'; // 'menu' | 'playing' | 'paused' | 'gameover'
    this.elapsedTime = 0;
    this.hudSyncTimer = 0;

    // Room Configuration (Host-configurable)
    this.roomConfig = {
      biomeId: 'forest',
      difficulty: 'normal', // 'normal' (1.0x) | 'veteran' (1.4x) | 'nightmare' (2.0x)
      squadSize: 4,
      startingCredits: 500,
      friendlyFire: false,
      dayCycleSpeed: 'normal', // 'normal' | 'fast' | 'day_only' | 'night_only'
      mapSeed: 4092,
    };

    // Solar Cycle & Dynamic Weather
    this.timeOfDay = 0.22; // 0.0-0.45 Day, 0.45-0.65 Sunset, 0.65-1.0 Night
    this.weather = 'clear'; // 'clear' | 'rain' | 'fog' | 'storm'
    this.weatherTimer = 42;
    this.lightningTimer = 0;

    // PeerJS WebRTC P2P + WebSocket Hybrid Co-Op State
    this.peer = null;
    this.peerConnections = new Map();
    this.hostConn = null;
    this.p2pStatus = 'ready';
    this.ws = null;
    this.localId = `p_${Math.random().toString(36).slice(2, 8)}`;
    this.playerName = `COLE-${Math.floor(10 + Math.random() * 89)}`;
    this.roomCode = '';
    this.isHost = true;
    this.roomPlayers = [];
    this.remotePlayers = new Map();
    this.netSyncTimer = 0;
    this.chatMessages = [
      { id: 'sys_1', sender: 'COMANDO', text: 'Canal táctico P2P activo. Usa [T] para transmitir.', time: '00:00' },
    ];

    // Input & Viewport State
    this.canvasSize = { width: 1280, height: 720 };
    this.keys = {};
    this.mouse = { screenX: 640, screenY: 360, worldX: 0, worldY: 0, down: false, lastMovedAt: 0 };
    this.touchMove = { active: false, dx: 0, dy: 0, dist: 0, isSprinting: false };
    this.touchAim = { active: false, dx: 0, dy: 0, dist: 0, angle: 0, firing: false };

    this.squadCommand = 'free'; // 'free' | 'loot' | 'hunt' | 'hold' | 'follow' | 'peace'
    this.holdPoint = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };

    this.shopOpen = false;
    this.globalMapOpen = false;
    this.shopStock = {};
    this.flashSaleIds = [];

    this.resetSession('forest', 4, 4092);
    this.connectMultiplayerSocket();
  }

  connectMultiplayerSocket() {
    if (typeof window === 'undefined') return;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws`;
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          this.handleNetworkMessage(msg);
        } catch {}
      };

      socket.onclose = () => {
        this.ws = null;
      };
    } catch {}
  }

  broadcastP2P(payload) {
    // 1. Send over PeerJS WebRTC P2P connections
    const serialized = JSON.stringify(payload);
    if (this.isHost) {
      for (const conn of this.peerConnections.values()) {
        if (conn && conn.open) {
          try {
            conn.send(payload);
          } catch {}
        }
      }
    } else if (this.hostConn && this.hostConn.open) {
      try {
        this.hostConn.send(payload);
      } catch {}
    }

    // 2. Also send over WebSocket relay for same-instance / firewall fallback
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(serialized);
      } catch {}
    }
  }

  updateRoomConfig(partial) {
    this.roomConfig = { ...this.roomConfig, ...partial };
    this.biomeId = this.roomConfig.biomeId;
    this.squadSize = this.roomConfig.squadSize;
    if (this.isHost && this.roomCode) {
      this.broadcastP2P({
        type: 'room:config',
        roomConfig: this.roomConfig,
        biomeId: this.biomeId,
        squadSize: this.squadSize,
      });
    }
    this.syncHudImmediate();
  }

  createMultiplayerRoom(playerName, customConfig = {}) {
    if (playerName) this.playerName = playerName.trim().slice(0, 14).toUpperCase();
    this.roomConfig = {
      ...this.roomConfig,
      ...customConfig,
      mapSeed: Math.floor(1000 + Math.random() * 8999),
    };
    this.biomeId = this.roomConfig.biomeId;
    this.squadSize = this.roomConfig.squadSize;

    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    this.roomCode = code;
    this.isHost = true;
    this.p2pStatus = 'connecting';
    this.roomPlayers = [{ id: this.localId, name: this.playerName, role: 'HOST P2P', ready: true, color: '#fde047' }];
    this.syncHudImmediate();

    // Initialize Real PeerJS WebRTC Host with ID `survev-room-XXXX` & Google STUN
    try {
      if (this.peer) {
        this.peer.destroy();
      }
      const peerId = `survev-room-${code}`;
      const peer = new Peer(peerId, PEER_CONFIG);
      this.peer = peer;

      peer.on('open', () => {
        this.p2pStatus = 'online';
        this.syncHudImmediate();
      });

      peer.on('connection', (conn) => {
        conn.on('open', () => {
          this.peerConnections.set(conn.peer, conn);
          conn.send({
            type: 'room:joined',
            code: this.roomCode,
            hostId: this.localId,
            biomeId: this.biomeId,
            squadSize: this.squadSize,
            mapSeed: this.roomConfig.mapSeed,
            roomConfig: this.roomConfig,
            players: this.roomPlayers,
            status: this.status,
          });
        });

        conn.on('data', (data) => {
          const msg = typeof data === 'string' ? JSON.parse(data) : data;
          this.handleNetworkMessage(msg, conn);
        });

        conn.on('close', () => {
          this.peerConnections.delete(conn.peer);
          this.syncHudImmediate();
        });

        conn.on('error', () => {
          this.peerConnections.delete(conn.peer);
        });
      });

      peer.on('error', (err) => {
        console.warn('[PeerJS Host Error]', err);
        this.p2pStatus = 'relay';
        this.syncHudImmediate();
      });
    } catch {
      this.p2pStatus = 'relay';
    }

    // Also register on WebSocket relay
    this.broadcastP2P({
      type: 'room:create',
      code,
      name: this.playerName,
      biomeId: this.biomeId,
      squadSize: this.squadSize,
      mapSeed: this.roomConfig.mapSeed,
      roomConfig: this.roomConfig,
    });
  }

  joinMultiplayerRoom(code, playerName) {
    const cleanCode = String(code || '').trim().toUpperCase().slice(0, 4);
    if (cleanCode.length !== 4) return;
    if (playerName) this.playerName = playerName.trim().slice(0, 14).toUpperCase();
    this.roomCode = cleanCode;
    this.isHost = false;
    this.p2pStatus = 'connecting';
    this.roomPlayers = [
      { id: 'host_peer', name: 'HOST SALA', role: 'HOST P2P', ready: true, color: '#fde047' },
      { id: this.localId, name: this.playerName, role: 'CLIENTE P2P', ready: true, color: '#38bdf8' },
    ];
    this.syncHudImmediate();

    // Connect via PeerJS WebRTC to `survev-room-XXXX` using Google STUN
    try {
      if (this.peer) {
        this.peer.destroy();
      }
      const peer = new Peer(undefined, PEER_CONFIG);
      this.peer = peer;

      peer.on('open', () => {
        const hostPeerId = `survev-room-${cleanCode}`;
        const conn = peer.connect(hostPeerId, { reliable: true });
        this.hostConn = conn;

        conn.on('open', () => {
          this.p2pStatus = 'online';
          conn.send({
            type: 'peer:hello',
            player: {
              id: this.localId,
              name: this.playerName,
              role: 'OPERADOR P2P',
              ready: true,
              color: '#38bdf8',
            },
          });
          this.syncHudImmediate();
        });

        conn.on('data', (data) => {
          const msg = typeof data === 'string' ? JSON.parse(data) : data;
          this.handleNetworkMessage(msg, conn);
        });

        conn.on('close', () => {
          this.p2pStatus = 'relay';
          this.hostConn = null;
          this.syncHudImmediate();
        });

        conn.on('error', (err) => {
          console.warn('[PeerJS Conn Error]', err);
          this.p2pStatus = 'relay';
          this.syncHudImmediate();
        });
      });

      peer.on('error', (err) => {
        console.warn('[PeerJS Client Error]', err);
        this.p2pStatus = 'relay';
        this.syncHudImmediate();
      });
    } catch {
      this.p2pStatus = 'relay';
    }

    // Also join via WebSocket relay fallback
    this.broadcastP2P({
      type: 'room:join',
      code: cleanCode,
      name: this.playerName,
    });
  }

  sendChatMessage(text) {
    const clean = String(text || '').trim().slice(0, 90);
    if (!clean) return;
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const entry = {
      id: `chat_${Date.now()}_${Math.random()}`,
      sender: this.playerName || 'COLE',
      text: clean,
      time: nowTime,
    };
    this.chatMessages = [...this.chatMessages.slice(-14), entry];
    this.broadcastP2P({ type: 'world:event', event: 'chatMessage', entry });

    // Natural-Language Spanish Bot Command & Item Sharing Parser
    const lower = clean
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const aliveBots = (this.allies || []).filter((b) => !b.downed);
    if (aliveBots.length > 0) {
      const botSpeaker = aliveBots[0];
      const pushBotReply = (speakerObj, msgText) => {
        const speakerName = speakerObj?.name || 'LOGAN';
        const reply = {
          id: `chat_bot_${Date.now()}_${Math.random()}`,
          sender: speakerName,
          text: msgText,
          time: nowTime,
        };
        this.chatMessages = [...this.chatMessages.slice(-14), reply];
        if (speakerObj) {
          setBotChatBubble(speakerObj, msgText, 4.2);
        }
      };

      if (
        lower.includes('vete') ||
        lower.includes('vayanse') ||
        lower.includes('no me sigan') ||
        lower.includes('alejense') ||
        lower.includes('separense') ||
        lower.includes('lotear') ||
        lower.includes('libres')
      ) {
        this.squadCommand = 'free';
        const p = this.player;
        const buildings = this.world?.buildings || [];
        this.allies.forEach((bot, idx) => {
          bot.holdPos = null;
          // Assign a distant building (> 1300px away in 4 opposite sectors)
          const sectorAngle = (idx * Math.PI) / 2;
          const targetX = p.x + Math.cos(sectorAngle) * 1900;
          const targetY = p.y + Math.sin(sectorAngle) * 1900;
          let bestB = null;
          let bestD2 = Infinity;
          for (const b of buildings) {
            const bCx = b.x + b.w * 0.5;
            const bCy = b.y + b.h * 0.5;
            if (distSq(p.x, p.y, bCx, bCy) < 1300 * 1300) continue;
            const d2 = distSq(targetX, targetY, bCx, bCy);
            if (d2 < bestD2) {
              bestD2 = d2;
              bestB = b;
            }
          }
          if (bestB) {
            bot.roamTarget = { x: bestB.x + bestB.w * 0.5, y: bestB.y + bestB.h * 0.5, buildingId: bestB.id };
          } else {
            bot.roamTarget = {
              x: clamp(targetX, 900, WORLD_SIZE - 900),
              y: clamp(targetY, 900, WORLD_SIZE - 900),
            };
          }
          bot.roamTimer = 22;
        });
        pushBotReply(
          botSpeaker,
          '¡Sale bro, nos abrimos! Cada quien a explorar casas lejos de tu posición.'
        );
      } else if (
        lower.includes('quieto') ||
        lower.includes('quedense') ||
        lower.includes('esperen') ||
        lower.includes('paren')
      ) {
        this.squadCommand = 'hold';
        this.holdPoint = { x: this.player.x, y: this.player.y };
        this.allies.forEach((bot) => {
          bot.holdPos = { x: bot.x, y: bot.y };
        });
        pushBotReply(botSpeaker, '¡Copiado! Mantenemos posición aquí sin movernos.');
      } else if (lower.includes('siganme') || lower.includes('vengan') || lower.includes('ayuda')) {
        this.squadCommand = 'follow';
        this.allies.forEach((bot) => {
          bot.holdPos = null;
        });
        pushBotReply(botSpeaker, '¡En camino bro! Nos reagrupamos contigo.');
      } else if (
        lower.includes('soda') ||
        lower.includes('pildora') ||
        lower.includes('pastilla') ||
        lower.includes('venda') ||
        lower.includes('botiquin') ||
        lower.includes('cura') ||
        lower.includes('bala') ||
        lower.includes('municion')
      ) {
        // Nearest alive bot drops the requested supply 40px from the player
        let nearestBot = aliveBots[0];
        let minD2 = distSq(this.player.x, this.player.y, nearestBot.x, nearestBot.y);
        for (const b of aliveBots) {
          const d2 = distSq(this.player.x, this.player.y, b.x, b.y);
          if (d2 < minD2) {
            minD2 = d2;
            nearestBot = b;
          }
        }
        const dropX = this.player.x + Math.cos(this.player.angle) * 40;
        const dropY = this.player.y + Math.sin(this.player.angle) * 40;

        if (lower.includes('bala') || lower.includes('municion')) {
          const activeSlot = this.player.slots[this.player.activeSlot === 2 ? 2 : 1];
          const cal = WEAPONS[activeSlot?.weaponId]?.ammoType || '5.56';
          this.world.loot.push({
            id: `bot_drop_${Date.now()}`,
            kind: 'ammo',
            ammoType: cal,
            amount: 45,
            x: dropX,
            y: dropY,
            inBunker: this.player.inBunker,
          });
          pushBotReply(nearestBot, `¡Toma bro! Te solté una caja de ${cal} a tus pies.`);
        } else {
          const medId = lower.includes('soda')
            ? 'soda'
            : lower.includes('pildora') || lower.includes('pastilla')
            ? 'pills'
            : lower.includes('botiquin')
            ? 'medkit'
            : 'bandage';
          this.world.loot.push({
            id: `bot_drop_${Date.now()}`,
            kind: 'med',
            medId,
            amount: 1,
            x: dropX,
            y: dropY,
            inBunker: this.player.inBunker,
          });
          pushBotReply(
            nearestBot,
            `¡Listo bro! Te tiré ${MEDICAL_ITEMS[medId]?.name || medId} justo al lado tuyo.`
          );
        }
        soundEngine.playPickup();
      } else {
        pushBotReply(botSpeaker, '¡Recibido en el canal táctico! Manteniendo cobertura.');
      }
    }

    this.syncHudImmediate();
  }

  handleNetworkMessage(msg, conn = null) {
    if (!msg || !msg.type) return;

    if (msg.type === 'peer:hello') {
      const player = msg.player;
      if (player && player.id) {
        this.remotePlayers.set(player.id, player);
        const exists = this.roomPlayers.some((p) => p.id === player.id);
        if (!exists && this.roomPlayers.length < 4) {
          this.roomPlayers.push(player);
        }
        if (conn && conn.open) {
          try {
            conn.send({
              type: 'room:joined',
              code: this.roomCode,
              hostId: this.localId,
              biomeId: this.biomeId,
              squadSize: this.squadSize,
              mapSeed: this.roomConfig.mapSeed,
              roomConfig: this.roomConfig,
              players: this.roomPlayers,
              status: this.status,
            });
          } catch {}
        }
        this.broadcastP2P({
          type: 'room:updated',
          code: this.roomCode,
          hostId: this.localId,
          biomeId: this.biomeId,
          squadSize: this.squadSize,
          mapSeed: this.roomConfig.mapSeed,
          roomConfig: this.roomConfig,
          players: this.roomPlayers,
        });
        this.syncHudImmediate();
      }
    } else if (msg.type === 'room:joined' || msg.type === 'room:updated') {
      if (msg.selfId) this.localId = msg.selfId;
      this.roomCode = msg.code || this.roomCode;
      if (msg.roomConfig) {
        this.roomConfig = { ...this.roomConfig, ...msg.roomConfig };
      }
      if (msg.mapSeed) {
        this.roomConfig.mapSeed = msg.mapSeed;
      }
      this.biomeId = msg.biomeId || this.roomConfig.biomeId || this.biomeId;
      if (typeof msg.squadSize === 'number') this.squadSize = msg.squadSize;
      if (Array.isArray(msg.players)) {
        this.roomPlayers = msg.players;
      }
      this.syncHudImmediate();
    } else if (msg.type === 'room:config') {
      if (msg.roomConfig) {
        this.roomConfig = { ...this.roomConfig, ...msg.roomConfig };
        this.biomeId = this.roomConfig.biomeId;
        this.squadSize = this.roomConfig.squadSize;
      }
      this.syncHudImmediate();
    } else if (msg.type === 'room:started') {
      this.roomCode = msg.code || this.roomCode;
      if (msg.roomConfig) {
        this.roomConfig = { ...this.roomConfig, ...msg.roomConfig };
      }
      this.biomeId = msg.biomeId || this.roomConfig.biomeId;
      this.squadSize = typeof msg.squadSize === 'number' ? msg.squadSize : this.roomConfig.squadSize;
      const seed = msg.seed || this.roomConfig.mapSeed || this.roomCode || 4092;
      this.roomConfig.mapSeed = seed;
      this.isHost = false;
      this.resetSession(this.biomeId, this.squadSize, seed);
      this.status = 'playing';
      this.syncHudImmediate();
    } else if (msg.type === 'client:input') {
      if (msg.player && msg.player.id && msg.player.id !== this.localId) {
        this.remotePlayers.set(msg.player.id, msg.player);
      }
    } else if (msg.type === 'client:fire' && this.isHost) {
      const w = WEAPONS[msg.weaponId];
      if (w) {
        const shooterProxy = {
          x: msg.x,
          y: msg.y,
          angle: msg.angle,
          inBunker: Boolean(msg.inBunker),
          damageBoostMult: 1.0,
        };
        this.spawnWeaponProjectiles(shooterProxy, w, true);
        soundEngine.playShot(w.category);
      }
    } else if (msg.type === 'client:melee' && this.isHost) {
      const m = MELEE_WEAPONS[msg.meleeId];
      if (m) {
        const attackerProxy = {
          x: msg.x,
          y: msg.y,
          angle: msg.angle,
          inBunker: Boolean(msg.inBunker),
          meleeId: msg.meleeId,
          damageBoostMult: 1.0,
        };
        this.performMeleeAttack(attackerProxy);
      }
    } else if (msg.type === 'client:throw' && this.isHost) {
      const throwerProxy = {
        x: msg.x,
        y: msg.y,
        angle: msg.angle,
        inBunker: Boolean(msg.inBunker),
        activeBunkerId: null,
      };
      this.executeRemoteThrowable(throwerProxy, msg.throwableId, msg.rotation || 0);
    } else if (msg.type === 'client:pickup' && this.isHost) {
      const idx = this.world.loot.findIndex((l) => l.id === msg.lootId);
      if (idx !== -1) {
        this.world.loot.splice(idx, 1);
      }
    } else if (msg.type === 'client:drop' && this.isHost) {
      if (msg.item) {
        this.world.loot.push(msg.item);
      }
    } else if (msg.type === 'client:door') {
      if (this.world?.buildings) {
        for (const b of this.world.buildings) {
          for (const d of b.doors || []) {
            if (d.id === msg.doorId) {
              d.open = typeof msg.open === 'boolean' ? msg.open : !d.open;
            }
          }
        }
      }
    } else if (msg.type === 'host:snapshot' && !this.isHost) {
      this.applyHostSnapshot(msg);
    } else if (msg.type === 'world:event') {
      if (msg.event === 'revive' && msg.targetId === this.localId && this.player.downed) {
        this.player.downed = false;
        this.player.hp = 65;
        this.player.reviveProgress = 0;
      } else if (msg.event === 'credits' && typeof msg.amount === 'number') {
        this.player.credits += msg.amount;
      } else if (msg.event === 'chatMessage' && msg.entry) {
        this.chatMessages = [...this.chatMessages.slice(-14), msg.entry];
        this.syncHudImmediate();
      } else if (msg.event === 'openDoor' && msg.doorId) {
        for (const b of this.world.buildings) {
          for (const d of b.doors || []) {
            if (d.id === msg.doorId) d.open = msg.open;
          }
        }
      }
    }
  }

  applyHostSnapshot(s) {
    if (!s) return;

    if (Array.isArray(s.players)) {
      for (const p of s.players) {
        if (p.id === this.localId) {
          if (typeof p.hp === 'number' && p.hp < this.player.hp) {
            this.player.hp = p.hp;
          }
          if (p.downed && !this.player.downed) {
            this.player.downed = true;
          } else if (!p.downed && this.player.downed) {
            this.player.downed = false;
            this.player.hp = Math.max(65, p.hp);
          }
        } else {
          this.remotePlayers.set(p.id, p);
        }
      }
    }

    if (Array.isArray(s.zombies)) {
      this.zombies = s.zombies;
    }

    if (Array.isArray(s.bullets)) {
      this.bullets = s.bullets;
    }
    if (Array.isArray(s.acidProjectiles)) {
      this.acidProjectiles = s.acidProjectiles;
    }

    if (Array.isArray(s.loot)) {
      this.world.loot = s.loot;
    }

    if (Array.isArray(s.allies) && s.allies.length > 0) {
      this.allies = s.allies;
    }

    if (typeof s.wave === 'number') {
      this.wave = s.wave;
    }
    if (typeof s.timeOfDay === 'number') {
      this.timeOfDay = s.timeOfDay;
    }
    if (s.weather) {
      this.weather = s.weather;
    }
    if (typeof s.rainIntensity === 'number') {
      this.rainIntensity = s.rainIntensity;
    }
    if (typeof s.fogDensity === 'number') {
      this.fogDensity = s.fogDensity;
    }
    if (s.waveBanner && s.waveBanner !== this.waveBanner) {
      this.waveBanner = s.waveBanner;
      this.waveBannerTimer = 3.0;
    }
  }

  broadcastHostTick() {
    if (!this.isHost || !this.roomCode) return;

    const p = this.player;
    const activeSlotW = p.slots[p.activeSlot === 2 ? 2 : 1]?.weaponId || 'm416';
    const allPlayers = [
      {
        id: this.localId,
        name: this.playerName,
        x: Math.round(p.x),
        y: Math.round(p.y),
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        angle: Number(p.angle.toFixed(2)),
        hp: Math.round(p.hp),
        maxHp: p.maxHp,
        downed: p.downed,
        activeSlot: p.activeSlot,
        weaponId: activeSlotW,
        meleeId: p.meleeId,
        throwableId: p.throwableId,
        inBunker: p.inBunker,
        color: '#fde047',
        reloading: p.reloading > 0,
        meleeSwingTimer: p.meleeSwingTimer || 0,
      },
      ...Array.from(this.remotePlayers.values()),
    ];

    const snapshot = {
      type: 'host:snapshot',
      time: Date.now(),
      wave: this.wave,
      waveBanner: this.waveBannerTimer > 0 ? this.waveBanner : '',
      timeOfDay: Number(this.timeOfDay.toFixed(3)),
      weather: this.weather,
      rainIntensity: Number((this.rainIntensity || 0).toFixed(2)),
      fogDensity: Number((this.fogDensity || 0).toFixed(2)),
      players: allPlayers,
      zombies: this.zombies
        .filter((z) => !z._dead && z.hp > 0)
        .map((z) => ({
          id: z.id,
          type: z.type,
          x: Math.round(z.x),
          y: Math.round(z.y),
          hp: Math.round(z.hp),
          maxHp: z.maxHp,
          angle: Number(z.angle.toFixed(2)),
          moveAngle: Number((z.moveAngle ?? z.angle).toFixed(2)),
          inBunker: Boolean(z.inBunker),
          bunkerId: z.bunkerId || null,
          vest: Boolean(z.vest),
          ranged: Boolean(z.ranged),
          isVip: Boolean(z.isVip),
          r: z.r || 20,
        })),
      bullets: this.bullets.map((b) => ({
        x: Math.round(b.x),
        y: Math.round(b.y),
        angle: Number(b.angle.toFixed(2)),
        inBunker: Boolean(b.inBunker),
        color: b.color || '#fef08a',
        thickness: b.thickness || 3,
      })),
      acidProjectiles: this.acidProjectiles.map((ap) => ({
        x: Math.round(ap.x),
        y: Math.round(ap.y),
        inBunker: Boolean(ap.inBunker),
      })),
      loot: this.world.loot.map((it) => ({
        id: it.id,
        kind: it.kind,
        weaponId: it.weaponId,
        ammoType: it.ammoType,
        amount: it.amount,
        medId: it.medId,
        gearType: it.gearType,
        level: it.level,
        scope: it.scope,
        meleeId: it.meleeId,
        throwableId: it.throwableId,
        x: Math.round(it.x),
        y: Math.round(it.y),
        inBunker: Boolean(it.inBunker),
        bunkerId: it.bunkerId || null,
      })),
      allies: this.allies.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        x: Math.round(a.x),
        y: Math.round(a.y),
        angle: Number(a.angle.toFixed(2)),
        hp: Math.round(a.hp),
        maxHp: a.maxHp,
        downed: a.downed,
        inBunker: Boolean(a.inBunker),
        weaponId: a.weaponId,
        color: a.color,
        chatBubble: a.chatBubble ? { ...a.chatBubble } : null,
      })),
    };

    this.broadcastP2P(snapshot);
  }

  broadcastClientInput() {
    if (this.isHost || !this.roomCode) return;
    const p = this.player;
    const activeSlotW = p.slots[p.activeSlot === 2 ? 2 : 1]?.weaponId || 'm416';
    const payload = {
      type: 'client:input',
      player: {
        id: this.localId,
        name: this.playerName,
        x: Math.round(p.x),
        y: Math.round(p.y),
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        angle: Number(p.angle.toFixed(2)),
        hp: Math.round(p.hp),
        maxHp: p.maxHp,
        downed: p.downed,
        activeSlot: p.activeSlot,
        weaponId: activeSlotW,
        meleeId: p.meleeId,
        throwableId: p.throwableId,
        inBunker: p.inBunker,
        color: '#38bdf8',
        reloading: p.reloading > 0,
        meleeSwingTimer: p.meleeSwingTimer || 0,
      },
    };
    this.broadcastP2P(payload);
  }

  executeRemoteThrowable(thrower, thId, rot = 0) {
    const th = THROWABLES[thId];
    if (!th) return;

    if (thId === 'turret') {
      const tx = thrower.x + Math.cos(thrower.angle) * 52;
      const ty = thrower.y + Math.sin(thrower.angle) * 52;
      this.turrets.push({
        id: `turret_${Date.now()}_${Math.random()}`,
        x: tx,
        y: ty,
        angle: thrower.angle,
        hp: 300,
        ammo: th.ammo || 120,
        maxDuration: th.duration || 45,
        ttl: th.duration || 45,
        deployProgress: 0.1,
        fireTimer: 0.35,
        inBunker: Boolean(thrower.inBunker),
      });
      soundEngine.playPickup();
      return;
    }

    if (thId === 'barricade') {
      const isVertical = rot === 90 || rot === 270;
      const bw = isVertical ? 26 : 84;
      const bh = isVertical ? 84 : 26;
      const cx = thrower.x + Math.cos(thrower.angle) * 60;
      const cy = thrower.y + Math.sin(thrower.angle) * 60;

      this.world.barricades.push({
        id: `bar_${Date.now()}_${Math.random()}`,
        x: cx - bw * 0.5,
        y: cy - bh * 0.5,
        w: bw,
        h: bh,
        rotation: rot,
        hp: th.hp || 480,
        maxHp: th.hp || 480,
        destroyed: false,
        inBunker: Boolean(thrower.inBunker),
      });
      soundEngine.playImpact('metal');
      return;
    }

    const speed = 520;
    this.grenades.push({
      id: `gren_${Date.now()}_${Math.random()}`,
      type: thId,
      x: thrower.x,
      y: thrower.y,
      vx: Math.cos(thrower.angle) * speed,
      vy: Math.sin(thrower.angle) * speed,
      fuse: th.fuse,
      radius: th.radius,
      damage: th.damage,
      color: th.color,
      inBunker: Boolean(thrower.inBunker),
      smokeActive: false,
      smokeTimer: th.duration || 0,
    });
  }

  refreshShopWaveStock() {
    this.shopStock = {};
    for (const item of SHOP_ITEMS) {
      this.shopStock[item.id] = item.maxStock ?? 2;
    }
    for (const cal of ['9mm', '12g', '5.56', '7.62', '.50']) {
      this.shopStock[`ammo_refill_${cal}`] = 4;
    }
    // Select 2 random items for Flash Sale (-40% discount)
    const eligible = SHOP_ITEMS.filter((it) => (it.minWave || 1) <= (this.wave || 1)).map((it) => it.id);
    const shuffled = [...eligible].sort(() => Math.random() - 0.5);
    this.flashSaleIds = shuffled.slice(0, 2);
  }

  getShopItemEffectivePrice(item) {
    if (this.flashSaleIds.includes(item.id)) {
      return Math.round(item.price * 0.6);
    }
    return item.price;
  }

  resetSession(biomeId = this.biomeId, squadSize = this.squadSize, seed = null) {
    this.biomeId = biomeId;
    this.squadSize = squadSize;
    const worldSeed = seed || this.roomConfig.mapSeed || this.roomCode || 4092;
    this.world = generateWorld(worldSeed);
    const c = this.world.center;

    const startCredits = this.roomConfig?.startingCredits || 500;
    this.timeOfDay =
      this.roomConfig?.dayCycleSpeed === 'night_only'
        ? 0.78
        : this.roomConfig?.dayCycleSpeed === 'day_only'
        ? 0.22
        : 0.22;
    this.weather = 'clear';
    this.weatherTimer = 120;
    this.weatherTransition = 1.0;
    this.rainIntensity = 0;
    this.fogDensity = 0;
    this.weatherWindAngle = 0.22;
    this.rainRipples = [];
    this.lightningTimer = 0;

    this.player = {
      id: this.localId,
      name: this.playerName || 'COLE',
      x: c,
      y: c,
      vx: 0,
      vy: 0,
      r: 20,
      angle: 0,
      hp: 100,
      maxHp: 100,
      adrenaline: 50,
      stamina: 100,
      maxStamina: 100,
      staminaExhausted: false,
      infiniteStaminaTimer: 0,
      hitImmunityTimer: 0,
      damageBoostMult: 1.0,
      reloadSpeedMult: 1.0,
      armorLevel: 1,
      helmetLevel: 1,
      backpackLevel: 1,
      scope: 1,
      credits: startCredits,
      score: 0,
      kills: 0,
      downed: false,
      reviveProgress: 0,
      inBunker: false,
      activeBunkerId: null,
      activeBunkerExit: { x: c + 440, y: c - 340 },
      drivingVehicleId: null,
      barricadeRotation: 0,
      activeHeal: null,
      activeSlot: 1,
      slots: {
        1: { weaponId: 'm416', mag: 30 },
        2: { weaponId: 'm870', mag: 5 },
      },
      meleeId: 'fists',
      throwableId: 'turret',
      throwableCount: { frag: 1, mirv: 0, smoke: 1, strobe: 0, turret: 1, barricade: 1 },
      ammo: {
        '9mm': 60,
        '12g': 16,
        '5.56': 90,
        '7.62': 45,
        '.50': 8,
      },
      meds: {
        bandage: 3,
        medkit: 1,
        soda: 1,
        pills: 1,
      },
      fireTimer: 0,
      meleeSwingTimer: 0,
      reloading: 0,
      reloadTotal: 0,
    };

    this.camera = { x: c, y: c };
    this.allies = createAISquad(c, c, squadSize);
    this.zombies = [];
    this.bullets = [];
    this.acidProjectiles = [];
    this.grenades = [];
    this.turrets = [];
    this.drones = [];
    this.decals = [];
    this.particles = [];
    this.airstrikes = [];
    this.muzzleFlashes = [];
    this.shells = [];
    this._explosionQueue = [];
    this._processingExplosions = false;

    this.wave = 1;
    this.lastRestockedWaveMilestone = 0;
    this.refreshShopWaveStock();
    this.waveBanner = 'RONDA 1 INICIANDO';
    this.waveBannerTimer = 3.0;
    this.interWaveTimer = 0;
    this.shopOpen = false;
    this.globalMapOpen = false;
    this.startWave(1);
  }

  startGame(biomeId = this.biomeId, squadSize = this.squadSize) {
    soundEngine.init();
    this.roomConfig.biomeId = biomeId;
    this.roomConfig.squadSize = squadSize;
    if (this.roomCode && this.isHost) {
      this.broadcastP2P({
        type: 'room:started',
        code: this.roomCode,
        seed: this.roomConfig.mapSeed || 4092,
        biomeId,
        squadSize,
        roomConfig: this.roomConfig,
      });
    }
    this.resetSession(biomeId, squadSize, this.roomConfig.mapSeed || this.roomCode || 4092);
    this.status = 'playing';
    this.syncHudImmediate();
  }

  startWave(waveNum) {
    this.wave = waveNum;
    const totalPlayers = 1 + this.remotePlayers.size;
    const diffMult =
      this.roomConfig.difficulty === 'nightmare'
        ? 2.0
        : this.roomConfig.difficulty === 'veteran'
        ? 1.4
        : 1.0;
    const comp = computeWaveComposition(waveNum, totalPlayers, diffMult);
    this.waveQueue = [...comp.queue];
    this.waveHpMult = comp.hpMultiplier;
    this.waveSpeedMult = comp.speedMultiplier;
    this.waveTotal = comp.totalCount;
    this.waveSpawnTimer = 0.55;
    this.waveBanner = `RONDA ${waveNum} EN CURSO`;
    this.waveBannerTimer = 3.2;
    soundEngine.playWaveAlert();
  }

  getCameraZoom() {
    const sc = SCOPES[this.player.scope] || SCOPES[1];
    return sc.zoom;
  }

  getActiveWeaponData() {
    if (this.player.activeSlot === 1 || this.player.activeSlot === 2) {
      const slotObj = this.player.slots[this.player.activeSlot];
      return WEAPONS[slotObj.weaponId] || WEAPONS.m9;
    }
    if (this.player.activeSlot === 3) {
      return MELEE_WEAPONS[this.player.meleeId] || MELEE_WEAPONS.fists;
    }
    return THROWABLES[this.player.throwableId] || THROWABLES.frag;
  }

  switchSlot(slotNum) {
    if (slotNum < 1 || slotNum > 4) return;
    this.player.activeSlot = slotNum;
    this.player.reloading = 0;
    this.player.activeHeal = null;
    this.syncHudImmediate();
  }

  rotateBarricade() {
    this.player.barricadeRotation = ((this.player.barricadeRotation || 0) + 90) % 360;
    this.syncHudImmediate();
  }

  getActiveVehicle() {
    const vid = this.player?.drivingVehicleId;
    if (!vid || !this.world?.vehicles) return null;
    return this.world.vehicles.find((v) => v.id === vid && !v.destroyed && v.hp > 0) || null;
  }

  exitVehicle() {
    const p = this.player;
    const veh = this.getActiveVehicle();
    p.drivingVehicleId = null;
    if (veh) {
      veh.speed = 0;
      const sideAngle = (veh.angle || 0) + Math.PI * 0.5;
      p.x = veh.x + Math.cos(sideAngle) * 52;
      p.y = veh.y + Math.sin(sideAngle) * 52;
      resolveEntityCollisions(p, this.world, p.inBunker);
    }
    soundEngine.playPickup();
    this.syncHudImmediate();
  }

  cycleThrowable(specificId = null) {
    const order = ['turret', 'barricade', 'frag', 'mirv', 'smoke', 'strobe'];
    if (specificId && THROWABLES[specificId]) {
      this.player.throwableId = specificId;
      this.player.activeSlot = 4;
      this.syncHudImmediate();
      return;
    }
    const idx = order.indexOf(this.player.throwableId);
    for (let i = 1; i <= order.length; i++) {
      const next = order[(idx + i) % order.length];
      if ((this.player.throwableCount[next] || 0) > 0) {
        this.player.throwableId = next;
        break;
      }
    }
    this.player.activeSlot = 4;
    this.syncHudImmediate();
  }

  /**
   * Drops a portion of ammo, a medical item, or a throwable onto the floor at the player's position
   * (triggered by right-click, discard button, or holding for 400ms on mobile).
   */
  dropInventoryItem(kind, id) {
    const p = this.player;
    const dropX = p.x + Math.cos(p.angle + Math.PI) * 34 + (Math.random() - 0.5) * 14;
    const dropY = p.y + Math.sin(p.angle + Math.PI) * 34 + (Math.random() - 0.5) * 14;

    let droppedItem = null;
    if (kind === 'ammo') {
      const current = p.ammo[id] || 0;
      if (current <= 0) return false;
      const amount = Math.min(current, id === '12g' ? 12 : id === '.50' ? 5 : 30);
      p.ammo[id] -= amount;
      droppedItem = {
        id: `drop_a_${Date.now()}_${Math.random()}`,
        kind: 'ammo',
        ammoType: id,
        amount,
        x: dropX,
        y: dropY,
        inBunker: p.inBunker,
        bunkerId: p.activeBunkerId,
      };
      this.world.loot.push(droppedItem);
    } else if (kind === 'med') {
      const current = p.meds[id] || 0;
      if (current <= 0) return false;
      p.meds[id] -= 1;
      droppedItem = {
        id: `drop_m_${Date.now()}_${Math.random()}`,
        kind: 'med',
        medId: id,
        amount: 1,
        x: dropX,
        y: dropY,
        inBunker: p.inBunker,
        bunkerId: p.activeBunkerId,
      };
      this.world.loot.push(droppedItem);
    } else if (kind === 'throwable') {
      const current = p.throwableCount[id] || 0;
      if (current <= 0) return false;
      p.throwableCount[id] -= 1;
      droppedItem = {
        id: `drop_th_${Date.now()}_${Math.random()}`,
        kind: 'throwable',
        throwableId: id,
        amount: 1,
        x: dropX,
        y: dropY,
        inBunker: p.inBunker,
        bunkerId: p.activeBunkerId,
      };
      this.world.loot.push(droppedItem);
    } else {
      return false;
    }

    if (!this.isHost && droppedItem) {
      this.broadcastP2P({ type: 'client:drop', item: droppedItem });
    }

    soundEngine.playPickup();
    this.syncHudImmediate();
    return true;
  }

  getPlayerMaxCapacity() {
    return getMaxInventoryCapacity(this.player?.backpackLevel ?? 0);
  }

  equipBackpack(newLevel) {
    const p = this.player;
    const targetLevel = clamp(Math.floor(newLevel ?? 0), 0, 3);
    const used = computeInventoryUsage(p);
    const targetMax = getMaxInventoryCapacity(targetLevel);
    if (used > targetMax + 0.001) {
      this.waveBanner = `⚠️ NO PUEDES EQUIPAR MOCHILA NV.${targetLevel}: Excede capacidad (${used}/${targetMax})`;
      this.waveBannerTimer = 3.2;
      this.syncHudImmediate();
      return false;
    }
    p.backpackLevel = targetLevel;
    this.syncHudImmediate();
    return true;
  }

  startReload() {
    const p = this.player;
    if (p.activeSlot !== 1 && p.activeSlot !== 2) return;
    if (p.reloading > 0) return;
    const slot = p.slots[p.activeSlot];
    const w = WEAPONS[slot.weaponId];
    if (!w) return;
    const reserve = p.ammo[w.ammoType] || 0;
    if (slot.mag >= w.magSize || reserve <= 0) return;

    p.activeHeal = null;
    p.reloading = w.reloadTime * (p.reloadSpeedMult || 1.0);
    p.reloadTotal = p.reloading;
    this.syncHudImmediate();
  }

  useMedicalItem(medId) {
    const p = this.player;
    const med = MEDICAL_ITEMS[medId];
    if (!med || (p.meds[medId] || 0) <= 0 || p.downed) return false;
    if (med.heal > 0 && med.adrenaline === 0 && p.hp >= p.maxHp) return false;
    if (p.activeHeal && p.activeHeal.id === medId) return false;

    p.reloading = 0;
    p.activeHeal = {
      id: medId,
      name: med.name,
      label: med.label,
      timer: med.useTime || 1.5,
      total: med.useTime || 1.5,
    };
    soundEngine.playPickup();
    this.syncHudImmediate();
    return true;
  }

  completeMedicalUse() {
    const p = this.player;
    if (!p.activeHeal) return false;
    const medId = p.activeHeal.id;
    const med = MEDICAL_ITEMS[medId];
    p.activeHeal = null;
    if (!med || (p.meds[medId] || 0) <= 0 || p.downed) return false;

    p.meds[medId]--;
    if (med.heal > 0) {
      p.hp = Math.min(p.maxHp, p.hp + med.heal);
    }
    if (med.adrenaline > 0) {
      p.adrenaline = Math.min(100, p.adrenaline + med.adrenaline);
    }
    soundEngine.playPickup();
    this.syncHudImmediate();
    return true;
  }

  cancelMedicalUse() {
    if (this.player.activeHeal) {
      this.player.activeHeal = null;
      this.syncHudImmediate();
    }
  }

  throwActiveGrenade() {
    const p = this.player;
    if (p.downed) return;
    p.activeHeal = null;
    let thId = p.throwableId;
    if ((p.throwableCount[thId] || 0) <= 0) {
      const fallback = Object.keys(p.throwableCount).find((k) => p.throwableCount[k] > 0);
      if (!fallback) return;
      thId = fallback;
      p.throwableId = fallback;
    }

    const th = THROWABLES[thId];
    if (!th || (p.throwableCount[thId] || 0) <= 0) return;

    p.throwableCount[thId]--;

    if (thId === 'turret') {
      const tx = p.x + Math.cos(p.angle) * 52;
      const ty = p.y + Math.sin(p.angle) * 52;
      this.turrets.push({
        id: `turret_${Date.now()}`,
        x: tx,
        y: ty,
        angle: p.angle,
        hp: 300,
        ammo: th.ammo || 120,
        maxDuration: th.duration || 45,
        ttl: th.duration || 45,
        deployProgress: 0.1,
        fireTimer: 0.35,
        inBunker: p.inBunker,
        bunkerId: p.activeBunkerId,
      });
      soundEngine.playPickup();
      this.syncHudImmediate();
      return;
    }

    if (thId === 'barricade') {
      const rot = p.barricadeRotation || 0;
      const isVertical = rot === 90 || rot === 270;
      const bw = isVertical ? 26 : 84;
      const bh = isVertical ? 84 : 26;
      let cx = p.x + Math.cos(p.angle) * 60;
      let cy = p.y + Math.sin(p.angle) * 60;

      // Prevent permanently sealing building doorways by nudging outward if placed directly on a door threshold
      if (!p.inBunker && this.world?.buildings) {
        for (const b of this.world.buildings) {
          for (const d of b.doors || []) {
            const dCx = d.x + d.w * 0.5;
            const dCy = d.y + d.h * 0.5;
            if (distSq(cx, cy, dCx, dCy) < 52 * 52) {
              cx += Math.cos(p.angle) * 28;
              cy += Math.sin(p.angle) * 28;
            }
          }
        }
      }

      this.world.barricades.push({
        id: `bar_${Date.now()}_${Math.random()}`,
        x: cx - bw * 0.5,
        y: cy - bh * 0.5,
        w: bw,
        h: bh,
        rotation: rot,
        hp: th.hp || 480,
        maxHp: th.hp || 480,
        destroyed: false,
        inBunker: p.inBunker,
        bunkerId: p.activeBunkerId,
      });
      soundEngine.playImpact('metal');
      this.syncHudImmediate();
      return;
    }

    const speed = 520;
    this.grenades.push({
      id: `gren_${Date.now()}`,
      type: thId,
      x: p.x,
      y: p.y,
      vx: Math.cos(p.angle) * speed,
      vy: Math.sin(p.angle) * speed,
      fuse: th.fuse,
      radius: th.radius,
      damage: th.damage,
      color: th.color,
      inBunker: p.inBunker,
      bunkerId: p.activeBunkerId,
      smokeActive: false,
      smokeTimer: th.duration || 0,
    });
    this.syncHudImmediate();
  }

  interact() {
    const p = this.player;
    const w = this.world;

    // 0. If currently driving a vehicle, exit it cleanly
    if (p.drivingVehicleId) {
      this.exitVehicle();
      return;
    }

    // 1. Cross-Revive downed AI ally or remote co-op player
    for (const bot of this.allies) {
      if (bot.downed && distSq(p.x, p.y, bot.x, bot.y) < 85 * 85) {
        bot.downed = false;
        bot.hp = Math.round(bot.maxHp * 0.65);
        bot.reviveProgress = 0;
        soundEngine.playPickup();
        this.syncHudImmediate();
        return;
      }
    }

    for (const rp of this.remotePlayers.values()) {
      if (rp.downed && distSq(p.x, p.y, rp.x, rp.y) < 88 * 88) {
        this.broadcastP2P({ type: 'world:event', event: 'revive', targetId: rp.id });
        soundEngine.playPickup();
        return;
      }
    }

    // 2. Check any of the 5 Distinct Furnished Underground Bunkers
    if (!p.inBunker) {
      for (const st of w.bunkerEntrances || [w.bunkerStairsSurface]) {
        if (distSq(p.x, p.y, st.x + st.w * 0.5, st.y + st.h * 0.5) < 95 * 95) {
          const targetBunker = (w.bunkersById && w.bunkersById[st.id]) || w.bunker;
          w.bunker = targetBunker;
          p.inBunker = true;
          p.activeBunkerId = st.id || 'bunker_hydra';
          p.activeBunkerExit = { x: st.x - 70, y: st.y + 40 };
          p.x = targetBunker.stairsExit.x + 120;
          p.y = targetBunker.stairsExit.y + 40;
          for (const bot of this.allies) {
            bot.inBunker = true;
            bot.x = p.x + (Math.random() - 0.5) * 70;
            bot.y = p.y + (Math.random() - 0.5) * 70;
          }

          // Spawn high-risk elite bunker guards on first entry to Bunker Omega
          if (targetBunker.highRisk && !targetBunker.guardsSpawned) {
            targetBunker.guardsSpawned = true;
            const guardSpawns = [
              { type: 'armored', x: targetBunker.x + 980, y: targetBunker.y + 260 },
              { type: 'exploder', x: targetBunker.x + 1120, y: targetBunker.y + 520 },
              { type: 'armored', x: targetBunker.x + 980, y: targetBunker.y + 780 },
            ];
            guardSpawns.forEach((gs, gIdx) => {
              const gz = createZombieInstance(gs.type, gs.x, gs.y, 1.35, 1.05, `omega_guard_${gIdx}`);
              gz.inBunker = true;
              gz.bunkerId = p.activeBunkerId;
              this.zombies.push(gz);
            });
            this.waveBanner = '⚠️ BÚNKER OMEGA: GUARDIAS DE ÉLITE DETECTADOS';
            this.waveBannerTimer = 3.5;
          }

          soundEngine.playPickup();
          this.syncHudImmediate();
          return;
        }
      }
    } else {
      const ex = w.bunker.stairsExit;
      if (distSq(p.x, p.y, ex.x + ex.w * 0.5, ex.y + ex.h * 0.5) < 95 * 95) {
        p.inBunker = false;
        p.activeBunkerId = null;
        p.x = p.activeBunkerExit?.x || w.bunkerStairsSurface.x - 70;
        p.y = p.activeBunkerExit?.y || w.bunkerStairsSurface.y + 40;
        for (const bot of this.allies) {
          bot.inBunker = false;
          bot.x = p.x + (Math.random() - 0.5) * 80;
          bot.y = p.y + (Math.random() - 0.5) * 80;
        }
        soundEngine.playPickup();
        this.syncHudImmediate();
        return;
      }
    }

    // 3. Toggle Doors (if not destroyed)
    if (!p.inBunker) {
      for (const b of w.buildings) {
        for (const d of b.doors) {
          if (d.destroyed) continue;
          const dcx = d.x + d.w * 0.5;
          const dcy = d.y + d.h * 0.5;
          if (distSq(p.x, p.y, dcx, dcy) < 95 * 95) {
            d.open = !d.open;
            this.broadcastP2P({ type: 'world:event', event: 'openDoor', doorId: d.id, open: d.open });
            soundEngine.playPickup();
            return;
          }
        }
      }
    }

    // 4. Pick Up Floor Loot (matching current surface or active bunker)
    for (let i = w.loot.length - 1; i >= 0; i--) {
      const item = w.loot[i];
      if (item.inBunker !== p.inBunker) continue;
      if (p.inBunker && item.bunkerId && p.activeBunkerId && item.bunkerId !== p.activeBunkerId) continue;
      if (distSq(p.x, p.y, item.x, item.y) < 78 * 78) {
        const picked = this.pickupLootItem(item, i);
        if (picked && !this.isHost) {
          this.broadcastP2P({ type: 'client:pickup', lootId: item.id });
        }
        return;
      }
    }

    // 5. Enter Driveable Vehicle (if on surface and within 98px)
    if (!p.inBunker && w.vehicles) {
      for (const veh of w.vehicles) {
        if (!veh.driveable || veh.destroyed || veh.hp <= 0) continue;
        if (distSq(p.x, p.y, veh.x, veh.y) < 98 * 98) {
          p.activeHeal = null;
          p.reloading = 0;
          p.drivingVehicleId = veh.id;
          p.x = veh.x;
          p.y = veh.y;
          p.angle = veh.angle || 0;
          soundEngine.playPickup();
          this.syncHudImmediate();
          return;
        }
      }
    }

    // 6. Open Shop if standing next to a Vendor station
    if (!p.inBunker && w.vendors) {
      for (const v of w.vendors) {
        if (distSq(p.x, p.y, v.x, v.y) < 160 * 160) {
          this.shopOpen = !this.shopOpen;
          this.syncHudImmediate();
          return;
        }
      }
    }
  }

  pickupLootItem(item, index) {
    const p = this.player;
    const bpLevel = p.backpackLevel ?? 0;
    const maxCap = getMaxInventoryCapacity(bpLevel);
    const currentUsed = computeInventoryUsage(p);
    const freeCap = Math.max(0, maxCap - currentUsed);

    if (item.kind === 'weapon') {
      const wData = WEAPONS[item.weaponId];
      if (!wData) return false;
      const targetSlot = p.activeSlot === 2 ? 2 : 1;
      const prevWeaponId = p.slots[targetSlot].weaponId;
      const prevWWeight = getItemWeight('weapon', prevWeaponId, 1);
      const newWWeight = getItemWeight('weapon', wData.id, 1);
      const weightDelta = newWWeight - prevWWeight;

      if (currentUsed + weightDelta > maxCap + 0.001) {
        this.waveBanner = `⚠️ INVENTARIO LLENO (${currentUsed}/${maxCap}) — Libera espacio para equipar ${wData.name}`;
        this.waveBannerTimer = 2.8;
        this.syncHudImmediate();
        return false;
      }

      p.slots[targetSlot] = { weaponId: wData.id, mag: wData.magSize };
      item.weaponId = prevWeaponId;

      // Also grant bonus ammo up to remaining backpack capacity & reserve limit
      const maxRes = getMaxAmmoReserve(bpLevel, wData.ammoType);
      const curAmmo = p.ammo[wData.ammoType] || 0;
      const remCapAfterSwap = Math.max(0, maxCap - computeInventoryUsage(p));
      const unitW = ITEM_WEIGHTS.ammo[wData.ammoType] || 0.06;
      const bonusRounds = Math.min(
        wData.magSize,
        Math.max(0, maxRes - curAmmo),
        Math.floor((remCapAfterSwap + 0.001) / unitW)
      );
      if (bonusRounds > 0) {
        p.ammo[wData.ammoType] = curAmmo + bonusRounds;
      }
    } else if (item.kind === 'ammo') {
      const cal = item.ammoType;
      const curAmmo = p.ammo[cal] || 0;
      const maxRes = getMaxAmmoReserve(bpLevel, cal);
      const roomByReserve = Math.max(0, maxRes - curAmmo);
      const unitW = ITEM_WEIGHTS.ammo[cal] || 0.06;
      const roomByWeight = Math.floor((freeCap + 0.001) / unitW);
      const takeAmount = Math.min(item.amount || 0, roomByReserve, roomByWeight);

      if (takeAmount <= 0) {
        this.waveBanner =
          roomByReserve <= 0
            ? `⚠️ RESERVA DE ${cal} COMPLETA (${curAmmo}/${maxRes}) PARA TU MOCHILA`
            : `⚠️ INVENTARIO LLENO (${currentUsed}/${maxCap}) — Descarta objetos para liberar espacio`;
        this.waveBannerTimer = 2.8;
        this.syncHudImmediate();
        return false;
      }

      p.ammo[cal] = curAmmo + takeAmount;
      if (takeAmount >= item.amount) {
        if (index >= 0 && index < this.world.loot.length) {
          this.world.loot.splice(index, 1);
        }
      } else {
        item.amount -= takeAmount;
        this.waveBanner = `📦 RECOGIDOS +${takeAmount} ${cal} (Mochila al límite: ${computeInventoryUsage(p)}/${maxCap})`;
        this.waveBannerTimer = 2.5;
      }
    } else if (item.kind === 'med') {
      const medId = item.medId;
      const curCount = p.meds[medId] || 0;
      const maxStack = MEDICAL_ITEMS[medId]?.maxStack || 15;
      const unitW = getItemWeight('med', medId, 1);
      const roomByStack = Math.max(0, maxStack - curCount);
      const roomByWeight = Math.floor((freeCap + 0.001) / unitW);
      const takeAmount = Math.min(item.amount || 1, roomByStack, roomByWeight);

      if (takeAmount <= 0) {
        this.waveBanner =
          roomByStack <= 0
            ? `⚠️ LÍMITE DE ${MEDICAL_ITEMS[medId]?.name?.toUpperCase() || medId} ALCANZADO (${curCount}/${maxStack})`
            : `⚠️ INVENTARIO LLENO (${currentUsed}/${maxCap}) — Descarta objetos para liberar espacio`;
        this.waveBannerTimer = 2.8;
        this.syncHudImmediate();
        return false;
      }

      p.meds[medId] = curCount + takeAmount;
      if (takeAmount >= (item.amount || 1)) {
        if (index >= 0 && index < this.world.loot.length) {
          this.world.loot.splice(index, 1);
        }
      } else {
        item.amount -= takeAmount;
      }
    } else if (item.kind === 'gear') {
      if (item.gearType === 'helmet') {
        if (item.level <= p.helmetLevel) return false;
        p.helmetLevel = item.level;
      } else if (item.gearType === 'vest') {
        if (item.level <= p.armorLevel) return false;
        p.armorLevel = item.level;
      } else if (item.gearType === 'backpack') {
        if (item.level === bpLevel) return false;
        if (!this.equipBackpack(item.level)) return false;
      }
      if (index >= 0 && index < this.world.loot.length) {
        this.world.loot.splice(index, 1);
      }
    } else if (item.kind === 'throwable') {
      const tid = item.throwableId || 'turret';
      const unitW = getItemWeight('throwable', tid, 1);
      const roomByWeight = Math.floor((freeCap + 0.001) / unitW);
      const takeAmount = Math.min(item.amount || 1, roomByWeight);

      if (takeAmount <= 0) {
        this.waveBanner = `⚠️ INVENTARIO LLENO (${currentUsed}/${maxCap}) — Descarta objetos para liberar espacio`;
        this.waveBannerTimer = 2.8;
        this.syncHudImmediate();
        return false;
      }

      p.throwableCount[tid] = (p.throwableCount[tid] || 0) + takeAmount;
      p.throwableId = tid;
      if (takeAmount >= (item.amount || 1)) {
        if (index >= 0 && index < this.world.loot.length) {
          this.world.loot.splice(index, 1);
        }
      } else {
        item.amount -= takeAmount;
      }
    } else if (item.kind === 'melee') {
      const mData = MELEE_WEAPONS[item.meleeId];
      if (!mData) return false;
      const prevMelee = p.meleeId;
      p.meleeId = mData.id;
      p.activeSlot = 3;
      if (prevMelee && prevMelee !== 'fists') {
        item.meleeId = prevMelee;
      } else if (index >= 0 && index < this.world.loot.length) {
        this.world.loot.splice(index, 1);
      }
    } else if (item.kind === 'scope') {
      if (item.scope <= p.scope) return false;
      p.scope = item.scope;
      if (index >= 0 && index < this.world.loot.length) {
        this.world.loot.splice(index, 1);
      }
    }
    soundEngine.playPickup();
    this.syncHudImmediate();
    return true;
  }

  getWeaponAmmoRefillQuote(slotNum = 1) {
    const p = this.player;
    const slot = p.slots[slotNum === 2 ? 2 : 1];
    const w = WEAPONS[slot?.weaponId] || WEAPONS.m416;
    const cal = w.ammoType;
    const bpLevel = p.backpackLevel ?? 0;
    const curReserve = p.ammo[cal] || 0;
    const maxReserve = getMaxAmmoReserve(bpLevel, cal);
    const missingRounds = Math.max(0, maxReserve - curReserve);

    const maxCap = getMaxInventoryCapacity(bpLevel);
    const currentUsed = computeInventoryUsage(p);
    const freeCap = Math.max(0, maxCap - currentUsed);
    const unitW = ITEM_WEIGHTS.ammo[cal] || 0.06;
    const maxByWeight = Math.floor((freeCap + 0.001) / unitW);

    const roundsToBuy = Math.min(missingRounds, maxByWeight);
    const unitPrice = AMMO_SHOP_PRICES[cal] || 1.0;
    const price = roundsToBuy > 0 ? Math.max(5, Math.ceil(roundsToBuy * unitPrice)) : 0;
    const stockKey = `ammo_refill_${cal}`;
    const stockLeft = this.shopStock[stockKey] ?? 4;

    let reason = 'OK';
    if (missingRounds <= 0) reason = 'RESERVA AL MÁXIMO';
    else if (maxByWeight <= 0) reason = 'MOCHILA LLENA';
    else if (stockLeft <= 0) reason = 'AGOTADO';
    else if (p.credits < price) reason = 'SIN CRÉDITOS';

    const canRefill = roundsToBuy > 0 && stockLeft > 0 && p.credits >= price;
    return {
      slotNum: slotNum === 2 ? 2 : 1,
      weaponId: w.id,
      weaponName: w.name,
      ammoType: cal,
      currentReserve: curReserve,
      maxReserve,
      missingRounds,
      missingReserve: missingRounds,
      roundsToBuy,
      price,
      stockLeft,
      canBuy: canRefill,
      canRefill,
      reason,
    };
  }

  buyWeaponAmmoRefill(slotNum = 1) {
    const quote = this.getWeaponAmmoRefillQuote(slotNum);
    if (!quote) return false;
    if (!quote.canBuy) {
      if (quote.reason === 'RESERVA AL MÁXIMO' || quote.reason === 'RESERVA COMPLETA') {
        this.waveBanner = `⚠️ RESERVA DE ${quote.ammoType} YA ESTÁ COMPLETA (${quote.currentReserve}/${quote.maxReserve})`;
        this.waveBannerTimer = 2.8;
      } else if (quote.reason === 'MOCHILA LLENA' || quote.reason === 'INVENTARIO LLENO') {
        this.waveBanner = '⚠️ INVENTARIO LLENO — Libera espacio en tu mochila para comprar munición';
        this.waveBannerTimer = 2.8;
      }
      this.syncHudImmediate();
      return false;
    }

    const p = this.player;
    p.credits -= quote.price;
    const stockKey = `ammo_refill_${quote.ammoType}`;
    this.shopStock[stockKey] = Math.max(0, (this.shopStock[stockKey] ?? 4) - 1);
    p.ammo[quote.ammoType] = (p.ammo[quote.ammoType] || 0) + quote.roundsToBuy;

    this.waveBanner = `🔋 RECARGA ${quote.weaponName}: +${quote.roundsToBuy} (${quote.ammoType}) POR $${quote.price}`;
    this.waveBannerTimer = 2.8;
    soundEngine.playPickup();
    this.syncHudImmediate();
    return true;
  }

  buyShopItem(shopId) {
    const p = this.player;
    const item = SHOP_ITEMS.find((s) => s.id === shopId);
    if (!item) return false;
    const stockLeft = this.shopStock[shopId] ?? item.maxStock ?? 1;
    if (stockLeft <= 0) return false;
    if ((item.minWave || 1) > this.wave) return false;

    const effectivePrice = this.getShopItemEffectivePrice(item);
    if (p.credits < effectivePrice) return false;

    const bpLevel = p.backpackLevel ?? 0;
    const maxCap = getMaxInventoryCapacity(bpLevel);
    const currentUsed = computeInventoryUsage(p);
    const freeCap = Math.max(0, maxCap - currentUsed);

    // Pre-validate inventory capacity before deducting credits or stock
    if (item.id === 'turret_item') {
      const neededW = getItemWeight('throwable', 'turret', 1);
      if (freeCap + 0.001 < neededW) {
        this.waveBanner = `⚠️ INVENTARIO LLENO (${currentUsed}/${maxCap}) — No cabe Torreta`;
        this.waveBannerTimer = 2.8;
        this.syncHudImmediate();
        return false;
      }
    } else if (item.id === 'barricade_item') {
      const neededW = getItemWeight('throwable', 'barricade', 1);
      if (freeCap + 0.001 < neededW) {
        this.waveBanner = `⚠️ INVENTARIO LLENO (${currentUsed}/${maxCap}) — No cabe Barricada`;
        this.waveBannerTimer = 2.8;
        this.syncHudImmediate();
        return false;
      }
    } else if (item.id === 'med_bundle') {
      const minMedW = getItemWeight('med', 'bandage', 1);
      if (freeCap + 0.001 < minMedW) {
        this.waveBanner = `⚠️ INVENTARIO LLENO (${currentUsed}/${maxCap}) — Libera espacio para Lote Médico`;
        this.waveBannerTimer = 2.8;
        this.syncHudImmediate();
        return false;
      }
    } else if (item.id === 'ammo_pack') {
      const minAmmoW = ITEM_WEIGHTS.ammo['9mm'] || 0.05;
      let anyReserveRoom = false;
      for (const cal of ['9mm', '12g', '5.56', '7.62', '.50']) {
        if ((p.ammo[cal] || 0) < getMaxAmmoReserve(bpLevel, cal)) {
          anyReserveRoom = true;
          break;
        }
      }
      if (!anyReserveRoom || freeCap + 0.001 < minAmmoW) {
        this.waveBanner = !anyReserveRoom
          ? '⚠️ RESERVA DE MUNICIÓN COMPLETA EN TODOS LOS CALIBRES'
          : `⚠️ INVENTARIO LLENO (${currentUsed}/${maxCap}) — Libera espacio en tu mochila`;
        this.waveBannerTimer = 2.8;
        this.syncHudImmediate();
        return false;
      }
    } else if (item.weaponId) {
      const w = WEAPONS[item.weaponId];
      const prevWWeight = getItemWeight('weapon', p.slots[1]?.weaponId, 1);
      const newWWeight = getItemWeight('weapon', w.id, 1);
      if (currentUsed + (newWWeight - prevWWeight) > maxCap + 0.001) {
        this.waveBanner = `⚠️ INVENTARIO LLENO (${currentUsed}/${maxCap}) — No cabe ${w.name}`;
        this.waveBannerTimer = 2.8;
        this.syncHudImmediate();
        return false;
      }
    }

    p.credits -= effectivePrice;
    this.shopStock[shopId] = stockLeft - 1;

    if (item.id === 'ammo_pack') {
      const packAmounts = { '9mm': 90, '12g': 24, '5.56': 90, '7.62': 60, '.50': 10 };
      for (const [cal, amt] of Object.entries(packAmounts)) {
        const remCap = Math.max(0, maxCap - computeInventoryUsage(p));
        const unitW = ITEM_WEIGHTS.ammo[cal] || 0.06;
        const maxRes = getMaxAmmoReserve(bpLevel, cal);
        const cur = p.ammo[cal] || 0;
        const add = Math.min(amt, Math.max(0, maxRes - cur), Math.floor((remCap + 0.001) / unitW));
        if (add > 0) p.ammo[cal] = cur + add;
      }
    } else if (item.id === 'med_bundle') {
      const bundle = [
        ['medkit', 2],
        ['bandage', 5],
        ['soda', 2],
        ['pills', 1],
      ];
      for (const [medId, amt] of bundle) {
        const remCap = Math.max(0, maxCap - computeInventoryUsage(p));
        const unitW = getItemWeight('med', medId, 1);
        const maxStack = MEDICAL_ITEMS[medId]?.maxStack || 15;
        const cur = p.meds[medId] || 0;
        const add = Math.min(amt, Math.max(0, maxStack - cur), Math.floor((remCap + 0.001) / unitW));
        if (add > 0) p.meds[medId] = cur + add;
      }
    } else if (item.id === 'armor_t3') {
      p.armorLevel = 3;
      p.helmetLevel = 3;
      p.backpackLevel = 3;
      p.maxHp = 140;
      p.hp = p.maxHp;
    } else if (item.id === 'turret_item') {
      p.throwableCount.turret = (p.throwableCount.turret || 0) + 1;
      p.throwableId = 'turret';
      p.activeSlot = 4;
    } else if (item.id === 'barricade_item') {
      p.throwableCount.barricade = (p.throwableCount.barricade || 0) + 1;
      p.throwableId = 'barricade';
      p.activeSlot = 4;
    } else if (item.id === 'combat_drone') {
      this.drones.push({
        id: `drone_${Date.now()}`,
        orbitAngle: 0,
        x: p.x + 56,
        y: p.y,
        ttl: 60,
        fireTimer: 0.25,
      });
    } else if (item.id === 'exp_adrenaline') {
      p.adrenaline = 100;
      p.stamina = 100;
      p.infiniteStaminaTimer = 30;
    } else if (item.id === 'vip_contract') {
      const angle = Math.random() * Math.PI * 2;
      const sx = clamp(p.x + Math.cos(angle) * 680, 900, WORLD_SIZE - 900);
      const sy = clamp(p.y + Math.sin(angle) * 680, 900, WORLD_SIZE - 900);
      const vipZ = createZombieInstance('behemoth', sx, sy, this.waveHpMult * 1.25, 1.1, 'VIP');
      vipZ.isVip = true;
      vipZ.name = 'OBJETIVO VIP HVT';
      vipZ.inBunker = p.inBunker;
      this.zombies.push(vipZ);
      this.waveBanner = '🎯 CONTRATO VIP ACTIVO — ELIMINA AL TITÁN (+$1,200)';
      this.waveBannerTimer = 4.0;
    } else if (item.id === 'mystery_perk') {
      p.damageBoostMult = (p.damageBoostMult || 1.0) + 0.25;
      p.reloadSpeedMult = 0.72;
      this.waveBanner = '⚡ PERK MISTERIOSO: DAÑO +25% Y RECARGA RÁPIDA';
      this.waveBannerTimer = 3.5;
    } else if (item.weaponId) {
      const w = WEAPONS[item.weaponId];
      p.slots[1] = { weaponId: w.id, mag: w.magSize };
      p.activeSlot = 1;
      const remCap = Math.max(0, maxCap - computeInventoryUsage(p));
      const unitW = ITEM_WEIGHTS.ammo[w.ammoType] || 0.06;
      const maxRes = getMaxAmmoReserve(bpLevel, w.ammoType);
      const curAmmo = p.ammo[w.ammoType] || 0;
      const bonusAmmo = Math.min(
        w.magSize * 2,
        Math.max(0, maxRes - curAmmo),
        Math.floor((remCap + 0.001) / unitW)
      );
      if (bonusAmmo > 0) {
        p.ammo[w.ammoType] = curAmmo + bonusAmmo;
      }
    }

    soundEngine.playPickup();
    this.syncHudImmediate();
    return true;
  }

  setSquadCommand(cmd) {
    this.squadCommand = cmd;
    if (cmd === 'hold') {
      this.holdPoint = { x: this.player.x, y: this.player.y };
    }
    const aliveBots = (this.allies || []).filter((b) => !b.downed);
    if (aliveBots.length > 0) {
      const orderResponses = {
        free: '¡Entendido! Nos desplegamos de forma autónoma.',
        loot: '¡Recibido! Buscando cajas y armamento en el sector.',
        hunt: '¡En modo cacería! Rastreando infectados.',
        hold: '¡Posición asegurada! Nadie se mueve de aquí.',
        follow: '¡Reagrupando! Te cubrimos la espalda, jefe.',
        peace: '¡Alto al fuego! Solo respuesta defensiva.',
      };
      const sortedByProx = [...aliveBots].sort(
        (a, b) => distSq(a.x, a.y, this.player.x, this.player.y) - distSq(b.x, b.y, this.player.x, this.player.y)
      );
      const speaker = sortedByProx[0];
      setBotChatBubble(speaker, orderResponses[cmd] || '¡Orden recibida!', 3.8);
      if (sortedByProx[1]) {
        setBotChatBubble(sortedByProx[1], '¡Copiado, en posición!', 3.4);
      }
    }
    this.syncHudImmediate();
  }

  spawnImpactSparks(x, y, nx, ny, material = 'concrete', inBunker = false) {
    const colors =
      material === 'metal'
        ? ['#fde047', '#f97316', '#f8fafc']
        : material === 'wood'
        ? ['#d97706', '#92400e', '#fcd34d']
        : ['#cbd5e1', '#94a3b8', '#fde047'];

    const baseAngle = nx !== 0 || ny !== 0 ? Math.atan2(ny, nx) : Math.random() * Math.PI * 2;
    for (let i = 0; i < 6; i++) {
      const a = baseAngle + (Math.random() - 0.5) * 1.4;
      const spd = 70 + Math.random() * 160;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        size: 2 + Math.random() * 2.2,
        color: colors[i % colors.length],
        ttl: 0.22 + Math.random() * 0.14,
        maxTtl: 0.36,
        inBunker,
      });
    }
  }

  spawnWeaponProjectiles(shooter, w, isPlayer) {
    const pellets = w.pellets || 1;
    const muzzleDist = 30;
    const startX = shooter.x + Math.cos(shooter.angle) * muzzleDist;
    const startY = shooter.y + Math.sin(shooter.angle) * muzzleDist;

    const barrelCheck = raycastObstacles(shooter.x, shooter.y, startX, startY, this.world, shooter.inBunker);
    if (barrelCheck && barrelCheck.hit) {
      this.spawnImpactSparks(
        barrelCheck.ix,
        barrelCheck.iy,
        barrelCheck.nx,
        barrelCheck.ny,
        barrelCheck.material,
        shooter.inBunker
      );
      soundEngine.playImpact(barrelCheck.material);
      return;
    }

    const dmgMult = isPlayer ? this.player.damageBoostMult || 1.0 : 1.0;

    for (let i = 0; i < pellets; i++) {
      const spreadAngle = shooter.angle + (Math.random() - 0.5) * w.spread * 2;
      this.bullets.push({
        x: startX,
        y: startY,
        vx: Math.cos(spreadAngle) * w.bulletSpeed,
        vy: Math.sin(spreadAngle) * w.bulletSpeed,
        angle: spreadAngle,
        damage: Math.round(w.damage * dmgMult),
        rangeLeft: w.range,
        pierceLeft: w.pierce || 1,
        explosive: Boolean(w.explosiveRounds),
        hitIds: new Set(),
        fromPlayer: isPlayer,
        inBunker: shooter.inBunker,
        color: w.explosiveRounds ? '#f97316' : w.ammoType === '.50' ? '#c084fc' : '#fef08a',
        thickness: w.explosiveRounds || w.ammoType === '.50' ? 4.5 : 3,
      });
    }
    // Muzzle Flash & Spinning Brass Shell Casing Ejection
    this.muzzleFlashes.push({
      x: startX,
      y: startY,
      angle: shooter.angle,
      size: w.category === 'shotgun' || w.category === 'sniper' ? 16 : 11,
      ttl: 0.055,
      inBunker: shooter.inBunker,
    });

    const ejectAngle = shooter.angle + Math.PI * 0.5 + (Math.random() - 0.5) * 0.45;
    const ejectSpd = 65 + Math.random() * 55;
    this.shells.push({
      x: shooter.x + Math.cos(shooter.angle) * 14,
      y: shooter.y + Math.sin(shooter.angle) * 14,
      vx: Math.cos(ejectAngle) * ejectSpd,
      vy: Math.sin(ejectAngle) * ejectSpd,
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 18,
      ttl: 1.6,
      inBunker: shooter.inBunker,
    });

    soundEngine.playShot(w.category);
  }

  shatterWindow(win, ix, iy, inBunker = false) {
    if (!win || win.shattered) return;
    win.shattered = true;
    win.hp = 0;
    const cx = ix ?? win.x + win.w * 0.5;
    const cy = iy ?? win.y + win.h * 0.5;
    const shardColors = ['#bae6fd', '#ffffff', '#38bdf8', '#e0f2fe'];
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 65 + Math.random() * 145;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        size: 2.2 + Math.random() * 2.4,
        color: shardColors[i % shardColors.length],
        ttl: 0.32 + Math.random() * 0.16,
        maxTtl: 0.48,
        inBunker,
      });
    }
    soundEngine.playImpact('metal');
  }

  damageDoor(door, dmg, inBunker = false) {
    if (!door || door.destroyed) return;
    door.hp = (door.hp ?? 120) - dmg;
    const cx = door.x + door.w * 0.5;
    const cy = door.y + door.h * 0.5;
    this.spawnImpactSparks(cx, cy, 0, 0, 'wood', inBunker);
    soundEngine.playImpact('wood');
    if (door.hp <= 0) {
      door.hp = 0;
      door.destroyed = true;
      door.open = true;
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 55 + Math.random() * 120;
        this.particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          size: 2.8 + Math.random() * 2.5,
          color: i % 2 === 0 ? '#92400e' : '#d97706',
          ttl: 0.38,
          maxTtl: 0.38,
          inBunker,
        });
      }
    }
  }

  damageFurniture(f, dmg, inBunker = false) {
    if (!f || f.destroyed || f._exploded || f.solid === false) return;
    f.hp = (f.hp ?? 90) - dmg;
    const cx = f.x + f.w * 0.5;
    const cy = f.y + f.h * 0.5;
    this.spawnImpactSparks(cx, cy, 0, 0, f.material || 'wood', inBunker);
    soundEngine.playImpact(f.material || 'wood');

    if (f.hp <= 0) {
      f.hp = 0;
      f.destroyed = true;
      if (f.kind === 'barrel_explosive') {
        f._exploded = true;
        this.triggerExplosion(cx, cy, 135, 115, inBunker);
        return;
      }
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 60 + Math.random() * 115;
        this.particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          size: 2.6 + Math.random() * 2.4,
          color: f.material === 'metal' ? '#94a3b8' : '#b45309',
          ttl: 0.36,
          maxTtl: 0.36,
          inBunker,
        });
      }
      // 38% chance to drop survival supplies when breaking furniture
      const roll = Math.random();
      if (roll < 0.16) {
        const meds = ['bandage', 'soda', 'pills'];
        this.world.loot.push({
          id: `furn_m_${Date.now()}_${Math.random()}`,
          kind: 'med',
          medId: meds[Math.floor(Math.random() * meds.length)],
          amount: 1,
          x: cx,
          y: cy,
          inBunker,
        });
      } else if (roll < 0.32) {
        const cal = ['9mm', '12g', '5.56', '7.62'][Math.floor(Math.random() * 4)];
        this.world.loot.push({
          id: `furn_a_${Date.now()}_${Math.random()}`,
          kind: 'ammo',
          ammoType: cal,
          amount: 20,
          x: cx,
          y: cy,
          inBunker,
        });
      } else if (roll < 0.42) {
        this.player.credits += 25;
      }
    }
  }

  damageBarricade(bar, dmg, inBunker = false) {
    if (!bar || bar.destroyed || bar.hp <= 0) return;
    bar.hp -= dmg;
    const cx = bar.x + bar.w * 0.5;
    const cy = bar.y + bar.h * 0.5;
    this.spawnImpactSparks(cx, cy, 0, 0, 'metal', inBunker);
    soundEngine.playImpact('metal');

    if (bar.hp <= 0) {
      bar.hp = 0;
      bar.destroyed = true;
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 60 + Math.random() * 130;
        this.particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          size: 2.6 + Math.random() * 2.4,
          color: i % 2 === 0 ? '#f59e0b' : '#64748b',
          ttl: 0.36,
          maxTtl: 0.36,
          inBunker,
        });
      }
      if (this.world.barricades) {
        const idx = this.world.barricades.indexOf(bar);
        if (idx !== -1) {
          this.world.barricades.splice(idx, 1);
        }
      }
    }
  }

  damageTree(tree, dmg) {
    if (!tree || tree.destroyed || tree.hp <= 0) return;
    tree.hp = (tree.hp ?? 140) - dmg;
    this.spawnImpactSparks(tree.x, tree.y, 0, 0, 'wood', false);
    soundEngine.playImpact('wood');

    if (tree.hp <= 0) {
      tree.hp = 0;
      tree.destroyed = true;
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 55 + Math.random() * 125;
        this.particles.push({
          x: tree.x,
          y: tree.y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          size: 3 + Math.random() * 3,
          color: i % 2 === 0 ? '#78350f' : '#166534',
          ttl: 0.42,
          maxTtl: 0.42,
          inBunker: false,
        });
      }
      if (this.world.trees) {
        const idx = this.world.trees.indexOf(tree);
        if (idx !== -1) {
          this.world.trees.splice(idx, 1);
        }
      }
    }
  }

  damageStone(stone, dmg) {
    if (!stone || stone.destroyed || stone.hp <= 0) return;
    stone.hp = (stone.hp ?? 220) - dmg;
    this.spawnImpactSparks(stone.x, stone.y, 0, 0, 'concrete', false);
    soundEngine.playImpact('concrete');

    if (stone.hp <= 0) {
      stone.hp = 0;
      stone.destroyed = true;
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 60 + Math.random() * 135;
        this.particles.push({
          x: stone.x,
          y: stone.y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          size: 3 + Math.random() * 2.8,
          color: i % 2 === 0 ? '#64748b' : '#94a3b8',
          ttl: 0.42,
          maxTtl: 0.42,
          inBunker: false,
        });
      }
      if (this.world.stones) {
        const idx = this.world.stones.indexOf(stone);
        if (idx !== -1) {
          this.world.stones.splice(idx, 1);
        }
      }
    }
  }

  damageVehicle(veh, dmg, inBunker = false) {
    if (!veh || veh.destroyed || veh.hp <= 0) return;
    veh.hp = Math.max(0, (veh.hp ?? 280) - dmg);
    this.spawnImpactSparks(veh.x, veh.y, 0, 0, 'metal', inBunker);
    soundEngine.playImpact('metal');

    if (veh.hp <= 0) {
      veh.hp = 0;
      veh.destroyed = true;
      if (this.player?.drivingVehicleId === veh.id) {
        this.exitVehicle();
      }
      if (this.world?.vehicles) {
        const idx = this.world.vehicles.indexOf(veh);
        if (idx !== -1) {
          this.world.vehicles.splice(idx, 1);
        }
      }
      this.triggerExplosion(veh.x, veh.y, 115, 75, inBunker);
    }
  }

  issueSquadOrder(cmd) {
    return this.setSquadCommand(cmd);
  }

  performMeleeAttack(attacker = this.player) {
    const p = attacker;
    const m = MELEE_WEAPONS[p.meleeId] || MELEE_WEAPONS.fists;
    if (p === this.player) {
      p.fireTimer = m.cooldown;
      p.meleeSwingTimer = 0.24;
      if (p.activeHeal) {
        this.cancelMedicalUse();
      }
    }
    soundEngine.playShot('pistol');

    const hitX = p.x + Math.cos(p.angle) * (m.range * 0.65);
    const hitY = p.y + Math.sin(p.angle) * (m.range * 0.65);
    const crateDmg = Math.max(8, Math.round(m.damage * (m.propMult || 0.6)));
    const doorDmg = Math.max(8, Math.round(m.damage * (m.doorMult || m.propMult || 0.5)));
    const furnDmg = Math.max(8, Math.round(m.damage * (m.furnitureMult || m.propMult || 0.5)));
    const barDmg = Math.max(8, Math.round(m.damage * (m.barricadeMult || 0.4)));
    const treeDmg = Math.max(8, Math.round(m.damage * (m.treeMult || m.propMult || 0.5)));
    const stoneDmg = Math.max(6, Math.round(m.damage * (m.stoneMult || 0.25)));
    const maxTargets = m.maxTargets || 1;

    const candidateZombies = [];
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z || z._dead || z.inBunker !== p.inBunker) continue;
      const dSq = distSq(hitX, hitY, z.x, z.y);
      if (dSq < (m.range * 0.78 + z.r) ** 2) {
        candidateZombies.push({ z, dSq: distSq(p.x, p.y, z.x, z.y) });
      }
    }
    candidateZombies.sort((a, b) => a.dSq - b.dSq);
    const hitZombies = candidateZombies.slice(0, maxTargets).map((item) => item.z);

    const dmgMult = p.damageBoostMult || 1.0;
    for (const z of hitZombies) {
      if (!z._dead) {
        // Apply controlled knockback so melee strikes create tactical space
        const kAngle = Math.atan2(z.y - p.y, z.x - p.x);
        z.x += Math.cos(kAngle) * 14;
        z.y += Math.sin(kAngle) * 14;
        resolveEntityCollisions(z, this.world, z.inBunker);
        this.damageZombie(z, -1, Math.round(m.damage * dmgMult), true);
      }
    }

    const activeCrates = p.inBunker ? this.world.bunker?.crates || [] : this.world.crates || [];
    for (const c of activeCrates) {
      if (c.hp <= 0 || c._destroyed) continue;
      if (distSq(hitX, hitY, c.x + c.w * 0.5, c.y + c.h * 0.5) < (m.range + 34) ** 2) {
        c.hp -= crateDmg;
        this.spawnImpactSparks(c.x + c.w * 0.5, c.y + c.h * 0.5, 0, 0, 'wood', p.inBunker);
        if (c.hp <= 0) {
          c.hp = 0;
          c._destroyed = true;
          this.spawnCrateLoot(c, p.inBunker);
        }
      }
    }

    if (this.world.barricades) {
      for (let i = this.world.barricades.length - 1; i >= 0; i--) {
        const bar = this.world.barricades[i];
        if (!bar || bar.destroyed || bar.hp <= 0 || Boolean(bar.inBunker) !== Boolean(p.inBunker)) continue;
        const bx = clamp(hitX, bar.x, bar.x + bar.w);
        const by = clamp(hitY, bar.y, bar.y + bar.h);
        if (distSq(hitX, hitY, bx, by) < (m.range * 0.75) ** 2) {
          this.damageBarricade(bar, barDmg, p.inBunker);
        }
      }
    }

    if (p.inBunker && this.world.bunker?.furniture) {
      for (const f of this.world.bunker.furniture) {
        if (f.destroyed || f.solid === false) continue;
        if (distSq(hitX, hitY, f.x + f.w * 0.5, f.y + f.h * 0.5) < (m.range + Math.max(f.w, f.h) * 0.55) ** 2) {
          this.damageFurniture(f, furnDmg, true);
        }
      }
    }

    if (!p.inBunker) {
      if (this.world.trees) {
        for (let i = this.world.trees.length - 1; i >= 0; i--) {
          const t = this.world.trees[i];
          if (!t || t.destroyed || t.hp <= 0) continue;
          const trunkR = t.trunkR || 17;
          if (distSq(hitX, hitY, t.x, t.y) < (m.range + trunkR) ** 2) {
            this.damageTree(t, treeDmg);
          }
        }
      }
      if (this.world.stones) {
        for (let i = this.world.stones.length - 1; i >= 0; i--) {
          const s = this.world.stones[i];
          if (!s || s.destroyed || s.hp <= 0) continue;
          if (distSq(hitX, hitY, s.x, s.y) < (m.range + s.r * 0.75) ** 2) {
            this.damageStone(s, stoneDmg);
          }
        }
      }
      for (const b of this.world.buildings) {
        if (hitX < b.x - 90 || hitX > b.x + b.w + 90 || hitY < b.y - 90 || hitY > b.y + b.h + 90) continue;
        if (b.doors) {
          for (const d of b.doors) {
            if (d.destroyed) continue;
            if (distSq(hitX, hitY, d.x + d.w * 0.5, d.y + d.h * 0.5) < (m.range + 28) ** 2) {
              this.damageDoor(d, doorDmg, false);
            }
          }
        }
        if (b.windows) {
          for (const win of b.windows) {
            if (win.shattered) continue;
            if (distSq(hitX, hitY, win.x + win.w * 0.5, win.y + win.h * 0.5) < (m.range + 28) ** 2) {
              this.shatterWindow(win, win.x + win.w * 0.5, win.y + win.h * 0.5, false);
            }
          }
        }
        if (b.furniture) {
          for (const f of b.furniture) {
            if (f.destroyed || f.solid === false) continue;
            if (distSq(hitX, hitY, f.x + f.w * 0.5, f.y + f.h * 0.5) < (m.range + Math.max(f.w, f.h) * 0.55) ** 2) {
              this.damageFurniture(f, furnDmg, false);
            }
          }
        }
      }
    }
  }

  spawnCrateLoot(crate, inBunker = false) {
    const roll = Math.random();
    const cx = crate.x + crate.w * 0.5;
    const cy = crate.y + crate.h * 0.5;
    const bunkerId = inBunker ? this.player.activeBunkerId || this.world.bunker?.id : undefined;
    if (roll < 0.36) {
      const pool =
        crate.tier >= 3
          ? ['scarH', 'vector', 'saiga12', 'dp28', 'sv98', 'usas12']
          : ['mp5', 'm870', 'm416', 'ak47', 'spas12', 'famas'];
      const wId = pool[Math.floor(Math.random() * pool.length)];
      this.world.loot.push({ id: `loot_c_${Date.now()}_${Math.random()}`, kind: 'weapon', weaponId: wId, x: cx, y: cy, inBunker, bunkerId });
    } else if (roll < 0.68) {
      const types = ['9mm', '12g', '5.56', '7.62'];
      const t = types[Math.floor(Math.random() * types.length)];
      this.world.loot.push({ id: `loot_a_${Date.now()}_${Math.random()}`, kind: 'ammo', ammoType: t, amount: 45, x: cx, y: cy, inBunker, bunkerId });
    } else if (roll < 0.86) {
      const meds = ['bandage', 'medkit', 'soda', 'pills'];
      const m = meds[Math.floor(Math.random() * meds.length)];
      this.world.loot.push({ id: `loot_m_${Date.now()}_${Math.random()}`, kind: 'med', medId: m, amount: 1, x: cx, y: cy, inBunker, bunkerId });
    } else {
      const gears = ['helmet', 'vest', 'backpack'];
      const g = gears[Math.floor(Math.random() * gears.length)];
      this.world.loot.push({
        id: `loot_g_${Date.now()}_${Math.random()}`,
        kind: 'gear',
        gearType: g,
        level: crate.tier >= 3 ? 3 : 2,
        x: cx,
        y: cy,
        inBunker,
        bunkerId,
      });
    }
  }

  damageZombie(z, _zIndex, dmg, byPlayer = true, impactX = z?.x, impactY = z?.y) {
    if (!z || z._dead || z.hp <= 0) return;

    const actualDmg = z.vest ? Math.round(dmg * 0.78) : dmg;
    z.hp -= actualDmg;

    this.decals.push({
      x: impactX + (Math.random() - 0.5) * 12,
      y: impactY + (Math.random() - 0.5) * 12,
      r: 7 + Math.random() * 8,
      color: '#7f1d1d',
      ttl: 8.0,
      maxTtl: 8.0,
      inBunker: z.inBunker,
    });

    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 45 + Math.random() * 90;
      this.particles.push({
        x: impactX,
        y: impactY,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        size: 2.2 + Math.random() * 2,
        color: '#dc2626',
        ttl: 0.25,
        maxTtl: 0.25,
        inBunker: z.inBunker,
      });
    }

    if (z.hp <= 0) {
      z.hp = 0;
      z._dead = true;
      const shouldExplode = Boolean(z.explodes);
      z.explodes = false;

      // Remove by real object reference BEFORE processing any explosion or chain effects
      const realIndex = this.zombies.indexOf(z);
      if (realIndex !== -1) {
        this.zombies.splice(realIndex, 1);
      }

      if (z.isVip) {
        this.player.credits += 1200;
        this.broadcastP2P({ type: 'world:event', event: 'credits', amount: 1200 });
        this.waveBanner = '🏆 CONTRATO VIP COMPLETADO: +$1,200 CRÉDITOS';
        this.waveBannerTimer = 4.0;
      } else {
        this.player.credits += z.credits;
      }
      this.player.score += z.score;
      if (byPlayer) this.player.kills++;

      if (Math.random() < 0.28) {
        const types = ['9mm', '12g', '5.56', '7.62'];
        this.world.loot.push({
          id: `drop_${Date.now()}_${Math.random()}`,
          kind: 'ammo',
          ammoType: types[Math.floor(Math.random() * types.length)],
          amount: 24,
          x: z.x,
          y: z.y,
          inBunker: z.inBunker,
          bunkerId: z.inBunker ? this.player.activeBunkerId || this.world.bunker?.id : undefined,
        });
      }

      if (shouldExplode) {
        this.triggerExplosion(z.x, z.y, z.explosionRadius || 120, 42, z.inBunker);
      }
    }
  }

  triggerExplosion(x, y, radius, damage, inBunker) {
    if (!this._explosionQueue) {
      this._explosionQueue = [];
    }
    this._explosionQueue.push({ x, y, radius, damage, inBunker });

    // If an explosion loop is already active on the call stack, enqueue and return (zero recursion)
    if (this._processingExplosions) {
      return;
    }

    this._processingExplosions = true;
    try {
      while (this._explosionQueue.length > 0) {
        const exp = this._explosionQueue.shift();
        this._executeSingleExplosion(exp.x, exp.y, exp.radius, exp.damage, exp.inBunker);
      }
    } finally {
      this._processingExplosions = false;
    }
  }

  _executeSingleExplosion(x, y, radius, damage, inBunker) {
    soundEngine.playExplosion();
    this.decals.push({
      x,
      y,
      r: radius * 0.55,
      color: '#1c1917',
      ttl: 8.0,
      maxTtl: 8.0,
      inBunker,
    });

    const r2 = radius * radius;

    // Collect target zombie references first so array mutations never skip or shift targets
    const zombiesInBlast = [];
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z || z._dead || z.inBunker !== inBunker) continue;
      if (distSq(x, y, z.x, z.y) <= r2) {
        zombiesInBlast.push(z);
      }
    }

    for (const z of zombiesInBlast) {
      if (!z._dead) {
        this.damageZombie(z, -1, damage, true);
      }
    }

    if (this.world.barricades) {
      for (let i = this.world.barricades.length - 1; i >= 0; i--) {
        const bar = this.world.barricades[i];
        if (!bar || bar.destroyed || bar.hp <= 0 || Boolean(bar.inBunker) !== Boolean(inBunker)) continue;
        if (distSq(x, y, bar.x + bar.w * 0.5, bar.y + bar.h * 0.5) <= r2) {
          this.damageBarricade(bar, damage, inBunker);
        }
      }
    }

    if (inBunker && this.world.bunker) {
      if (this.world.bunker.crates) {
        for (const c of this.world.bunker.crates) {
          if (c.hp <= 0 || c._destroyed) continue;
          if (distSq(x, y, c.x + c.w * 0.5, c.y + c.h * 0.5) <= r2) {
            c.hp -= damage;
            if (c.hp <= 0) {
              c.hp = 0;
              c._destroyed = true;
              this.spawnCrateLoot(c, true);
            }
          }
        }
      }
      if (this.world.bunker.furniture) {
        for (const f of this.world.bunker.furniture) {
          if (f.destroyed || f._exploded || f.solid === false) continue;
          if (distSq(x, y, f.x + f.w * 0.5, f.y + f.h * 0.5) <= r2) {
            this.damageFurniture(f, damage, true);
          }
        }
      }
    }

    if (!inBunker) {
      for (const c of this.world.crates) {
        if (c.hp <= 0 || c._destroyed) continue;
        if (distSq(x, y, c.x + c.w * 0.5, c.y + c.h * 0.5) <= r2) {
          c.hp -= damage;
          if (c.hp <= 0) {
            c.hp = 0;
            c._destroyed = true;
            this.spawnCrateLoot(c, false);
          }
        }
      }
      if (this.world.trees) {
        for (let i = this.world.trees.length - 1; i >= 0; i--) {
          const t = this.world.trees[i];
          if (!t || t.destroyed || t.hp <= 0) continue;
          if (distSq(x, y, t.x, t.y) <= r2) {
            this.damageTree(t, damage);
          }
        }
      }
      if (this.world.stones) {
        for (let i = this.world.stones.length - 1; i >= 0; i--) {
          const s = this.world.stones[i];
          if (!s || s.destroyed || s.hp <= 0) continue;
          if (distSq(x, y, s.x, s.y) <= r2) {
            this.damageStone(s, damage);
          }
        }
      }
      for (const b of this.world.buildings) {
        if (x < b.x - radius || x > b.x + b.w + radius || y < b.y - radius || y > b.y + b.h + radius) continue;
        if (b.doors) {
          for (const d of b.doors) {
            if (!d.destroyed && distSq(x, y, d.x + d.w * 0.5, d.y + d.h * 0.5) <= r2) {
              this.damageDoor(d, damage, false);
            }
          }
        }
        if (b.windows) {
          for (const win of b.windows) {
            if (!win.shattered && distSq(x, y, win.x + win.w * 0.5, win.y + win.h * 0.5) <= r2) {
              this.shatterWindow(win, win.x + win.w * 0.5, win.y + win.h * 0.5, false);
            }
          }
        }
        if (b.furniture) {
          for (const f of b.furniture) {
            if (f.destroyed || f._exploded || f.solid === false) continue;
            if (distSq(x, y, f.x + f.w * 0.5, f.y + f.h * 0.5) <= r2) {
              this.damageFurniture(f, damage, false);
            }
          }
        }
      }
    }
  }

  update(dt) {
    if (this.status !== 'playing') return;
    const clampedDt = Math.min(dt, 0.05);
    this.elapsedTime += clampedDt;

    if (this.waveBannerTimer > 0) {
      this.waveBannerTimer = Math.max(0, this.waveBannerTimer - clampedDt);
    }

    if (this.isHost) {
      // HOST: Authoritative simulation of all game systems (AI, waves, projectiles, loot)
      this.updateEnvironmentCycle(clampedDt);
      this.updatePlayer(clampedDt);
      updateAISquad(this, clampedDt);
      this.updateWaveSpawner(clampedDt);
      this.updateZombies(clampedDt);
      this.updateBullets(clampedDt);
      this.updateGrenadesAndStrikes(clampedDt);
      this.updateTurretsAndDrones(clampedDt);
      this.updateDecalsAndParticles(clampedDt);

      // Smooth camera follow
      this.camera.x += (this.player.x - this.camera.x) * Math.min(1, clampedDt * 12);
      this.camera.y += (this.player.y - this.camera.y) * Math.min(1, clampedDt * 12);

      // Host: Broadcast Authoritative 20Hz State Snapshot (every 50ms)
      this.netSyncTimer += clampedDt;
      if (this.netSyncTimer >= 0.05 && this.roomCode) {
        this.netSyncTimer = 0;
        this.broadcastHostTick();
      }
    } else {
      // CLIENT: Client-side local player movement, atmosphere & visual particles
      // (NO local wave spawner, NO local zombie AI, NO duplicate damage calculations!)
      this.updateEnvironmentCycle(clampedDt);
      this.updatePlayer(clampedDt);
      this.updateDecalsAndParticles(clampedDt);

      // Smooth camera follow
      this.camera.x += (this.player.x - this.camera.x) * Math.min(1, clampedDt * 12);
      this.camera.y += (this.player.y - this.camera.y) * Math.min(1, clampedDt * 12);

      // Client: Broadcast 20Hz input/position snapshot to Host (every 50ms)
      this.netSyncTimer += clampedDt;
      if (this.netSyncTimer >= 0.05 && this.roomCode) {
        this.netSyncTimer = 0;
        this.broadcastClientInput();
      }
    }

    // Throttled HUD sync at 10 Hz
    this.hudSyncTimer += clampedDt;
    if (this.hudSyncTimer >= 0.1) {
      this.hudSyncTimer = 0;
      this.syncHudImmediate();
    }
  }

  updateEnvironmentCycle(dt) {
    const mode = this.roomConfig?.dayCycleSpeed || 'normal';
    if (mode === 'day_only') {
      this.timeOfDay = 0.22;
    } else if (mode === 'night_only') {
      this.timeOfDay = 0.78;
    } else {
      // Significantly longer, natural solar cycle (~12 minutes full day/night cycle in normal mode)
      const rate = mode === 'fast' ? 0.0035 : 0.0014;
      this.timeOfDay = (this.timeOfDay + dt * rate) % 1.0;
    }

    if (this.lightningTimer > 0) {
      this.lightningTimer = Math.max(0, this.lightningTimer - dt);
    }

    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      const states = ['clear', 'rain', 'fog', 'storm'];
      this.weather = states[Math.floor(Math.random() * states.length)];
      // Longer weather duration (110s to 180s per state)
      this.weatherTimer = 110 + Math.random() * 70;
    }

    // Smooth atmospheric transitions for Rain Intensity and Fog Density
    const targetRain = this.weather === 'storm' ? 1.0 : this.weather === 'rain' ? 0.62 : 0.0;
    const targetFog = this.weather === 'fog' ? 0.88 : this.weather === 'storm' ? 0.36 : this.weather === 'rain' ? 0.22 : 0.0;
    this.rainIntensity = (this.rainIntensity ?? 0) + (targetRain - (this.rainIntensity ?? 0)) * Math.min(1, dt * 1.4);
    this.fogDensity = (this.fogDensity ?? 0) + (targetFog - (this.fogDensity ?? 0)) * Math.min(1, dt * 1.1);

    if (this.weather === 'storm' && Math.random() < dt * 0.18) {
      this.lightningTimer = 0.15;
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    const speedBoost = applyAdrenalineTick(p, dt);

    if (p.hitImmunityTimer > 0) {
      p.hitImmunityTimer = Math.max(0, p.hitImmunityTimer - dt);
    }

    if (p.infiniteStaminaTimer > 0) {
      p.infiniteStaminaTimer = Math.max(0, p.infiniteStaminaTimer - dt);
      p.stamina = p.maxStamina;
      p.staminaExhausted = false;
    }

    if (p.downed) {
      p.activeHeal = null;
      if (p.drivingVehicleId) {
        this.exitVehicle();
      }
      const aliveAllies = this.allies.some((a) => !a.downed);
      const aliveCoop = Array.from(this.remotePlayers.values()).some((rp) => !rp.downed);
      if (!aliveAllies && !aliveCoop) {
        this.status = 'gameover';
        this.syncHudImmediate();
      }
      return;
    }

    // Channeling medical or consumable item
    if (p.activeHeal) {
      p.activeHeal.timer -= dt;
      if (p.activeHeal.timer <= 0) {
        this.completeMedicalUse();
      }
    }

    if (p.fireTimer > 0) p.fireTimer = Math.max(0, p.fireTimer - dt);
    if (p.meleeSwingTimer > 0) p.meleeSwingTimer = Math.max(0, p.meleeSwingTimer - dt);

    if (p.reloading > 0) {
      p.reloading = Math.max(0, p.reloading - dt);
      if (p.reloading === 0 && (p.activeSlot === 1 || p.activeSlot === 2)) {
        const slot = p.slots[p.activeSlot];
        const w = WEAPONS[slot.weaponId];
        const needed = w.magSize - slot.mag;
        const avail = Math.min(needed, p.ammo[w.ammoType] || 0);
        slot.mag += avail;
        p.ammo[w.ammoType] -= avail;
      }
    }

    // Movement vector (WASD or Dual-Zone Touch Left Stick)
    let mx = 0;
    let my = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) my -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) my += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) mx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) mx += 1;

    if (this.touchMove.active) {
      mx += this.touchMove.dx;
      my += this.touchMove.dy;
    }

    const len = Math.hypot(mx, my);

    // Vehicle driving mode
    const activeVeh = this.getActiveVehicle();
    if (activeVeh) {
      p.stamina = Math.min(p.maxStamina, p.stamina + 18 * dt);
      if (p.stamina >= 25) p.staminaExhausted = false;

      const maxVehSpeed = activeVeh.maxSpeed || 395;
      if (len > 0.05) {
        const targetAngle = Math.atan2(my, mx);
        activeVeh.angle = lerpAngle(activeVeh.angle ?? targetAngle, targetAngle, Math.min(1, dt * 7.5));
        activeVeh.speed = Math.min(maxVehSpeed, (activeVeh.speed || 0) + 520 * dt);
      } else {
        activeVeh.speed = Math.max(0, (activeVeh.speed || 0) - 640 * dt);
      }

      if (activeVeh.speed > 1) {
        const vx = Math.cos(activeVeh.angle || 0) * activeVeh.speed;
        const vy = Math.sin(activeVeh.angle || 0) * activeVeh.speed;
        const vehProxy = {
          x: activeVeh.x + vx * dt,
          y: activeVeh.y + vy * dt,
          r: 34,
          isVehicle: true,
        };
        resolveEntityCollisions(vehProxy, this.world, false, { ignoreVehicleId: activeVeh.id });
        activeVeh.x = vehProxy.x;
        activeVeh.y = vehProxy.y;
        p.vx = vx;
        p.vy = vy;

        // Ramming zombies while driving
        if (activeVeh.speed > 95) {
          const ramRadiusSq = (38 + 22) ** 2;
          const impactDmg = Math.round(activeVeh.speed * 0.45);
          for (let i = this.zombies.length - 1; i >= 0; i--) {
            const z = this.zombies[i];
            if (!z || z._dead || z.inBunker) continue;
            if (distSq(activeVeh.x, activeVeh.y, z.x, z.y) <= ramRadiusSq) {
              const pushAngle = Math.atan2(z.y - activeVeh.y, z.x - activeVeh.x);
              z.x += Math.cos(pushAngle) * 34;
              z.y += Math.sin(pushAngle) * 34;
              resolveEntityCollisions(z, this.world, false);
              this.damageZombie(z, i, impactDmg, true, z.x, z.y);
              soundEngine.playImpact('metal');
              activeVeh.hp = Math.max(0, (activeVeh.hp ?? 420) - 5);
              if (activeVeh.hp <= 0) {
                activeVeh.destroyed = true;
                this.triggerExplosion(activeVeh.x, activeVeh.y, 115, 75, false);
                this.exitVehicle();
                return;
              }
            }
          }
        }
      } else {
        p.vx = 0;
        p.vy = 0;
      }

      p.x = activeVeh.x;
      p.y = activeVeh.y;
      p.angle = activeVeh.angle || 0;
      return;
    }

    // Stamina Exhaustion Hysteresis Lockout (cannot sprint again until stamina recovers to >= 25%)
    if (p.stamina <= 0.1 && p.infiniteStaminaTimer <= 0) {
      p.stamina = 0;
      p.staminaExhausted = true;
    } else if (p.staminaExhausted && p.stamina >= 25) {
      p.staminaExhausted = false;
    }

    const wantsSprint =
      !p.staminaExhausted &&
      Boolean(this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.touchMove.isSprinting) &&
      (p.stamina > 0 || p.infiniteStaminaTimer > 0) &&
      len > 0.1;

    if (wantsSprint && p.infiniteStaminaTimer <= 0) {
      p.stamina = Math.max(0, p.stamina - 19 * dt);
      if (p.stamina <= 0.1) {
        p.stamina = 0;
        p.staminaExhausted = true;
      }
    } else if (!wantsSprint) {
      p.stamina = Math.min(p.maxStamina, p.stamina + 18 * dt);
      if (p.staminaExhausted && p.stamina >= 25) {
        p.staminaExhausted = false;
      }
    }

    if (len > 0.01) {
      // Slightly reduced move speed while channeling a medical item (80%)
      const healMoveMult = p.activeHeal ? 0.8 : 1.0;
      const baseSpeed = 248 * speedBoost * (wantsSprint ? 1.25 : 1.0) * healMoveMult;
      p.vx = (mx / len) * baseSpeed;
      p.vy = (my / len) * baseSpeed;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      resolveEntityCollisions(p, this.world, p.inBunker);
    } else {
      p.vx = 0;
      p.vy = 0;
    }

    // Mathematical Aim Angle Calculation (Zero fixed-point bug when walking!)
    const zoom = this.getCameraZoom();
    p.angle = computePlayerAimAngle({
      player: p,
      camera: this.camera,
      mouse: this.mouse,
      canvasWidth: this.canvasSize.width,
      canvasHeight: this.canvasSize.height,
      zoom,
      aimJoy: this.touchAim,
      vx: p.vx,
      vy: p.vy,
      dt,
    });

    // Firing
    const wantsFire = (this.mouse.down || this.touchAim.firing) && !this.shopOpen && !this.globalMapOpen;
    if (wantsFire && p.activeHeal) {
      this.cancelMedicalUse();
    }
    if (wantsFire && p.fireTimer <= 0 && p.reloading <= 0) {
      if (p.activeSlot === 1 || p.activeSlot === 2) {
        const slot = p.slots[p.activeSlot];
        const w = WEAPONS[slot.weaponId];
        if (slot.mag <= 0) {
          this.startReload();
        } else {
          slot.mag--;
          p.fireTimer = w.fireRate;
          if (!w.auto && !this.touchAim.firing) {
            this.mouse.down = false;
          }
          if (this.isHost) {
            this.spawnWeaponProjectiles(p, w, true);
          } else {
            // Client: immediate responsive local gunshot audio & muzzle flash
            soundEngine.playShot(w.category);
            this.muzzleFlashes.push({
              x: p.x + Math.cos(p.angle) * 30,
              y: p.y + Math.sin(p.angle) * 30,
              angle: p.angle,
              size: w.category === 'shotgun' || w.category === 'sniper' ? 16 : 11,
              ttl: 0.055,
              inBunker: p.inBunker,
            });
            this.broadcastP2P({
              type: 'client:fire',
              shooterId: this.localId,
              weaponId: w.id,
              x: Math.round(p.x),
              y: Math.round(p.y),
              angle: Number(p.angle.toFixed(3)),
              inBunker: p.inBunker,
            });
          }
        }
      } else if (p.activeSlot === 3) {
        if (this.isHost) {
          this.performMeleeAttack();
        } else {
          p.meleeSwingTimer = 0.24;
          soundEngine.playShot('pistol');
          this.broadcastP2P({
            type: 'client:melee',
            shooterId: this.localId,
            meleeId: p.meleeId,
            x: Math.round(p.x),
            y: Math.round(p.y),
            angle: Number(p.angle.toFixed(3)),
            inBunker: p.inBunker,
          });
        }
      } else if (p.activeSlot === 4) {
        if (this.isHost) {
          this.throwActiveGrenade();
        } else {
          const tid = p.throwableId;
          const count = p.throwableCount[tid] || 0;
          if (count > 0) {
            p.throwableCount[tid]--;
            soundEngine.playPickup();
            this.broadcastP2P({
              type: 'client:throw',
              shooterId: this.localId,
              throwableId: tid,
              x: Math.round(p.x),
              y: Math.round(p.y),
              angle: Number(p.angle.toFixed(3)),
              inBunker: p.inBunker,
              rotation: p.barricadeRotation || 0,
            });
          }
        }
        this.mouse.down = false;
      }
    }
  }

  completeWave(completedWaveNum = this.wave) {
    this.player.credits += 180;
    if (completedWaveNum >= 5 && completedWaveNum % 5 === 0 && this.lastRestockedWaveMilestone !== completedWaveNum) {
      this.lastRestockedWaveMilestone = completedWaveNum;
      this.refreshShopWaveStock();
      this.waveBanner = `RONDA ${completedWaveNum} COMPLETADA — ¡TIENDA REABASTECIDA! (+$180 CR)`;
    } else {
      this.waveBanner = `RONDA ${completedWaveNum} COMPLETADA — +$180 CR`;
    }
    this.waveBannerTimer = 3.8;
    this.syncHudImmediate();
  }

  updateWaveSpawner(dt) {
    if (this.waveQueue.length > 0) {
      this.waveSpawnTimer -= dt;
      if (this.waveSpawnTimer <= 0 && this.zombies.length < 44) {
        const typeId = this.waveQueue.shift();
        const angle = Math.random() * Math.PI * 2;
        const dist = 760 + Math.random() * 340;
        const sx = clamp(this.player.x + Math.cos(angle) * dist, 750, WORLD_SIZE - 750);
        const sy = clamp(this.player.y + Math.sin(angle) * dist, 750, WORLD_SIZE - 750);
        const z = createZombieInstance(typeId, sx, sy, this.waveHpMult, this.waveSpeedMult, this.waveQueue.length);
        z.inBunker = this.player.inBunker;
        this.zombies.push(z);
        this.waveSpawnTimer = 0.48;
      }
    } else if (this.zombies.length === 0) {
      if (this.interWaveTimer === 0) {
        this.interWaveTimer = 6.0;
        this.completeWave(this.wave);
      } else {
        this.interWaveTimer -= dt;
        if (this.interWaveTimer <= 0) {
          this.interWaveTimer = 0;
          this.startWave(this.wave + 1);
        }
      }
    }
  }

  updateZombies(dt) {
    const targets = [this.player, ...this.allies, ...Array.from(this.remotePlayers.values())].filter((t) => !t.downed);
    if (targets.length === 0) return;

    for (let zi = 0; zi < this.zombies.length; zi++) {
      const z = this.zombies[zi];
      if (!z || z._dead) continue;
      if (!z.bunkerId) {
        z.inBunker = this.player.inBunker;
      } else if (this.player.inBunker && this.player.activeBunkerId === z.bunkerId) {
        z.inBunker = true;
      } else {
        continue;
      }
      if (z.attackTimer > 0) z.attackTimer = Math.max(0, z.attackTimer - dt);

      let nearest = targets[0];
      let minD2 = distSq(z.x, z.y, nearest.x, nearest.y);
      for (let i = 1; i < targets.length; i++) {
        const d2 = distSq(z.x, z.y, targets[i].x, targets[i].y);
        if (d2 < minD2) {
          minD2 = d2;
          nearest = targets[i];
        }
      }

      const dx = nearest.x - z.x;
      const dy = nearest.y - z.y;
      const d = Math.sqrt(minD2) || 1;
      const directAngle = Math.atan2(dy, dx);

      // 1. Check if zombie is blocked by a deployed barricade
      let hitBarricade = null;
      if (this.world.barricades) {
        for (const bar of this.world.barricades) {
          if (!bar || bar.destroyed || bar.hp <= 0 || Boolean(bar.inBunker) !== Boolean(z.inBunker)) continue;
          const bx = clamp(z.x, bar.x, bar.x + bar.w);
          const by = clamp(z.y, bar.y, bar.y + bar.h);
          if (distSq(z.x, z.y, bx, by) < (z.r + 14) ** 2) {
            hitBarricade = bar;
            break;
          }
        }
      }

      // 2. Check if zombie is pressing against a closed door or solid furniture
      let blockingDoor = null;
      let blockingFurn = null;
      if (!z.inBunker) {
        for (const b of this.world.buildings) {
          if (z.x < b.x - 60 || z.x > b.x + b.w + 60 || z.y < b.y - 60 || z.y > b.y + b.h + 60) continue;
          if (b.doors) {
            for (const door of b.doors) {
              if (door.open || door.destroyed) continue;
              const dCx = door.x + door.w * 0.5;
              const dCy = door.y + door.h * 0.5;
              if (distSq(z.x, z.y, dCx, dCy) < (z.r + 28) ** 2) {
                blockingDoor = door;
                break;
              }
            }
          }
          if (!blockingDoor && b.furniture) {
            for (const f of b.furniture) {
              if (f.destroyed || f.solid === false) continue;
              const fCx = f.x + f.w * 0.5;
              const fCy = f.y + f.h * 0.5;
              if (distSq(z.x, z.y, fCx, fCy) < (z.r + Math.max(f.w, f.h) * 0.5 + 8) ** 2) {
                blockingFurn = f;
                break;
              }
            }
          }
          if (blockingDoor || blockingFurn) break;
        }
      }

      if (hitBarricade) {
        z.angle = lerpAngle(z.angle ?? directAngle, directAngle, dt * 10);
        if (z.attackTimer <= 0) {
          this.damageBarricade(hitBarricade, z.damage, z.inBunker);
          z.attackTimer = 0.85;
        }
      } else if (blockingDoor) {
        z.angle = lerpAngle(z.angle ?? directAngle, directAngle, dt * 10);
        if (z.attackTimer <= 0) {
          this.damageDoor(blockingDoor, z.damage, z.inBunker);
          z.attackTimer = 0.85;
        }
      } else if (z.ranged && d < z.range && d > 140) {
        z.angle = lerpAngle(z.angle ?? directAngle, directAngle, dt * 10);
        if (z.attackTimer <= 0) {
          this.acidProjectiles.push({
            x: z.x,
            y: z.y,
            vx: (dx / d) * 500,
            vy: (dy / d) * 500,
            damage: z.damage,
            ttl: 2.2,
            inBunker: z.inBunker,
          });
          z.attackTimer = z.attackCooldown;
        }
      } else if (d > z.r + nearest.r + 5) {
        // 3. Smart Door-Seeking & Radial Obstacle Avoidance when a wall blocks Line of Sight
        let goalX = nearest.x;
        let goalY = nearest.y;

        if (!z.inBunker && d < 900) {
          const losHit = raycastObstacles(z.x, z.y, nearest.x, nearest.y, this.world, z.inBunker);
          if (losHit && losHit.hit) {
            for (const b of this.world.buildings) {
              const targetInside =
                nearest.x >= b.x - 30 &&
                nearest.x <= b.x + b.w + 30 &&
                nearest.y >= b.y - 30 &&
                nearest.y <= b.y + b.h + 30;
              const zombieInside =
                z.x >= b.x - 30 && z.x <= b.x + b.w + 30 && z.y >= b.y - 30 && z.y <= b.y + b.h + 30;
              if ((targetInside || zombieInside) && b.doors && b.doors.length > 0) {
                let bestDoor = b.doors[0];
                let bestDoorScore = Infinity;
                for (const door of b.doors) {
                  const dCx = door.x + door.w * 0.5;
                  const dCy = door.y + door.h * 0.5;
                  const score =
                    Math.hypot(z.x - dCx, z.y - dCy) + Math.hypot(nearest.x - dCx, nearest.y - dCy) * 0.65;
                  if (score < bestDoorScore) {
                    bestDoorScore = score;
                    bestDoor = door;
                  }
                }
                goalX = bestDoor.x + bestDoor.w * 0.5;
                goalY = bestDoor.y + bestDoor.h * 0.5;
                break;
              }
            }
          }
        }

        const smartAngle = computeSmartSteerAngle(z, goalX, goalY, this.world, z.inBunker);
        z.moveAngle = lerpAngle(z.moveAngle ?? directAngle, smartAngle, dt * 8);
        z.angle = lerpAngle(z.angle ?? directAngle, z.moveAngle, dt * 10);

        const prevZx = z.x;
        const prevZy = z.y;
        z.x += Math.cos(z.moveAngle) * z.speed * dt;
        z.y += Math.sin(z.moveAngle) * z.speed * dt;

        // Soft zombie-to-zombie crowd separation to prevent stacking and player pinning
        for (let oj = 0; oj < this.zombies.length; oj++) {
          if (oj === zi) continue;
          const oz = this.zombies[oj];
          if (!oz || oz._dead || oz.inBunker !== z.inBunker) continue;
          const sdx = z.x - oz.x;
          const sdy = z.y - oz.y;
          const minSep = (z.r + oz.r) * 0.88;
          const sd2 = sdx * sdx + sdy * sdy;
          if (sd2 > 0.001 && sd2 < minSep * minSep) {
            const sd = Math.sqrt(sd2);
            const push = (minSep - sd) * 0.35;
            z.x += (sdx / sd) * push;
            z.y += (sdy / sd) * push;
          }
        }

        resolveEntityCollisions(z, this.world, z.inBunker);

        // If blocked by furniture while trying to move, smash the furniture!
        if (blockingFurn && Math.hypot(z.x - prevZx, z.y - prevZy) < z.speed * dt * 0.35 && z.attackTimer <= 0) {
          this.damageFurniture(blockingFurn, z.damage, z.inBunker);
          z.attackTimer = 0.85;
        }
      } else {
        // Prevent zombie from overlapping inside the survivor so the player can always escape
        const minTargetDist = z.r + nearest.r + 3;
        if (d < minTargetDist && d > 0.001) {
          const pushOut = (minTargetDist - d) * 0.6;
          z.x -= (dx / d) * pushOut;
          z.y -= (dy / d) * pushOut;
        }
        z.angle = lerpAngle(z.angle ?? directAngle, directAngle, dt * 10);
        if (z.attackTimer <= 0) {
          this.applyDamageToSurvivor(nearest, z.damage);
          z.attackTimer = z.attackCooldown;
        }
      }
    }

    for (let i = this.acidProjectiles.length - 1; i >= 0; i--) {
      const ap = this.acidProjectiles[i];
      const nextX = ap.x + ap.vx * dt;
      const nextY = ap.y + ap.vy * dt;

      const wallHit = raycastObstacles(ap.x, ap.y, nextX, nextY, this.world, ap.inBunker);
      if (wallHit && wallHit.hit) {
        this.acidProjectiles.splice(i, 1);
        continue;
      }

      ap.x = nextX;
      ap.y = nextY;
      ap.ttl -= dt;

      let hit = false;
      for (const t of targets) {
        if (distSq(ap.x, ap.y, t.x, t.y) < (t.r + 8) ** 2) {
          this.applyDamageToSurvivor(t, ap.damage);
          hit = true;
          break;
        }
      }
      if (hit || ap.ttl <= 0) {
        this.acidProjectiles.splice(i, 1);
      }
    }
  }

  applyDamageToSurvivor(unit, rawDmg) {
    if (unit.downed) return;
    if (unit === this.player && (unit.hitImmunityTimer || 0) > 0) return;

    const reduction = unit.armorLevel >= 3 ? 0.52 : unit.armorLevel === 2 ? 0.7 : 0.85;
    const dmg = Math.max(2, Math.round(rawDmg * reduction));
    unit.hp -= dmg;
    if (unit === this.player) {
      unit.hitImmunityTimer = 0.32;
    }
    if (unit.hp <= 0) {
      unit.hp = 1;
      unit.downed = true;
      unit.reviveProgress = 0;
    }
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const stepDist = Math.hypot(b.vx * dt, b.vy * dt);
      const x1 = b.x;
      const y1 = b.y;
      const x2 = b.x + b.vx * dt;
      const y2 = b.y + b.vy * dt;

      const shatteredWindows = [];
      const obstacleHit = raycastObstacles(x1, y1, x2, y2, this.world, b.inBunker, {
        isBullet: true,
        shatteredWindows,
      });
      const maxT = obstacleHit && obstacleHit.hit ? obstacleHit.t : 1.0;

      // Shatter any windows along the bullet's path before maxT (bullets pass through windows!)
      for (const wHit of shatteredWindows) {
        if (wHit.t <= maxT) {
          this.shatterWindow(wHit.win, wHit.ix, wHit.iy, b.inBunker);
        }
      }

      const zombieHits = [];
      for (let zi = 0; zi < this.zombies.length; zi++) {
        const z = this.zombies[zi];
        if (z.inBunker !== b.inBunker) continue;
        if (b.hitIds && b.hitIds.has(z.id)) continue;

        const res = segmentIntersectsCircle(x1, y1, x2, y2, z.x, z.y, z.r + 2);
        if (res.hit && res.t <= maxT) {
          zombieHits.push({ z, t: res.t, ix: res.ix, iy: res.iy });
        }
      }

      zombieHits.sort((a, c) => a.t - c.t);

      let bulletConsumed = false;
      for (const hit of zombieHits) {
        const zIdx = this.zombies.indexOf(hit.z);
        if (zIdx === -1) continue;
        if (b.hitIds) b.hitIds.add(hit.z.id);
        if (b.explosive) {
          this.triggerExplosion(hit.ix, hit.iy, 95, b.damage, b.inBunker);
        } else {
          this.damageZombie(hit.z, zIdx, b.damage, b.fromPlayer, hit.ix, hit.iy);
        }
        b.pierceLeft--;
        if (b.pierceLeft <= 0) {
          bulletConsumed = true;
          break;
        }
      }

      if (bulletConsumed) {
        this.bullets.splice(i, 1);
        continue;
      }

      if (obstacleHit && obstacleHit.hit) {
        if (b.explosive) {
          this.triggerExplosion(obstacleHit.ix, obstacleHit.iy, 95, b.damage, b.inBunker);
        } else {
          this.spawnImpactSparks(
            obstacleHit.ix,
            obstacleHit.iy,
            obstacleHit.nx,
            obstacleHit.ny,
            obstacleHit.material,
            b.inBunker
          );
          soundEngine.playImpact(obstacleHit.material);
        }

        if (obstacleHit.refType === 'crate' && obstacleHit.refObj) {
          obstacleHit.refObj.hp -= b.damage;
          if (obstacleHit.refObj.hp <= 0 && !obstacleHit.refObj._destroyed) {
            obstacleHit.refObj.hp = 0;
            obstacleHit.refObj._destroyed = true;
            this.spawnCrateLoot(obstacleHit.refObj, b.inBunker);
          }
        } else if (obstacleHit.refType === 'door' && obstacleHit.refObj) {
          this.damageDoor(obstacleHit.refObj, b.damage, b.inBunker);
        } else if (obstacleHit.refType === 'furniture' && obstacleHit.refObj) {
          this.damageFurniture(obstacleHit.refObj, b.damage, b.inBunker);
        } else if (obstacleHit.refType === 'barricade' && obstacleHit.refObj) {
          this.damageBarricade(obstacleHit.refObj, b.damage, b.inBunker);
        } else if (obstacleHit.refType === 'tree' && obstacleHit.refObj) {
          this.damageTree(obstacleHit.refObj, b.damage);
        } else if (obstacleHit.refType === 'stone' && obstacleHit.refObj) {
          this.damageStone(obstacleHit.refObj, b.damage);
        }

        this.bullets.splice(i, 1);
        continue;
      }

      b.x = x2;
      b.y = y2;
      b.rangeLeft -= stepDist;

      if (b.rangeLeft <= 0) {
        this.bullets.splice(i, 1);
      }
    }
  }

  updateGrenadesAndStrikes(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (g.smokeActive) {
        g.smokeTimer -= dt;
        if (g.smokeTimer <= 0) this.grenades.splice(i, 1);
        continue;
      }

      const nextX = g.x + g.vx * dt;
      const nextY = g.y + g.vy * dt;
      const hitWall = raycastObstacles(g.x, g.y, nextX, nextY, this.world, g.inBunker);
      if (hitWall && hitWall.hit) {
        g.vx *= -0.45;
        g.vy *= -0.45;
      } else {
        g.x = nextX;
        g.y = nextY;
      }

      g.vx *= 0.92;
      g.vy *= 0.92;
      g.fuse -= dt;

      if (g.fuse <= 0) {
        if (g.type === 'smoke') {
          g.smokeActive = true;
        } else if (g.type === 'strobe') {
          this.airstrikes.push({ x: g.x, y: g.y, radius: g.radius, timer: 1.4, inBunker: g.inBunker });
          this.grenades.splice(i, 1);
        } else {
          this.triggerExplosion(g.x, g.y, g.radius, g.damage, g.inBunker);
          if (g.type === 'mirv') {
            for (let c = 0; c < 4; c++) {
              const a = (c * Math.PI) / 2 + 0.4;
              this.triggerExplosion(g.x + Math.cos(a) * 75, g.y + Math.sin(a) * 75, 95, 110, g.inBunker);
            }
          }
          this.grenades.splice(i, 1);
        }
      }
    }

    for (let i = this.airstrikes.length - 1; i >= 0; i--) {
      const s = this.airstrikes[i];
      s.timer -= dt;
      if (s.timer <= 0) {
        this.triggerExplosion(s.x, s.y, s.radius, 340, s.inBunker);
        this.airstrikes.splice(i, 1);
      }
    }
  }

  updateTurretsAndDrones(dt) {
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i];
      t.deployProgress = Math.min(1, (t.deployProgress || 0.2) + dt * 2.5);
      t.ttl = (t.ttl ?? 45) - dt;
      if (t.ttl <= 0 || t.ammo <= 0 || t.hp <= 0) {
        this.turrets.splice(i, 1);
        continue;
      }

      t.fireTimer = Math.max(0, t.fireTimer - dt);
      let nearest = null;
      let minD2 = 540 * 540;
      for (const z of this.zombies) {
        if (z.inBunker !== t.inBunker) continue;
        const d2 = distSq(t.x, t.y, z.x, z.y);
        if (d2 < minD2) {
          minD2 = d2;
          nearest = z;
        }
      }

      if (nearest) {
        t.angle = Math.atan2(nearest.y - t.y, nearest.x - t.x);
        if (t.fireTimer <= 0 && t.deployProgress >= 0.95) {
          this.bullets.push({
            x: t.x + Math.cos(t.angle) * 20,
            y: t.y + Math.sin(t.angle) * 20,
            vx: Math.cos(t.angle) * 1340,
            vy: Math.sin(t.angle) * 1340,
            angle: t.angle,
            damage: 28,
            rangeLeft: 560,
            pierceLeft: 1,
            hitIds: new Set(),
            fromPlayer: true,
            inBunker: t.inBunker,
            color: '#4ade80',
            thickness: 3,
          });
          t.ammo--;
          t.fireTimer = 0.11;
          soundEngine.playShot('smg');
        }
      } else {
        t.angle += dt * 1.8;
      }
    }

    // Autonomous Combat Drones orbiting player
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const dr = this.drones[i];
      dr.ttl -= dt;
      if (dr.ttl <= 0) {
        this.drones.splice(i, 1);
        continue;
      }
      dr.orbitAngle = (dr.orbitAngle || 0) + dt * 2.6;
      dr.x = this.player.x + Math.cos(dr.orbitAngle) * 62;
      dr.y = this.player.y + Math.sin(dr.orbitAngle) * 62;
      dr.fireTimer = Math.max(0, dr.fireTimer - dt);

      if (dr.fireTimer <= 0) {
        let nearest = null;
        let minD2 = 460 * 460;
        for (const z of this.zombies) {
          if (z.inBunker !== this.player.inBunker) continue;
          const d2 = distSq(dr.x, dr.y, z.x, z.y);
          if (d2 < minD2) {
            minD2 = d2;
            nearest = z;
          }
        }
        if (nearest) {
          const a = Math.atan2(nearest.y - dr.y, nearest.x - dr.x);
          this.bullets.push({
            x: dr.x,
            y: dr.y,
            vx: Math.cos(a) * 1450,
            vy: Math.sin(a) * 1450,
            angle: a,
            damage: 24,
            rangeLeft: 480,
            pierceLeft: 1,
            hitIds: new Set(),
            fromPlayer: true,
            inBunker: this.player.inBunker,
            color: '#38bdf8',
            thickness: 2.5,
          });
          dr.fireTimer = 0.22;
        }
      }
    }
  }

  updateDecalsAndParticles(dt) {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      this.decals[i].ttl -= dt;
      if (this.decals[i].ttl <= 0) {
        this.decals.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.88;
      pt.vy *= 0.88;
      pt.ttl -= dt;
      if (pt.ttl <= 0) {
        this.particles.splice(i, 1);
      }
    }

    if (this.muzzleFlashes) {
      for (let i = this.muzzleFlashes.length - 1; i >= 0; i--) {
        this.muzzleFlashes[i].ttl -= dt;
        if (this.muzzleFlashes[i].ttl <= 0) {
          this.muzzleFlashes.splice(i, 1);
        }
      }
    }

    if (this.shells) {
      for (let i = this.shells.length - 1; i >= 0; i--) {
        const s = this.shells[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vx *= 0.86;
        s.vy *= 0.86;
        s.rot += s.vRot * dt;
        s.ttl -= dt;
        if (s.ttl <= 0) {
          this.shells.splice(i, 1);
        }
      }
    }
  }

  getHudSnapshot() {
    const p = this.player;
    const activeW = this.getActiveWeaponData();
    const slotObj = p.slots[p.activeSlot] || p.slots[1];
    const currentMag = p.activeSlot <= 2 ? slotObj.mag : p.activeSlot === 4 ? p.throwableCount[p.throwableId] || 0 : '∞';
    const currentReserve = p.activeSlot <= 2 ? p.ammo[activeW.ammoType] || 0 : '';

    const todLabel =
      this.timeOfDay < 0.45
        ? '☀️ Día'
        : this.timeOfDay < 0.62
        ? '🌅 Ocaso'
        : this.timeOfDay < 0.88
        ? '🌙 Noche'
        : '🌄 Amanecer';
    const weatherIcon =
      this.weather === 'rain' ? '🌧️ Lluvia' : this.weather === 'fog' ? '🌫️ Niebla' : this.weather === 'storm' ? '⛈️ Tormenta' : '';

    // Check nearby vendor (within 210px on surface)
    let nearbyVendor = null;
    if (!p.inBunker && this.world?.vendors) {
      let minV = 210 * 210;
      for (const v of this.world.vendors) {
        const d2 = distSq(p.x, p.y, v.x, v.y);
        if (d2 <= minV) {
          minV = d2;
          nearbyVendor = { id: v.id, name: v.name, distance: Math.round(Math.sqrt(d2)) };
        }
      }
    }

    // Check active or nearby driveable vehicle
    const activeVeh = this.getActiveVehicle();
    let nearbyVehicle = null;
    if (!activeVeh && !p.inBunker && this.world?.vehicles) {
      let minVeh = 115 * 115;
      for (const veh of this.world.vehicles) {
        if (!veh.driveable || veh.destroyed || veh.hp <= 0) continue;
        const d2 = distSq(p.x, p.y, veh.x, veh.y);
        if (d2 <= minVeh) {
          minVeh = d2;
          nearbyVehicle = {
            id: veh.id,
            name: veh.name || 'Vehículo Táctico',
            hp: Math.round(veh.hp),
            maxHp: veh.maxHp || 420,
          };
        }
      }
    }

    const bpLevel = p.backpackLevel ?? 0;
    const inventoryUsed = computeInventoryUsage(p);
    const inventoryMax = getMaxInventoryCapacity(bpLevel);
    const nextRestockWave = Math.ceil(Math.max(1, this.wave) / 5) * 5;

    return {
      status: this.status,
      biomeId: this.biomeId,
      squadSize: this.squadSize,
      roomCode: this.roomCode,
      p2pStatus: this.p2pStatus,
      isHost: this.isHost,
      roomConfig: { ...this.roomConfig },
      roomPlayers: [...this.roomPlayers],
      chatMessages: [...this.chatMessages],
      wave: this.wave,
      nextRestockWave,
      lastRestockedWaveMilestone: this.lastRestockedWaveMilestone || 0,
      timeLabel: weatherIcon ? `${todLabel} • ${weatherIcon}` : todLabel,
      zombiesAlive: this.zombies.length + (this.waveQueue ? this.waveQueue.length : 0),
      waveBanner: this.waveBannerTimer > 0 ? this.waveBanner : '',
      shopOpen: this.shopOpen,
      globalMapOpen: this.globalMapOpen,
      shopStock: { ...this.shopStock },
      flashSaleIds: [...this.flashSaleIds],
      weaponRefillQuotes: [this.getWeaponAmmoRefillQuote(1), this.getWeaponAmmoRefillQuote(2)],
      squadCommand: this.squadCommand,
      nearbyVendor,
      nearbyVehicle,
      drivingVehicle: activeVeh
        ? {
            id: activeVeh.id,
            name: activeVeh.name || 'Vehículo Táctico',
            hp: Math.round(activeVeh.hp),
            maxHp: activeVeh.maxHp || 280,
            speed: Math.round(activeVeh.speed || 0),
          }
        : null,
      player: {
        hp: Math.round(p.hp),
        maxHp: p.maxHp,
        adrenaline: Math.round(p.adrenaline),
        stamina: Math.round(p.stamina),
        staminaExhausted: Boolean(p.staminaExhausted),
        credits: p.credits,
        score: p.score,
        kills: p.kills,
        scope: p.scope,
        armorLevel: p.armorLevel,
        helmetLevel: p.helmetLevel,
        backpackLevel: bpLevel,
        backpackName: BACKPACK_NAMES[bpLevel] || 'Mochila Ligera Nv.1',
        inventoryUsed,
        inventoryMax,
        inBunker: p.inBunker,
        activeBunkerId: p.activeBunkerId || null,
        activeBunkerName: p.inBunker ? this.world?.bunker?.name || 'BÚNKER SUBTERRÁNEO' : null,
        barricadeRotation: p.barricadeRotation || 0,
        downed: p.downed,
        activeSlot: p.activeSlot,
        activeWeaponName: activeW.name,
        currentMag,
        currentReserve,
        reloading: p.reloading > 0,
        reloadTimeLeft: Number(p.reloading.toFixed(1)),
        reloadProgress: p.reloadTotal > 0 ? clamp(1 - p.reloading / p.reloadTotal, 0, 1) : 0,
        activeHeal: p.activeHeal
          ? {
              id: p.activeHeal.id,
              name: p.activeHeal.name,
              label: p.activeHeal.label,
              timeLeft: Number(Math.max(0, p.activeHeal.timer).toFixed(1)),
              progress: p.activeHeal.total > 0 ? clamp(1 - p.activeHeal.timer / p.activeHeal.total, 0, 1) : 0,
            }
          : null,
        slots: {
          1: { ...p.slots[1], name: WEAPONS[p.slots[1].weaponId].name },
          2: { ...p.slots[2], name: WEAPONS[p.slots[2].weaponId].name },
          3: { id: p.meleeId, name: MELEE_WEAPONS[p.meleeId].name },
          4: { id: p.throwableId, name: THROWABLES[p.throwableId].name, count: p.throwableCount[p.throwableId] || 0 },
        },
        throwableCount: { ...p.throwableCount },
        ammo: { ...p.ammo },
        ammoMaxReserve: {
          '9mm': getMaxAmmoReserve(bpLevel, '9mm'),
          '12g': getMaxAmmoReserve(bpLevel, '12g'),
          '5.56': getMaxAmmoReserve(bpLevel, '5.56'),
          '7.62': getMaxAmmoReserve(bpLevel, '7.62'),
          '.50': getMaxAmmoReserve(bpLevel, '.50'),
        },
        meds: { ...p.meds },
      },
      allies: this.allies.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        hp: Math.round(a.hp),
        maxHp: a.maxHp,
        downed: a.downed,
        weaponName: WEAPONS[a.weaponId]?.name || a.weaponId,
        color: a.color,
        chatBubble: a.chatBubble ? { ...a.chatBubble } : null,
      })),
    };
  }

  syncHudImmediate() {
    if (this.onHudSync) {
      this.onHudSync(this.getHudSnapshot());
    }
  }
}
