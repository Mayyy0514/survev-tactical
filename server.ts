import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RoomPlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  downed: boolean;
  dead: boolean;
  weaponId: string;
  helmet: number;
  vest: number;
  backpack: number;
  credits: number;
  ready: boolean;
}

interface GameRoom {
  code: string;
  seed: number;
  biomeId: string;
  squadCount: number;
  hostId: string;
  status: 'lobby' | 'playing';
  wave: number;
  players: Map<string, RoomPlayer>;
  clients: Map<string, WebSocket>;
}

const rooms = new Map<string, GameRoom>();

const PLAYER_COLORS = ['#f8fafc', '#38bdf8', '#facc15', '#c084fc', '#4ade80'];

function seedFromCode(code: string): number {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) || 1337;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function serializeRoom(room: GameRoom) {
  return {
    code: room.code,
    seed: room.seed,
    biomeId: room.biomeId,
    squadCount: room.squadCount,
    hostId: room.hostId,
    status: room.status,
    wave: room.wave,
    players: Array.from(room.players.values())
  };
}

function broadcastToRoom(room: GameRoom, payload: unknown, excludeId?: string) {
  const msg = JSON.stringify(payload);
  for (const [clientId, ws] of room.clients.entries()) {
    if (excludeId && clientId === excludeId) continue;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', activeRooms: rooms.size });
  });

  wss.on('connection', (ws) => {
    let currentRoomCode: string | null = null;
    let currentPlayerId: string | null = null;

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        const type = data.type;

        if (type === 'room:create') {
          const code = (data.code || generateRoomCode()).toUpperCase().slice(0, 4);
          const playerId = data.playerId || `p_${Date.now()}`;
          currentPlayerId = playerId;
          currentRoomCode = code;

          const room: GameRoom = {
            code,
            seed: seedFromCode(code),
            biomeId: data.biomeId || 'forest',
            squadCount: data.squadCount || 5,
            hostId: playerId,
            status: 'lobby',
            wave: 1,
            players: new Map(),
            clients: new Map()
          };

          room.players.set(playerId, {
            id: playerId,
            name: data.playerName || 'Cole',
            color: PLAYER_COLORS[0],
            x: 9000,
            y: 8600,
            angle: 0,
            hp: 100,
            maxHp: 100,
            downed: false,
            dead: false,
            weaponId: 'mp5',
            helmet: 1,
            vest: 1,
            backpack: 1,
            credits: 250,
            ready: true
          });
          room.clients.set(playerId, ws);
          rooms.set(code, room);

          ws.send(
            JSON.stringify({
              type: 'room:joined',
              playerId,
              room: serializeRoom(room)
            })
          );
        } else if (type === 'room:join') {
          const code = (data.code || '').toUpperCase().trim().slice(0, 4);
          if (code.length !== 4) {
            ws.send(JSON.stringify({ type: 'room:error', message: 'Código de 4 letras inválido.' }));
            return;
          }
          const playerId = data.playerId || `p_${Date.now()}`;
          currentPlayerId = playerId;
          currentRoomCode = code;

          let room = rooms.get(code);
          if (!room) {
            room = {
              code,
              seed: seedFromCode(code),
              biomeId: data.biomeId || 'forest',
              squadCount: data.squadCount || 5,
              hostId: playerId,
              status: 'lobby',
              wave: 1,
              players: new Map(),
              clients: new Map()
            };
            rooms.set(code, room);
          }

          const colorIdx = room.players.size % PLAYER_COLORS.length;
          room.players.set(playerId, {
            id: playerId,
            name: data.playerName || `Operador ${room.players.size + 1}`,
            color: PLAYER_COLORS[colorIdx],
            x: 9000 + room.players.size * 55,
            y: 8600,
            angle: 0,
            hp: 100,
            maxHp: 100,
            downed: false,
            dead: false,
            weaponId: 'mp5',
            helmet: 1,
            vest: 1,
            backpack: 1,
            credits: 250,
            ready: true
          });
          room.clients.set(playerId, ws);

          ws.send(
            JSON.stringify({
              type: 'room:joined',
              playerId,
              room: serializeRoom(room)
            })
          );
          broadcastToRoom(room, { type: 'room:state', room: serializeRoom(room) });
        } else if (type === 'room:config' && currentRoomCode) {
          const room = rooms.get(currentRoomCode);
          if (room) {
            if (data.biomeId) room.biomeId = data.biomeId;
            if (data.squadCount) room.squadCount = data.squadCount;
            broadcastToRoom(room, { type: 'room:state', room: serializeRoom(room) });
          }
        } else if (type === 'room:start' && currentRoomCode) {
          const room = rooms.get(currentRoomCode);
          if (room) {
            room.status = 'playing';
            broadcastToRoom(room, {
              type: 'room:started',
              room: serializeRoom(room)
            });
          }
        } else if (type === 'player:sync' && currentRoomCode && currentPlayerId) {
          const room = rooms.get(currentRoomCode);
          if (room && data.state) {
            const existing = room.players.get(currentPlayerId);
            if (existing) {
              Object.assign(existing, data.state);
            }
            broadcastToRoom(
              room,
              {
                type: 'player:updated',
                playerId: currentPlayerId,
                state: existing || data.state
              },
              currentPlayerId
            );
          }
        } else if (type === 'world:event' && currentRoomCode && currentPlayerId) {
          const room = rooms.get(currentRoomCode);
          if (room) {
            broadcastToRoom(
              room,
              {
                type: 'world:event',
                senderId: currentPlayerId,
                event: data.event
              },
              currentPlayerId
            );
          }
        }
      } catch {
        // Ignore malformed packets
      }
    });

    ws.on('close', () => {
      if (currentRoomCode && currentPlayerId) {
        const room = rooms.get(currentRoomCode);
        if (room) {
          room.players.delete(currentPlayerId);
          room.clients.delete(currentPlayerId);
          if (room.players.size === 0) {
            rooms.delete(currentRoomCode);
          } else {
            if (room.hostId === currentPlayerId) {
              room.hostId = Array.from(room.players.keys())[0];
            }
            broadcastToRoom(room, { type: 'room:state', room: serializeRoom(room) });
          }
        }
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SURVEV PVE Tactical Server & WebSocket Relay listening on port ${PORT}`);
  });
}

startServer();
