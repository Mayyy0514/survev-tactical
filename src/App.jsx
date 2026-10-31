import React, { useEffect, useRef, useState } from 'react';
import {
  Crosshair,
  ShoppingCart,
  RotateCcw,
  Users,
  Skull,
  Play,
  X,
  Radio,
  Copy,
  Check,
  Map as MapIcon,
  MessageSquare,
} from 'lucide-react';
import {
  BIOMES,
  SHOP_ITEMS,
  AMMO_COLORS,
  MEDICAL_ITEMS,
  AI_ORDERS,
} from './config/constants.js';
import { TacticalStrikeEngine } from './engine/gameEngine.js';
import { renderGameCanvas } from './engine/renderer.js';
import { soundEngine } from './engine/sound.js';

function computeUiScale() {
  if (typeof window === 'undefined') return 1;
  return Number(Math.min(1, window.innerWidth / 900, window.innerHeight / 440).toFixed(3));
}

export default function App() {
  const canvasRef = useRef(null);
  const minimapRef = useRef(null);
  const globalMapRef = useRef(null);
  const engineRef = useRef(null);
  const holdTimerRef = useRef(null);

  const [hud, setHud] = useState(null);
  const [uiScale, setUiScale] = useState(computeUiScale);
  const [selectedBiome, setSelectedBiome] = useState('forest');
  const [selectedSquadSize, setSelectedSquadSize] = useState(4);
  const [muted, setMuted] = useState(false);
  const [ordersMenuOpen, setOrdersMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');

  // Co-Op P2P Multiplayer Lobby Modals
  const [lobbyMode, setLobbyMode] = useState(null); // null | 'waiting' | 'join'
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [operatorCallsign, setOperatorCallsign] = useState('COLE-01');
  const [copiedCode, setCopiedCode] = useState(false);

  // Dual-zone Left Joystick & Right Aim Joystick (100% invisible until touched)
  const [leftStickUI, setLeftStickUI] = useState(null);
  const [rightStickUI, setRightStickUI] = useState(null);

  useEffect(() => {
    const updateScale = () => setUiScale(computeUiScale());
    window.addEventListener('resize', updateScale);
    window.addEventListener('orientationchange', updateScale);
    return () => {
      window.removeEventListener('resize', updateScale);
      window.removeEventListener('orientationchange', updateScale);
    };
  }, []);

  useEffect(() => {
    const engine = new TacticalStrikeEngine((snapshot) => {
      setHud(snapshot);
    });
    engineRef.current = engine;
    setHud(engine.getHudSnapshot());

    if (typeof window !== 'undefined') {
      window.__gameEngine = engine;
    }

    let animId;
    let timerId;
    let cancelled = false;
    let lastTime = performance.now();

    const loop = (now) => {
      if (cancelled) return;
      if (typeof window !== 'undefined' && window.__pauseLoop) {
        lastTime = now;
        timerId = setTimeout(() => {
          if (!cancelled) animId = requestAnimationFrame(loop);
        }, 40);
        return;
      }
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const canvas = canvasRef.current;
      if (canvas) {
        if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
        }
        engine.canvasSize.width = canvas.width;
        engine.canvasSize.height = canvas.height;
      }

      engine.update(dt);

      if (canvas) {
        const ctx = canvas.getContext('2d');
        renderGameCanvas(ctx, engine, canvas.width, canvas.height);
      }

      const mini = minimapRef.current;
      if (mini && engine.status === 'playing') {
        renderMinimap(mini.getContext('2d'), engine, mini.width, mini.height, false);
      }

      const gMap = globalMapRef.current;
      if (gMap && engine.globalMapOpen) {
        renderMinimap(gMap.getContext('2d'), engine, gMap.width, gMap.height, true);
      }

      timerId = setTimeout(() => {
        if (!cancelled) animId = requestAnimationFrame(loop);
      }, 16);
    };

    animId = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
      clearTimeout(timerId);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      const eng = engineRef.current;
      if (!eng) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

      eng.keys[e.code] = true;

      if (eng.status !== 'playing') return;

      if (e.code === 'Digit1') eng.switchSlot(1);
      else if (e.code === 'Digit2') eng.switchSlot(2);
      else if (e.code === 'Digit3') eng.switchSlot(3);
      else if (e.code === 'Digit4') eng.cycleThrowable();
      else if (e.code === 'KeyR') eng.startReload();
      else if (e.code === 'KeyF' || e.code === 'KeyE') eng.interact();
      else if (e.code === 'KeyG') eng.throwActiveGrenade();
      else if (e.code === 'KeyV') eng.rotateBarricade();
      else if (e.code === 'KeyB') {
        eng.shopOpen = !eng.shopOpen;
        eng.syncHudImmediate();
      } else if (e.code === 'KeyM') {
        eng.globalMapOpen = !eng.globalMapOpen;
        eng.syncHudImmediate();
      } else if (e.code === 'KeyT') {
        e.preventDefault();
        setChatOpen((prev) => !prev);
      } else if (e.code === 'Digit7') eng.useMedicalItem('bandage');
      else if (e.code === 'Digit8') eng.useMedicalItem('medkit');
      else if (e.code === 'Digit9') eng.useMedicalItem('soda');
      else if (e.code === 'Digit0') eng.useMedicalItem('pills');
      else if (e.code === 'Escape') {
        if (eng.shopOpen) eng.shopOpen = false;
        else if (eng.globalMapOpen) eng.globalMapOpen = false;
        else if (settingsOpen) setSettingsOpen(false);
        else eng.status = eng.status === 'playing' ? 'paused' : 'playing';
        eng.syncHudImmediate();
      }
    };

    const onKeyUp = (e) => {
      const eng = engineRef.current;
      if (!eng) return;
      eng.keys[e.code] = false;
    };

    const onMouseMove = (e) => {
      const eng = engineRef.current;
      if (!eng) return;
      eng.mouse.screenX = e.clientX;
      eng.mouse.screenY = e.clientY;
      eng.mouse.lastMovedAt = performance.now();
    };

    const onMouseDown = (e) => {
      const eng = engineRef.current;
      if (!eng || eng.status !== 'playing') return;
      if (e.target && e.target.closest('button, input, select, .hud-interactive')) return;
      if (e.button === 0) {
        soundEngine.init();
        eng.mouse.screenX = e.clientX;
        eng.mouse.screenY = e.clientY;
        eng.mouse.lastMovedAt = performance.now();
        eng.mouse.down = true;
      }
    };

    const onMouseUp = (e) => {
      const eng = engineRef.current;
      if (!eng) return;
      if (e.button === 0) eng.mouse.down = false;
    };

    const onWheel = (e) => {
      const eng = engineRef.current;
      if (!eng || eng.status !== 'playing' || eng.shopOpen) return;
      const next = e.deltaY > 0 ? (eng.player.activeSlot % 4) + 1 : ((eng.player.activeSlot + 2) % 4) + 1;
      eng.switchSlot(next);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
    };
  }, [settingsOpen]);

  const handleTouchStart = (e) => {
    const eng = engineRef.current;
    if (!eng || eng.status !== 'playing' || eng.shopOpen) return;
    if (e.target && e.target.closest('button, input, select, .hud-interactive')) return;
    soundEngine.init();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.clientX < window.innerWidth * 0.45 && !leftStickUI) {
        setLeftStickUI({
          id: t.identifier,
          startX: t.clientX,
          startY: t.clientY,
          curX: t.clientX,
          curY: t.clientY,
          dist: 0,
          isSprinting: false,
        });
        eng.touchMove = { active: true, dx: 0, dy: 0, dist: 0, isSprinting: false };
      } else if (t.clientX >= window.innerWidth * 0.45 && !rightStickUI) {
        setRightStickUI({
          id: t.identifier,
          startX: t.clientX,
          startY: t.clientY,
          curX: t.clientX,
          curY: t.clientY,
          dist: 0,
        });
        eng.touchAim = { active: true, dx: 0, dy: 0, dist: 0, angle: eng.player.angle, firing: false };
      }
    }
  };

  const handleTouchMove = (e) => {
    const eng = engineRef.current;
    if (!eng) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (leftStickUI && t.identifier === leftStickUI.id) {
        const dx = t.clientX - leftStickUI.startX;
        const dy = t.clientY - leftStickUI.startY;
        const rawDist = Math.hypot(dx, dy);
        // Dual-Zone Left Stick: Inner Zone <= 42px (Walk), Outer Zone 42px..68px (Sprint)
        const clampedDist = Math.min(68, rawDist);
        const isSprinting = rawDist > 42;
        const angle = Math.atan2(dy, dx);
        const norm = clampedDist / 42;
        const nx = Math.cos(angle) * Math.min(1, norm);
        const ny = Math.sin(angle) * Math.min(1, norm);

        eng.touchMove = { active: true, dx: nx, dy: ny, dist: clampedDist, isSprinting };
        setLeftStickUI((prev) =>
          prev
            ? {
                ...prev,
                curX: leftStickUI.startX + Math.cos(angle) * clampedDist,
                curY: leftStickUI.startY + Math.sin(angle) * clampedDist,
                dist: clampedDist,
                isSprinting,
              }
            : null
        );
      } else if (rightStickUI && t.identifier === rightStickUI.id) {
        const dx = t.clientX - rightStickUI.startX;
        const dy = t.clientY - rightStickUI.startY;
        const rawDist = Math.hypot(dx, dy);
        const clampedDist = Math.min(54, rawDist);
        const angle = Math.atan2(dy, dx);
        const nx = Math.cos(angle) * (clampedDist / 54);
        const ny = Math.sin(angle) * (clampedDist / 54);

        eng.touchAim = {
          active: true,
          dx: nx,
          dy: ny,
          dist: clampedDist,
          angle,
          firing: clampedDist > 16,
        };
        setRightStickUI((prev) =>
          prev
            ? {
                ...prev,
                curX: rightStickUI.startX + Math.cos(angle) * clampedDist,
                curY: rightStickUI.startY + Math.sin(angle) * clampedDist,
                dist: clampedDist,
              }
            : null
        );
      }
    }
  };

  const handleTouchEnd = (e) => {
    const eng = engineRef.current;
    if (!eng) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (leftStickUI && t.identifier === leftStickUI.id) {
        setLeftStickUI(null);
        eng.touchMove = { active: false, dx: 0, dy: 0, dist: 0, isSprinting: false };
      } else if (rightStickUI && t.identifier === rightStickUI.id) {
        setRightStickUI(null);
        eng.touchAim = { active: false, dx: 0, dy: 0, dist: 0, angle: eng.player.angle, firing: false };
      }
    }
  };

  const handleDropHoldStart = (kind, id) => {
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      engineRef.current?.dropInventoryItem(kind, id);
    }, 400);
  };

  const handleDropHoldEnd = () => {
    clearTimeout(holdTimerRef.current);
  };

  const handleCreateRoom = () => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.createMultiplayerRoom(operatorCallsign, {
      biomeId: selectedBiome,
      squadSize: selectedSquadSize,
    });
    setLobbyMode('waiting');
  };

  const handleJoinRoomSubmit = (e) => {
    e.preventDefault();
    const eng = engineRef.current;
    if (!eng || joinCodeInput.trim().length !== 4) return;
    eng.joinMultiplayerRoom(joinCodeInput.trim().toUpperCase(), operatorCallsign);
    setLobbyMode('waiting');
  };

  const copyRoomCode = () => {
    if (!hud?.roomCode) return;
    navigator.clipboard?.writeText(hud.roomCode).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  };

  const handleSendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    engineRef.current?.sendChatMessage(chatInput);
    setChatInput('');
    setChatOpen(false);
  };

  if (!hud) return null;
  const { player, allies, roomConfig } = hud;

  return (
    <div
      className="fixed inset-0 w-screen h-screen overflow-hidden select-none touch-none bg-black font-sans text-slate-100"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Full-Viewport 60FPS Tactical 2D Canvas */}
      <canvas ref={canvasRef} className="block w-full h-full cursor-crosshair" />

      {/* Dual-Zone Left Joystick (Inner 42px Walk Ring + Outer 68px Sprint Ring + Cyan Line & ⚡ SPRINT) */}
      {leftStickUI && (
        <div
          className="pointer-events-none fixed z-30"
          style={{ left: leftStickUI.startX, top: leftStickUI.startY }}
        >
          <div
            className={`absolute rounded-full border transition-colors ${
              leftStickUI.isSprinting
                ? 'border-cyan-400/80 bg-cyan-500/10'
                : 'border-white/15 bg-black/10'
            }`}
            style={{ width: 136, height: 136, left: -68, top: -68 }}
          />
          <div
            className="absolute rounded-full border border-white/30 bg-black/25"
            style={{ width: 84, height: 84, left: -42, top: -42 }}
          />
          {leftStickUI.isSprinting && (
            <svg
              className="absolute overflow-visible"
              style={{ left: 0, top: 0 }}
              width="1"
              height="1"
            >
              <line
                x1="0"
                y1="0"
                x2={leftStickUI.curX - leftStickUI.startX}
                y2={leftStickUI.curY - leftStickUI.startY}
                stroke="#22d3ee"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          )}
          <div
            className={`absolute rounded-full transition-colors ${
              leftStickUI.isSprinting ? 'bg-cyan-400/85 shadow-lg' : 'bg-amber-400/70'
            }`}
            style={{
              width: 34,
              height: 34,
              left: leftStickUI.curX - leftStickUI.startX - 17,
              top: leftStickUI.curY - leftStickUI.startY - 17,
            }}
          >
            {leftStickUI.isSprinting && (
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-cyan-950/90 px-1 py-0.2 text-[8px] font-mono font-black text-cyan-300 border border-cyan-400/50">
                ⚡ SPRINT
              </span>
            )}
          </div>
        </div>
      )}

      {/* Right Aim Joystick (100% invisible until touched) */}
      {rightStickUI && (
        <div
          className="pointer-events-none fixed z-30 rounded-full border border-red-400/35 bg-black/20"
          style={{ width: 96, height: 96, left: rightStickUI.startX - 48, top: rightStickUI.startY - 48 }}
        >
          <div
            className="rounded-full bg-red-500/70"
            style={{
              width: 34,
              height: 34,
              transform: `translate(${rightStickUI.curX - rightStickUI.startX + 31}px, ${rightStickUI.curY - rightStickUI.startY + 31}px)`,
            }}
          />
        </div>
      )}

      {/* ================= LANDSCAPE 2-COLUMN TITLE SCREEN OVERLAY (AUTO-SCALED FOR MOBILE) ================= */}
      {hud.status === 'menu' && !lobbyMode && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-2">
          <div
            style={{ transform: `scale(${uiScale})`, transformOrigin: 'center center' }}
            className="w-full max-w-2xl rounded-xl border-2 border-slate-700/80 bg-slate-900/95 p-3 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2.5">
              <div>
                <span className="text-[9px] font-mono uppercase tracking-widest text-amber-400">
                  OPERACIÓN HYDRA • WEBRTC P2P • 115+ CASAS AMUEBLADAS (3-5 CUARTOS)
                </span>
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
                  SURVEV PVE: TACTICAL STRIKE
                </h1>
              </div>
              <Crosshair className="w-6 h-6 text-amber-400 shrink-0" />
            </div>

            {/* 2-Column Landscape Layout so nothing overflows on 640x360 phones */}
            <div className="grid grid-cols-2 gap-2.5 items-stretch">
              {/* Left Column: Callsign & PeerJS P2P Multiplayer */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <label className="text-[9px] font-mono uppercase tracking-wider text-slate-400">
                      INDICATIVO OPERADOR
                    </label>
                    <input
                      type="text"
                      maxLength={12}
                      value={operatorCallsign}
                      onChange={(e) => setOperatorCallsign(e.target.value.toUpperCase())}
                      className="w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-mono font-bold text-amber-300 focus:border-amber-400 focus:outline-none text-right"
                    />
                  </div>

                  <p className="text-[10px] text-slate-300 leading-snug mb-2">
                    Mapa <span className="text-amber-300 font-mono">20,000x20,000</span> con 16 pueblos, vehículos, farolas, ciclo solar continuo e IA autónoma por voz/chat.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <button
                    onClick={handleCreateRoom}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/60 bg-emerald-500/15 py-1.5 px-2 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25 transition cursor-pointer"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    [CREAR SALA MULTIJUGADOR]
                  </button>
                  <button
                    onClick={() => setLobbyMode('join')}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-sky-500/60 bg-sky-500/15 py-1.5 px-2 text-[10px] font-bold text-sky-300 hover:bg-sky-500/25 transition cursor-pointer"
                  >
                    <Users className="w-3.5 h-3.5" />
                    [UNIRSE CON CÓDIGO]
                  </button>
                </div>
              </div>

              {/* Right Column: Biome, Squad Size & Deploy Button */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 flex flex-col justify-between">
                <div>
                  <label className="block text-[9px] font-mono uppercase text-slate-400 mb-1">
                    BIOMA TÁCTICO (115+ EDIFICIOS • 14 TIENDAS)
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 mb-2">
                    {Object.values(BIOMES).map((b) => (
                      <button
                        key={b.id}
                        onClick={() => setSelectedBiome(b.id)}
                        className={`rounded border px-2 py-1 text-left transition cursor-pointer ${
                          selectedBiome === b.id
                            ? 'border-amber-400 bg-amber-500/15 text-white'
                            : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-xs border border-black/40 shrink-0"
                            style={{ backgroundColor: b.bg }}
                          />
                          <span className="text-[10px] font-bold truncate">{b.name}</span>
                        </div>
                      </button>
                    ))}
                  </div>

                  <label className="block text-[9px] font-mono uppercase text-slate-400 mb-1">
                    ESCUADRÓN IA (LOGAN, WYATT, NOLAN, BRODY)
                  </label>
                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    {[0, 2, 4].map((cnt) => (
                      <button
                        key={cnt}
                        onClick={() => setSelectedSquadSize(cnt)}
                        className={`rounded border px-1.5 py-1 text-[10px] font-bold transition cursor-pointer ${
                          selectedSquadSize === cnt
                            ? 'border-sky-400 bg-sky-500/15 text-white'
                            : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        {cnt === 0 ? 'SOLO' : `${cnt} BOTS`}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => engineRef.current?.startGame(selectedBiome, selectedSquadSize)}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold py-2 px-3 text-xs tracking-wide shadow-lg transition cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  DESPLEGAR ESCUADRÓN
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= PEERJS WEBRTC P2P LOBBY & HOST ROOM CONFIGURATION MODAL ================= */}
      {lobbyMode && hud.status === 'menu' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2">
          <div
            style={{ transform: `scale(${uiScale})`, transformOrigin: 'center center' }}
            className="w-full max-w-2xl rounded-xl border-2 border-slate-700 bg-slate-900 p-3 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-400" />
                <h2 className="text-xs sm:text-sm font-extrabold text-white">
                  {lobbyMode === 'join'
                    ? 'CONECTAR A SALA REMOTA (PEERJS P2P)'
                    : 'SALA MULTIJUGADOR P2P • CONFIGURACIÓN DEL HOST'}
                </h2>
              </div>
              <button
                onClick={() => setLobbyMode(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {lobbyMode === 'join' ? (
              <form onSubmit={handleJoinRoomSubmit} className="space-y-2.5">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    DIGITA EL CÓDIGO DE 4 LETRAS DEL HOST (`survev-room-XXXX`):
                  </label>
                  <input
                    type="text"
                    maxLength={4}
                    placeholder="X7K9"
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                    className="w-full rounded-lg border-2 border-sky-500/60 bg-slate-950 py-2 text-center text-xl font-mono font-black tracking-[0.35em] text-sky-300 focus:border-sky-400 focus:outline-none"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setLobbyMode(null)}
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-800 py-2 text-xs font-bold text-slate-300 cursor-pointer"
                  >
                    CANCELAR
                  </button>
                  <button
                    type="submit"
                    disabled={joinCodeInput.trim().length !== 4}
                    className="flex-1 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-40 py-2 text-xs font-extrabold text-slate-950 cursor-pointer"
                  >
                    CONECTAR P2P
                  </button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {/* Left Column: Room Code & Connected Operators */}
                <div className="space-y-2 flex flex-col justify-between">
                  <div className="flex items-center justify-between rounded-lg border border-emerald-500/50 bg-slate-950 px-2.5 py-1.5">
                    <div>
                      <div className="text-[8px] font-mono uppercase text-slate-400">
                        ID PEERJS: survev-room-{hud.roomCode || 'X7K9'}
                      </div>
                      <div className="text-lg font-mono font-black tracking-[0.25em] text-emerald-400">
                        {hud.roomCode || 'X7K9'}
                      </div>
                    </div>
                    <button
                      onClick={copyRoomCode}
                      className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2 py-1 text-[10px] font-mono font-bold text-slate-200 cursor-pointer"
                    >
                      {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      {copiedCode ? 'OK' : 'COPIAR'}
                    </button>
                  </div>

                  <div>
                    <div className="text-[9px] font-mono uppercase text-slate-400 mb-1">
                      OPERADORES ({hud.roomPlayers?.length || 1}/4) • SEMILLA #{roomConfig.mapSeed}
                    </div>
                    <div className="space-y-1">
                      {(hud.roomPlayers?.length
                        ? hud.roomPlayers
                        : [{ id: 'self', name: operatorCallsign, role: 'HOST P2P', color: '#fde047' }]
                      ).map((rp) => (
                        <div
                          key={rp.id}
                          className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/75 px-2 py-1"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-black"
                              style={{ backgroundColor: rp.color || '#fde047' }}
                            />
                            <span className="text-[11px] font-bold text-white">{rp.name}</span>
                          </div>
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[8px] font-mono font-bold text-emerald-300">
                            {rp.role || 'CONECTADO'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {hud.isHost ? (
                    <button
                      onClick={() => {
                        setLobbyMode(null);
                        engineRef.current?.startGame(roomConfig.biomeId, roomConfig.squadSize);
                      }}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 py-2 text-xs font-extrabold text-slate-950 tracking-wide transition cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      INICIAR OPERACIÓN P2P
                    </button>
                  ) : (
                    <div className="w-full flex items-center justify-center gap-2 rounded-lg bg-sky-500/20 border border-sky-400/50 py-2 text-xs font-bold text-sky-300">
                      <div className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse" />
                      ESPERANDO AL HOST PARA INICIAR...
                    </div>
                  )}
                </div>

                {/* Right Column: Host Room Configuration */}
                <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-[9px] font-mono">
                  <div>
                    <label className="block text-slate-400 mb-0.5">BIOMA</label>
                    <select
                      disabled={!hud.isHost}
                      value={roomConfig.biomeId}
                      onChange={(e) => {
                        setSelectedBiome(e.target.value);
                        engineRef.current?.updateRoomConfig({ biomeId: e.target.value });
                      }}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-1 text-white"
                    >
                      <option value="forest">Bosque</option>
                      <option value="desert">Sabana</option>
                      <option value="snow">Ártico</option>
                      <option value="cobalt">Cobalto</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-0.5">DIFICULTAD</label>
                    <select
                      disabled={!hud.isHost}
                      value={roomConfig.difficulty}
                      onChange={(e) => engineRef.current?.updateRoomConfig({ difficulty: e.target.value })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-1 text-amber-300"
                    >
                      <option value="normal">Normal (1.0x)</option>
                      <option value="veteran">Veterano (1.4x)</option>
                      <option value="nightmare">Pesadilla (2.0x)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-0.5">BOTS IA</label>
                    <select
                      disabled={!hud.isHost}
                      value={roomConfig.squadSize}
                      onChange={(e) => {
                        const sz = Number(e.target.value);
                        setSelectedSquadSize(sz);
                        engineRef.current?.updateRoomConfig({ squadSize: sz });
                      }}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-1 text-sky-300"
                    >
                      <option value={0}>0 Bots</option>
                      <option value={2}>2 Bots IA</option>
                      <option value={4}>4 Bots IA</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-0.5">CRÉDITOS</label>
                    <select
                      disabled={!hud.isHost}
                      value={roomConfig.startingCredits}
                      onChange={(e) => engineRef.current?.updateRoomConfig({ startingCredits: Number(e.target.value) })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-1 text-emerald-300"
                    >
                      <option value={100}>$100</option>
                      <option value={500}>$500</option>
                      <option value={1000}>$1,000</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-0.5">FUEGO AMIGO</label>
                    <select
                      disabled={!hud.isHost}
                      value={roomConfig.friendlyFire ? 'on' : 'off'}
                      onChange={(e) => engineRef.current?.updateRoomConfig({ friendlyFire: e.target.value === 'on' })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-1 text-white"
                    >
                      <option value="off">No</option>
                      <option value="on">Sí</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-0.5">CICLO SOLAR</label>
                    <select
                      disabled={!hud.isHost}
                      value={roomConfig.dayCycleSpeed}
                      onChange={(e) => engineRef.current?.updateRoomConfig({ dayCycleSpeed: e.target.value })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-1 text-white"
                    >
                      <option value="normal">Normal</option>
                      <option value="fast">Rápido</option>
                      <option value="day_only">Solo Día</option>
                      <option value="night_only">Solo Noche</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= AUTO-SCALED SAFE-AREA HUD (HIDDEN IN MENU) ================= */}
      {hud.status !== 'menu' && (
        <>
          {/* 1. TOP-LEFT: 68x68 Minimap + Horizontal Squad Pills + [⚡ Órdenes] Dropdown */}
          <div
            style={{
              top: 'max(6px, env(safe-area-inset-top))',
              left: 'max(8px, env(safe-area-inset-left))',
              transform: `scale(${uiScale})`,
              transformOrigin: 'top left',
            }}
            className="hud-interactive fixed z-20 flex items-start gap-1"
          >
            <button
              onClick={() => {
                const eng = engineRef.current;
                if (!eng) return;
                eng.globalMapOpen = !eng.globalMapOpen;
                eng.syncHudImmediate();
              }}
              title="Abrir Mapa Global [M]"
              className="relative w-[68px] h-[68px] shrink-0 rounded border border-slate-700/80 bg-slate-950/75 overflow-hidden shadow cursor-pointer"
            >
              <canvas ref={minimapRef} width={68} height={68} className="block w-full h-full" />
              <span className="absolute bottom-0 left-0.5 text-[7px] font-mono text-amber-300">
                [M] {player.scope}x
              </span>
              {hud.roomCode && (
                <span className="absolute top-0 right-0.5 text-[7px] font-mono font-bold text-emerald-400">
                  #{hud.roomCode}
                </span>
              )}
            </button>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 flex-wrap">
                {allies.map((bot) => (
                  <div
                    key={bot.id}
                    className="rounded border border-slate-800/80 bg-black/55 px-1.5 py-0.5 text-[8px] font-mono min-w-[46px]"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-slate-200 truncate max-w-[34px]">{bot.name}</span>
                      <span className={bot.downed ? 'text-red-400 font-bold' : 'text-emerald-400'}>
                        {bot.downed ? 'SOS' : `${Math.round((bot.hp / bot.maxHp) * 100)}%`}
                      </span>
                    </div>
                    <div className="w-full h-[2.5px] bg-slate-800 rounded-full overflow-hidden mt-0.5">
                      <div
                        className={bot.downed ? 'bg-red-500 h-full' : 'bg-emerald-400 h-full'}
                        style={{ width: `${Math.max(0, Math.min(100, (bot.hp / bot.maxHp) * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}

                <div className="relative">
                  <button
                    onClick={() => setOrdersMenuOpen((prev) => !prev)}
                    className="h-6 px-2 rounded border border-amber-500/50 bg-black/60 hover:bg-amber-500/20 text-[9px] font-mono font-bold text-amber-300 flex items-center gap-1 cursor-pointer"
                  >
                    <span>⚡ Órdenes:</span>
                    <span className="uppercase">{AI_ORDERS.find((o) => o.id === hud.squadCommand)?.label || 'Libre'}</span>
                  </button>

                  {ordersMenuOpen && (
                    <div className="absolute left-0 top-7 z-30 flex items-center gap-1 rounded border border-slate-700 bg-slate-950/95 p-1 shadow-xl">
                      {AI_ORDERS.map((ord) => (
                        <button
                          key={ord.id}
                          onClick={() => {
                            engineRef.current?.setSquadCommand(ord.id);
                            setOrdersMenuOpen(false);
                          }}
                          className={`rounded px-1.5 py-1 text-[8px] font-mono font-bold whitespace-nowrap cursor-pointer ${
                            hud.squadCommand === ord.id
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {ord.icon} {ord.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 2. TOP-RIGHT: Single-Line Compact Bar */}
          <div
            style={{
              top: 'max(6px, env(safe-area-inset-top))',
              right: 'max(8px, env(safe-area-inset-right))',
              transform: `scale(${uiScale})`,
              transformOrigin: 'top right',
            }}
            className="hud-interactive fixed z-20 h-6 px-2 text-[9px] font-mono flex items-center gap-2 bg-black/60 border border-slate-800/80 rounded"
          >
            <span className="text-amber-200 font-semibold">{hud.timeLabel}</span>
            <span className="text-slate-400">
              Ronda <strong className="text-amber-400">{hud.wave}</strong>
            </span>
            <span className="text-slate-400">
              🧟 <strong className="text-red-400">{hud.zombiesAlive}</strong>
            </span>
            <span className="text-emerald-400 font-bold">${player.credits}</span>
            <button
              onClick={() => setSettingsOpen((prev) => !prev)}
              title="Configuración / Controles [⚙️]"
              className="hover:text-amber-300 cursor-pointer px-0.5"
            >
              [⚙️]
            </button>
          </div>

          {/* Wave / VIP Contract Banner */}
          {hud.waveBanner && (
            <div
              style={{
                top: 'max(34px, calc(env(safe-area-inset-top) + 28px))',
                transform: `translateX(-50%) scale(${uiScale})`,
                transformOrigin: 'top center',
              }}
              className="pointer-events-none fixed left-1/2 z-20 rounded border border-amber-500/50 bg-black/65 px-2.5 py-0.5 text-[9px] font-mono font-bold tracking-wider text-amber-300 whitespace-nowrap"
            >
              {hud.waveBanner}
            </div>
          )}

          {/* 3. BOTTOM-CENTER: Shop/Vehicle/Bunker Indicators + Medical/Reload Progress Pills + 140px x 26px Micro-Cluster */}
          <div
            style={{
              bottom: 'max(6px, env(safe-area-inset-bottom))',
              transform: `translateX(-50%) scale(${uiScale})`,
              transformOrigin: 'bottom center',
            }}
            className="fixed left-1/2 z-20 flex flex-col items-center gap-1 pointer-events-none"
          >
            {/* Active Underground Bunker Badge */}
            {player.inBunker && player.activeBunkerName && (
              <div className="rounded border border-amber-500/70 bg-slate-950/90 px-2 py-0.5 text-[7.5px] font-mono font-bold text-amber-300 shadow">
                🛡️ {player.activeBunkerName}
              </div>
            )}

            {/* Shop Proximity Indicator (Appears when within 210px of any of the 14 Vendor Stations) */}
            {hud.nearbyVendor && !hud.shopOpen && (
              <button
                onClick={() => {
                  const eng = engineRef.current;
                  if (!eng) return;
                  eng.shopOpen = true;
                  eng.syncHudImmediate();
                }}
                className="hud-interactive pointer-events-auto rounded border border-sky-400/85 bg-slate-950/90 hover:bg-sky-950/90 px-2 py-0.5 text-[8px] font-mono font-extrabold text-sky-300 shadow-lg flex items-center gap-1 cursor-pointer"
              >
                <span>🛒 {hud.nearbyVendor.name}</span>
                <span className="text-amber-300">[B] / [F] ABRIR</span>
              </button>
            )}

            {/* Driveable Vehicle Status / Proximity Indicator */}
            {hud.drivingVehicle ? (
              <button
                onClick={() => engineRef.current?.exitVehicle()}
                className="hud-interactive pointer-events-auto rounded border border-emerald-400/85 bg-slate-950/90 px-2 py-0.5 text-[8px] font-mono font-extrabold text-emerald-300 shadow-lg flex items-center gap-1.5 cursor-pointer"
              >
                <span>🚙 {hud.drivingVehicle.name}</span>
                <span className="text-slate-300">
                  HP {hud.drivingVehicle.hp}/{hud.drivingVehicle.maxHp}
                </span>
                <span className="text-amber-300">[F] SALIR</span>
              </button>
            ) : (
              hud.nearbyVehicle && (
                <button
                  onClick={() => engineRef.current?.interact()}
                  className="hud-interactive pointer-events-auto rounded border border-amber-400/85 bg-slate-950/90 px-2 py-0.5 text-[8px] font-mono font-extrabold text-amber-300 shadow-lg flex items-center gap-1 cursor-pointer"
                >
                  <span>🚙 [F] CONDUCIR {hud.nearbyVehicle.name.toUpperCase()}</span>
                </button>
              )
            )}

            {/* Visual Medical / Consumable Usage Progress Pill on HUD */}
            {player.activeHeal && (
              <div className="w-[156px] rounded border border-emerald-400/85 bg-slate-950/90 px-1.5 py-0.5 shadow-lg">
                <div className="flex items-center justify-between text-[7.5px] font-mono font-extrabold text-emerald-300 mb-0.5">
                  <span>
                    ✚ {player.activeHeal.name.toUpperCase()} {player.activeHeal.timeLeft}s
                  </span>
                  <span>({Math.round((player.activeHeal.progress || 0) * 100)}%)</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-xs overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-75"
                    style={{ width: `${Math.round((player.activeHeal.progress || 0) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Visual Reload Progress Pill on HUD */}
            {player.reloading && (
              <div className="w-[156px] rounded border border-amber-400/80 bg-slate-950/90 px-1.5 py-0.5 shadow-lg">
                <div className="flex items-center justify-between text-[7.5px] font-mono font-extrabold text-amber-300 mb-0.5">
                  <span>🔄 RECARGANDO {player.reloadTimeLeft}s</span>
                  <span>({Math.round((player.reloadProgress || 0) * 100)}%)</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-xs overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-all duration-75"
                    style={{ width: `${Math.round((player.reloadProgress || 0) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="w-[140px] h-[26px] rounded border border-slate-800/75 bg-black/55 px-1.5 py-0.5 flex flex-col justify-between">
              <div className="flex items-center justify-between text-[7.5px] font-mono leading-none">
                <span className="text-slate-200 font-bold truncate max-w-[66px]">
                  {player.reloading
                    ? 'RECARGA'
                    : player.staminaExhausted
                    ? 'AGOTADO'
                    : player.activeWeaponName.split(' ')[0]}
                </span>
                <span className="text-sky-300">
                  🪖{player.helmetLevel} 🦺{player.armorLevel} 🎒{player.backpackLevel}
                </span>
                <span className="text-amber-400 font-bold">
                  {player.currentMag}
                  {player.currentReserve !== '' ? `/${player.currentReserve}` : ''}
                </span>
              </div>

              {/* HP Bar */}
              <div className="w-full h-1.5 bg-slate-900 rounded-xs overflow-hidden">
                <div
                  className={`h-full ${
                    player.hp > 50 ? 'bg-emerald-500' : player.hp > 25 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100))}%` }}
                />
              </div>

              {/* Adrenaline & Stamina (Red when Exhausted Lockout is active until 25% recovery) */}
              <div className="grid grid-cols-2 gap-0.5">
                <div className="w-full h-1 bg-slate-900 rounded-xs overflow-hidden">
                  <div
                    className="h-full bg-orange-400"
                    style={{ width: `${Math.max(0, Math.min(100, player.adrenaline))}%` }}
                  />
                </div>
                <div className="w-full h-1 bg-slate-900 rounded-xs overflow-hidden">
                  <div
                    className={`h-full ${player.staminaExhausted ? 'bg-red-500' : 'bg-sky-400'}`}
                    style={{ width: `${Math.max(0, Math.min(100, player.stamina))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 4. BOTTOM-RIGHT: Action Arc + Ammo/Meds + 46x28 Weapon Slots */}
          <div
            style={{
              bottom: 'max(6px, env(safe-area-inset-bottom))',
              right: 'max(8px, env(safe-area-inset-right))',
              transform: `scale(${uiScale})`,
              transformOrigin: 'bottom right',
            }}
            className="hud-interactive fixed z-20 flex flex-col items-end"
          >
            {/* Ergonomic Arc of 32x32 Action Buttons */}
            <div className="flex items-center gap-1 mb-1">
              {player.slots[4]?.id === 'barricade' && (
                <button
                  onClick={() => engineRef.current?.rotateBarricade()}
                  title="Rotar Barricada (0° / 90° / 180° / 270°) [V]"
                  className="h-8 px-2 rounded-full bg-black/55 border border-amber-400/55 hover:bg-amber-500/25 text-[9px] font-mono font-bold text-amber-300 flex items-center justify-center cursor-pointer"
                >
                  ↻{player.barricadeRotation}°
                </button>
              )}
              <button
                onClick={() => engineRef.current?.startReload()}
                title="Recargar [R]"
                className="w-8 h-8 rounded-full bg-black/45 border border-white/25 hover:bg-white/15 text-[10px] font-mono font-bold text-amber-300 flex items-center justify-center cursor-pointer"
              >
                R
              </button>
              <button
                onClick={() => engineRef.current?.interact()}
                title="Interactuar / Vehículo / Búnker / Reanimar [F]"
                className="w-8 h-8 rounded-full bg-black/45 border border-white/25 hover:bg-white/15 text-[10px] font-mono font-bold text-emerald-300 flex items-center justify-center cursor-pointer -translate-y-1"
              >
                F
              </button>
              <button
                onClick={() => engineRef.current?.throwActiveGrenade()}
                title="Usar Slot 4 (Plantar Torreta / Barricada / Granada) [G]"
                className="w-8 h-8 rounded-full bg-black/45 border border-emerald-400/45 hover:bg-emerald-500/25 text-[10px] font-mono font-bold text-emerald-400 flex items-center justify-center cursor-pointer -translate-y-1.5"
              >
                G
              </button>
              <button
                onClick={() => {
                  const eng = engineRef.current;
                  if (!eng) return;
                  eng.shopOpen = !eng.shopOpen;
                  eng.syncHudImmediate();
                }}
                title="Tienda Táctica [B]"
                className="w-8 h-8 rounded-full bg-black/45 border border-sky-400/45 hover:bg-sky-500/25 text-[10px] flex items-center justify-center cursor-pointer -translate-y-1"
              >
                🛒
              </button>
              <button
                onClick={() => setChatOpen((prev) => !prev)}
                title="Radio Chat Escuadrón [T]"
                className="w-8 h-8 rounded-full bg-black/45 border border-white/25 hover:bg-white/15 text-[10px] font-mono font-bold text-sky-300 flex items-center justify-center cursor-pointer"
              >
                T
              </button>
            </div>

            {/* Backpack Capacity Bar & Indicator */}
            <div className="flex items-center gap-1.5 mb-0.5 px-1.5 py-0.5 rounded bg-black/60 border border-slate-800 text-[8px] font-mono">
              <span className="text-slate-300 font-bold">
                🎒 {player.backpackName || `Mochila Nv.${player.backpackLevel || 0}`}:
              </span>
              <span
                className={`font-extrabold ${
                  (player.inventoryUsed || 0) >= (player.inventoryMax || 60) * 0.92
                    ? 'text-rose-400'
                    : (player.inventoryUsed || 0) >= (player.inventoryMax || 60) * 0.75
                    ? 'text-amber-300'
                    : 'text-emerald-400'
                }`}
              >
                {player.inventoryUsed ?? 0}/{player.inventoryMax ?? 60}
              </span>
              <div className="w-14 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    (player.inventoryUsed || 0) >= (player.inventoryMax || 60) * 0.92
                      ? 'bg-rose-500'
                      : (player.inventoryUsed || 0) >= (player.inventoryMax || 60) * 0.75
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(((player.inventoryUsed || 0) / Math.max(1, player.inventoryMax || 60)) * 100)
                    )}%`,
                  }}
                />
              </div>
            </div>

            {/* Compact row of Ammo & Meds */}
            <div className="flex items-center gap-0.5 mb-0.5 text-[8px] font-mono">
              {Object.entries(player.ammo).map(([cal, count]) => (
                <button
                  key={cal}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    engineRef.current?.dropInventoryItem('ammo', cal);
                  }}
                  onPointerDown={() => handleDropHoldStart('ammo', cal)}
                  onPointerUp={handleDropHoldEnd}
                  onPointerLeave={handleDropHoldEnd}
                  title={`Click Der. o Mantener 400ms para soltar ${cal}`}
                  className="rounded bg-black/55 border border-slate-800 px-1 py-0.2 flex items-center gap-0.5 cursor-pointer"
                >
                  <span className="w-1.5 h-1.5 rounded-xs" style={{ backgroundColor: AMMO_COLORS[cal] }} />
                  <span className="text-slate-100 font-bold">{count}</span>
                </button>
              ))}
              {Object.values(MEDICAL_ITEMS).map((m) => (
                <button
                  key={m.id}
                  onClick={() => engineRef.current?.useMedicalItem(m.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    engineRef.current?.dropInventoryItem('med', m.id);
                  }}
                  onPointerDown={() => handleDropHoldStart('med', m.id)}
                  onPointerUp={handleDropHoldEnd}
                  onPointerLeave={handleDropHoldEnd}
                  title={`Click: Usar ${m.name} | Click Der./400ms: Soltar`}
                  className="rounded bg-black/55 border border-slate-700/80 hover:bg-slate-800 px-1 py-0.2 flex items-center gap-0.5 cursor-pointer"
                >
                  <span className="text-amber-300">{m.label}</span>
                  <span className="font-bold text-emerald-400">{player.meds[m.id] || 0}</span>
                </button>
              ))}
            </div>

            {/* 4 Weapon Slots */}
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4].map((slotNum) => {
                const sData = player.slots[slotNum];
                const active = player.activeSlot === slotNum;
                return (
                  <button
                    key={slotNum}
                    onClick={() => {
                      if (slotNum === 4 && active) {
                        engineRef.current?.cycleThrowable();
                      } else {
                        engineRef.current?.switchSlot(slotNum);
                      }
                    }}
                    onContextMenu={(e) => {
                      if (slotNum === 4 && sData?.id) {
                        e.preventDefault();
                        engineRef.current?.dropInventoryItem('throwable', sData.id);
                      }
                    }}
                    title={
                      slotNum === 4
                        ? `Click: Equipar/Cambiar • Click Der.: Soltar 1 ${sData.name}`
                        : `Equipar [${slotNum}] ${sData.name}`
                    }
                    className={`w-[46px] h-[28px] text-[8px] font-mono rounded border px-1 flex flex-col justify-center leading-tight transition cursor-pointer ${
                      active
                        ? 'border-amber-400 bg-amber-500/25 text-white'
                        : 'border-slate-800/80 bg-black/50 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[7px] text-slate-400">
                      <span>[{slotNum}]</span>
                      {slotNum === 4 && <span className="text-emerald-400 font-bold">x{sData.count}</span>}
                    </div>
                    <div className="font-bold truncate w-full text-left">{sData.name}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ================= TACTICAL RADIO CHAT OVERLAY ([T]) ================= */}
      {chatOpen && hud.status === 'playing' && (
        <div
          style={{
            left: 'max(8px, env(safe-area-inset-left))',
            bottom: 'max(42px, calc(env(safe-area-inset-bottom) + 36px))',
            transform: `scale(${uiScale})`,
            transformOrigin: 'bottom left',
          }}
          className="hud-interactive fixed z-30 w-64 rounded-lg border border-slate-700 bg-slate-950/95 p-2 shadow-xl text-[10px] font-mono"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1">
            <span className="font-bold text-sky-400 flex items-center gap-1">
              <MessageSquare className="w-3 h-3" /> RADIO ESCUADRÓN P2P
            </span>
            <button onClick={() => setChatOpen(false)} className="text-slate-400 hover:text-white cursor-pointer">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="max-h-24 overflow-y-auto space-y-1 mb-1.5">
            {hud.chatMessages.map((m) => (
              <div key={m.id} className="leading-tight">
                <span className="text-amber-400 font-bold">{m.sender}: </span>
                <span className="text-slate-200">{m.text}</span>
              </div>
            ))}
          </div>
          <form onSubmit={handleSendChat} className="flex gap-1">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder='Ej: "vete a lotear", "dame soda"...'
              className="flex-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-white focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              className="rounded bg-sky-500 px-2 py-1 font-bold text-slate-950 cursor-pointer"
            >
              OK
            </button>
          </form>
        </div>
      )}

      {/* ================= GLOBAL MAP MODAL ([M]) ================= */}
      {hud.globalMapOpen && hud.status === 'playing' && (
        <div className="hud-interactive fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-2">
          <div
            style={{ transform: `scale(${uiScale})`, transformOrigin: 'center center' }}
            className="rounded-xl border-2 border-amber-500/60 bg-slate-900 p-3 shadow-2xl max-w-md w-full"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-white">
                <MapIcon className="w-4 h-4 text-amber-400" />
                MAPA TÁCTICO GLOBAL (20,000 x 20,000)
              </div>
              <button
                onClick={() => {
                  engineRef.current.globalMapOpen = false;
                  engineRef.current.syncHudImmediate();
                }}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="relative w-full aspect-square max-h-[62dvh] mx-auto rounded border border-slate-700 overflow-hidden bg-slate-950">
              <canvas ref={globalMapRef} width={360} height={360} className="block w-full h-full" />
            </div>
            <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-slate-300">
              <span>🟡 Operador</span>
              <span>🔵 14 Tiendas (🛒)</span>
              <span>🟠 5 Búnkeres</span>
              <span>🔴 Infectados</span>
            </div>
          </div>
        </div>
      )}

      {/* ================= TACTICAL VENDOR MODAL (2-COLUMN LANDSCAPE, AUTO-SCALED) ================= */}
      {hud.shopOpen && hud.status === 'playing' && (
        <div className="hud-interactive fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-2">
          <div
            style={{ transform: `scale(${uiScale})`, transformOrigin: 'center center' }}
            className="w-full max-w-2xl rounded-xl border-2 border-sky-500/60 bg-slate-900 p-3 shadow-2xl max-h-[88dvh] flex flex-col"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 shrink-0">
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-sky-400" />
                  <h2 className="text-xs sm:text-sm font-extrabold tracking-wide text-white">
                    ESTACIÓN DE COMPRA TÁCTICA — CRÉDITOS:{' '}
                    <span className="text-emerald-400 font-mono">${player.credits}</span>
                  </h2>
                </div>
                <div className="flex items-center gap-2 text-[9px] font-mono text-slate-300">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-sky-300">
                    🎒 Capacidad: {player.inventoryUsed ?? 0}/{player.inventoryMax ?? 60}
                  </span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-amber-300">
                    🔄 Reabastecimiento: Ronda {hud.nextRestockWave ?? 5}
                  </span>
                </div>
              </div>
              <button
                onClick={() => {
                  engineRef.current.shopOpen = false;
                  engineRef.current.syncHudImmediate();
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* WEAPON-SPECIFIC AMMO REFILL SECTION (EXACT MISSING ROUNDS) */}
            {hud.weaponRefillQuotes && hud.weaponRefillQuotes.length > 0 && (
              <div className="mt-2 rounded-lg border border-sky-500/40 bg-slate-950/90 p-2 shrink-0">
                <div className="text-[9px] font-mono font-bold text-sky-400 mb-1.5 flex items-center justify-between">
                  <span>🔫 RECARGA DE MUNICIÓN POR ARMA EQUIPADA (COMPRA EXACTA DE FALTANTES)</span>
                  <span className="text-slate-400">Calculado según reserva y espacio de mochila</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {hud.weaponRefillQuotes.map((q) => {
                    const canBuyRefill =
                      q.canRefill &&
                      q.roundsToBuy > 0 &&
                      q.stockLeft > 0 &&
                      player.credits >= q.price;
                    return (
                      <div
                        key={q.slotNum}
                        className="flex items-center justify-between rounded border border-slate-800 bg-slate-900/90 px-2 py-1.5"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-1.5 text-[9.5px] font-bold text-white">
                            <span className="text-amber-400 font-mono">[{q.slotNum}]</span>
                            <span className="truncate">{q.weaponName}</span>
                            <span className="rounded bg-slate-800 px-1 text-[8px] font-mono text-sky-300">
                              {q.ammoType}
                            </span>
                            <span className="text-[8px] font-mono text-slate-400">
                              [Stock: {q.stockLeft}]
                            </span>
                          </div>
                          <div className="text-[8px] font-mono text-slate-400 mt-0.5">
                            Reserva: <span className="text-slate-200">{q.currentReserve}/{q.maxReserve}</span>
                            {q.roundsToBuy > 0 && (
                              <span className="text-emerald-400 font-bold ml-1.5">
                                (+{q.roundsToBuy} cartuchos)
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          disabled={!canBuyRefill}
                          onClick={() => engineRef.current?.buyWeaponAmmoRefill(q.slotNum)}
                          className={`shrink-0 rounded px-2 py-1 text-[9px] font-mono font-bold transition cursor-pointer ${
                            canBuyRefill
                              ? 'bg-sky-500 hover:bg-sky-400 text-slate-950'
                              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          {q.reason === 'RESERVA AL MÁXIMO'
                            ? 'LLENO'
                            : q.reason === 'MOCHILA LLENA'
                            ? 'SIN ESPACIO'
                            : q.stockLeft <= 0
                            ? 'AGOTADO'
                            : `Recargar $${q.price}`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-2 grid grid-cols-2 gap-2 overflow-y-auto pr-1">
              {SHOP_ITEMS.map((item) => {
                const isFlashSale = hud.flashSaleIds?.includes(item.id);
                const effectivePrice = isFlashSale ? Math.round(item.price * 0.6) : item.price;
                const stockLeft = hud.shopStock?.[item.id] ?? item.maxStock ?? 1;
                const waveLocked = (item.minWave || 1) > hud.wave;
                const canAfford = player.credits >= effectivePrice && stockLeft > 0 && !waveLocked;

                return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between rounded-lg border p-2 ${
                      isFlashSale
                        ? 'border-amber-400/70 bg-amber-950/20'
                        : 'border-slate-800 bg-slate-950/80'
                    }`}
                  >
                    <div className="pr-2 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] font-bold text-white truncate">{item.name}</span>
                        {isFlashSale && (
                          <span className="rounded bg-amber-400 px-1 py-0.2 text-[8px] font-mono font-black text-slate-950">
                            🔥 -40%
                          </span>
                        )}
                        <span className="text-[8px] font-mono text-slate-400">
                          [Stock: {stockLeft}]
                        </span>
                      </div>
                      <div className="text-[8.5px] text-slate-400 mt-0.5 leading-tight">{item.desc}</div>
                    </div>
                    <button
                      disabled={!canAfford}
                      onClick={() => engineRef.current?.buyShopItem(item.id)}
                      className={`shrink-0 rounded px-2 py-1 text-[9.5px] font-mono font-bold transition cursor-pointer ${
                        canAfford
                          ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                          : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      {waveLocked ? `Ronda ${item.minWave}+` : stockLeft <= 0 ? 'AGOTADO' : `$${effectivePrice}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ================= SETTINGS / PAUSE MODAL ([⚙️]) ================= */}
      {(settingsOpen || hud.status === 'paused') && (
        <div className="hud-interactive fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-2">
          <div
            style={{ transform: `scale(${uiScale})`, transformOrigin: 'center center' }}
            className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-center max-w-xs w-full space-y-2"
          >
            <h2 className="text-xs font-extrabold text-white">CONFIGURACIÓN TÁCTICA</h2>
            <div className="text-[9.5px] font-mono text-slate-300 space-y-1 text-left bg-slate-950 p-2 rounded border border-slate-800">
              <div>• Mover/Sprint: WASD + Shift / Joystick Doble Zona</div>
              <div>• Armas: [1][2][3][4] • Recargar: [R] • Usar: [F]</div>
              <div>• Plantar Torreta/Barricada: Slot [4] + [G]</div>
              <div>• Soltar Munición/Cura: Click Der. o Mantener 400ms</div>
              <div>• Órdenes por Chat [T]: "vete", "quieto", "dame soda"</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => {
                  soundEngine.muted = !muted;
                  setMuted(!muted);
                }}
                className="rounded-lg border border-slate-700 bg-slate-800 py-1.5 text-xs font-bold text-slate-200 cursor-pointer"
              >
                AUDIO: {muted ? 'SILENCIADO 🔇' : 'ACTIVO 🔊'}
              </button>
              <button
                onClick={() => {
                  setSettingsOpen(false);
                  engineRef.current.status = 'playing';
                  engineRef.current.syncHudImmediate();
                }}
                className="rounded-lg bg-amber-500 py-1.5 text-xs font-bold text-slate-950 cursor-pointer"
              >
                CONTINUAR OPERACIÓN
              </button>
              <button
                onClick={() => {
                  setSettingsOpen(false);
                  engineRef.current.status = 'menu';
                  engineRef.current.syncHudImmediate();
                }}
                className="rounded-lg border border-slate-700 bg-slate-800 py-1.5 text-xs font-bold text-slate-300 cursor-pointer"
              >
                MENÚ PRINCIPAL
              </button>
            </div>
          </div>
        </div>
      )}

      {hud.status === 'gameover' && (
        <div className="hud-interactive fixed inset-0 z-40 flex items-center justify-center bg-red-950/80 p-3">
          <div
            style={{ transform: `scale(${uiScale})`, transformOrigin: 'center center' }}
            className="w-full max-w-sm rounded-xl border-2 border-red-500 bg-slate-900 p-4 text-center shadow-2xl"
          >
            <Skull className="w-9 h-9 text-red-500 mx-auto" />
            <h2 className="mt-1.5 text-lg font-extrabold text-white">ESCUADRÓN CAÍDO</h2>
            <p className="mt-1 text-xs text-slate-300 font-mono">
              RONDA: {hud.wave} • BAJAS: {player.kills} • SCORE: {player.score}
            </p>
            <button
              onClick={() => engineRef.current?.startGame(selectedBiome, selectedSquadSize)}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-400 py-2 text-xs font-extrabold text-slate-950 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              REINTENTAR OPERACIÓN
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function renderMinimap(ctx, engine, w, h, isGlobal = false) {
  const { world, player, allies, remotePlayers, zombies } = engine;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  const scale = w / world.size;

  // River line
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = isGlobal ? 3 : 1.5;
  ctx.beginPath();
  world.riverPoints.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x * scale, p.y * scale);
    else ctx.lineTo(p.x * scale, p.y * scale);
  });
  ctx.stroke();

  // 115+ Multi-room Buildings
  ctx.fillStyle = '#64748b';
  for (const b of world.buildings) {
    ctx.fillRect(b.x * scale, b.y * scale, Math.max(1.5, b.w * scale), Math.max(1.5, b.h * scale));
  }

  // 14 Vendor Stations in Cyan
  ctx.fillStyle = '#38bdf8';
  for (const v of world.vendors || [world.vendor]) {
    ctx.beginPath();
    ctx.arc(v.x * scale, v.y * scale, isGlobal ? 3.2 : 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5 Underground Bunkers in Amber
  ctx.fillStyle = '#f59e0b';
  for (const bk of world.bunkerEntrances || [world.bunkerStairsSurface]) {
    ctx.fillRect(bk.x * scale - 1.5, bk.y * scale - 1.5, isGlobal ? 4 : 2.5, isGlobal ? 4 : 2.5);
  }

  // Zombies & VIP Target
  for (const z of zombies) {
    ctx.fillStyle = z.isVip ? '#fde047' : '#ef4444';
    const sz = z.isVip ? (isGlobal ? 4.5 : 2.5) : isGlobal ? 2.5 : 1.5;
    ctx.fillRect(z.x * scale - sz * 0.5, z.y * scale - sz * 0.5, sz, sz);
  }

  // Allies
  ctx.fillStyle = '#22c55e';
  for (const a of allies) {
    ctx.beginPath();
    ctx.arc(a.x * scale, a.y * scale, isGlobal ? 3 : 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Remote Co-Op Players
  if (remotePlayers && remotePlayers.size > 0) {
    ctx.fillStyle = '#38bdf8';
    for (const rp of remotePlayers.values()) {
      ctx.beginPath();
      ctx.arc(rp.x * scale, rp.y * scale, isGlobal ? 3.5 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Local Player
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.arc(player.x * scale, player.y * scale, isGlobal ? 4 : 2.5, 0, Math.PI * 2);
  ctx.fill();
}
