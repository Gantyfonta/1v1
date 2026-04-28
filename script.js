import * as fb from './firebase-manager.js';

let multiplayer = {
    roomId: null,
    isHost: false,
    opponent: null,
    opponentState: null,
    roomSubscription: null,
    statesSubscription: null,
    lastUpdate: 0,
    updateRate: 100, // ms
    opponentBullets: [],
    status: 'idle'
};

// --- API SYSTEM (Replacement for Firebase) ---
async function fetchHighscores() {
    try {
        const res = await fetch('/api/highscores');
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        console.warn("Could not fetch highscores", e);
        return [];
    }
}

async function postScore(userName, time) {
    try {
        const res = await fetch('/api/highscores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userName, time })
        });
        return await res.json();
    } catch (e) {
        console.error("Score submission failed", e);
        throw e;
    }
}

async function fetchAnnouncement() {
    try {
        const res = await fetch('/api/announcement');
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        // Silently fail as announcements are non-critical
        return null;
    }
}

async function updateAnnouncement(message, active = true) {
    try {
        const res = await fetch('/api/announcement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, active })
        });
        return await res.json();
    } catch (e) {
        console.error("Announcement update failed", e);
        throw e;
    }
}

async function removeScore(index) {
    try {
        await fetch(`/api/highscores/${index}`, { method: 'DELETE' });
    } catch (e) {
        console.error("Score deletion failed", e);
    }
}

// Initialize Announcement - REMOVED AS REQUESTED
// Admin Simulation
let isAdminUser = false;
function updateAdminUI() {
    const adminBtn = document.getElementById('admin-panel-btn');
    const loginLink = document.getElementById('admin-login-link');
    if (isAdminUser) {
        adminBtn.style.display = 'block';
        if (loginLink) loginLink.style.display = 'none';
    } else {
        adminBtn.style.display = 'none';
        if (loginLink) loginLink.style.display = 'block';
    }
}

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = 800;
canvas.height = 400;

const ARENA_FLOOR = 20;

// --- MULTIPLAYER CORE ---
async function signIn() {
    try {
        const user = await fb.loginWithGoogle();
        updateAuthUI(user);
    } catch (e) {
        console.error(e);
    }
}

async function signOut() {
    await fb.signOut();
    updateAuthUI(null);
}

function updateAuthUI(user) {
    const loginBtn = document.getElementById('login-btn');
    const userInfo = document.getElementById('user-info');
    const userName = document.getElementById('user-name');
    const userAvatar = document.getElementById('user-avatar');

    if (user) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (userInfo) userInfo.style.display = 'flex';
        if (userName) userName.innerText = user.displayName;
        if (userAvatar) userAvatar.src = user.photoURL;
    } else {
        if (loginBtn) loginBtn.style.display = 'block';
        if (userInfo) userInfo.style.display = 'none';
    }
}

// Check auth state on load
fb.onAuthStateChanged(fb.auth, (user) => {
    updateAuthUI(user);
});

async function showLobby() {
    if (!fb.auth.currentUser) {
        alert("Please sign in first!");
        return;
    }
    document.getElementById('title-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'flex';
    refreshRoomList();
}

async function refreshRoomList() {
    const list = document.getElementById('room-list');
    const rooms = await fb.getOpenRooms();
    if (rooms && rooms.length > 0) {
        list.style.display = 'block';
        list.innerHTML = '<h4>Joinable Games:</h4>';
        rooms.forEach(room => {
            const btn = document.createElement('button');
            btn.style.width = '100%';
            btn.style.marginBottom = '5px';
            btn.style.fontSize = '12px';
            btn.innerText = `Join ${room.playerNames[room.hostId]}'s Arena`;
            btn.onclick = () => joinRoom(room.id);
            list.appendChild(btn);
        });
    } else {
        list.style.display = 'none';
    }
}

async function createRoom() {
    try {
        const id = await fb.createRoom();
        enterRoom(id, true);
    } catch (e) {
        alert(e.message);
    }
}

async function quickJoin() {
    const rooms = await fb.getOpenRooms();
    if (rooms && rooms.length > 0) {
        joinRoom(rooms[0].id);
    } else {
        createRoom();
    }
}

async function joinRoom(id) {
    try {
        await fb.joinRoom(id);
        enterRoom(id, false);
    } catch (e) {
        alert(e.message);
    }
}

function enterRoom(id, isHost) {
    multiplayer.roomId = id;
    multiplayer.isHost = isHost;
    multiplayer.status = 'waiting';

    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('room-waiting-screen').style.display = 'flex';
    document.getElementById('room-id-display').innerText = `ROOM: ${id}`;

    // Update slots
    const p1 = document.getElementById('player-1-slot');
    const p1Name = p1.querySelector('.slot-name');
    p1Name.innerText = fb.auth.currentUser.displayName;
    
    // Subscribe to room
    multiplayer.roomSubscription = fb.subscribeToRoom(id, (room) => {
        if (room.players.length === 2) {
            const opponentId = room.players.find(uid => uid !== fb.auth.currentUser.uid);
            const p2 = document.getElementById('player-2-slot');
            p2.querySelector('.slot-name').innerText = room.playerNames[opponentId];
            p2.querySelector('.slot-avatar').innerText = '';
            
            if (room.status === 'playing' && multiplayer.status !== 'playing') {
                startMultiplayerGame(room);
            }
        }
    });
}

function startMultiplayerGame(room) {
    multiplayer.status = 'playing';
    multiplayer.opponent = room.players.find(uid => uid !== fb.auth.currentUser.uid);
    
    document.getElementById('room-waiting-screen').style.display = 'none';
    document.getElementById('ui').style.display = 'block';
    document.getElementById('player2-ui').style.display = 'flex';
    document.getElementById('player2-name').innerText = room.playerNames[multiplayer.opponent];
    
    gameState = 'PLAYING';
    initLevel(); // Reset everything
    
    // Set positions
    if (multiplayer.isHost) {
        player.x = 100;
        player.facing = 1;
    } else {
        player.x = 650;
        player.facing = -1;
    }
    
    // Subscribe to state
    multiplayer.statesSubscription = fb.subscribeToPlayerStates(multiplayer.roomId, (states) => {
        if (states[multiplayer.opponent]) {
            multiplayer.opponentState = states[multiplayer.opponent];
            // Multi-bullet sync
            if (multiplayer.opponentState.bullets) {
                // We'll reconcile bullets in the loop
            }
        }
    });

    // Handle game state
    timerRunning = true;
    startTime = Date.now();
}

async function leaveRoom() {
    if (multiplayer.roomId) {
        // Cleanup subscriptions
        if (multiplayer.roomSubscription) multiplayer.roomSubscription();
        if (multiplayer.statesSubscription) multiplayer.statesSubscription();
        
        multiplayer.roomId = null;
        multiplayer.status = 'idle';
    }
    showTitle();
}

// --- 1. SETTINGS & VARIABLES ---
let mobileMode = localStorage.getItem('platformer_mobile') === 'true';
let sfxEnabled = localStorage.getItem('platformer_sfx') !== 'false';
let selectedWeapon = 'GUN';
let DIFFICULTY_SCALING = 1.25; // Global difficulty modifier

// --- CHANNEL SYSTEM ---
let channelStates = {}; // Tracks activation state for lever/button channels
function toggleChannel(id) {
    if (!id && id !== 0) return;
    channelStates[id] = !channelStates[id];
    sfx.click(); // Trigger click sound
}

// --- AUDIO SYSTEM ---
class SoundEngine {
    constructor() {
        this.ctx = null;
    }
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }
    play(freq, duration, type = 'sine', volume = 0.1, ramp = true) {
        if (!sfxEnabled) return;
        this.init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        if (ramp) {
            osc.frequency.exponentialRampToValueAtTime(freq * 0.01, this.ctx.currentTime + duration);
        }
        gain.gain.setValueAtTime(volume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }
    jump() { this.play(500, 0.15, 'sine', 0.12); }
    land() { this.play(100, 0.1, 'triangle', 0.1, false); }
    death() { this.play(200, 0.4, 'sawtooth', 0.1); }
    portal() { this.play(800, 0.2, 'square', 0.06); }
    click() { this.play(1000, 0.05, 'sine', 0.1, false); }
    win() {
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((f, i) => {
            setTimeout(() => this.play(f, 0.3, 'sine', 0.1), i * 100);
        });
    }
}
const sfx = new SoundEngine();

const gravity = 2200;    
const friction = 0.001;  
const acceleration = 2500; 
const coyoteTime = 0.25;
let randomPlatformTimer = 0;

// --- BOSS FIGHT CONSTANTS ---
const PLAYER_MAX_HEALTH_DEFAULT = 10;
const BOSS_MAX_HEALTH = 1250; // Increased difficulty from 750 (originally 1000)
let PLAYER_BULLET_SPEED = 800;
const INVULN_DURATION = 0.8; // Reduced invuln window from 1.2 for more challenge
const BOSS_HIT_RESONANCE = 0.2; // Slightly lower resonance for bullets

// --- BOSS ATTACK CONFIG ---
const ALPHA_PHASES = [
    { threshold: 1.0, attacks: ['BURST', 'CHARGE'] },
    { threshold: 0.5, attacks: ['BURST', 'CHARGE', 'TRIPLE_SHOT', 'SPIRAL'] }
];

const BETA_PHASES = [
    { threshold: 1.0, attacks: ['TRIPLE_SHOT', 'MINES'] },
    { threshold: 0.5, attacks: ['TRIPLE_SHOT', 'MINES', 'SPIRAL'] }
];

const DELTA_PHASES = [
    { threshold: 1.0, attacks: ['CHARGE', 'TRIPLE_SHOT'] },
    { threshold: 0.5, attacks: ['CHARGE', 'TRIPLE_SHOT', 'BEAM_PREP'] }
];

const OMEGA_PHASES = [
    { threshold: 1.0, attacks: ['BURST', 'MINES', 'SPIRAL'] },
    { threshold: 0.7, attacks: ['BURST', 'MINES', 'SPIRAL', 'BEAM_PREP'] },
    { threshold: 0.4, attacks: ['BEAM_PREP', 'MINES', 'SPIRAL', 'CHARGE', 'WAVE'] }
];

const SIGMA_PHASES = [
    { threshold: 1.0, attacks: ['WAVE', 'MINES'] },
    { threshold: 0.5, attacks: ['WAVE', 'MINES', 'WALL_STRIKE'] }
];

const EPSILON_PHASES = [
    { threshold: 1.0, attacks: ['SPIRAL', 'BOUNCE'] },
    { threshold: 0.5, attacks: ['SPIRAL', 'BOUNCE', 'BEAM_PREP'] }
];

const RHO_PHASES = [
    { threshold: 1.0, attacks: ['TRIPLE_SHOT', 'SINE'] },
    { threshold: 0.5, attacks: ['TRIPLE_SHOT', 'SINE', 'BURST'] }
];

const ZETA_PHASES = [
    { threshold: 1.0, attacks: ['SLAM_PREP', 'BURST'] },
    { threshold: 0.5, attacks: ['SLAM_PREP', 'BURST', 'PHASE_SHIFT'] }
];

const KAPPA_PHASES = [
    { threshold: 1.0, attacks: ['SUMMON', 'TRIPLE_SHOT'] },
    { threshold: 0.5, attacks: ['SUMMON', 'TRIPLE_SHOT', 'SPIRAL'] }
];

const MU_PHASES = [
    { threshold: 1.0, attacks: ['LAVA_PREP', 'SINE'] },
    { threshold: 0.5, attacks: ['LAVA_PREP', 'SINE', 'BOUNCE'] }
];

// Combine into lookup
const BOSS_DATA = [
    { name: 'ALPHA CORE', color: '#ff4757', phases: ALPHA_PHASES, spawnX: 600 },
    { name: 'BETA CORE', color: '#2ecc71', phases: BETA_PHASES, spawnX: 200 },
    { name: 'SIGMA CORE', color: '#e67e22', phases: SIGMA_PHASES, spawnX: 700 },
    { name: 'DELTA CORE', color: '#3498db', phases: DELTA_PHASES, spawnX: 500 },
    { name: 'RHO CORE', color: '#1abc9c', phases: RHO_PHASES, spawnX: 100 },
    { name: 'ZETA CORE', color: '#a29bfe', phases: ZETA_PHASES, spawnX: 400 },
    { name: 'KAPPA CORE', color: '#55e6c1', phases: KAPPA_PHASES, spawnX: 250 },
    { name: 'MU CORE', color: '#e17055', phases: MU_PHASES, spawnX: 350 },
    { name: 'EPSILON CORE', color: '#f1c40f', phases: EPSILON_PHASES, spawnX: 300 },
    { name: 'OMEGA CORE', color: '#9b59b6', phases: OMEGA_PHASES, spawnX: 400 }
];

let rushIndex = 0; // Current boss in the rush (0 to BOSS_DATA.length-1)
let mouseX = 100;
let mouseY = 300;
let isMouseDown = false;
let isShootKeyDown = false;
let currentLevel = 1;
let currentXP = 0;
let bufferedXP = 0;

// --- JUICE & POLISH ---
let particles = [];
let xpOrbs = [];
let trails = [];
let screenShake = 0;
let shakeTime = 0;
let lavaTimer = 0;
let lavaFlash = 0;

function spawnParticles(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 400,
            vy: (Math.random() - 0.5) * 400,
            life: 0.5 + Math.random() * 0.5,
            color,
            size: 2 + Math.random() * 4
        });
    }
}

function addTrail(x, y, w, h, color) {
    trails.push({ x, y, w, h, color, life: 0.3 });
}

function setShake(amount, duration) {
    screenShake = amount;
    shakeTime = duration;
}

let explosions = [];
let orbitals = [];

function createCheeseLord(hpMod = 1.0, speedMod = 1.0) {
    const allAttacks = ['BURST', 'TRIPLE_SHOT', 'WAVE', 'SINE', 'BOUNCE', 'WALL_STRIKE', 'CHARGE', 'BEAM_PREP', 'MINES', 'SPIRAL', 'SLAM_PREP', 'SUMMON', 'LAVA_PREP', 'PHASE_SHIFT', 'ORBITAL_STRIKE', 'GRAVITY_WELL', 'RING_SHOCK', 'CROSS_BEAM', 'STALACTITE', 'SUMMON_MINION', 'METEOR_SHOWER', 'LASER_GRID'];
    const allTraits = ['HOMING', 'BOOMERANG', 'RAGE', 'DEPRESSED', 'TRIUMVIRATE', 'STONE', 'SHARP', 'HEAL', 'CHILL', 'BOUNCY', 'GHOST', 'REACTIVE', 'ORBITAL', 'TELEPORT', 'TITAN', 'STATIC'];

    const cheese = {
        name: "Cheese Lord: The King of Chanakh",
        color: "#f1c40f",
        width: 120, height: 120,
        x: canvas.width / 2 - 60, y: 180,
        spawnX: canvas.width / 2 - 60,
        velY: 0,
        health: Math.floor(BOSS_MAX_HEALTH * hpMod * 2), // beefier
        maxHealth: Math.floor(BOSS_MAX_HEALTH * hpMod * 2),
        speedMod: speedMod,
        state: 'IDLE',
        attackTimer: 2.0,
        projectiles: [],
        seekers: [],
        mines: [],
        hitResonance: 0,
        phases: [
            { threshold: 1.0, attacks: allAttacks }
        ],
        phase: 0,
        traits: allTraits,
        isCheeseLord: true,
        minions: []
    };

    // Sub-modules to run additional attacks simultaneously
    for(let i=0; i<2; i++) {
        cheese.minions.push({
            name: "Cheese Lord Sub",
            color: "transparent",
            width: 1, height: 1,
            x: cheese.x, y: cheese.y,
            spawnX: cheese.x,
            velY: 0,
            health: 999999, maxHealth: 999999,
            speedMod: speedMod,
            state: 'IDLE',
            attackTimer: 2.0 + Math.random() * 2,
            projectiles: [],
            seekers: [],
            mines: [],
            hitResonance: 0,
            phases: [ { threshold: 1.0, attacks: allAttacks } ],
            phase: 0,
            isInvulnerable: true, 
            isCheeseSub: true
        });
    }

    return cheese;
}

function createInfiniteBoss() {
    const colors = ['#f1c40f', '#e67e22', '#e74c3c', '#9b59b6', '#3498db', '#1abc9c', '#2ecc71', '#ff4757', '#a29bfe', '#ffa502'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const hpScale = 1 + (defeatedBossesCount * 0.15);
    
    // Choose 3 random attacks from the available pool
    const pool = ['BURST', 'TRIPLE_SHOT', 'WAVE', 'SINE', 'BOUNCE', 'WALL_STRIKE', 'CHARGE', 'BEAM_PREP', 'MINES', 'SPIRAL', 'SLAM_PREP', 'SUMMON', 'LAVA_PREP', 'PHASE_SHIFT', 'ORBITAL_STRIKE', 'GRAVITY_WELL', 'RING_SHOCK', 'CROSS_BEAM', 'STALACTITE', 'SUMMON_MINION'];
    const chosenAttacks = [];
    const poolCopy = [...pool];
    for (let i = 0; i < 3; i++) {
        const idx = Math.floor(Math.random() * poolCopy.length);
        chosenAttacks.push(poolCopy[idx]);
        poolCopy.splice(idx, 1);
    }

    const traits = getTraits();
    return {
        id: -1, // Use -1 or similar for procedural bosses
        x: 400,
        y: 150,
        spawnX: 400,
        width: 80,
        height: 80,
        health: BOSS_MAX_HEALTH * hpScale,
        maxHealth: BOSS_MAX_HEALTH * hpScale,
        speedMod: traits.includes('RAGE') ? 1.5 : 1.0,
        traits: traits,
        state: 'IDLE',
        attackTimer: 2.0,
        phase: 0,
        color: color,
        name: `RNG CORE ${defeatedBossesCount + 1}`,
        targetX: 400,
        targetY: 150,
        projectiles: [],
        mines: [],
        seekers: [],
        minions: [],
        beam: { active: false, x1: 0, y1: 0, x2: 0, y2: 0, width: 0, timer: 0 },
        lastSpiralTick: 0,
        hitResonance: 0,
        slowTimer: 0,
        phases: [{ threshold: 1.0, attacks: chosenAttacks }] // Infinite bosses use all attacks from start
    };
}

let lastTime = 0; 
let gameTime = 0; 
const keys = {}; 
const touchKeys = { left: false, right: false, jump: false };

// Speedrun Timer
let startTime = 0;
let elapsedTime = 0;
let timerRunning = false;
let timerFinished = false;
let dialogueActive = false;
let currentInteractable = null;
let isCustomMode = false;
let isInfiniteMode = false;
let isSandboxMode = false;
let sandboxAttacks = [];
let defeatedBossesCount = 0;
let customLevelData = null;

function formatTime(ms) {
    let minutes = Math.floor(ms / 60000);
    let seconds = Math.floor((ms % 60000) / 1000);
    let centiseconds = Math.floor((ms % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

// --- HELPER FOR ROTATED COLLISION ---
function getRotatedOverlap(p, obj) {
    const angle = (obj.currentAngle || 0) * (Math.PI / 180);
    const cx = obj.currentX + obj.width / 2;
    const cy = obj.currentY + obj.height / 2;

    const pCorners = [
        { x: p.x, y: p.y },
        { x: p.x + p.width, y: p.y },
        { x: p.x, y: p.y + p.height },
        { x: p.x + p.width, y: p.y + p.height }
    ];

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hw = obj.width / 2;
    const hh = obj.height / 2;

    const oCorners = [
        { x: cx + (-hw) * cos - (-hh) * sin, y: cy + (-hw) * sin + (-hh) * cos },
        { x: cx + (hw) * cos - (-hh) * sin, y: cy + (hw) * sin + (-hh) * cos },
        { x: cx + (hw) * cos - (hh) * sin, y: cy + (hw) * sin + (hh) * cos },
        { x: cx + (-hw) * cos - (hh) * sin, y: cy + (-hw) * sin + (hh) * cos }
    ];

    const axes = [
        { x: 1, y: 0 }, { x: 0, y: 1 },
        { x: cos, y: sin }, { x: -sin, y: cos }
    ];

    let minOverlap = Infinity;
    let overlapAxis = { x: 0, y: 0 };

    for (const axis of axes) {
        let minP = Infinity, maxP = -Infinity;
        for (const pt of pCorners) {
            const proj = pt.x * axis.x + pt.y * axis.y;
            minP = Math.min(minP, proj);
            maxP = Math.max(maxP, proj);
        }
        let minO = Infinity, maxO = -Infinity;
        for (const pt of oCorners) {
            const proj = pt.x * axis.x + pt.y * axis.y;
            minO = Math.min(minO, proj);
            maxO = Math.max(maxO, proj);
        }
        const overlap = Math.min(maxP, maxO) - Math.max(minP, minO);
        if (overlap < 0) return null;
        if (overlap < minOverlap) {
            minOverlap = overlap;
            overlapAxis = axis;
        }
    }

    const centerDist = { x: (p.x + p.width / 2) - cx, y: (p.y + p.height / 2) - cy };
    if (centerDist.x * overlapAxis.x + centerDist.y * overlapAxis.y < 0) {
        overlapAxis.x = -overlapAxis.x;
        overlapAxis.y = -overlapAxis.y;
    }
    return { x: overlapAxis.x * minOverlap, y: overlapAxis.y * minOverlap };
}

// 2. PLAYER DEFINITION
const player = {
    x: 100,
    y: 300,
    width: 30,
    height: 30,
    velX: 0,
    velY: 0,
    jumping: false,
    coyoteCounter: 0,
    color: localStorage.getItem('playerColor') || '#00d2ff',
    eyeStyle: localStorage.getItem('playerEyeStyle') || 'STARE',
    hat: localStorage.getItem('playerHat') || 'NONE',
    health: PLAYER_MAX_HEALTH_DEFAULT,
    maxHealth: PLAYER_MAX_HEALTH_DEFAULT,
    invuln: 0,
    radius: 15,
    facing: 1,
    bullets: [],
    fireCooldown: 0,
    damage: JSON.parse(localStorage.getItem('stat_damage') || '10'),
    crit: JSON.parse(localStorage.getItem('stat_crit') || '0') / 100,
    multishot: 1
};

let playerMoveSpeed = JSON.parse(localStorage.getItem('stat_speed') || '450');
let jumpForce = JSON.parse(localStorage.getItem('stat_jump') || '-750');
let PLAYER_FIRE_RATE = JSON.parse(localStorage.getItem('stat_firerate') || '0.25');

function getTraits() {
    const availableTraits = ['HOMING', 'BOOMERANG', 'RAGE', 'DEPRESSED', 'TRIUMVIRATE', 'STONE', 'SHARP', 'HEAL', 'CHILL', 'BOUNCY', 'GHOST', 'REACTIVE', 'ORBITAL', 'TELEPORT', 'TITAN', 'STATIC'];
    let traits = [];
    let chosenTrait = availableTraits[Math.floor(Math.random() * availableTraits.length)];
    if (chosenTrait === 'TRIUMVIRATE') {
        traits.push('TRIUMVIRATE');
        const subset = availableTraits.filter(t => t !== 'TRIUMVIRATE');
        const t1 = subset.splice(Math.floor(Math.random() * subset.length), 1)[0];
        const t2 = subset.splice(Math.floor(Math.random() * subset.length), 1)[0];
        traits.push(t1, t2);
    } else {
        traits.push(chosenTrait);
    }
    return traits;
}

// 3. BOSS DEFINITION
function createBoss(index) {
    const data = BOSS_DATA[index];
    
    // Scale boss Health and Speed
    let hpMod = 1.0;
    let speedMod = 1.0;
    let traits = [];
    
    // In Normal mode, bosses don't have random traits. They are in Infinite and Sandbox.
    if (isInfiniteMode) {
        hpMod = Math.pow(1.25, defeatedBossesCount);
        speedMod = Math.pow(1.10, defeatedBossesCount);
        traits = getTraits();
    }
    if (isSandboxMode) {
        const hpVal = parseFloat(document.getElementById('sandbox-hp-val').innerText);
        if (!isNaN(hpVal)) hpMod = hpVal;
        traits = getTraits();
    }
    
    // Apply Rage trait multiplier
    if (traits.includes('RAGE')) {
        speedMod *= 1.5;
    }
    if (traits.includes('TITAN')) {
        hpMod *= 2.0;
        speedMod *= 0.6;
    }
    
    // Global Harder Scaling (25% harder on base health and speed)
    hpMod *= DIFFICULTY_SCALING;
    speedMod *= (1 + (DIFFICULTY_SCALING - 1) * 0.5);
    
    return {
        id: index,
        x: data.spawnX,
        y: 190,
        spawnX: data.spawnX,
        width: 80 * (traits.includes('TITAN') ? 1.5 : 1.0),
        height: 80 * (traits.includes('TITAN') ? 1.5 : 1.0),
        health: Math.floor(BOSS_MAX_HEALTH * hpMod),
        maxHealth: Math.floor(BOSS_MAX_HEALTH * hpMod),
        speedMod: speedMod,
        traits: traits,
        state: 'IDLE', 
        attackTimer: 2.5, // Calm start for each boss
        phase: 0,
        phases: data.phases,
        color: data.color,
        name: data.name,
        targetX: data.spawnX,
        targetY: 190,
        projectiles: [],
        mines: [],
        seekers: [],
        beam: { active: false, x1: 0, y1: 0, x2: 0, y2: 0, width: 0, timer: 0 },
        lastSpiralTick: 0,
        hitResonance: 0
    };
}
let boss = createBoss(0);
let boss2 = null; // Removed in favor of rushIndex sequential logic

// 4. ARENA DEFINITION
const ARENA = [
    {"x":0, "y":380, "width":800, "height":20, "type":"PLATFORM"}, // Floor
    {"x":0, "y":0, "width":800, "height":20, "type":"PLATFORM"},   // Ceiling
    {"x":0, "y":0, "width":20, "height":400, "type":"PLATFORM"},    // Left Wall
    {"x":780, "y":0, "width":20, "height":400, "type":"PLATFORM"},  // Right Wall
    {"x":150, "y":280, "width":100, "height":20, "type":"PLATFORM"}, // Platforms
    {"x":550, "y":280, "width":100, "height":20, "type":"PLATFORM"},
    {"x":350, "y":180, "width":100, "height":20, "type":"PLATFORM"}
];

let worldObjects = [];
let spawnPoint = { x: 100, y: 300 };
let gameState = 'TITLE';

// --- CONTROLS CONFIG ---
let controls = {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    jump: 'Space',
    reset: 'KeyR',
    interact: 'KeyE'
};

// Load controls from local storage
const savedControls = localStorage.getItem('platformer_controls');
if (savedControls) {
    try {
        const parsed = JSON.parse(savedControls);
        // Merge saved controls with defaults to ensure new actions like 'interact' exist
        controls = { ...controls, ...parsed };
    } catch (e) {
        console.error("Failed to parse saved controls", e);
    }
}

let remappingKey = null;

function remapKey(action) {
    remappingKey = action;
    const btn = document.getElementById(`key-${action}`);
    btn.innerText = 'Press any key...';
    btn.classList.add('waiting');
}

function saveControls() {
    try {
        localStorage.setItem('platformer_controls', JSON.stringify(controls));
    } catch (e) {
        console.error("Failed to save controls:", e);
    }
}

// --- UI MANAGEMENT ---
function toggleMobileMode() {
    mobileMode = !mobileMode;
    localStorage.setItem('platformer_mobile', mobileMode);
    updateSettingsUI();
    sfx.click();
}

function toggleSFX() {
    sfxEnabled = !sfxEnabled;
    localStorage.setItem('platformer_sfx', sfxEnabled);
    updateSettingsUI();
    if (sfxEnabled) sfx.click();
}

function updateSettingsUI() {
    const mobileBtn = document.getElementById('toggle-mobile');
    const sfxBtn = document.getElementById('toggle-sfx');
    const touchControls = document.getElementById('touch-controls');

    if (mobileBtn) {
        mobileBtn.innerText = mobileMode ? 'ON' : 'OFF';
        mobileBtn.className = mobileMode ? 'active' : '';
    }
    if (sfxBtn) {
        sfxBtn.innerText = sfxEnabled ? 'ON' : 'OFF';
        sfxBtn.className = sfxEnabled ? 'active' : '';
    }
    if (touchControls) {
        touchControls.style.display = (mobileMode && gameState === 'PLAYING') ? 'flex' : 'none';
    }
}

function startInfiniteMode() {
    isInfiniteMode = true;
    defeatedBossesCount = 0;
    startGame();
    document.getElementById('rush-counter').style.display = 'none';
    const inf = document.getElementById('infinite-counter');
    inf.style.display = 'block';
    inf.innerText = `DEFEATED: 0`;
}

function startGame() {
    gameState = 'PLAYING';
    dialogueActive = false;
    document.getElementById('title-screen').style.display = 'none';
    document.getElementById('controls-screen').style.display = 'none';
    document.getElementById('win-screen').style.display = 'none';
    document.getElementById('ui').style.display = 'block';
    
    currentLevel = 1;
    currentXP = 0;
    
    updateSettingsUI();
    sfx.click();
    
    // Reset timer state but wait for movement
    timerRunning = false;
    timerFinished = false;
    elapsedTime = 0;
    document.getElementById('timer-display').innerText = "00:00.00";
    
    initLevel();
}

function resetRun(backToMenu = true) {
    dialogueActive = false;
    const upgradeScreen = document.getElementById('upgrade-screen');
    if (upgradeScreen) upgradeScreen.style.display = 'none';

    if (backToMenu) {
        gameState = 'TITLE';
        isInfiniteMode = false;
        isSandboxMode = false;
        defeatedBossesCount = 0;
        document.getElementById('rush-counter').style.display = 'block';
        document.getElementById('infinite-counter').style.display = 'none';
        timerRunning = false;
        timerFinished = false;
        elapsedTime = 0;
        document.getElementById('title-screen').style.display = 'flex';
        document.getElementById('controls-screen').style.display = 'none';
        document.getElementById('win-screen').style.display = 'none';
        document.getElementById('ui').style.display = 'none';
        
        const indexScreen = document.getElementById('index-screen');
        if (indexScreen) indexScreen.style.display = 'none';
        const sandboxScreen = document.getElementById('sandbox-screen');
        if (sandboxScreen) sandboxScreen.style.display = 'none';
        const adminPanel = document.getElementById('admin-panel');
        if (adminPanel) adminPanel.style.display = 'none';
        const inventoryScreen = document.getElementById('inventory-screen');
        if (inventoryScreen) inventoryScreen.style.display = 'none';
    } else {
        startGame();
    }
}

function showTitle() {
    gameState = 'TITLE';
    document.getElementById('title-screen').style.display = 'flex';
    document.getElementById('controls-screen').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'none';
    document.getElementById('credits-screen').style.display = 'none';
    const indexScreen = document.getElementById('index-screen');
    if (indexScreen) indexScreen.style.display = 'none';
    const sandboxScreen = document.getElementById('sandbox-screen');
    if (sandboxScreen) sandboxScreen.style.display = 'none';
    const avatarScreen = document.getElementById('avatar-screen');
    if (avatarScreen) avatarScreen.style.display = 'none';
    document.getElementById('ui').style.display = 'none';
    document.getElementById('xp-container').style.display = 'none';
}

function showAvatarEditor() {
    document.getElementById('title-screen').style.display = 'none';
    document.getElementById('avatar-screen').style.display = 'flex';
    initAvatarEditor();
}

const AVATAR_COLORS = [
    '#00d2ff', '#ff4757', '#2ecc71', '#f1c40f', '#9b59b6',
    '#e67e22', '#ffffff', '#2f3542', '#ff9f43', '#54a0ff'
];
const EYE_STYLES = ['STARE', 'NARROW', 'WINK', 'NONE', 'GLOW', 'CUTE'];
const HAT_STYLES = ['NONE', 'TOPHAT', 'BEANIE', 'HALO', 'CROWN', 'SPIKES'];

function initAvatarEditor() {
    const colorGrid = document.getElementById('color-options');
    if (colorGrid) {
        colorGrid.innerHTML = '';
        AVATAR_COLORS.forEach(color => {
            const div = document.createElement('div');
            div.className = `color-circle ${player.color === color ? 'active' : ''}`;
            div.style.backgroundColor = color;
            div.onclick = () => {
                player.color = color;
                localStorage.setItem('playerColor', color);
                initAvatarEditor();
            };
            colorGrid.appendChild(div);
        });
    }

    const eyeGrid = document.getElementById('eye-options');
    if (eyeGrid) {
        eyeGrid.innerHTML = '';
        EYE_STYLES.forEach(style => {
            const btn = document.createElement('button');
            btn.className = `eye-style-btn ${player.eyeStyle === style ? 'active' : ''}`;
            btn.innerText = style;
            btn.onclick = () => {
                player.eyeStyle = style;
                localStorage.setItem('playerEyeStyle', style);
                initAvatarEditor();
            };
            eyeGrid.appendChild(btn);
        });
    }

    const hatGrid = document.getElementById('hat-options');
    if (hatGrid) {
        hatGrid.innerHTML = '';
        HAT_STYLES.forEach(style => {
            const btn = document.createElement('button');
            btn.className = `eye-style-btn ${player.hat === style ? 'active' : ''}`;
            btn.innerText = style;
            btn.onclick = () => {
                player.hat = style;
                localStorage.setItem('playerHat', style);
                initAvatarEditor();
            };
            hatGrid.appendChild(btn);
        });
    }

    renderAvatarPreview();
}

function renderAvatarPreview() {
    const canvas = document.getElementById('avatarCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawPlayerAvatar(ctx, 10, 10, 40, 40, player.color, player.eyeStyle, player.hat);
    }
    
    const creationCanvas = document.getElementById('creationCanvas');
    if (creationCanvas) {
        const ctx = creationCanvas.getContext('2d');
        ctx.clearRect(0, 0, creationCanvas.width, creationCanvas.height);
        drawPlayerAvatar(ctx, 10, 10, 60, 60, player.color, player.eyeStyle, player.hat);
    }
}

function drawPlayerAvatar(ctx, x, y, w, h, color, eyeStyle, hatStyle = 'NONE') {
    ctx.shadowBlur = 10;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.shadowBlur = 0;

    // Hat rendering
    if (hatStyle !== 'NONE') {
        if (hatStyle === 'TOPHAT') {
            ctx.fillStyle = '#222';
            ctx.fillRect(x - w*0.1, y - h*0.1, w*1.2, h*0.1);
            ctx.fillRect(x + w*0.2, y - h*0.6, w*0.6, h*0.5);
        } else if (hatStyle === 'BEANIE') {
            ctx.fillStyle = '#ff4757';
            ctx.beginPath(); ctx.arc(x + w/2, y, w/2, Math.PI, 0); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + w/2, y - w/2, w*0.1, 0, Math.PI*2); ctx.fill();
        } else if (hatStyle === 'HALO') {
            ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.ellipse(x + w/2, y - h*0.2, w*0.4, h*0.1, 0, 0, Math.PI*2); ctx.stroke();
        } else if (hatStyle === 'CROWN') {
            ctx.fillStyle = '#f1c40f';
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h*0.3); ctx.lineTo(x + w*0.25, y - h*0.1);
            ctx.lineTo(x + w*0.5, y - h*0.3); ctx.lineTo(x + w*0.75, y - h*0.1); ctx.lineTo(x + w, y - h*0.3);
            ctx.lineTo(x + w, y); ctx.closePath(); ctx.fill();
        } else if (hatStyle === 'SPIKES') {
            ctx.fillStyle = '#222';
            for(let i=0; i<3; i++){
                ctx.beginPath(); ctx.moveTo(x + (i*w/2.5), y); ctx.lineTo(x + (i*w/2.5) + w*0.1, y - h*0.3);
                ctx.lineTo(x + (i*w/2.5) + w*0.2, y); ctx.fill();
            }
        }
    }

    ctx.fillStyle = '#fff';
    const eyeSize = w * 0.15;
    const eyeY = y + h * 0.3;
    const eyeSpacing = w * 0.25;
    const centerX = x + w / 2;

    if (eyeStyle === 'STARE') {
        ctx.fillRect(centerX - eyeSpacing - eyeSize/2, eyeY, eyeSize, eyeSize);
        ctx.fillRect(centerX + eyeSpacing - eyeSize/2, eyeY, eyeSize, eyeSize);
    } else if (eyeStyle === 'NARROW') {
        ctx.fillRect(centerX - eyeSpacing - eyeSize/2, eyeY + eyeSize/3, eyeSize, eyeSize/3);
        ctx.fillRect(centerX + eyeSpacing - eyeSize/2, eyeY + eyeSize/3, eyeSize, eyeSize/3);
    } else if (eyeStyle === 'WINK') {
        ctx.fillRect(centerX - eyeSpacing - eyeSize/2, eyeY, eyeSize, eyeSize);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(centerX + eyeSpacing - eyeSize/2, eyeY + eyeSize/2);
        ctx.lineTo(centerX + eyeSpacing + eyeSize/2, eyeY + eyeSize/2); ctx.stroke();
    } else if (eyeStyle === 'GLOW') {
        ctx.shadowBlur = 15; ctx.shadowColor = '#fff'; ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(centerX - eyeSpacing, eyeY + eyeSize/2, eyeSize/2, 0, Math.PI * 2);
        ctx.arc(centerX + eyeSpacing, eyeY + eyeSize/2, eyeSize/2, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    } else if (eyeStyle === 'CUTE') {
        ctx.beginPath(); ctx.arc(centerX - eyeSpacing, eyeY + eyeSize/2, eyeSize/2, 0, Math.PI * 2);
        ctx.arc(centerX + eyeSpacing, eyeY + eyeSize/2, eyeSize/2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(centerX - eyeSpacing, eyeY + eyeSize/2, 1.5, 0, Math.PI * 2);
        ctx.arc(centerX + eyeSpacing, eyeY + eyeSize/2, 1.5, 0, Math.PI * 2); ctx.fill();
    }
}

function showAdminPanel() {
    document.getElementById('title-screen').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'flex';
}

async function postAnnouncement() {
    const input = document.getElementById('announcement-input');
    const message = input.value.trim();
    if (!message) return;

    try {
        await updateAnnouncement(message, true);
        alert("Announcement posted!");
        checkAnnouncement();
    } catch (e) {
        console.error(e);
        alert("Failed to post announcement.");
    }
}

async function clearAnnouncement() {
    try {
        await updateAnnouncement("", false);
        document.getElementById('announcement-input').value = "";
        alert("Announcement cleared.");
        checkAnnouncement();
    } catch (e) {
        console.error(e);
        alert("Failed to clear.");
    }
}

// Attach UI-related functions to window for onclick support in index.html
window.startGame = startGame;
window.startInfiniteMode = startInfiniteMode;
window.showControls = showControls;
window.showAdminPanel = showAdminPanel;
window.toggleMobileMode = toggleMobileMode;
window.toggleSFX = toggleSFX;
window.remapKey = remapKey;
window.resetRun = resetRun;
window.showTitle = showTitle;
window.showAvatarEditor = showAvatarEditor;
window.postAnnouncement = postAnnouncement;
window.clearAnnouncement = clearAnnouncement;
window.adminLogin = adminLogin;
window.selectWeapon = selectWeapon;
window.toggleInventory = toggleInventory;

function toggleInventory() {
    const inv = document.getElementById('inventory-screen');
    if (inv.style.display === 'flex') {
        inv.style.display = 'none';
        if (gameState === 'PAUSED_INVENTORY') {
            gameState = 'PLAYING';
        }
        return;
    }
    
    // Open inventory
    if (gameState === 'PLAYING') {
        gameState = 'PAUSED_INVENTORY';
    }
    inv.style.display = 'flex';
    
    const list = document.getElementById('inventory-list');
    list.innerHTML = '';
    
    let hasItems = false;
    // Iterate keys
    Object.keys(player.upgrades || {}).forEach(id => {
        const count = player.upgrades[id];
        if (count > 0) {
            hasItems = true;
            const up = UPGRADES.find(u => u.id === id);
            if (up) {
                const el = document.createElement('div');
                el.className = `upgrade-card ${up.rarity}`;
                el.style.transform = 'none';
                el.style.cursor = 'default';
                el.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <div class="rarity">${up.rarity}</div>
                        <div style="font-size: 14px; font-weight: bold; background: rgba(0,0,0,0.5); padding: 2px 6px; border-radius: 4px;">x${count}</div>
                    </div>
                    <h3 style="font-size: 14px; margin-top: 5px;">${up.title}</h3>
                    <p style="font-size: 10px;">${up.desc}</p>
                `;
                list.appendChild(el);
            }
        }
    });

    if (!hasItems) {
        list.innerHTML = '<p style="color: rgba(255,255,255,0.5);">No upgrades collected yet.</p>';
    }
}

// Attach new Sandbox & Index flows so they work from HTML
if (typeof showIndex !== 'undefined') window.showIndex = showIndex;
if (typeof showSandbox !== 'undefined') window.showSandbox = showSandbox;
if (typeof startSandboxRun !== 'undefined') window.startSandboxRun = startSandboxRun;

function selectWeapon(type) {
    selectedWeapon = type;
    const gunBtn = document.getElementById('weapon-gun');
    const swordBtn = document.getElementById('weapon-sword');
    const boomBtn = document.getElementById('weapon-boomerang');
    const greBtn = document.getElementById('weapon-grenade');
    const wandBtn = document.getElementById('weapon-wand');
    
    // Reset all
    if (gunBtn) { gunBtn.style.border = 'none'; gunBtn.style.opacity = '0.5'; }
    if (swordBtn) { swordBtn.style.border = 'none'; swordBtn.style.opacity = '0.5'; }
    if (boomBtn) { boomBtn.style.border = 'none'; boomBtn.style.opacity = '0.5'; }
    if (greBtn) { greBtn.style.border = 'none'; greBtn.style.opacity = '0.5'; }
    if (wandBtn) { wandBtn.style.border = 'none'; wandBtn.style.opacity = '0.5'; }

    const highlight = '2px solid #00d2ff';
    if (type === 'GUN') {
        if (gunBtn) { gunBtn.style.border = highlight; gunBtn.style.opacity = '1'; }
    } else if (type === 'SWORD') {
        if (swordBtn) { swordBtn.style.border = highlight; swordBtn.style.opacity = '1'; }
    } else if (type === 'BOOMERANG') {
        if (boomBtn) { boomBtn.style.border = highlight; boomBtn.style.opacity = '1'; }
    } else if (type === 'GRENADE') {
        if (greBtn) { greBtn.style.border = highlight; greBtn.style.opacity = '1'; }
    } else if (type === 'WAND') {
        if (wandBtn) { wandBtn.style.border = highlight; wandBtn.style.opacity = '1'; }
    }
}

window.submitAdminLogin = function() {
    const passInput = document.getElementById('admin-pass');
    const pass = passInput.value;
    if (pass === "admin123") {
        isAdminUser = true;
        updateAdminUI();
        document.getElementById('admin-login-form').style.display = 'none';
        alert("Admin mode activated.");
    } else {
        alert("Incorrect password.");
    }
    passInput.value = '';
};

async function adminLogin() {
    // Legacy function, no longer used by default but kept for internal compatibility if needed
    window.submitAdminLogin();
}

function showControls() {
    document.getElementById('title-screen').style.display = 'none';
    document.getElementById('controls-screen').style.display = 'flex';
    updateSettingsUI();
    for (let action in controls) {
        const btn = document.getElementById(`key-${action}`);
        if (btn) btn.innerText = controls[action];
    }
}

// --- PORTAL LOGIC ---
function setPlayerSize(newSize) {
    if (player.width === newSize) return; 
    sfx.portal();
    setShake(5, 0.15);
    spawnParticles(player.x + player.width/2, player.y + player.height/2, player.color, 15);
    let heightDiff = newSize - player.height;
    player.width = newSize;
    player.height = newSize;
    player.y -= heightDiff; 
}

// --- NPC & DIALOGUE ---
let typewriterHandle = null;

function openDialogue(text) {
    if (!text || dialogueActive) return;
    dialogueActive = true;
    const prompt = document.getElementById('interaction-prompt');
    prompt.innerHTML = '<div id="typewriter-content" style="min-height: 20px;"></div>';
    const content = document.getElementById('typewriter-content');
    prompt.classList.add('dialogue-active');
    sfx.click();

    // Typewriter effect
    if (typewriterHandle) clearInterval(typewriterHandle);
    let i = 0;
    typewriterHandle = setInterval(() => {
        if (i < text.length) {
            content.innerText += text.charAt(i);
            i++;
        } else {
            clearInterval(typewriterHandle);
            typewriterHandle = null;
            // Add a "Close" tip
            const rawKey = controls.interact || 'E';
            const keyName = rawKey.replace('Key', '').replace('Digit', '');
            const tip = document.createElement('div');
            tip.innerText = `[${keyName}] CLOSE`;
            tip.style.fontSize = '9px';
            tip.style.opacity = '0.5';
            tip.style.marginTop = '8px';
            tip.style.borderTop = '1px solid rgba(255,255,255,0.1)';
            tip.style.paddingTop = '4px';
            prompt.appendChild(tip);
        }
    }, 25);
}

function closeDialogue() {
    if (typewriterHandle) {
        clearInterval(typewriterHandle);
        typewriterHandle = null;
    }
    dialogueActive = false;
    const prompt = document.getElementById('interaction-prompt');
    prompt.classList.remove('dialogue-active');
    sfx.click();
}

// 4. LEVEL LOGIC
function initLevel() {
    channelStates = {}; 
    worldObjects = ARENA.map(obj => ({ ...obj }));
    lavaTimer = 0;
    lavaFlash = 0;
    particles = [];
    xpOrbs = [];
    trails = [];
    explosions = [];
    
    player.maxHealth = PLAYER_MAX_HEALTH_DEFAULT;
    player.health = player.maxHealth;
    player.invuln = 0;
    player.bullets = [];
    player.fireCooldown = 0;
    player.damage = 10 + (parseInt(localStorage.getItem('stat_damage')) || 0);
    player.multishot = 1;
    player.homing = 0;
    player.bulletSize = 6;
    player.lifesteal = 0;
    player.pierce = 0;
    player.crit = (parseInt(localStorage.getItem('stat_crit')) || 0) / 100;
    player.chargeTime = 0;
    player.hasChargeShot = false;
    player.bounces = 0;
    player.backshot = 0;
    player.bulletLife = 2.0;
    player.armor = 0;
    player.chargeSpeed = 1.0;
    player.explosive = 0;
    player.splitting = 0;
    player.berserker = 0;
    player.lastStandUsed = false;
    player.drones = [];
    player.frostRounds = 0;
    player.reactiveArmor = 0;
    player.weaponType = selectedWeapon;
    player.isSwinging = false;
    player.swingProgress = 0;
    player.swingCooldown = 0;
    player.swordAngle = 0;
    player.swordLength = 70;
    player.whirlwind = false;
    player.throwingSword = false;
    player.upgrades = {};
    playerMoveSpeed = 450 + (parseInt(localStorage.getItem('stat_speed')) || 0) * 2;
    jumpForce = -750 - (parseInt(localStorage.getItem('stat_jump')) || 0) * 5;
    PLAYER_FIRE_RATE = 0.25 * (1 - ((parseInt(localStorage.getItem('stat_firerate')) || 0) / 1000));
    
    // Boomerang default stats
    player.boomerangDamage = 20;
    player.boomerangCount = 1;
    player.boomerangSpeed = 600;
    player.boomerangRange = 400;
    player.boomerangReturnSpeed = 900;
    player.boomerangSize = 15;
    player.boomerangFrost = 0;

    // Grenade default stats
    player.grenadeDamage = 40;
    player.grenadeCount = 1;
    player.grenadeRadius = 100;
    player.grenadeBounces = 2;
    player.grenadeFrags = 0;

    // Wand default stats
    player.wandHomingPower = 1.0;
    player.wandArcaneSpeed = 500;
    
    // Initialization flag cleanup (was duplicate lines)
    if (player.weaponType === 'SWORD') {
        player.damage = 25; // Base sword damage approx 2x bullet
        PLAYER_FIRE_RATE = 0.4; // Slower "fire" rate for sword
    } else if (player.weaponType === 'BOOMERANG') {
        player.damage = player.boomerangDamage;
        PLAYER_FIRE_RATE = 1.0; 
    } else if (player.weaponType === 'GRENADE') {
        player.damage = player.grenadeDamage;
        PLAYER_FIRE_RATE = 1.2;
    } else if (player.weaponType === 'WAND') {
        player.damage = 15;
        PLAYER_FIRE_RATE = 0.6;
    } else {
        player.damage = 10;
        PLAYER_FIRE_RATE = 0.25;
    }
    jumpForce = -750;
    PLAYER_BULLET_SPEED = 800;
    randomPlatformTimer = 3.0;
    
    rushIndex = 0;
    if (isInfiniteMode) {
        boss = createInfiniteBoss();
    } else if (isSandboxMode) {
        const hpScale = parseFloat(document.getElementById('sandbox-hp').value) || 1.0;
        const color = '#9b59b6';
        if (document.getElementById('sandbox-cheeselord') && document.getElementById('sandbox-cheeselord').checked) {
            boss = createCheeseLord(hpScale, 1.0);
        } else {
            const traits = getTraits();
            boss = {
                id: -2,
                x: 400, y: 150, spawnX: 400,
                width: 80, height: 80,
                health: BOSS_MAX_HEALTH * hpScale,
                maxHealth: BOSS_MAX_HEALTH * hpScale,
                speedMod: traits.includes('RAGE') ? 1.5 : 1.0,
                traits: traits,
                state: 'IDLE', attackTimer: 2.0, phase: 0,
                color: color, name: 'SANDBOX CORE',
                targetX: 400, targetY: 150,
                projectiles: [], mines: [], seekers: [], minions: [],
                beam: { active: false, x1: 0, y1: 0, x2: 0, y2: 0, width: 0, timer: 0 },
                lastSpiralTick: 0, hitResonance: 0, slowTimer: 0,
                phases: [{ threshold: 1.0, attacks: sandboxAttacks }]
            };
        }
    } else {
        boss = createBoss(0);
    }
    
    updateHealthUI();
    respawn();
}

function updateHealthUI() {
    const container = document.getElementById('player-health-container');
    if (!container) return;
    
    // Dynamically create pips based on maxHealth
    container.innerHTML = '';
    for (let i = 0; i < player.maxHealth; i++) {
        const pip = document.createElement('div');
        pip.classList.add('health-pip');
        if (i >= player.health) pip.classList.add('empty');
        container.appendChild(pip);
    }
    
    const bossBar = document.getElementById('boss-health-bar');
    const bossNameDisplay = document.getElementById('boss-name');
    const rushCounter = document.getElementById('rush-counter');
    
    if (bossBar) {
        const percent = (boss.health / boss.maxHealth) * 100;
        bossBar.style.width = Math.max(0, percent) + '%';
        bossBar.style.background = boss.color;
        if (bossNameDisplay) {
            let trStr = "";
            if (boss.traits && boss.traits.length > 0) trStr = ` [${boss.traits.join(", ")}]`;
            bossNameDisplay.innerText = boss.name + trStr;
            bossNameDisplay.style.color = boss.color;
        }
    }
    
    if (rushCounter) {
        rushCounter.innerText = `BOSS ${rushIndex + 1} OF ${BOSS_DATA.length}`;
        rushCounter.style.color = boss.color;
        rushCounter.style.opacity = 0.6;
    }

    const traitsDisplay = document.getElementById('boss-traits-display');
    const traitIcons = document.getElementById('boss-trait-icons');
    
    if (traitsDisplay && boss && boss.health > 0) {
        if (boss.traits && boss.traits.length > 0) {
            traitsDisplay.innerHTML = "BOSS TRAITS:<br>" + boss.traits.map(t => `<span style="color: white; font-weight: bold;">${t}</span>`).join('<br>');
        } else {
            traitsDisplay.innerHTML = '';
        }
    } else if (traitsDisplay) {
        traitsDisplay.innerHTML = '';
    }

    if (traitIcons) {
        traitIcons.innerHTML = '';
        if (boss && boss.traits && boss.health > 0) {
            boss.traits.forEach(t => {
                const icon = document.createElement('div');
                icon.style.width = '14px';
                icon.style.height = '14px';
                icon.style.borderRadius = '3px';
                icon.style.fontSize = '10px';
                icon.style.display = 'flex';
                icon.style.alignItems = 'center';
                icon.style.justifyContent = 'center';
                icon.style.background = 'rgba(255,255,255,0.15)';
                icon.style.color = 'white';
                icon.style.border = '1px solid rgba(255,255,255,0.1)';
                icon.title = t;
                
                let symbol = t[0]; 
                if (t === 'DEPRESSED') symbol = '😢';
                else if (t === 'TRIUMVIRATE') symbol = '👁️';
                else if (t === 'RAGE') symbol = '💢';
                else if (t === 'HOMING') symbol = '🎯';
                else if (t === 'BOOMERANG') symbol = '🪃';
                else if (t === 'STONE') symbol = '🪨';
                else if (t === 'SHARP') symbol = '⚔️';
                else if (t === 'HEAL') symbol = '➕';
                else if (t === 'CHILL') symbol = '❄️';
                else if (t === 'BOUNCY') symbol = '🏀';
                else if (t === 'GHOST') symbol = '👻';
                else if (t === 'REACTIVE') symbol = '⚡';
                else if (t === 'ORBITAL') symbol = '🪐';
                else if (t === 'TELEPORT') symbol = '🌀';
                else if (t === 'TITAN') symbol = '🐘';
                else if (t === 'STATIC') symbol = '🌩️';
                
                icon.innerText = symbol;
                traitIcons.appendChild(icon);
            });
        }
    }
    
    // XP UI update
    const xpContainer = document.getElementById('xp-container');
    const xpBar = document.getElementById('xp-bar');
    const xpLevel = document.getElementById('xp-level');
    
    if (xpContainer && xpBar && xpLevel) {
        if (gameState === 'PLAYING') {
            xpContainer.style.display = 'block';
            xpLevel.innerText = currentLevel;
            let reqXP = Math.floor(1.8 * Math.pow(currentLevel, 2));
            let prevReqXP = currentLevel > 1 ? Math.floor(1.8 * Math.pow(currentLevel - 1, 2)) : 0;
            let currentLevelProgress = currentXP - prevReqXP;
            let currentLevelReq = reqXP - prevReqXP;
            let xpPercent = Math.min(100, (currentLevelProgress / currentLevelReq) * 100);
            xpBar.style.width = Math.max(0, xpPercent) + '%';
        } else {
            xpContainer.style.display = 'none';
        }
    }
}

function updateMultiplayer(dt) {
    if (!multiplayer.roomId) return;

    // Sync local state to Firebase
    const now = Date.now();
    if (now - multiplayer.lastUpdate > multiplayer.updateRate) {
        multiplayer.lastUpdate = now;
        
        const state = {
            x: player.x,
            y: player.y,
            health: player.health,
            bullets: player.bullets.map(b => ({ x: b.x, y: b.y, radius: b.radius }))
        };
        fb.updatePlayerState(multiplayer.roomId, state);
    }
}

async function multiplayerWin() {
    multiplayer.status = 'finished';
    timerRunning = false;
    
    // Clear subscriptions
    if (multiplayer.roomSubscription) multiplayer.roomSubscription();
    if (multiplayer.statesSubscription) multiplayer.statesSubscription();

    // Show win screen
    document.getElementById('win-screen').style.display = 'flex';
    document.getElementById('final-time-text').innerText = "YOU DEFEATED THE OPPONENT!";
    document.getElementById('final-time-text').style.color = '#2ed573';
}

function playerTakeDamage(source = 'default') {
    if (player.invuln > 0 || player.health <= 0 || gameState !== 'PLAYING') return;

    if (player.lastStandUsed === false && player.health === 1) {
        player.invuln = 4.0;
        player.lastStandUsed = true;
        setShake(20, 0.5);
        sfx.portal();
        return;
    }
    
    // Check traits from the global boss
    let dmgAmount = 1;
    if (boss && boss.traits) {
        if (boss.traits.includes('STONE')) dmgAmount = Math.floor(Math.random() * 2) + 2; // 2 or 3 damage
        if (boss.traits.includes('SHARP')) {
            player.bleedTimer = 6; // Take 2 further damage over 6 seconds
        }
        if (boss.traits.includes('HEAL')) {
            boss.health = Math.min(boss.maxHealth, boss.health + boss.maxHealth * 0.25);
            spawnParticles(boss.x + boss.width/2, boss.y + boss.height/2, '#2ecc71', 15);
        }
    }

    if (player.armor && Math.random() < player.armor) {
        spawnParticles(player.x + player.width/2, player.y + player.height/2, '#00d2ff', 5);
        player.invuln = 0.3; // Short invuln for "glance"
        return;
    }

    player.health -= dmgAmount;
    if (player.health < 0) player.health = 0;
    player.invuln = INVULN_DURATION;
    setShake(15, 0.3);
    sfx.land(); 
    spawnParticles(player.x + player.width/2, player.y + player.height/2, '#fff', 15);
    updateHealthUI();
    
    if (player.health <= 0) {
        setTimeout(() => resetRun(false), 800);
    }

    if (player.reactiveArmor) {
        for (let i = 0; i < 12; i++) {
            const ang = (i / 12) * Math.PI * 2;
            player.bullets.push({
                x: player.x + player.width/2,
                y: player.y + player.height/2,
                vx: Math.cos(ang) * 600,
                vy: Math.sin(ang) * 600,
                radius: 6,
                life: 1.5,
                damageScale: 0.8
            });
        }
    }
}

// --- UPGRADE SYSTEM ---
const UPGRADES = [
    { id: 'DAMAGE', title: 'Kinetic Amp', rarity: 'COMMON', buff: 'Core damage +5', defect: 'Max HP -1', run: () => { player.damage += 5; player.maxHealth = Math.max(1, player.maxHealth - 1); player.health = Math.min(player.health, player.maxHealth); updateHealthUI(); } },
    { id: 'FIRE_RATE', title: 'Overclock', rarity: 'RARE', buff: 'Firing rate +25%', defect: 'Movement speed -10%', run: () => { PLAYER_FIRE_RATE *= 0.75; playerMoveSpeed *= 0.9; } },
    { id: 'MULTISHOT', title: 'Split Core', rarity: 'EPIC', weapon: 'GUN', buff: '+1 Bullet', defect: 'Damage -3', run: () => { player.multishot++; player.damage = Math.max(1, player.damage - 3); } },
    { id: 'HEALTH', title: 'Repair Nano', rarity: 'COMMON', buff: '+2 Max HP, heal 5', defect: 'Move speed -5%', run: () => { player.maxHealth += 2; player.health = Math.min(player.maxHealth, player.health + 5); playerMoveSpeed *= 0.95; updateHealthUI(); } },
    { id: 'SPEED', title: 'Photon Accel', rarity: 'COMMON', weapon: 'GUN', buff: 'Bullet speed +25%', defect: 'Bullet size -20%', run: () => { PLAYER_BULLET_SPEED *= 1.25; player.bulletSize *= 0.8; } },
    { id: 'HOMING', title: 'Seeker Core', rarity: 'RARE', weapon: 'GUN', buff: 'Homing +0.15', defect: 'Damage -2', run: () => { player.homing = (player.homing || 0) + 0.15; player.damage = Math.max(1, player.damage - 2); } },
    { id: 'SIZE', title: 'Mass Pulse', rarity: 'COMMON', buff: 'Attack size +50%', defect: 'Bullet speed -15%', run: () => { player.bulletSize = (player.bulletSize || 6) * 1.5; PLAYER_BULLET_SPEED *= 0.85; } },
    { id: 'LIFESTEAL', title: 'Siphon Soul', rarity: 'EPIC', buff: '3% Heal chance', defect: 'Max HP -2', run: () => { player.lifesteal = (player.lifesteal || 0) + 0.03; player.maxHealth = Math.max(1, player.maxHealth - 2); player.health = Math.min(player.health, player.maxHealth); updateHealthUI(); } },
    { id: 'PIERCE', title: 'Void Shell', rarity: 'RARE', weapon: 'GUN', buff: 'Pierce +1', defect: 'Fire rate -10%', run: () => { player.pierce = (player.pierce || 0) + 1; PLAYER_FIRE_RATE *= 1.1; } },
    { id: 'CRIT', title: 'Logic Fault', rarity: 'EPIC', buff: '+10% Crit chance', defect: 'Base damage -1', run: () => { player.crit = (player.crit || 0) + 0.1; player.damage = Math.max(1, player.damage - 1); } },
    { id: 'CHARGE_SHOT', title: 'Fusion Pulse', rarity: 'EPIC', weapon: 'GUN', buff: 'Enable Charge Shot', defect: 'Standard damage -2', run: () => { player.hasChargeShot = true; player.damage = Math.max(1, player.damage - 2); } },
    { id: 'BIGGER_SIZE', title: 'Titan Core', rarity: 'RARE', weapon: 'GUN', buff: 'Bullet size +100%', defect: 'Move speed -10%', run: () => { player.bulletSize = (player.bulletSize || 6) * 2; playerMoveSpeed *= 0.9; } },
    { id: 'MOVE_SPEED', title: 'Turbo Thruster', rarity: 'COMMON', buff: 'Move speed +30%', defect: 'Jump force -15%', run: () => { playerMoveSpeed *= 1.3; jumpForce *= 0.85; } },
    { id: 'RICOCHET', title: 'Ricochet', rarity: 'RARE', weapon: 'GUN', buff: 'Bounce +1', defect: 'Bullet speed -20%', run: () => { player.bounces++; PLAYER_BULLET_SPEED *= 0.8; } },
    { id: 'REAR_GUARD', title: 'Rear Guard', rarity: 'RARE', weapon: 'GUN', buff: 'Backshot +1', defect: 'Fire rate -5%', run: () => { player.backshot++; PLAYER_FIRE_RATE *= 1.05; } },
    { id: 'JUMP_JET', title: 'Jump Jet', rarity: 'COMMON', buff: 'Jump Force +25%', defect: 'Max HP -1', run: () => { jumpForce *= 1.25; player.maxHealth = Math.max(1, player.maxHealth - 1); player.health = Math.min(player.health, player.maxHealth); updateHealthUI(); } },
    { id: 'ARMOR', title: 'Ceramic Plate', rarity: 'RARE', buff: '20% Armor', defect: 'Move speed -10%', run: () => { player.armor = (player.armor || 0) + 0.2; playerMoveSpeed *= 0.9; } },
    { id: 'GLASS_CANNON', title: 'Glass Cannon', rarity: 'EPIC', buff: 'Damage +20', defect: 'Max HP -5', run: () => { player.damage += 20; player.maxHealth = Math.max(1, player.maxHealth - 5); player.health = Math.min(player.health, player.maxHealth); updateHealthUI(); } },
    { id: 'LONG_BARREL', title: 'Long Barrel', rarity: 'COMMON', weapon: 'GUN', buff: 'Range +50%', defect: 'Move speed -5%', run: () => { player.bulletLife *= 1.5; playerMoveSpeed *= 0.95; } },
    { id: 'STEADY_AIM', title: 'Steady Aim', rarity: 'RARE', weapon: 'GUN', buff: 'Rate & Spd +20%', defect: 'Bullet size -30%', run: () => { PLAYER_FIRE_RATE *= 0.8; PLAYER_BULLET_SPEED *= 1.2; player.bulletSize *= 0.7; } },
    { id: 'QUICK_RELOAD', title: 'Quick Fire', rarity: 'COMMON', weapon: 'GUN', buff: 'Rate +15%', defect: 'Damage -1', run: () => { PLAYER_FIRE_RATE *= 0.85; player.damage = Math.max(1, player.damage - 1); } },
    { id: 'SOLAR_PANEL', title: 'Solar Core', rarity: 'RARE', weapon: 'GUN', buff: 'Charge Speed 1.5x', defect: 'Max HP -1', run: () => { player.chargeSpeed *= 1.5; player.maxHealth = Math.max(1, player.maxHealth - 1); player.health = Math.min(player.health, player.maxHealth); updateHealthUI(); } },
    { id: 'HULL_HARDER', title: 'Hardened Hull', rarity: 'RARE', buff: 'Max HP +4', defect: 'Move speed -20%', run: () => { player.maxHealth += 4; player.health += 4; playerMoveSpeed *= 0.8; updateHealthUI(); } },
    { id: 'EXPLOSIVE', title: 'Nitro Core', rarity: 'EPIC', weapon: 'GUN', buff: 'Explosions', defect: 'Fire rate -20%', run: () => { player.explosive = (player.explosive || 0) + 1; PLAYER_FIRE_RATE *= 1.25; } },
    { id: 'SPLIT_SHOT', title: 'Fission Shell', rarity: 'EPIC', weapon: 'GUN', buff: 'Splitting Bullets', defect: 'Bullet speed -30%', run: () => { player.splitting = (player.splitting || 0) + 1; PLAYER_BULLET_SPEED *= 0.7; } },
    { id: 'BERSERKER', title: 'Berserker Engine', rarity: 'RARE', buff: 'Rate up as HP drops', defect: 'Max HP -2', run: () => { player.berserker = 1; player.maxHealth = Math.max(1, player.maxHealth - 2); player.health = Math.min(player.health, player.maxHealth); updateHealthUI(); } },
    { id: 'DRONE_PILOT', title: 'Drone Mk1', rarity: 'EPIC', buff: 'Tactical Drone', defect: 'Damage -5', run: () => { player.drones.push({ angle: Math.random() * Math.PI * 2, fireCooldown: 0, x: player.x, y: player.y, mk2: player.dronesMk2 }); player.damage = Math.max(1, player.damage - 5); } },
    { id: 'FROST_ROUNDS', title: 'Cryo Core', rarity: 'RARE', weapon: 'GUN', buff: 'Freeze Bullets', defect: 'Fire rate -10%', run: () => { player.frostRounds += 0.5; PLAYER_FIRE_RATE *= 1.1; } },
    { id: 'DRONE_PILOT_MK2', title: 'Drone Mk2', rarity: 'LEGENDARY', buff: 'Detached Drones', defect: 'Max HP -3', run: () => { player.drones.forEach(d => { d.mk2 = true; }); player.dronesMk2 = true; player.maxHealth = Math.max(1, player.maxHealth - 3); player.health = Math.min(player.health, player.maxHealth); updateHealthUI(); } },
    { id: 'REACTIVE_ARMOR', title: 'Reactive Core', rarity: 'RARE', buff: 'Revenge Nova', defect: 'Move speed -5%', run: () => { player.reactiveArmor++; playerMoveSpeed *= 0.95; } },
    { id: 'LAST_STAND', title: 'Final Protocol', rarity: 'LEGENDARY', buff: 'Invuln on Death', defect: 'Max HP -4', run: () => { player.lastStandUsed = false; player.maxHealth = Math.max(1, player.maxHealth - 4); player.health = Math.min(player.health, player.maxHealth); updateHealthUI(); } },
    { id: 'TITAN_PLATE', title: 'Titan Plate', rarity: 'RARE', buff: 'Max HP +5', defect: 'Move speed -25%', run: () => { player.maxHealth += 5; player.health += 5; playerMoveSpeed *= 0.75; updateHealthUI(); } },
    { id: 'SHARP_SHOOTER', title: 'Sharp Shooter', rarity: 'RARE', weapon: 'GUN', buff: 'Dist DMG +50%', defect: 'Bullet size -40%', run: () => { player.sharpShooter = true; player.bulletSize *= 0.6; } },
    { id: 'SNIPER_ROUND', title: 'Sniper Core', rarity: 'EPIC', weapon: 'GUN', buff: '+Pierce & Spd', defect: 'Fire rate -30%', run: () => { player.pierce = (player.pierce || 0) + 1; PLAYER_BULLET_SPEED *= 1.5; player.damage += 10; PLAYER_FIRE_RATE *= 1.3; } },
    { id: 'SCATTERGUN', title: 'Scatter Core', rarity: 'EPIC', weapon: 'GUN', buff: '+3 Bullets', defect: 'Damage -60%', run: () => { player.multishot += 3; player.damage = Math.max(1, player.damage * 0.4); } },
    { id: 'WHIRLWIND', title: 'Whirlwind', rarity: 'LEGENDARY', weapon: 'SWORD', buff: '360 Hit', defect: 'Jump force -20%', run: () => { player.whirlwind = true; jumpForce *= 0.8; } },
    { id: 'THROWING_SWORD', title: 'Spectral Blade', rarity: 'LEGENDARY', weapon: 'SWORD', buff: 'Ranged Swords', defect: 'Sword damage -5', run: () => { player.throwingSword = true; player.damage = Math.max(1, player.damage - 5); } },
    { id: 'VAMPIRIC_STRIKE', title: 'Vampiric Edge', rarity: 'EPIC', weapon: 'SWORD', buff: 'Huge Lifesteal', defect: 'Max HP -4', run: () => { player.lifesteal = (player.lifesteal || 0) + 0.1; player.maxHealth = Math.max(1, player.maxHealth - 4); player.health = Math.min(player.health, player.maxHealth); updateHealthUI(); } },
    { id: 'XP_BOOST', title: 'Core Extractor', rarity: 'LEGENDARY', buff: 'XP Multi +25%', defect: 'Max HP -1', run: () => { player.xpMultiplier = (player.xpMultiplier || 1.0) + 0.25; player.maxHealth = Math.max(1, player.maxHealth - 1); player.health = Math.min(player.health, player.maxHealth); updateHealthUI(); } }
];

const BOOMERANG_UPGRADES = [
    { id: 'BOOMERANG_EXTRA', title: 'Twin Orbit', rarity: 'EPIC', weapon: 'BOOMERANG', buff: '+1 Boomerang', defect: 'Damage -3', run: () => { player.boomerangCount++; player.boomerangDamage = Math.max(1, player.boomerangDamage - 3); } },
    { id: 'BOOMERANG_DMG', title: 'Sharp Edge', rarity: 'COMMON', weapon: 'BOOMERANG', buff: 'DMG +10', defect: 'Speed -15%', run: () => { player.boomerangDamage += 10; player.boomerangSpeed *= 0.85; } },
    { id: 'BOOMERANG_RANGE', title: 'Far Reach', rarity: 'COMMON', weapon: 'BOOMERANG', buff: 'Range +40%', defect: 'Return Speed -20%', run: () => { player.boomerangRange *= 1.4; player.boomerangReturnSpeed *= 0.8; } },
    { id: 'BOOMERANG_FROST', title: 'Glacial Blade', rarity: 'RARE', weapon: 'BOOMERANG', buff: 'Freeze Hits', defect: 'Damage -5', run: () => { player.boomerangFrost += 0.3; player.boomerangDamage = Math.max(1, player.boomerangDamage - 5); } },
    { id: 'BOOMERANG_SPEED', title: 'Quick Return', rarity: 'RARE', weapon: 'BOOMERANG', buff: 'Speed +30%', defect: 'Size -20%', run: () => { player.boomerangSpeed *= 1.3; player.boomerangReturnSpeed *= 1.3; player.boomerangSize *= 0.8; } }
];

const GRENADE_UPGRADES = [
    { id: 'GRENADE_COUNT', title: 'Cluster Pack', rarity: 'EPIC', weapon: 'GRENADE', buff: '+1 Grenade', defect: 'Radius -20%', run: () => { player.grenadeCount++; player.grenadeRadius *= 0.8; } },
    { id: 'GRENADE_RADIUS', title: 'Blast Shield', rarity: 'RARE', weapon: 'GRENADE', buff: 'Radius +50%', defect: 'Damage -10', run: () => { player.grenadeRadius *= 1.5; player.grenadeDamage = Math.max(1, player.grenadeDamage - 10); } },
    { id: 'GRENADE_DMG', title: 'Heavy Payload', rarity: 'COMMON', weapon: 'GRENADE', buff: 'DMG +20', defect: 'Bounces -1', run: () => { player.grenadeDamage += 20; player.grenadeBounces = Math.max(0, player.grenadeBounces - 1); } },
    { id: 'GRENADE_FRAG', title: 'Shrapnel', rarity: 'EPIC', weapon: 'GRENADE', buff: 'Release Fragments', defect: 'Radius -30%', run: () => { player.grenadeFrags += 4; player.grenadeRadius *= 0.7; } },
    { id: 'GRENADE_BOUNCE', title: 'Rubber Shell', rarity: 'COMMON', weapon: 'GRENADE', buff: 'Extra Bounce', defect: 'Damage -5', run: () => { player.grenadeBounces++; player.grenadeDamage = Math.max(1, player.grenadeDamage - 5); } }
];

const WAND_UPGRADES = [
    { id: 'WAND_AUTO', title: 'Sentient Will', rarity: 'LEGENDARY', weapon: 'WAND', buff: 'Faster Homing', defect: 'Damage -5', run: () => { player.wandHomingPower = (player.wandHomingPower || 1) * 2; player.damage = Math.max(1, player.damage - 5); } },
    { id: 'WAND_ORBIT', title: 'Arcane Orbit', rarity: 'EPIC', weapon: 'WAND', buff: '+1 Orb', defect: 'Size -20%', run: () => { player.multishot++; player.bulletSize *= 0.8; } },
    { id: 'WAND_LURK', title: 'Ghost Flame', rarity: 'RARE', weapon: 'WAND', buff: 'Duration +100%', defect: 'Fire rate -15%', run: () => { player.bulletLife *= 2; PLAYER_FIRE_RATE *= 1.15; } },
    { id: 'WAND_SPLAT', title: 'Mana Burst', rarity: 'RARE', weapon: 'WAND', buff: 'Size +50%', defect: 'Move speed -5%', run: () => { player.bulletSize *= 1.5; playerMoveSpeed *= 0.95; } }
];

const ALL_UPGRADES = [...UPGRADES, ...BOOMERANG_UPGRADES, ...GRENADE_UPGRADES, ...WAND_UPGRADES];

function checkLevelUp() {
    let reqXP = Math.floor(3.0 * Math.pow(currentLevel, 2)); // Increased from 1.8 for hard mode
    if (currentXP >= reqXP && gameState === 'PLAYING') {
        currentLevel++;
        showUpgradeScreen();
    }
}

function showUpgradeScreen() {
    gameState = 'UPGRADE';
    const screen = document.getElementById('upgrade-screen');
    const container = document.getElementById('card-selection');
    container.innerHTML = '';
    screen.style.display = 'flex';
    
    // Check constraints
    let validUpgrades = [...ALL_UPGRADES];
    validUpgrades = validUpgrades.filter(u => {
        // Exclusivity: Weapon-specific cards only show for that weapon
        if (u.weapon && u.weapon !== player.weaponType) {
            // Special case: Spectral Blade allows Gun cards
            if (player.throwingSword && u.weapon === 'GUN') {
                // Allow
            } else {
                return false;
            }
        }
        
        // Logical constraints
        if (u.id === 'DRONE_PILOT_MK2') {
            if (!player.drones || player.drones.length === 0 || player.dronesMk2) return false;
        }
        
        return true;
    });
    
    // Pick 3 random upgrades
    const shuffled = validUpgrades.sort(() => 0.5 - Math.random());
    const selection = shuffled.slice(0, 3);
    
    selection.forEach(up => {
        let displayBuff = up.buff || "---";
        let displayDefect = up.defect || "---";
        let displayTitle = up.title;
        
        if (player.weaponType === 'SWORD' && !player.throwingSword) {
            if (up.id === 'FIRE_RATE') displayBuff = 'Swing speed +25%';
            if (up.id === 'MULTISHOT') { displayTitle = 'Dual Edge'; displayBuff = 'Wider swing arc'; }
            if (up.id === 'SPEED') { displayTitle = 'Long Reach'; displayBuff = 'Sword length +25%'; }
            if (up.id === 'HOMING') { displayTitle = 'Lunge Core'; displayBuff = 'Lunge toward boss on swing'; }
            if (up.id === 'SIZE') displayBuff = 'Sword width/impact +50%';
            if (up.id === 'CHARGE_SHOT') { displayTitle = 'Fusion Blade'; displayBuff = 'Hold to charge heavy swing'; }
            if (up.id === 'LONG_BARREL') displayBuff = 'Sword length +50%';
            if (up.id === 'STEADY_AIM') displayBuff = 'Swing speed & Spd +20%';
            if (up.id === 'QUICK_RELOAD') displayBuff = 'Swing speed +15%';
            if (up.id === 'FROST_ROUNDS') displayBuff = 'Hits slow boss attacks';
            if (up.id === 'SHARP_SHOOTER') { displayTitle = 'Executioner'; displayBuff = 'DMG +50% to distant bosses'; }
        }

        if (player.weaponType === 'GRENADE') {
            if (up.id === 'FIRE_RATE') displayBuff = 'Throw rate +25%';
            if (up.id === 'SIZE') { displayTitle = 'Big Bang'; displayBuff = 'Explosion radius +50%'; }
            if (up.id === 'DAMAGE') displayBuff = 'Explosion damage +5';
        }

        const card = document.createElement('div');
        card.className = `upgrade-card ${up.rarity}`;
        card.innerHTML = `
            <div class="rarity">${up.rarity}</div>
            <h3 style="margin-bottom: 5px;">${displayTitle}</h3>
            <div style="text-align: left; background: rgba(46, 213, 115, 0.1); padding: 5px; border-radius: 4px; margin-bottom: 5px; font-size: 11px;">
                <span style="color: #2ed573; font-weight: bold; font-size: 9px; display: block;">Buff:</span>
                ${displayBuff}
            </div>
            <div style="text-align: left; background: rgba(255, 71, 87, 0.1); padding: 5px; border-radius: 4px; font-size: 11px;">
                <span style="color: #ff4757; font-weight: bold; font-size: 9px; display: block;">Downside:</span>
                ${displayDefect}
            </div>
            <div class="rarity" style="opacity: 0.3; margin-top: 10px;">SELECT</div>
        `;
        card.onclick = () => {
            up.run();
            // Track for inventory
            player.upgrades[up.id] = (player.upgrades[up.id] || 0) + 1;
            
            // Track in collection index
            const collected = JSON.parse(localStorage.getItem('collectedUpgrades') || '[]');
            if (!collected.includes(up.id)) {
                collected.push(up.id);
                localStorage.setItem('collectedUpgrades', JSON.stringify(collected));
            }
            screen.style.display = 'none';
            gameState = 'PLAYING';
            if (!boss || boss.health <= 0 || boss.state === 'DYING') {
                spawnNextBoss();
            }
            checkLevelUp();
            sfx.portal();
        };
        container.appendChild(card);
    });
    sfx.win();
}

// --- INDEX MENU ---
window.showIndex = function() {
    document.getElementById('title-screen').style.display = 'none';
    document.getElementById('index-screen').style.display = 'flex';
    const grid = document.getElementById('index-grid');
    grid.innerHTML = '';
    const collected = JSON.parse(localStorage.getItem('collectedUpgrades') || '[]');
    
    ALL_UPGRADES.forEach(up => {
        const isCollected = collected.includes(up.id);
        const el = document.createElement('div');
        el.className = `upgrade-card ${up.rarity}`;
        el.style.opacity = isCollected ? '1.0' : '0.2';
        el.style.filter = isCollected ? 'none' : 'grayscale(100%)';
        el.style.transform = 'none';
        el.style.cursor = 'default';
        el.innerHTML = `
            <div class="rarity">${up.rarity}</div>
            <h3 style="font-size: 14px;">${isCollected ? up.title : '???'}</h3>
            <p style="font-size: 10px;">${isCollected ? (up.buff + " | " + up.defect) : 'Unlocked by finding in runs'}</p>
        `;
        grid.appendChild(el);
    });
};

// --- SANDBOX MODE ---
window.showSandbox = function() {
    document.getElementById('title-screen').style.display = 'none';
    const screen = document.getElementById('sandbox-screen');
    screen.style.display = 'flex';
    
    // Populate Upgrades
    const upList = document.getElementById('sandbox-upgrades-list');
    upList.innerHTML = '';
    ALL_UPGRADES.forEach(up => {
        const lbl = document.createElement('label');
        lbl.style.display = 'flex';
        lbl.style.alignItems = 'center';
        lbl.style.gap = '10px';
        lbl.style.fontSize = '12px';
        lbl.title = up.buff + " | " + up.defect; // Add tooltip for hover
        lbl.innerHTML = `<input type="number" min="0" max="100" value="0" class="sandbox-up-input" data-id="${up.id}" style="width: 45px; background: #333; color: white; border: 1px solid #555; border-radius: 4px; padding: 2px;"> <span>${up.title}</span>`;
        upList.appendChild(lbl);
    });

    // Populate Attacks
    const atkList = document.getElementById('sandbox-attacks-list');
    atkList.innerHTML = '';
    const attackDescs = {
        'BURST': 'Fires a fast shotgun blast of bullets',
        'TRIPLE_SHOT': 'Fires 3 continuous targeted shots',
        'WAVE': 'Fires an expanding wave of bullets',
        'SINE': 'Shoots waving, oscillating streams',
        'BOUNCE': 'Fires large bouncing energy orbs',
        'WALL_STRIKE': 'Summons a barrier that closes in',
        'CHARGE': 'Boss dashes rapidly at the player',
        'BEAM_PREP': 'Charges and fires a massive continuous death ray',
        'MINES': 'Scatters explosive proximity mines',
        'SPIRAL': 'Spins and unleashes a bullet hell spiral',
        'SLAM_PREP': 'Leaps into the air and slams down heavily',
        'SUMMON': 'Spawns small minion enemies',
        'LAVA_PREP': 'Floods the lower arena with burning lava',
        'PHASE_SHIFT': 'Teleports rapidly and turns translucent',
        'ORBITAL_STRIKE': 'Calls down explosive pillars of light',
        'GRAVITY_WELL': 'Generates a pull that sucks the player in',
        'RING_SHOCK': 'Flashes rings that pulse outwards',
        'CROSS_BEAM': 'Creates intercepting laser grid lines',
        'STALACTITE': 'Drops debris from the ceiling',
        'SUMMON_MINION': 'Calls a specialized minion to assist',
        'METEOR_SHOWER': 'Calls down a rain of diagonal meteor strikes',
        'LASER_GRID': 'Flashes horizontal and vertical instant death beams'
    };
    
    Object.keys(attackDescs).forEach(a => {
        const lbl = document.createElement('label');
        lbl.style.display = 'flex';
        lbl.style.alignItems = 'center';
        lbl.style.gap = '5px';
        lbl.title = attackDescs[a]; // Add tooltip for hover
        lbl.innerHTML = `<input type="checkbox" value="${a}" class="sandbox-atk-cb" checked> <span>${a}</span>`;
        atkList.appendChild(lbl);
    });
};

window.startSandboxRun = function() {
    const atkCbs = document.querySelectorAll('.sandbox-atk-cb:checked');
    if (atkCbs.length === 0) {
        alert("Please select at least 1 boss attack.");
        return;
    }
    sandboxAttacks = Array.from(atkCbs).map(cb => cb.value);
    
    document.getElementById('sandbox-screen').style.display = 'none';
    document.getElementById('win-screen').style.display = 'none';
    document.getElementById('title-screen').style.display = 'none';
    document.getElementById('ui').style.display = 'block';
    
    isInfiniteMode = false;
    isSandboxMode = true;
    defeatedBossesCount = 0;
    gameState = 'PLAYING';
    startTime = Date.now();
    timerRunning = false;
    timerFinished = false;
    
    initLevel();

    // Apply selected upgrades
    const upInputs = document.querySelectorAll('.sandbox-up-input');
    upInputs.forEach(input => {
        const count = parseInt(input.value) || 0;
        if (count > 0) {
            const up = UPGRADES.find(u => u.id === input.dataset.id);
            if (up) {
                for (let i = 0; i < count; i++) {
                    up.run();
                    player.upgrades[up.id] = (player.upgrades[up.id] || 0) + 1;
                }
            }
        }
    });
};

function spawnNextBoss() {
    if (isInfiniteMode) {
        defeatedBossesCount++;
        document.getElementById('infinite-counter').innerText = `DEFEATED: ${defeatedBossesCount}`;
        if (defeatedBossesCount % 100 === 0) {
            boss = createCheeseLord(Math.pow(1.25, defeatedBossesCount), Math.pow(1.10, defeatedBossesCount));
        } else {
            boss = createInfiniteBoss();
        }
        player.bullets = [];
        updateHealthUI();
        setShake(20, 0.5);
        sfx.portal();
        respawn();
        return;
    }
    rushIndex++;
    if (rushIndex < BOSS_DATA.length) {
        boss = createBoss(rushIndex);
        player.bullets = [];
        updateHealthUI();
        setShake(20, 0.5);
        sfx.portal();
        respawn(); // Reset player to safe spawn point
    } else {
        nextLevel();
    }
}

function bossTakeDamage(target, amount = player.damage) {
    if (target.state === 'DYING' || target.health <= 0) return;
    amount *= 0.4; // Reduced player damage scaling for more challenge (from 0.5)
    target.health -= amount;
    target.hitResonance = BOSS_HIT_RESONANCE;
    setShake(5, 0.1);
    spawnParticles(target.x + target.width/2, target.y + target.height/2, target.color, 10);
    
    // Spawn small XP orb from hit
    if (Math.random() < 0.2) { // Reduced drop rate for harder progression (from 0.3)
        xpOrbs.push({
            x: target.x + target.width / 2,
            y: target.y + target.height / 2,
            vx: (Math.random() - 0.5) * 400,
            vy: -Math.random() * 300 - 100,
            value: 0.05, // Drastically reduced XP per hit for hard mode
            homingDelay: 0.5
        });
    }

    updateHealthUI();

    if (player.frostRounds) {
        target.slowTimer = Math.min(2.0, (target.slowTimer || 0) + 0.2);
    }

    if (target.traits && target.traits.includes('REACTIVE') && Math.random() < 0.25) {
        const pdx = (player.x + player.width/2) - (target.x + target.width/2);
        const pdy = (player.y + player.height/2) - (target.y + target.height/2);
        const pdist = Math.sqrt(pdx*pdx + pdy*pdy);
        if (pdist > 0) {
            target.projectiles = target.projectiles || [];
            target.projectiles.push({
                x: target.x + target.width/2, y: target.y + target.height/2,
                vx: (pdx/pdist) * 450, vy: (pdy/pdist) * 450,
                radius: 10, life: 3, type: 'NORMAL'
            });
        }
    }
    
    const phases = target.phases;
    const healthRatio = target.health / target.maxHealth;
    if (phases) {
        for (let i = 0; i < phases.length; i++) {
            if (healthRatio <= phases[i].threshold) {
                target.phase = i;
            }
        }
    }
    
    if (target.health <= 0) {
        target.state = 'DYING';
        target.attackTimer = 2.5;
        sfx.win();
        
        // Final burst of XP Orbs
        for(let i=0; i<15; i++) {
            xpOrbs.push({
                x: target.x + target.width / 2,
                y: target.y + target.height / 2,
                vx: (Math.random() - 0.5) * 600,
                vy: -Math.random() * 500 - 200,
                value: 0.2, 
                homingDelay: 1.0 + Math.random() * 1.5 
            });
        }
        // Release buffered XP
        currentXP += bufferedXP;
        bufferedXP = 0;
        checkLevelUp();
    }
}

function respawn() {
    player.x = spawnPoint.x;
    player.y = spawnPoint.y;
    player.velX = 0;
    player.velY = 0;
    player.jumping = false;
    player.invuln = INVULN_DURATION;
}

function nextLevel() {
    sfx.win();
    timerRunning = false;
    timerFinished = true;
    gameState = 'WIN';
    document.getElementById('ui').style.display = 'none';
    document.getElementById('win-screen').style.display = 'flex';
    const replayBtn = document.getElementById('win-replay-btn');
    if (isSandboxMode) {
        document.getElementById('final-time-text').innerText = `Sandbox Clear: ${formatTime(elapsedTime)}`;
        if (replayBtn) replayBtn.style.display = 'inline-block';
    } else {
        document.getElementById('final-time-text').innerText = `Time: ${formatTime(elapsedTime)}`;
        if (replayBtn) replayBtn.style.display = 'none';
    }
}

// 5. INPUT LISTENERS
window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    mouseX = (e.clientX - rect.left) * scaleX;
    mouseY = (e.clientY - rect.top) * scaleY;
});

window.addEventListener('mousedown', (e) => {
    isMouseDown = true;
});

window.addEventListener('mouseup', (e) => {
    isMouseDown = false;
});

function shoot(bonusCharge = 0) {
    if (player.health <= 0) return;
    
    if (player.weaponType === 'SWORD' && !player.throwingSword) {
        if (player.isSwinging) return;
        player.isSwinging = true;
        player.swingProgress = 0;
        player.swingCooldown = PLAYER_FIRE_RATE;
        player.currentSwingCharge = bonusCharge;
        player.swingHasHit = false;
        sfx.init();
        return;
    }

    let dx = mouseX - (player.x + player.width/2);
    let dy = mouseY - (player.y + player.height/2);

    if (player.weaponType === 'BOOMERANG') {
        const count = player.boomerangCount || 1;
        for (let i = 0; i < count; i++) {
            const angle = Math.atan2(dy, dx) + (i - (count-1)/2) * 0.2;
            player.bullets.push({
                x: player.x + player.width/2,
                y: player.y + player.height/2,
                vx: Math.cos(angle) * player.boomerangSpeed,
                vy: Math.sin(angle) * player.boomerangSpeed,
                radius: player.boomerangSize,
                life: 10,
                isBoomerang: true,
                state: 'OUT',
                returnTimer: player.boomerangRange / player.boomerangSpeed,
                damageTimer: 0,
                angle: 0
            });
        }
        player.fireCooldown = PLAYER_FIRE_RATE;
        sfx.click();
        return;
    }

    if (player.weaponType === 'GRENADE') {
        const count = player.grenadeCount || 1;
        for (let i = 0; i < count; i++) {
            const angle = Math.atan2(dy, dx) + (i - (count-1)/2) * 0.2;
            player.bullets.push({
                x: player.x + player.width/2,
                y: player.y + player.height/2,
                vx: Math.cos(angle) * 500,
                vy: Math.sin(angle) * 500 - 200, // Arc
                radius: 12,
                isGrenade: true,
                bounces: player.grenadeBounces || 1,
                timer: 1.5,
                angle: 0
            });
        }
        player.fireCooldown = PLAYER_FIRE_RATE;
        sfx.click();
        return;
    }

    if (player.weaponType === 'WAND') {
        const count = player.multishot || 1;
        for (let i = 0; i < count; i++) {
            const angle = Math.atan2(dy, dx) + (i - (count-1)/2) * 0.4;
            player.bullets.push({
                x: player.x + player.width/2,
                y: player.y + player.height/2,
                vx: Math.cos(angle) * 200, // Starts slow
                vy: Math.sin(angle) * 200,
                radius: (player.bulletSize || 8) * 1.2,
                isWand: true,
                life: (player.bulletLife || 3),
                homingPower: player.wandHomingPower || 1.0,
                color: '#ff00ff',
                initialDelay: 0.4 // Delay before it starts homing
            });
        }
        player.fireCooldown = PLAYER_FIRE_RATE * 1.2;
        sfx.portal();
        return;
    }
    
    // Default shoot forward if no clear aim
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
        dx = (player.velX >= 0) ? 1 : -1;
        dy = 0;
    }
    
    const chargeMultiplier = 1 + (bonusCharge * 1.5); // Max charge results in 4x total roughly if chargeTime=2
    const sizeMultiplier = 1 + bonusCharge * 0.5;

    const spread = 0.2;
    const bulletCount = (player.multishot || 1);
    
    // Forward shots
    for (let i = 0; i < bulletCount; i++) {
        const offset = (i - (bulletCount - 1) / 2) * spread;
        const angle = Math.atan2(dy, dx) + offset;
        createBullet(angle, sizeMultiplier, chargeMultiplier);
    }

    // Rear shots
    if (player.backshot && player.backshot > 0) {
        for (let i = 0; i < player.backshot; i++) {
            const angle = Math.atan2(dy, dx) + Math.PI + (Math.random() - 0.5) * 0.4;
            createBullet(angle, sizeMultiplier, chargeMultiplier);
        }
    }

    function createBullet(angle, sMult, cMult) {
        player.bullets.push({
            x: player.x + player.width/2,
            y: player.y + player.height/2,
            vx: Math.cos(angle) * PLAYER_BULLET_SPEED,
            vy: Math.sin(angle) * PLAYER_BULLET_SPEED,
            radius: (player.bulletSize || 6) * sMult,
            life: (player.bulletLife || 2.0),
            pierce: player.pierce || 0,
            damageScale: cMult,
            bounces: player.bounces || 0
        });
    }

    player.fireCooldown = PLAYER_FIRE_RATE;
    sfx.click();
    setShake(2 + bonusCharge * 8, 0.05);
}

let creditSequence = "";

window.addEventListener('keydown', (e) => {
    // Hidden Credits logic
    if (gameState === 'TITLE' && e.key.length === 1) {
        creditSequence += e.key.toUpperCase();
        if (creditSequence.length > 6) creditSequence = creditSequence.substring(creditSequence.length - 6);
        if (creditSequence === 'CREDIT') {
            document.getElementById('title-screen').style.display = 'none';
            document.getElementById('credits-screen').style.display = 'flex';
            creditSequence = "";
        }
    }

    if (remappingKey) {
        controls[remappingKey] = e.code;
        const btn = document.getElementById(`key-${remappingKey}`);
        btn.innerText = e.code;
        btn.classList.remove('waiting');
        remappingKey = null;
        saveControls(); // Save after remap
        return;
    }

    keys[e.code] = true;
    if (e.key === 'Tab') {
        e.preventDefault();
        toggleInventory();
    }
    if (e.key === '\\') {
        window.location.href = 'editor.html';
    }
    if (e.key === 'Escape') {
        const indexScreen = document.getElementById('index-screen');
        const sandboxScreen = document.getElementById('sandbox-screen');
        const controlsScreen = document.getElementById('controls-screen');
        const adminPanel = document.getElementById('admin-panel');
        const inventoryScreen = document.getElementById('inventory-screen');

        if (inventoryScreen && inventoryScreen.style.display === 'flex') {
            toggleInventory();
        } else if ((indexScreen && indexScreen.style.display === 'flex') || 
            (sandboxScreen && sandboxScreen.style.display === 'flex') ||
            (controlsScreen && controlsScreen.style.display === 'flex') ||
            (adminPanel && adminPanel.style.display === 'flex')) {
            showTitle();
        } else if (gameState !== 'TITLE') {
            resetRun(true);
        }
    }
    if (e.code === controls.reset && (gameState === 'PLAYING' || gameState === 'WIN')) {
        resetRun(false);
    }
    if (e.code === controls.interact && gameState === 'PLAYING') {
        if (dialogueActive) {
            closeDialogue();
        } else if (currentInteractable) {
            if (currentInteractable.type === 'NPC') {
                openDialogue(currentInteractable.dialogue || "Hello there!");
            } else if (currentInteractable.type === 'LEVER' || currentInteractable.type === 'BUTTON') {
                toggleChannel(currentInteractable.channel);
            }
        } else {
            isShootKeyDown = true;
        }
    }
});
window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === controls.interact) isShootKeyDown = false;
});

// Touch Listeners
function setupTouchEvents() {
    const attach = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('touchstart', (e) => {
            e.preventDefault();
            touchKeys[key] = true;
            sfx.init(); // Initialize audio on first interaction
        });
        el.addEventListener('touchend', (e) => {
            e.preventDefault();
            touchKeys[key] = false;
        });
        el.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            touchKeys[key] = false;
        });
    };
    attach('touch-left', 'left');
    attach('touch-right', 'right');
    attach('touch-jump', 'jump');
    attach('touch-interact', 'interact');
}
setupTouchEvents();
updateSettingsUI();

// 6. GAME ENGINE
function update(timestamp) {
    if (!lastTime) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000; 
    lastTime = timestamp;

    if (gameState !== 'PLAYING') {
        if (gameState === 'UPGRADE' || gameState === 'PAUSED_INVENTORY') {
            draw();
        }
        requestAnimationFrame(update);
        return;
    }

    if (dialogueActive) {
        lastTime = timestamp;
        requestAnimationFrame(update);
        return;
    }

    if (dt > 0.1) dt = 0.1;
    gameTime += dt * 2; 

    // --- MULTIPLAYER UPDATE ---
    if (multiplayer.status === 'playing' && multiplayer.roomId) {
        updateMultiplayer(dt);
        // Skip normal boss logic
    } else {
        // --- 0. BOSS LOGIC ---
        if (boss) updateBossEntity(boss);
        if (isSandboxMode && boss2) updateBossEntity(boss2);
    }

    function updateBossEntity(b) {
        if (!b) return;
        const _dt = dt; // store original dt
        dt = _dt * (b.speedMod || 1.0); // scale up boss perceived time

        if (b.hitResonance > 0) b.hitResonance -= _dt;
        if (b.slowTimer > 0) b.slowTimer -= _dt;

        let effectiveDt = dt;
        if (b.slowTimer > 0) effectiveDt *= 0.6;

        if (b.traits && b.traits.includes('DEPRESSED') && b.state !== 'DYING') {
            b.state = 'DEPRESSED';
        }

        // --- NEW TRAIT LOGIC ---
        if (b.traits && b.traits.includes('STATIC')) {
            b.staticTimer = (b.staticTimer || 0) + dt;
            if (b.staticTimer > 3.0) {
                b.staticTimer = 0;
                for (let i = 0; i < 12; i++) {
                    const ang = (i / 12) * Math.PI * 2;
                    b.projectiles.push({
                        x: b.x + b.width/2, y: b.y + b.height/2,
                        vx: Math.cos(ang) * 300, vy: Math.sin(ang) * 300,
                        radius: 12, life: 2, type: 'NORMAL', color: '#00d2ff'
                    });
                }
            }
        }
        if (b.traits && b.traits.includes('ORBITAL')) {
            if (!b.orbitPoints) {
                b.orbitPoints = [];
                for (let i = 0; i < 3; i++) {
                    b.orbitPoints.push({ angle: (i/3) * Math.PI * 2 });
                }
            }
            b.orbitPoints.forEach(orb => {
                orb.angle += dt * 3;
                const ox = b.x + b.width/2 + Math.cos(orb.angle) * (b.width * 0.8 + 20);
                const oy = b.y + b.height/2 + Math.sin(orb.angle) * (b.width * 0.8 + 20);
                const dx = (player.x + player.width/2) - ox;
                const dy = (player.y + player.height/2) - oy;
                if (Math.sqrt(dx*dx + dy*dy) < 20) playerTakeDamage();
                
                // Draw orbital logic (this is in update, but we should handle damage here)
            });
        }
        if (b.traits && b.traits.includes('TELEPORT')) {
            b.teleTimer = (b.teleTimer || 0) + dt;
            if (b.teleTimer > 5.0) {
                b.teleTimer = 0;
                b.x = Math.random() * (canvas.width - b.width - 40) + 20;
                b.y = Math.random() * 150 + 50;
                setShake(10, 0.2);
                spawnParticles(b.x + b.width/2, b.y + b.height/2, b.color, 15);
            }
        }

        if (b.state === 'IDLE') {
            b.attackTimer -= effectiveDt;
            // Float movement
            b.targetY = 150 + Math.sin(gameTime * 0.8) * 40;
            const spawnX = b.spawnX;
            b.targetX = spawnX + Math.cos(gameTime * 0.5) * 80;
            b.x += (b.targetX - b.x) * effectiveDt * 2;
            b.y += (b.targetY - b.y) * effectiveDt * 2;

            if (b.attackTimer <= 0) {
                const pool = (b.phases && b.phases[b.phase || 0]) ? b.phases[b.phase || 0].attacks : ['BURST'];
                b.state = pool[Math.floor(Math.random() * pool.length)];
                
                if (b.state === 'BURST') b.attackTimer = 1.5;
                else if (b.state === 'TRIPLE_SHOT') b.attackTimer = 1.0;
                else if (b.state === 'WAVE') b.attackTimer = 1.5;
                else if (b.state === 'SINE') b.attackTimer = 2.0;
                else if (b.state === 'BOUNCE') b.attackTimer = 1.8;
                else if (b.state === 'WALL_STRIKE') b.attackTimer = 1.0;
                else if (b.state === 'RING_SHOCK') b.attackTimer = 1.5;
                else if (b.state === 'CROSS_BEAM') b.attackTimer = 2.0;
                else if (b.state === 'STALACTITE') b.attackTimer = 2.0;
                else if (b.state === 'SUMMON_MINION') {
                    b.attackTimer = 0.5;
                }
                else if (b.state === 'CHARGE') {
                    b.attackTimer = 1.0;
                    b.targetX = player.x;
                    b.targetY = player.y;
                } else if (b.state === 'BEAM_PREP') {
                    b.attackTimer = 1.5;
                    b.beam.x1 = b.x + b.width/2;
                    b.beam.y1 = b.y + b.height/2;
                    b.beam.targetX = player.x + player.width/2;
                    b.beam.targetY = player.y + player.height/2;
                } else if (b.state === 'MINES') {
                    b.attackTimer = 0.5;
                } else if (b.state === 'SPIRAL') {
                    b.attackTimer = 2.0;
                } else if (b.state === 'SLAM_PREP') {
                    b.attackTimer = 1.0;
                    b.targetX = player.x;
                    b.targetY = 50;
                } else if (b.state === 'SUMMON') {
                    b.attackTimer = 0.5;
                } else if (b.state === 'LAVA_PREP') {
                    b.attackTimer = 1.5;
                    lavaFlash = 1.5;
                } else if (b.state === 'ORBITAL_STRIKE') {
                    b.attackTimer = 2.0;
                    b.targetX = player.x;
                } else if (b.state === 'GRAVITY_WELL') {
                    b.attackTimer = 3.0;
                } else if (b.state === 'PHASE_SHIFT') {
                    b.attackTimer = 2.0;
                } else if (b.state === 'METEOR_SHOWER') {
                    b.attackTimer = 2.0;
                } else if (b.state === 'LASER_GRID') {
                    b.attackTimer = 0.5;
                }
            }
        } else if (b.state === 'RING_SHOCK') {
            b.attackTimer -= effectiveDt;
            if (Math.floor(b.attackTimer * 10) % 3 === 0 && b.attackTimer > 0) {
                for (let i = 0; i < 16; i++) {
                    const ang = (i / 16) * Math.PI * 2 + (b.attackTimer * 2);
                    b.projectiles.push({
                        x: b.x + b.width/2, y: b.y + b.height/2,
                        vx: Math.cos(ang) * 400, vy: Math.sin(ang) * 400,
                        radius: 8, life: 3, type: 'NORMAL'
                    });
                }
            }
            if (b.attackTimer <= 0) { b.state = 'IDLE'; b.attackTimer = 1.5; }
        } else if (b.state === 'CROSS_BEAM') {
            b.attackTimer -= effectiveDt;
            if (b.attackTimer > 0.5 && b.attackTimer < 1.8) {
                b.crossX = player.x + player.width/2;
                b.crossY = player.y + player.height/2;
            }
            if (b.attackTimer <= 0.5 && b.attackTimer > 0) {
                const px = player.x + player.width/2;
                const py = player.y + player.height/2;
                if (Math.abs(px - b.crossX) < 20 || Math.abs(py - b.crossY) < 20) {
                    playerTakeDamage();
                }
            }
            if (b.attackTimer <= 0) { b.state = 'IDLE'; b.attackTimer = 2.0; }
        } else if (b.state === 'STALACTITE') {
            b.attackTimer -= effectiveDt;
            if (Math.floor(b.attackTimer * 10) % 2 === 0 && b.attackTimer > 0) {
                b.projectiles.push({
                    x: Math.random() * canvas.width, y: 0,
                    vx: (Math.random() - 0.5) * 100, vy: 800,
                    radius: 12, life: 2, type: 'LARGE'
                });
            }
            if (b.attackTimer <= 0) { b.state = 'IDLE'; b.attackTimer = 1.5; }
        } else if (b.state === 'ORBITAL_STRIKE') {
            b.attackTimer -= dt;
            if (b.attackTimer <= 1.2 && Math.floor(b.attackTimer * 10) % 2 === 0) {
                 // Telegraph
            }
            if (b.attackTimer <= 0) {
                b.projectiles.push({
                    x: b.targetX, y: 0,
                    vx: 0, vy: 1200,
                    radius: 30, life: 1, type: 'LARGE'
                });
                b.state = 'IDLE'; b.attackTimer = 1.0;
                setShake(10, 0.2);
            }
        } else if (b.state === 'GRAVITY_WELL') {
            b.attackTimer -= dt;
            const dx = (b.x + b.width/2) - (player.x + player.width/2);
            const dy = (b.y + b.height/2) - (player.y + player.height/2);
            const dist = Math.sqrt(dx*dx + dy*dy);
            const force = 300 * dt;
            player.velX += (dx/dist) * force;
            player.velY += (dy/dist) * force;
            if (Math.floor(b.attackTimer * 10) % 2 === 0) {
                spawnParticles(b.x + b.width/2, b.y + b.height/2, b.color, 1);
            }
            if (b.attackTimer <= 0) { b.state = 'IDLE'; b.attackTimer = 1.5; }
        } else if (b.state === 'PHASE_SHIFT') {
            b.attackTimer -= dt;
            if (Math.floor(b.attackTimer * 10) % 3 === 0) {
                b.x = Math.random() * (canvas.width - 100) + 50;
                b.y = Math.random() * (canvas.height - 200) + 50;
                spawnParticles(b.x, b.y, b.color, 5);
            }
            if (b.attackTimer <= 0) { b.state = 'IDLE'; b.attackTimer = 1.0; }
        } else if (b.state === 'SLAM_PREP') {
            b.attackTimer -= dt;
            b.x += (b.targetX - b.x) * dt * 5;
            b.y += (b.targetY - b.y) * dt * 5;
            if (b.attackTimer <= 0) {
                b.state = 'SLAM_FALL';
                b.velY = 0;
            }
        } else if (b.state === 'SLAM_FALL') {
            b.velY += 3000 * dt;
            b.y += b.velY * dt;
            if (b.y >= 300) {
                b.y = 300;
                b.state = 'SLAM_GROUND';
                b.attackTimer = 1.0;
                setShake(20, 0.4);
                sfx.land();
                // Shockwave
                for (let i = -1; i <= 1; i += 2) {
                    b.projectiles.push({
                        x: b.x + b.width/2, y: 370,
                        vx: i * 600, vy: 0,
                        radius: 15, life: 1.5, type: 'LARGE'
                    });
                }
            }
        } else if (b.state === 'SLAM_GROUND') {
            b.attackTimer -= dt;
            if (b.attackTimer <= 0) { b.state = 'IDLE'; b.attackTimer = 1.5; }
        } else if (b.state === 'SUMMON') {
            b.attackTimer -= dt;
            if (b.attackTimer <= 0) {
                for (let i = 0; i < 3; i++) {
                    b.seekers.push({
                        x: b.x + b.width/2, y: b.y + b.height/2,
                        vx: (Math.random() - 0.5) * 200,
                        vy: (Math.random() - 0.5) * 200,
                        radius: 10, life: 5,
                        homingPower: 4.0 // High at first
                    });
                }
                b.state = 'IDLE'; b.attackTimer = 2.0;
            }
        } else if (b.state === 'SUMMON_MINION') {
            b.attackTimer -= dt;
            if (b.attackTimer <= 0) {
                const pool = ['BURST', 'TRIPLE_SHOT', 'SINE'][Math.floor(Math.random() * 3)];
                b.minions = b.minions || [];
                if (b.minions.length < 5) {
                    b.minions.push({
                        x: canvas.width/2 - 20, y: canvas.height/2 - 20, spawnX: canvas.width/2 - 20,
                        width: 40, height: 40,
                        health: 2, maxHealth: 2,
                        state: 'IDLE', attackTimer: 1.0, phase: 0,
                        color: '#e74c3c', name: 'MINION',
                        targetX: b.x + b.width/2 - 20, targetY: b.y + b.height/2 + 50,
                        projectiles: [], mines: [], seekers: [],
                        beam: { active: false, x1: 0, y1: 0, x2: 0, y2: 0, width: 0, timer: 0 },
                        lastSpiralTick: 0, hitResonance: 0, slowTimer: 0, isMinion: true,
                        phases: [{ threshold: 1.0, attacks: [pool] }]
                    });
                }
                b.state = 'IDLE'; b.attackTimer = 2.5;
            }
        } else if (b.state === 'LAVA_PREP') {
            b.attackTimer -= dt;
            lavaFlash = b.attackTimer;
            if (b.attackTimer <= 0) {
                b.state = 'LAVA_ACTIVE';
                b.attackTimer = 3.0;
                lavaTimer = 3.0;
                sfx.portal();
            }
        } else if (b.state === 'LAVA_ACTIVE') {
            b.attackTimer -= dt;
            if (b.attackTimer <= 0) { b.state = 'IDLE'; b.attackTimer = 2.0; }
        } else if (b.state === 'WAVE') {
            b.attackTimer -= dt;
            if (Math.floor(b.attackTimer * 20) % 2 === 0 && b.attackTimer > 0) {
                const angle = (gameTime * 4) % (Math.PI * 2);
                b.projectiles.push({
                    x: b.x + b.width/2, y: b.y + b.height/2,
                    vx: Math.cos(angle) * 400, vy: Math.sin(angle) * 400,
                    radius: 8, life: 4, type: 'NORMAL'
                });
            }
            if (b.attackTimer <= 0) { b.state = 'IDLE'; b.attackTimer = 1.0; }
        } else if (b.state === 'SINE') {
            b.attackTimer -= dt;
            if (Math.floor(b.attackTimer * 8) % 2 === 0 && b.attackTimer > 0) {
                const dx = (player.x + player.width/2) - (b.x + b.width/2);
                const dy = (player.y + player.height/2) - (b.y + b.height/2);
                const angle = Math.atan2(dy, dx);
                b.projectiles.push({
                    x: b.x + b.width/2, y: b.y + b.height/2,
                    vx: Math.cos(angle) * 300, vy: Math.sin(angle) * 300,
                    radius: 8, life: 5, type: 'SINE', time: gameTime
                });
            }
            if (b.attackTimer <= 0) { b.state = 'IDLE'; b.attackTimer = 1.2; }
        } else if (b.state === 'BOUNCE') {
            b.attackTimer -= dt;
            if (b.attackTimer <= 0) {
                for (let i = 0; i < 8; i++) {
                    const angle = (i / 8) * Math.PI * 2;
                    b.projectiles.push({
                        x: b.x + b.width/2, y: b.y + b.height/2,
                        vx: Math.cos(angle) * 350, vy: Math.sin(angle) * 350,
                        radius: 10, life: 6, type: 'BOUNCE'
                    });
                }
                b.state = 'IDLE'; b.attackTimer = 1.5;
            }
        } else if (b.state === 'WALL_STRIKE') {
            b.attackTimer -= dt;
            if (b.attackTimer <= 0) {
                const side = Math.random() > 0.5 ? 0 : 800; // Left or right
                for (let i = 0; i < 10; i++) {
                    b.projectiles.push({
                        x: side, y: i * 40,
                        vx: side === 0 ? 500 : -500, vy: 0,
                        radius: 12, life: 2, type: 'LARGE'
                    });
                }
                b.state = 'IDLE'; b.attackTimer = 1.5;
            }
        } else if (b.state === 'METEOR_SHOWER') {
            b.attackTimer -= dt;
            if (Math.floor(b.attackTimer * 10) % 3 === 0 && b.attackTimer > 0) {
                b.projectiles.push({
                    x: Math.random() * canvas.width, y: -50,
                    vx: (Math.random() - 0.5) * 50, vy: 500 + Math.random() * 300,
                    radius: 18, life: 3, type: 'LARGE'
                });
            }
            if (b.attackTimer <= 0) { b.state = 'IDLE'; b.attackTimer = 1.8; }
        } else if (b.state === 'LASER_GRID') {
            b.attackTimer -= dt;
            if (b.attackTimer <= 0) {
                for (let i = 0; i < 5; i++) {
                    b.projectiles.push({
                        x: 0, y: i * 80 + 40,
                        vx: 600, vy: 0,
                        radius: 8, life: 2, type: 'NORMAL'
                    });
                    b.projectiles.push({
                        x: i * 160 + 80, y: 0,
                        vx: 0, vy: 600,
                        radius: 8, life: 2, type: 'NORMAL'
                    });
                }
                b.state = 'IDLE'; b.attackTimer = 2.0;
            }
        } else if (b.state === 'BURST') {
            b.attackTimer -= dt;
            if (Math.floor(b.attackTimer * 10) % 2 === 0 && b.attackTimer > 0) {
                const angle = Math.random() * Math.PI * 2;
                b.projectiles.push({
                    x: b.x + b.width/2,
                    y: b.y + b.height/2,
                    vx: Math.cos(angle) * 350,
                    vy: Math.sin(angle) * 350,
                    radius: 8,
                    life: 3,
                    type: 'NORMAL'
                });
            }
            if (b.attackTimer <= 0) {
                b.state = 'IDLE';
                b.attackTimer = 1.0;
            }
        } else if (b.state === 'TRIPLE_SHOT') {
            b.attackTimer -= dt;
            if (b.attackTimer <= 0) {
                const dx = (player.x + player.width/2) - (b.x + b.width/2);
                const dy = (player.y + player.height/2) - (b.y + b.height/2);
                const baseAngle = Math.atan2(dy, dx);
                const id = b.id || 0;
                const shots = id === 1 ? 5 : 3; // Gamma fires more shots
                const spread = id === 1 ? 0.6 : 0.25;
                
                for (let i = 0; i < shots; i++) {
                    const angle = baseAngle + (i - (shots-1)/2) * (spread / (shots-1 || 1));
                    b.projectiles.push({
                        x: b.x + b.width/2,
                        y: b.y + b.height/2,
                        vx: Math.cos(angle) * 500,
                        vy: Math.sin(angle) * 500,
                        radius: 10,
                        life: 4,
                        type: 'LARGE'
                    });
                }
                b.state = 'IDLE';
                b.attackTimer = 0.8;
            }
        } else if (b.state === 'CHARGE') {
            b.attackTimer -= dt;
            if (b.attackTimer <= 0) {
                const dx = b.targetX - b.x;
                const dy = b.targetY - b.y;
                const dist = Math.sqrt(dx*dx+dy*dy);
                b.x += (dx/dist) * 900 * dt;
                b.y += (dy/dist) * 900 * dt;
                if (dist < 15) {
                    b.state = 'IDLE';
                    b.attackTimer = 1.2;
                    setShake(8, 0.2);
                }
            }
        } else if (b.state === 'BEAM_PREP') {
            b.attackTimer -= dt;
            const tx = player.x + player.width/2;
            const ty = player.y + player.height/2;
            // Gamma tracks player faster
            const trackSpeed = (b.id || 0) === 1 ? 4 : 2;
            b.beam.targetX += (tx - b.beam.targetX) * dt * trackSpeed;
            b.beam.targetY += (ty - b.beam.targetY) * dt * trackSpeed;
            b.beam.x1 = b.x + b.width/2;
            b.beam.y1 = b.y + b.height/2;
            
            if (b.attackTimer <= 0) {
                b.state = 'BEAM_FIRE';
                b.attackTimer = 1.2;
                sfx.portal();
                setShake(5, 1.0);
            }
        } else if (b.state === 'BEAM_FIRE') {
            b.attackTimer -= dt;
            b.beam.x1 = b.x + b.width/2;
            b.beam.y1 = b.y + b.height/2;
            
            const px = player.x + player.width/2;
            const py = player.y + player.height/2;
            const x1 = b.beam.x1, y1 = b.beam.y1;
            const x2 = b.beam.targetX, y2 = b.beam.targetY;
            const lenSq = (x2-x1)**2 + (y2-y1)**2;
            const t = Math.max(0, Math.min(1, ((px-x1)*(x2-x1) + (py-y1)*(y2-y1)) / lenSq));
            const projX = x1 + t * (x2-x1);
            const projY = y1 + t * (y2-y1);
            const dist = Math.sqrt((px-projX)**2 + (py-projY)**2);
            
            if (dist < 30) playerTakeDamage();

            if (b.attackTimer <= 0) {
                b.state = 'IDLE';
                b.attackTimer = 1.5;
            }
        } else if (b.state === 'MINES') {
            b.attackTimer -= dt;
            if (b.attackTimer <= 0) {
                const count = (b.id || 0) === 1 ? 5 : 3;
                for (let i = 0; i < count; i++) {
                    b.mines.push({
                        x: Math.random() * (canvas.width - 100) + 50,
                        y: Math.random() * (canvas.height - 100) + 50,
                        radius: 15,
                        timer: 3.5 + Math.random() * 2,
                        state: 'READY'
                    });
                }
                b.state = 'IDLE';
                b.attackTimer = 2.5;
            }
        } else if (b.state === 'SPIRAL') {
            b.attackTimer -= dt;
            // Throttle spiral fire rate
            const currentTick = Math.floor(gameTime * 15);
            if (currentTick !== b.lastSpiralTick && b.attackTimer > 0) {
                b.lastSpiralTick = currentTick;
                const angle = gameTime * 6;
                const count = (b.id || 0) === 1 ? 3 : 2; // More points for Gamma
                for (let i = 0; i < count; i++) {
                    const finalAngle = angle + (i * (Math.PI * 2 / count));
                    b.projectiles.push({
                        x: b.x + b.width/2,
                        y: b.y + b.height/2,
                        vx: Math.cos(finalAngle) * 450,
                        vy: Math.sin(finalAngle) * 450,
                        radius: 7,
                        life: 3,
                        type: 'NORMAL'
                    });
                }
            }
            if (b.attackTimer <= 0) {
                b.state = 'IDLE';
                b.attackTimer = 1.0;
            }
        } else if (b.state === 'DEPRESSED') {
            b.targetY = canvas.height - ARENA_FLOOR - b.height;
            b.y += (b.targetY - b.y) * dt * 5;
            b.x += (b.spawnX - b.x) * dt * 2;
            if (Math.random() < 0.05) spawnParticles(b.x + Math.random()*b.width, b.y, '#00d2ff', 1); // tears
        } else if (b.state === 'DYING') {
            b.attackTimer -= dt;
            spawnParticles(b.x + Math.random()*b.width, b.y + Math.random()*b.height, b.color, 2);
            if (b.attackTimer <= 0) {
                if (isSandboxMode) {
                    nextLevel(); // End sandbox run
                } else if (!isInfiniteMode && rushIndex >= BOSS_DATA.length - 1) {
                    spawnNextBoss(); // Actually this terminates the normal run and shows win screen
                } else {
                    spawnNextBoss();
                }
            }
        }

        // Update Projectiles
        b.projectiles = b.projectiles.filter(p => {
            if (p.initialLife === undefined) {
                if (b.traits && b.traits.includes('BOOMERANG')) {
                    p.life *= 2.5; // Give more time to return
                }
                p.initialLife = p.life;
            }
            if (b.traits && b.traits.includes('HOMING')) {
                const pdx = (player.x + player.width/2) - p.x;
                const pdy = (player.y + player.height/2) - p.y;
                const pdist = Math.sqrt(pdx*pdx + pdy*pdy);
                if (pdist > 0) {
                    const speed = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
                    const homingStrength = 600 * dt;
                    p.vx += (pdx/pdist) * homingStrength;
                    p.vy += (pdy/pdist) * homingStrength;
                    const newSpeed = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
                    p.vx = (p.vx / newSpeed) * speed;
                    p.vy = (p.vy / newSpeed) * speed;
                }
            } else if (b.traits && b.traits.includes('BOOMERANG')) {
                if (p.life < p.initialLife * 0.6) {
                    const pdx = (b.x + b.width/2) - p.x;
                    const pdy = (b.y + b.height/2) - p.y;
                    const pdist = Math.sqrt(pdx*pdx + pdy*pdy);
                    if (pdist > 0) {
                        p.vx += (pdx/pdist) * 1200 * dt;
                        p.vy += (pdy/pdist) * 1200 * dt;
                    }
                }
            }

            if (p.type === 'SINE') {
                const elapsed = gameTime - p.time;
                const lateralX = -p.vy;
                const lateralY = p.vx;
                const norm = Math.sqrt(lateralX**2 + lateralY**2);
                const ox = (lateralX/norm) * Math.sin(elapsed * 10) * 5;
                const oy = (lateralY/norm) * Math.sin(elapsed * 10) * 5;
                p.x += (p.vx * dt) + ox;
                p.y += (p.vy * dt) + oy;
            } else {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
            }

            if (p.type === 'BOUNCE') {
                if (p.x < 0 && p.vx < 0) { p.x = 0; p.vx *= -1; }
                else if (p.x > canvas.width && p.vx > 0) { p.x = canvas.width; p.vx *= -1; }
                if (p.y < 0 && p.vy < 0) { p.y = 0; p.vy *= -1; }
                else if (p.y > canvas.height && p.vy > 0) { p.y = canvas.height; p.vy *= -1; }
            } else if (b.traits && b.traits.includes('BOUNCY')) {
                let bounced = false;
                if (p.x < 0 && p.vx < 0) { p.x = 0; p.vx *= -1; bounced = true; }
                else if (p.x > canvas.width && p.vx > 0) { p.x = canvas.width; p.vx *= -1; bounced = true; }
                if (p.y < 0 && p.vy < 0) { p.y = 0; p.vy *= -1; bounced = true; }
                else if (p.y > canvas.height && p.vy > 0) { p.y = canvas.height; p.vy *= -1; bounced = true; }
                if (bounced) {
                    p.bounces = (p.bounces || 0) + 1;
                    if (p.bounces > 3) p.life = 0;
                }
            }

            // Check collision with breakable platforms (and non-breakable)
            if (!b.traits || (!b.traits.includes('GHOST') && !b.traits.includes('BOOMERANG'))) {
                let hitPlatform = false;
                for (let i = 0; i < worldObjects.length; i++) {
                    let obj = worldObjects[i];
                    if (obj.type === 'PLATFORM' && p.x > obj.currentX && p.x < obj.currentX + obj.width && p.y > obj.currentY && p.y < obj.currentY + obj.height) {
                        hitPlatform = true;
                        if (obj.isBreakable) {
                            obj.health--;
                            if (obj.health <= 0) obj.isBroken = true;
                        }
                        break;
                    }
                }
                if (hitPlatform) {
                    if (b.traits && b.traits.includes('BOUNCY') && (p.bounces || 0) < 3) {
                        p.vy *= -1;
                        p.vx *= -1;
                        p.bounces = (p.bounces || 0) + 1;
                    } else {
                        spawnParticles(p.x, p.y, b.color, 5);
                        return false;
                    }
                }
            }

            p.life -= dt;
            const dx = (player.x + player.width/2) - p.x;
            const dy = (player.y + player.height/2) - p.y;
            if (Math.sqrt(dx*dx + dy*dy) < p.radius + player.width/2) {
                playerTakeDamage();
                return false;
            }
            return p.life > 0;
        });

        // Update Seekers
        b.seekers = b.seekers.filter(s => {
            const dx = (player.x + player.width/2) - s.x;
            const dy = (player.y + player.height/2) - s.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            // Homing logic: strength decays over time
            s.homingPower = Math.max(0, s.homingPower - dt * 0.8);
            if (s.homingPower > 0) {
                s.vx += (dx/dist) * 800 * s.homingPower * dt;
                s.vy += (dy/dist) * 800 * s.homingPower * dt;
            }
            
            const speed = Math.sqrt(s.vx**2 + s.vy**2);
            const maxSpeed = 350;
            if (speed > maxSpeed) {
                s.vx = (s.vx/speed) * maxSpeed;
                s.vy = (s.vy/speed) * maxSpeed;
            }
            
            s.x += s.vx * dt;
            s.y += s.vy * dt;

            // Check collision with breakable platforms
            if (!b.traits || (!b.traits.includes('GHOST') && !b.traits.includes('BOOMERANG'))) {
                let hitPlatform = false;
                for (let i = 0; i < worldObjects.length; i++) {
                    let obj = worldObjects[i];
                    if (obj.type === 'PLATFORM' && s.x > obj.currentX && s.x < obj.currentX + obj.width && s.y > obj.currentY && s.y < obj.currentY + obj.height) {
                        hitPlatform = true;
                        if (obj.isBreakable) {
                            obj.health--;
                            if (obj.health <= 0) obj.isBroken = true;
                        }
                        break;
                    }
                }
                if (hitPlatform) {
                    spawnParticles(s.x, s.y, b.color, 5);
                    return false;
                }
            }

            s.life -= dt;
            
            if (dist < s.radius + player.width/2) {
                playerTakeDamage();
                return false;
            }
            return s.life > 0;
        });

        // Update Mines
        b.mines = b.mines.filter(m => {
            m.timer -= dt;
            if (m.timer <= 0) {
                if (m.state === 'READY') {
                    m.state = 'EXPLODING';
                    m.timer = 0.5;
                    setShake(5, 0.1);
                } else return false;
            }
            const dx = (player.x + player.width/2) - m.x;
            const dy = (player.y + player.height/2) - m.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (m.state === 'READY' && dist < m.radius + player.width/2) {
                playerTakeDamage();
                m.state = 'EXPLODING';
                m.timer = 0.5;
            } else if (m.state === 'EXPLODING' && dist < 60) playerTakeDamage();
            return true;
        });

        // Touch damage
        if (player.health > 0) {
            const bdx = (player.x + player.width/2) - (b.x + b.width/2);
            const bdy = (player.y + player.height/2) - (b.y + b.height/2);
            if (Math.abs(bdx) < (player.width + b.width)/2 && Math.abs(bdy) < (player.height + b.height)/2) {
                playerTakeDamage();
            }
        }
        dt = _dt; // restore dt
    }

    updateBossEntity(boss);
    
    // Update Minions
    if (boss && boss.minions) {
        boss.minions = boss.minions.filter(m => {
            updateBossEntity(m);
            if (m.isCheeseSub) {
                m.x = boss.x + boss.width/2 - m.width/2;
                m.y = boss.y + boss.height/2 - m.height/2;
                return true; 
            }
            // Minion take damage check
            player.bullets.forEach(p => {
                const dx = (m.x + m.width/2) - p.x;
                const dy = (m.y + m.height/2) - p.y;
                if (Math.sqrt(dx*dx + dy*dy) < p.radius + m.width/2) {
                    m.health--;
                    m.hitResonance = 0.2;
                    spawnParticles(m.x + m.width/2, m.y + m.height/2, m.color, 5);
                    p.life = 0; // Destroy bullet
                }
            });
            // Sword check for minions
            if (player.weaponType === 'SWORD' && player.isSwinging && !m.swordHit) {
                const dx = (m.x + m.width/2) - (player.x + player.width/2);
                const dy = (m.y + m.height/2) - (player.y + player.height/2);
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < (player.swordLength || 70) + 20) {
                    m.health = 0;
                    spawnParticles(m.x + m.width/2, m.y + m.height/2, m.color, 10);
                }
            }
            return m.health > 0;
        });
    }

    // Update Player Bullets
    player.bullets = player.bullets.filter(p => {
        if (p.isGrenade) {
            p.angle += dt * 10;
            p.vy += gravity * 0.8 * dt; 
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.timer -= dt;

            // Simple bounce
            if (p.y > canvas.height - 20) {
                if (p.bounces > 0) {
                    p.vy *= -0.5;
                    p.bounces--;
                    p.y = canvas.height - 21;
                } else p.timer = 0;
            }
            if (p.x < 0 || p.x > canvas.width) {
                 if (p.bounces > 0) {
                    p.vx *= -0.8;
                    p.bounces--;
                    p.x = Math.max(0, Math.min(canvas.width, p.x));
                 } else p.timer = 0;
            }

            if (p.timer <= 0) {
                setShake(10, 0.2);
                sfx.land();
                spawnParticles(p.x, p.y, '#f39c12', 30);
                if (boss && boss.health > 0) {
                    const bdx = (boss.x + boss.width/2) - p.x;
                    const bdy = (boss.y + boss.height/2) - p.y;
                    if (Math.sqrt(bdx*bdx + bdy*bdy) < (player.grenadeRadius || 100) + boss.width/2) {
                        bossTakeDamage(boss, player.damage);
                    }
                }
                if (player.grenadeFrags > 0) {
                    for(let i=0; i<player.grenadeFrags; i++) {
                        const ang = (i/player.grenadeFrags) * Math.PI * 2;
                        player.bullets.push({
                            x: p.x, y: p.y, vx: Math.cos(ang) * 500, vy: Math.sin(ang) * 500,
                            radius: 6, life: 1, isFrag: true
                        });
                    }
                }
                return false;
            }
            return true;
        }

        if (p.isBoomerang) {
            p.angle += dt * 15;
            if (p.state === 'OUT') {
                p.returnTimer -= dt;
                if (p.returnTimer <= 0) p.state = 'RETURN';
            } else if (p.state === 'RETURN') {
                const rdx = (player.x + player.width/2) - p.x;
                const rdy = (player.y + player.height/2) - p.y;
                const rdist = Math.sqrt(rdx*rdx + rdy*rdy);
                if (rdist < 20) return false; // Caught
                p.vx = (rdx/rdist) * player.boomerangReturnSpeed;
                p.vy = (rdy/rdist) * player.boomerangReturnSpeed;
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            
            // Damage timer to avoid everyframe hit
            if (p.damageTimer > 0) p.damageTimer -= dt;
            
            // Collision with boss
            if (boss && boss.health > 0 && boss.state !== 'DYING' && p.damageTimer <= 0) {
                 const bdx = (boss.x + boss.width/2) - p.x;
                 const bdy = (boss.y + boss.height/2) - p.y;
                 if (Math.sqrt(bdx*bdx + bdy*bdy) < p.radius + boss.width/2) {
                     bossTakeDamage(boss, player.damage);
                     p.damageTimer = 0.15;
                     if (player.boomerangFrost) {
                         boss.slowTimer = Math.max(boss.slowTimer || 0, player.boomerangFrost);
                     }
                 }
            }
            return true;
        }

        if (p.isWand) {
            p.life -= dt;
            p.initialDelay -= dt;
            if (p.initialDelay <= 0 && boss && boss.health > 0) {
                const dx = (boss.x + boss.width/2) - p.x;
                const dy = (boss.y + boss.height/2) - p.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                const targetVx = (dx/dist) * (player.wandArcaneSpeed || 500);
                const targetVy = (dy/dist) * (player.wandArcaneSpeed || 500);
                p.vx += (targetVx - p.vx) * dt * (p.homingPower || 1) * 8;
                p.vy += (targetVy - p.vy) * dt * (p.homingPower || 1) * 8;
            } else {
                p.vx *= 0.95; // Drag while idle
                p.vy *= 0.95;
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            // Collision
            if (boss && boss.health > 0 && boss.state !== 'DYING') {
                const bdx = (boss.x + boss.width/2) - p.x;
                const bdy = (boss.y + boss.height/2) - p.y;
                if (Math.sqrt(bdx*bdx + bdy*bdy) < p.radius + boss.width/2) {
                    bossTakeDamage(boss, player.damage * 0.8);
                    spawnParticles(p.x, p.y, '#ff00ff', 10);
                    return false; // Arcane orbs disappear on hit usually or pierce? Disappear for balance.
                }
            }
            return p.life > 0;
        }

        // Homing
        if (player.homing && boss && boss.health > 0) {
            const dx = (boss.x + boss.width/2) - p.x;
            const dy = (boss.y + boss.height/2) - p.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            p.vx += (dx/dist) * PLAYER_BULLET_SPEED * player.homing * dt;
            p.vy += (dy/dist) * PLAYER_BULLET_SPEED * player.homing * dt;
            // Cap speed
            const speed = Math.sqrt(p.vx**2 + p.vy**2);
            p.vx = (p.vx/speed) * PLAYER_BULLET_SPEED;
            p.vy = (p.vy/speed) * PLAYER_BULLET_SPEED;
        }

        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;

        // Bounce logic
        if (p.bounces && p.bounces > 0) {
            if (p.x < 0 || p.x > canvas.width) {
                p.vx *= -1;
                p.bounces--;
                p.x = Math.max(0, Math.min(canvas.width, p.x));
            }
            if (p.y < 0 || p.y > canvas.height) {
                p.vy *= -1;
                p.bounces--;
                p.y = Math.max(0, Math.min(canvas.height, p.y));
            }
        }
        
        // Check collision with boss
        if (boss && boss.health > 0 && boss.state !== 'DYING') {
            const dx = (boss.x + boss.width/2) - p.x;
            const dy = (boss.y + boss.height/2) - p.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < p.radius + boss.width/2) {
                let dmg = player.damage * (p.damageScale || 1);
                
                if (player.sharpShooter) {
                    if (dist > 300) dmg *= 1.5;
                }

                if (player.crit && Math.random() < player.crit) {
                    dmg *= 3;
                    spawnParticles(p.x, p.y, '#fff', 20);
                }
                
                bossTakeDamage(boss, dmg);
                
                if (player.lifesteal && Math.random() < player.lifesteal) {
                    if (player.health < player.maxHealth) {
                        player.health++;
                        updateHealthUI();
                    }
                }

                if (player.explosive) {
                    explosions.push({ x: p.x, y: p.y, radius: 0, maxRadius: 80, life: 0.4, color: '#ff4757' });
                    bossTakeDamage(boss, player.damage * 0.5);
                    setShake(5, 0.1);
                }

                if (player.splitting && !p.isSplit) {
                    for (let i = -1; i <= 1; i++) {
                        const baseAngle = Math.atan2(p.vy, p.vx);
                        const angle = baseAngle + i * 0.5;
                        player.bullets.push({
                            x: p.x, y: p.y,
                            vx: Math.cos(angle) * PLAYER_BULLET_SPEED * 0.7,
                            vy: Math.sin(angle) * PLAYER_BULLET_SPEED * 0.7,
                            radius: p.radius * 0.75,
                            life: p.life * 0.8,
                            pierce: 0,
                            damageScale: p.damageScale * 0.5,
                            isSplit: true
                        });
                    }
                }

                if (p.pierce && p.pierce > 0) {
                    p.pierce--;
                } else {
                    return false;
                }
            }
        }
        
        return p.life > 0 && p.x > -100 && p.x < canvas.width + 100 && p.y > -100 && p.y < canvas.height + 100;
    });

    // --- 1. UPDATE PLATFORM POSITIONS & ROTATION ---
    worldObjects.forEach(obj => {
        // Initialize lerp progress if missing
        if (obj.currentLerp === undefined) obj.currentLerp = 0;

        if (obj.channel !== undefined) {
            const isActive = !!channelStates[obj.channel];
            const target = isActive ? 1 : 0;
            // Smooth transition for channel-linked objects (speed 5.0)
            const speed = 5.0 * dt;
            if (obj.currentLerp < target) obj.currentLerp = Math.min(target, obj.currentLerp + speed);
            else if (obj.currentLerp > target) obj.currentLerp = Math.max(target, obj.currentLerp - speed);
        } else {
            // Default oscillation for non-channel moving objects
            obj.currentLerp = (Math.sin(gameTime * (obj.moveSpeed || 1)) + 1) / 2;
        }

        if (obj.isMoving) {
            obj.oldX = obj.currentX || obj.x;
            obj.oldY = obj.currentY || obj.y;
            obj.currentX = obj.x + (obj.tx - obj.x) * obj.currentLerp;
            obj.currentY = obj.y + (obj.ty - obj.y) * obj.currentLerp;
        } else {
            obj.currentX = obj.x;
            obj.currentY = obj.y;
        }

        if (obj.isSpinning) {
            // If channel linked, spin speed is modulated by lerp (or just on/off)
            const multiplier = (obj.channel !== undefined) ? obj.currentLerp : 1;
            obj.currentAngle = (obj.currentAngle || 0) + (obj.spinSpeed || 0) * dt * multiplier;
        } else {
            obj.currentAngle = obj.angle || 0;
        }
    });

    // Update Particles
    particles = particles.filter(p => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        return p.life > 0;
    });

    // Update XP Orbs
    xpOrbs = xpOrbs.filter(orb => {
        orb.homingDelay -= dt;
        
        if (orb.homingDelay <= 0) {
            // Home towards player
            const dx = (player.x + player.width/2) - orb.x;
            const dy = (player.y + player.height/2) - orb.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < player.radius + 15) {
                // Collect
                const xpGain = orb.value * (player.xpMultiplier || 1.0);
                
                if (boss && boss.health > 0 && boss.state !== 'DYING') {
                    bufferedXP += xpGain;
                } else {
                    currentXP += xpGain;
                    checkLevelUp();
                }
                
                sfx.land(); // Tiny tick sound? Land works well enough
                updateHealthUI(); // Update the XP UI as well!
                return false;
            }
            
            // Accelerated homing
            orb.vx += (dx / dist) * 2000 * dt;
            orb.vy += (dy / dist) * 2000 * dt;
            
            // Max speed limit
            let spd = Math.sqrt(orb.vx*orb.vx + orb.vy*orb.vy);
            if (spd > 800) {
                orb.vx = (orb.vx/spd) * 800;
                orb.vy = (orb.vy/spd) * 800;
            }
        } else {
            // Apply gravity and drag while bursting
            orb.vy += 800 * dt; 
            orb.vx *= 0.95;
        }
        
        // Floor collision
        if (orb.y > canvas.height - ARENA_FLOOR) {
            orb.y = canvas.height - ARENA_FLOOR;
            orb.vy *= -0.6;
        }

        orb.x += orb.vx * dt;
        orb.y += orb.vy * dt;
        
        return true;
    });

    // Update Trails
    trails = trails.filter(t => {
        t.life -= dt;
        return t.life > 0;
    });

    // Update Explosions
    explosions = explosions.filter(e => {
        e.life -= dt;
        e.radius = (1 - e.life / 0.4) * e.maxRadius;
        return e.life > 0;
    });

    // Update Shake
    if (shakeTime > 0) {
        shakeTime -= dt;
    } else {
        screenShake = 0;
    }

    // Update Lava
    if (lavaTimer > 0) {
        lavaTimer -= dt;
        if (player.y + player.height >= 370) { // Standing on floor or very close
            playerTakeDamage();
        }
    }
    if (lavaFlash > 0) lavaFlash -= dt;

    if (player.invuln > 0) player.invuln -= dt;
    if (player.fireCooldown > 0) player.fireCooldown -= dt;
    
    if (player.bleedTimer > 0) {
        let prevTick = Math.ceil(player.bleedTimer / 3);
        player.bleedTimer -= dt;
        let currTick = Math.ceil(player.bleedTimer / 3);
        // Will deal damage at 3 secs and 0 secs remaining
        if (currTick < prevTick && currTick >= 0) {
            let tmpInvuln = player.invuln;
            player.invuln = 0; // bypass invuln
            player.health = Math.max(0, player.health - 1);
            player.invuln = tmpInvuln;
            spawnParticles(player.x + player.width/2, player.y + player.height/2, '#ff0000', 10);
            updateHealthUI();
            if (player.health === 0) playerTakeDamage(); // Trigger last stand or death
        }
    }

    // Update Sword
    if (player.weaponType === 'SWORD' && player.isSwinging) {
        player.swingProgress += dt * (1.0 / (PLAYER_FIRE_RATE || 0.4));
        if (player.swingProgress >= 1.0) {
            player.isSwinging = false;
            player.swingProgress = 0;
        }

        // Sword Collision
        if (boss && boss.health > 0 && !player.swingHasHit) {
            const dx = (boss.x + boss.width/2) - (player.x + player.width/2);
            const dy = (boss.y + boss.height/2) - (player.y + player.height/2);
            const dist = Math.sqrt(dx*dx + dy*dy);
            const reach = (player.swordLength || 70) * (player.multishot > 1 ? 1.2 : 1);
            
            if (dist < reach + boss.width/2) {
                const targetAng = Math.atan2(dy, dx);
                const mouseDx = mouseX - (player.x + player.width/2);
                const mouseDy = mouseY - (player.y + player.height/2);
                const mouseAng = Math.atan2(mouseDy, mouseDx);
                let diff = Math.abs(targetAng - mouseAng);
                while (diff > Math.PI) diff -= Math.PI * 2;
                diff = Math.abs(diff);

                const cone = 1.2 + (player.multishot - 1) * 0.5;
                if (diff < cone || player.whirlwind) {
                    let dmg = player.damage * (1 + (player.currentSwingCharge || 0) * 2);
                    if (player.sharpShooter && dist > 300) dmg *= 1.5;
                    
                    if (player.crit && Math.random() < player.crit) {
                        dmg *= 3;
                        spawnParticles(boss.x + boss.width/2, boss.y + boss.height/2, '#fff', 20);
                    }

                    bossTakeDamage(boss, dmg);
                    player.swingHasHit = true;

                    if (player.lifesteal && Math.random() < player.lifesteal) {
                        if (player.health < player.maxHealth) {
                            player.health++;
                            updateHealthUI();
                        }
                    }

                    if (player.frostRounds) {
                        boss.slowTimer = Math.min(2.0, (boss.slowTimer || 0) + 0.4);
                    }

                    if (player.explosive) {
                        explosions.push({ x: boss.x + boss.width/2, y: boss.y + boss.height/2, radius: 0, maxRadius: 100, life: 0.4, color: '#ff4757' });
                        bossTakeDamage(boss, player.damage * 0.5);
                        setShake(5, 0.1);
                    }

                    if (player.homing) {
                        player.velX += Math.cos(targetAng) * 400;
                        player.velY += Math.sin(targetAng) * 400;
                    }
                }
            }
        }
    }

    // Berserker Logic
    let fireRateMod = 1.0;
    if (player.berserker) {
        fireRateMod = 0.5 + (player.health / player.maxHealth) * 0.5;
    }

    // Drone Update
    if (player.drones && player.drones.length > 0) {
        player.drones.forEach(d => {
            if (d.mk2) {
                // Free flying drone logic
                if (!d.vx) d.vx = 0;
                if (!d.vy) d.vy = 0;
                if (!d.targetX || Math.random() < 0.05) {
                    d.targetX = player.x + (Math.random() - 0.5) * 300;
                    d.targetY = player.y + (Math.random() - 0.5) * 200 - 100;
                }
                const dx = d.targetX - d.x;
                const dy = d.targetY - d.y;
                d.vx += dx * dt * 2;
                d.vy += dy * dt * 2;
                d.vx *= 0.95; d.vy *= 0.95;
                d.x += d.vx * dt;
                d.y += d.vy * dt;
            } else {
                d.angle += dt * 2;
                d.x = player.x + player.width/2 + Math.cos(d.angle) * 60;
                d.y = player.y + player.height/2 + Math.sin(d.angle) * 60;
            }
            d.fireCooldown -= dt;
            if (d.fireCooldown <= 0 && boss && boss.health > 0) {
                const dx = (boss.x + boss.width/2) - d.x;
                const dy = (boss.y + boss.height/2) - d.y;
                const ang = Math.atan2(dy, dx);
                if (d.mk2) {
                    player.bullets.push({x: d.x, y: d.y, vx: Math.cos(ang-0.1) * PLAYER_BULLET_SPEED, vy: Math.sin(ang-0.1) * PLAYER_BULLET_SPEED, radius: 4, life: 2, damageScale: 0.3});
                    player.bullets.push({x: d.x, y: d.y, vx: Math.cos(ang+0.1) * PLAYER_BULLET_SPEED, vy: Math.sin(ang+0.1) * PLAYER_BULLET_SPEED, radius: 4, life: 2, damageScale: 0.3});
                    d.fireCooldown = 0.3;
                } else {
                    player.bullets.push({x: d.x, y: d.y, vx: Math.cos(ang) * PLAYER_BULLET_SPEED, vy: Math.sin(ang) * PLAYER_BULLET_SPEED, radius: 4, life: 2, damageScale: 0.3});
                    d.fireCooldown = 0.5;
                }
            }
        });
    }

    const isFiring = (touchKeys.interact || isMouseDown || isShootKeyDown) && gameState === 'PLAYING' && !dialogueActive;

    if (player.hasChargeShot) {
        if (isFiring && player.health > 0) {
            player.isCharging = true;
            player.chargeTime = Math.min(2.0, player.chargeTime + dt * (player.chargeSpeed || 1.0));
        } else {
            if (player.isCharging && player.chargeTime > 0.2) {
                shoot(player.chargeTime);
            }
            player.isCharging = false;
            player.chargeTime = 0;
        }
    } else if (isFiring && player.fireCooldown <= 0 && gameState === 'PLAYING' && !dialogueActive) {
        shoot();
        player.fireCooldown = PLAYER_FIRE_RATE * fireRateMod;
    }

    // --- 2. TIMER ---
    if (!timerRunning && !timerFinished) {
        if (keys[controls.jump] || keys[controls.left] || keys[controls.right] || touchKeys.jump || touchKeys.left || touchKeys.right) {
            startTime = Date.now();
            timerRunning = true;
        }
    }
    if (timerRunning) {
        elapsedTime = Date.now() - startTime;
        document.getElementById('timer-display').innerText = formatTime(elapsedTime);
    }

    // --- 3. INPUTS & PHYSICS ---
    currentInteractable = null;
    const prompt = document.getElementById('interaction-prompt');
    if (!dialogueActive) prompt.style.display = 'none';

    if (dialogueActive) {
        // Find the NPC we were talking to to keep position updated
        worldObjects.forEach(obj => {
            if (obj.type === 'NPC') {
                const dx = (player.x + player.width/2) - (obj.currentX + obj.width/2);
                const dy = (player.y + player.height/2) - (obj.currentY + obj.height/2);
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < 120) currentInteractable = obj; 
            }
        });

        if (currentInteractable) {
            prompt.style.display = 'block';
            prompt.style.left = (currentInteractable.currentX + currentInteractable.width / 2) + 'px';
            prompt.style.top = (currentInteractable.currentY - 30) - (prompt.offsetHeight/2) + 'px';
        }

        // Pause movement and timer when talking
        player.velX = 0;
    } else {
        let interactionCandidate = null;
        let interactionType = "TALK";

        worldObjects.forEach(obj => {
            const isNPC = obj.type === 'NPC';
            const isLever = obj.type === 'LEVER';
            const isButton = obj.type === 'BUTTON';
            
            if (isNPC || isLever || isButton) {
                const dx = (player.x + player.width/2) - (obj.currentX + obj.width/2);
                const dy = (player.y + player.height/2) - (obj.currentY + obj.height/2);
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                if (dist < 100) {
                    if (!interactionCandidate || dist < interactionCandidate.dist) {
                        interactionCandidate = { obj, dist };
                        if (isNPC) interactionType = "TALK";
                        else if (isLever) interactionType = channelStates[obj.channel] ? "FLIP OFF" : "FLIP ON";
                        else if (isButton) interactionType = "PUSH";
                    }
                }
            }
        });

        if (interactionCandidate) {
            currentInteractable = interactionCandidate.obj;
            prompt.style.display = 'block';
            const rawKey = controls.interact || 'E';
            const keyName = rawKey.replace('Key', '').replace('Digit', '');
            prompt.innerText = `[${keyName}] ${interactionType}`;

            prompt.style.left = (currentInteractable.currentX + currentInteractable.width / 2) + 'px';
            prompt.style.top = (currentInteractable.currentY - 30) + 'px';
            prompt.style.maxWidth = '200px';
        } else {
            currentInteractable = null;
        }
    }

        if ((keys[controls.jump] || touchKeys.jump) && player.coyoteCounter > 0) {
            player.velY = jumpForce;
            player.jumping = true;
            player.coyoteCounter = 0; 
            sfx.jump();
        }
        
        player.coyoteCounter -= dt;
        
        if (keys[controls.left] || touchKeys.left) {
            player.velX -= acceleration * dt;
            player.facing = -1;
            addTrail(player.x, player.y, player.width, player.height, player.color);
        } else if (keys[controls.right] || touchKeys.right) {
            player.velX += acceleration * dt;
            player.facing = 1;
            addTrail(player.x, player.y, player.width, player.height, player.color);
        } else {
            player.velX *= Math.pow(friction, dt);
        }

    player.velY += gravity * dt;

    if (player.velX > playerMoveSpeed) player.velX = playerMoveSpeed;
    if (player.velX < -playerMoveSpeed) player.velX = -playerMoveSpeed;

    // --- 4. Y-AXIS MOVE & COLLISION ---
    player.y += player.velY * dt; 
    
    worldObjects.forEach(obj => {
        if ((obj.currentAngle || 0) % 360 !== 0) {
            const overlap = getRotatedOverlap(player, obj);
            if (overlap) {
                if (obj.type === 'PLATFORM') {
                    if (obj.isSpinning) {
                        const cx = obj.currentX + obj.width / 2;
                        const cy = obj.currentY + obj.height / 2;
                        const rx = (player.x + player.width / 2) - cx;
                        const ry = (player.y + player.height / 2) - cy;
                        const deltaAngle = (obj.spinSpeed || 0) * dt * (Math.PI / 180);
                        player.x += (rx * Math.cos(deltaAngle) - ry * Math.sin(deltaAngle)) - rx;
                        player.y += (rx * Math.sin(deltaAngle) + ry * Math.cos(deltaAngle)) - ry;
                    }
                    const finalOverlap = getRotatedOverlap(player, obj);
                    if (finalOverlap) {
                        player.x += finalOverlap.x;
                        player.y += finalOverlap.y;
                        if (Math.abs(finalOverlap.y) > Math.abs(finalOverlap.x)) {
                            if (finalOverlap.y < 0) {
                                player.jumping = false;
                                player.coyoteCounter = coyoteTime;
                                player.velY = 0;
                            } else {
                                player.velY = 0;
                            }
                        } else {
                            player.velX = 0;
                        }
                    }
                }
                else if (obj.type === 'SPIKE') respawn();
                else if (obj.type === 'GOAL') nextLevel();
                else if (obj.type === 'PORTAL_SHRINK') setPlayerSize(15);
                else if (obj.type === 'PORTAL_NORMAL') setPlayerSize(30);
                else if (obj.type === 'PORTAL_GROW') setPlayerSize(45);
            }
        } else {
            const physX = obj.currentX;
            const physY = obj.currentY;
            if (player.x < physX + obj.width && player.x + player.width > physX &&
                player.y < physY + obj.height && player.y + player.height > physY) {
                if (obj.type === 'PLATFORM') {
                    if (player.velY >= 0 && (player.y + player.height) - (player.velY * dt) <= physY + 10) { 
                        if (player.jumping) {
                            spawnParticles(player.x + player.width/2, physY, '#fff', 5);
                            sfx.land();
                        }
                        player.jumping = false;
                        player.coyoteCounter = coyoteTime;
                        player.velY = 0;
                        player.y = physY - player.height;
                        if (obj.isMoving) player.y += (obj.currentY - obj.oldY);
                    } 
                    else if (player.velY < 0 && player.y - (player.velY * dt) >= physY + obj.height - 10) {
                        player.velY = 0;
                        player.y = physY + obj.height;
                    }
                } 
                else if (obj.type === 'SPIKE') respawn();
                else if (obj.type === 'GOAL') nextLevel();
                else if (obj.type === 'PORTAL_SHRINK') setPlayerSize(15);
                else if (obj.type === 'PORTAL_NORMAL') setPlayerSize(30);
                else if (obj.type === 'PORTAL_GROW') setPlayerSize(45);
            }
        }
    });

    // --- 5. X-AXIS MOVE & COLLISION ---
    player.x += player.velX * dt;
    
    worldObjects.forEach(obj => {
        if ((obj.currentAngle || 0) % 360 === 0) {
            const physX = obj.currentX;
            const physY = obj.currentY;
            if (obj.isMoving && !player.jumping && 
                player.x < physX + obj.width && player.x + player.width > physX &&
                player.y + player.height >= physY - 5 && player.y + player.height <= physY + 10) {
                player.x += (obj.currentX - obj.oldX);
            }
            if (player.x < physX + obj.width && player.x + player.width > physX &&
                player.y < physY + obj.height && player.y + player.height > physY) {
                if (obj.type === 'PLATFORM') {
                    if (player.y + player.height > physY + 5) {
                        if (player.velX > 0) { player.x = physX - player.width; player.velX = 0; }
                        else if (player.velX < 0) { player.x = physX + obj.width; player.velX = 0; }
                    }
                } else if (obj.type === 'SPIKE') respawn();
                else if (obj.type === 'GOAL') nextLevel();
            }
        }
    });

    if (player.x < 0) player.x = 0;
    if (player.x > canvas.width - player.width) player.x = canvas.width - player.width;

    // Random platforms logic
    randomPlatformTimer -= dt;
    if (randomPlatformTimer <= 0) {
        randomPlatformTimer = 3 + Math.random() * 4; // Spawn every 3-7 seconds
        let breakableCount = worldObjects.filter(o => o.isBreakable && !o.isBroken).length;
        if (breakableCount < 4) { // Max 4 breakable platforms on screen
            let platW = 60 + Math.random() * 40;
            let platX = 150 + Math.random() * (500 - platW);
            let platY = 150 + Math.random() * 150;
            worldObjects.push({
                x: platX, y: platY, width: platW, height: 15,
                type: 'PLATFORM', isBreakable: true, health: 3 // Takes 3 hits to break
            });
            spawnParticles(platX + platW/2, platY + 7, '#3498db', 10);
            sfx.land();
        }
    }

    // Cleanup broken platforms
    worldObjects = worldObjects.filter(obj => !obj.isBroken);

    draw();
    requestAnimationFrame(update);
}

// 7. DRAWING FUNCTION
function draw() {
    ctx.save();
    
    // Background Grid
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Lava Floor
    if (lavaTimer > 0) {
        ctx.fillStyle = '#ff4757';
        ctx.globalAlpha = 0.3 + Math.sin(gameTime * 10) * 0.2;
        ctx.fillRect(0, 380, canvas.width, 20);
        
        ctx.shadowBlur = 40;
        ctx.shadowColor = '#ff4757';
        ctx.fillRect(0, 375, canvas.width, 5);
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
    } else if (lavaFlash > 0) {
        ctx.fillStyle = '#ff4757';
        ctx.globalAlpha = 0.1 * (Math.floor(gameTime * 10) % 2);
        ctx.fillRect(0, 380, canvas.width, 20);
        ctx.globalAlpha = 1;
    }
    
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    // Apply Shake
    if (shakeTime > 0) {
        ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
    }

    // Draw Trails
    trails.forEach(t => {
        ctx.globalAlpha = t.life * 2;
        ctx.fillStyle = t.color;
        ctx.fillRect(t.x, t.y, t.w, t.h);
    });
    ctx.globalAlpha = 1;

    // Draw Explosions
    explosions.forEach(e => {
        ctx.globalAlpha = e.life * 2;
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Draw XP Orbs
    xpOrbs.forEach(orb => {
        ctx.fillStyle = orb.value >= 1 ? '#00FF00' : '#80FF80'; // Minecraft EXP green
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#00FF00';
        ctx.beginPath();
        // Little wobbling diamonds/circles
        let renderRad = orb.value >= 1 ? 5 : 3;
        renderRad += Math.sin(gameTime * 20 + orb.x) * 1;
        ctx.arc(orb.x, orb.y, renderRad, 0, Math.PI*2);
        ctx.fill();
    });
    ctx.shadowBlur = 0;
    
    worldObjects.forEach(obj => {
        ctx.save();
        ctx.translate(obj.currentX + obj.width / 2, obj.currentY + obj.height / 2);
        ctx.rotate((obj.currentAngle || 0) * Math.PI / 180);
        
        let color = '#fff';
        let glow = false;
        
        if (obj.type === 'PLATFORM') {
            color = obj.isBreakable ? (obj.health < 3 ? '#e74c3c' : '#3498db') : '#2f3542';
            ctx.strokeStyle = '#3f4552';
            if (obj.isBreakable) {
                glow = true;
                ctx.strokeStyle = '#fff';
            }
            ctx.lineWidth = 1;
        }
        else if (obj.type === 'SPIKE') {
            color = '#ff4757';
            glow = true;
        }
        else if (obj.type === 'GOAL') {
            color = '#ffa502';
            glow = true;
        }
        else if (obj.type === 'SPAWN') color = '#2ed573';
        else if (obj.type === 'PORTAL_SHRINK') { color = '#9c88ff'; glow = true; }
        else if (obj.type === 'PORTAL_GROW') { color = '#e1b12c'; glow = true; }
        else if (obj.type === 'PORTAL_NORMAL') { color = '#00a8ff'; glow = true; }
        else if (obj.type === 'NPC') {
            color = '#fd79a8';
            glow = true;
        }
        
        if (glow) {
            ctx.shadowBlur = 15;
            ctx.shadowColor = color;
        }
        
        ctx.fillStyle = color;

        if (obj.type === 'LEVER' || obj.type === 'BUTTON') {
            const isActive = !!channelStates[obj.channel];
            const stateColor = isActive ? '#00d2ff' : '#2ed573';
            ctx.fillStyle = stateColor;
            ctx.shadowBlur = 10;
            ctx.shadowColor = stateColor;

            if (obj.type === 'LEVER') {
                // Base
                ctx.fillStyle = '#444';
                ctx.fillRect(-obj.width/2, obj.height/2 - 5, obj.width, 5);
                // Stick
                ctx.save();
                ctx.translate(0, obj.height/2 - 5);
                const stickAngle = isActive ? -Math.PI/4 : Math.PI/4;
                ctx.rotate(stickAngle);
                ctx.fillStyle = stateColor;
                ctx.fillRect(-2, -obj.height * 0.8, 4, obj.height * 0.8);
                ctx.beginPath();
                ctx.arc(0, -obj.height * 0.8, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            } else if (obj.type === 'BUTTON') {
                // Base
                ctx.fillStyle = '#444';
                ctx.fillRect(-obj.width/2, obj.height/2 - 5, obj.width, 5);
                // Button top
                ctx.fillStyle = stateColor;
                const topY = isActive ? obj.height/2 - 8 : obj.height/2 - 12;
                const topH = isActive ? 3 : 7;
                ctx.fillRect(-obj.width/3, topY, obj.width/1.5, topH);
            }
        } else if (obj.type === 'NPC') {
            // NPC character drawing
            ctx.beginPath();
            ctx.arc(0, -obj.height/4, obj.width/3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillRect(-obj.width/2.5, 0, obj.width/1.25, obj.height/2);
            
            // Eyes
            ctx.fillStyle = 'white';
            ctx.fillRect(-obj.width/8, -obj.height/4 - obj.height/10, obj.width/15, obj.height/15);
            ctx.fillRect(obj.width/15, -obj.height/4 - obj.height/10, obj.width/15, obj.height/15);
        } else {
            ctx.fillRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
        }
        
        ctx.restore();
    });

    // Draw Particles
    particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1;

    // Draw Opponent
    if (multiplayer.status === 'playing' && multiplayer.opponentState) {
        const os = multiplayer.opponentState;
        // Basic interpolation
        if (!multiplayer.interpolatedOpponent) {
            multiplayer.interpolatedOpponent = { x: os.x, y: os.y };
        }
        multiplayer.interpolatedOpponent.x += (os.x - multiplayer.interpolatedOpponent.x) * 0.3;
        multiplayer.interpolatedOpponent.y += (os.y - multiplayer.interpolatedOpponent.y) * 0.3;
        
        drawPlayerAvatar(ctx, multiplayer.interpolatedOpponent.x, multiplayer.interpolatedOpponent.y, 30, 30, '#ff4757', 'STARE');
        
        // Draw Opponent Bullets
        if (os.bullets) {
            os.bullets.forEach(b => {
                ctx.fillStyle = '#ff4757';
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#ff4757';
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.radius || 6, 0, Math.PI * 2);
                ctx.fill();
            });
        }
        
        // Update opponent health UI
        const p2Container = document.getElementById('player2-health-container');
        if (p2Container) {
            p2Container.innerHTML = '';
            for (let i = 0; i < 10; i++) {
                const pip = document.createElement('div');
                pip.classList.add('health-pip');
                if (i >= (os.health || 0)) pip.classList.add('empty');
                p2Container.appendChild(pip);
            }
        }

        // Collision with opponent bullets
        if (os.bullets && player.invuln <= 0 && player.health > 0) {
            os.bullets.forEach(b => {
                const dx = b.x - (player.x + player.width/2);
                const dy = b.y - (player.y + player.height/2);
                if (Math.sqrt(dx*dx + dy*dy) < (b.radius || 6) + 15) {
                    playerTakeDamage('opponent');
                }
            });
        }
        
        // Check if opponent died
        if (os.health <= 0 && multiplayer.status === 'playing') {
            multiplayerWin();
        }
    }

    // Draw Player
    if (player.invuln > 0 && Math.floor(gameTime * 20) % 2 === 0) {
        // Blink
    } else {
        drawPlayerAvatar(ctx, player.x, player.y, player.width, player.height, player.color, player.eyeStyle);

        // Charge indicator
        if (player.isCharging && player.chargeTime > 0.1) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const radius = 25 + Math.sin(gameTime * 20) * 5;
            ctx.arc(player.x + player.width/2, player.y + player.height/2, radius, 0, (player.chargeTime / 2.0) * Math.PI * 2);
            ctx.stroke();
            
            ctx.fillStyle = 'rgba(255, 255, 255, ' + (player.chargeTime/2) + ')';
            ctx.beginPath();
            ctx.arc(player.x + player.width/2, player.y + player.height/2, 5 + player.chargeTime * 10, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Draw Player Bullets
    player.bullets.forEach(p => {
        if (p.isGrenade) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.fillStyle = '#f39c12';
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#e67e22';
            ctx.beginPath();
            ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
            ctx.fill();
            // Fuse effect
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, -p.radius);
            ctx.lineTo(Math.cos(p.angle * 2) * 5, -p.radius - 5);
            ctx.stroke();
            ctx.restore();
        } else if (p.isWand) {
            ctx.save();
            ctx.translate(p.x, p.y);
            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.radius * 1.5);
            grad.addColorStop(0, '#fff');
            grad.addColorStop(0.4, '#ff00ff');
            grad.addColorStop(1, 'rgba(255, 0, 255, 0)');
            ctx.fillStyle = grad;
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#ff00ff';
            ctx.beginPath();
            ctx.arc(0, 0, p.radius * 1.5, 0, Math.PI * 2);
            ctx.fill();
            // Core
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(0, 0, p.radius * 0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else if (p.isBoomerang) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.fillStyle = '#fff';
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#f1c40f';
            ctx.beginPath();
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#fff';
            ctx.moveTo(-p.radius, -p.radius/2);
            ctx.lineTo(0, p.radius/2);
            ctx.lineTo(p.radius, -p.radius/2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else if (player.throwingSword) {
            ctx.save();
            ctx.translate(p.x, p.y);
            const moveAngle = Math.atan2(p.vy, p.vx);
            ctx.rotate(moveAngle + gameTime * 15);
            const sl = (player.swordLength || 40) * (player.bulletSize/6) * (p.radius / 6);
            const sw = 6 * (player.bulletSize/6) * (p.radius / 6);
            ctx.fillStyle = '#fff';
            ctx.shadowBlur = 15;
            ctx.shadowColor = player.color;
            ctx.fillRect(-sw/2, -sl/2, sw, sl);
            ctx.fillStyle = '#444';
            ctx.fillRect(-sw*1.5, 0, sw*3, 4);
            ctx.restore();
        } else {
            ctx.fillStyle = '#fff';
            ctx.shadowBlur = 10;
            ctx.shadowColor = player.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    // Draw Sword
    if (player.weaponType === 'SWORD' && player.health > 0 && !player.throwingSword) {
        const dx = mouseX - (player.x + player.width/2);
        const dy = mouseY - (player.y + player.height/2);
        const angle = Math.atan2(dy, dx);
        ctx.save();
        ctx.translate(player.x + player.width/2, player.y + player.height/2);
        
        if (player.whirlwind && player.isSwinging) {
            ctx.beginPath();
            const reach = (player.swordLength || 70) * (player.multishot > 1 ? 1.2 : 1) + player.width/2;
            ctx.arc(0, 0, reach, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${1.0 - player.swingProgress})`;
            ctx.fill();
        }

        let sr = -0.6;
        if (player.isSwinging) sr = -0.8 + (player.swingProgress * 1.6);
        ctx.rotate(angle + sr + Math.PI/2);
        const sl = (player.swordLength || 70) * (1 + player.swingProgress * 0.1) * (player.bulletSize/6);
        const sw = 8 * (player.bulletSize/6);
        ctx.fillStyle = '#fff';
        ctx.shadowBlur = 15;
        ctx.shadowColor = player.color;
        ctx.fillRect(-sw/2, -sl, sw, sl);
        ctx.fillStyle = '#444';
        ctx.fillRect(-sw * 2, -10, sw * 4, 5);
        ctx.restore();
    }

    // Draw Drones
    if (player.drones) {
        player.drones.forEach(d => {
            ctx.fillStyle = '#2ed573';
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#2ed573';
            ctx.fillRect(d.x - 4, d.y - 4, 8, 8);
            // Engine glow
            ctx.fillStyle = '#fff';
            ctx.fillRect(d.x - 2, d.y - 2, 4, 4);
        });
    }

    // Draw Bosses
    function drawBossEntity(b) {
        if (b.health <= 0 && b.state !== 'DYING') return;

        ctx.save();
        ctx.translate(b.x + b.width/2, b.y + b.height/2);
        
        // Attack Telegraphs
        if ((b.state === 'CHARGE' || b.state === 'BEAM_PREP' || b.state === 'ORBITAL_STRIKE') && b.attackTimer > 0) {
            ctx.strokeStyle = (b.state === 'BEAM_PREP' || b.state === 'ORBITAL_STRIKE') ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 71, 87, 0.3)';
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            
            if (b.state === 'ORBITAL_STRIKE') {
                const screenTargetX = b.targetX - (b.x + b.width/2);
                ctx.moveTo(screenTargetX, -b.y - b.height/2);
                ctx.lineTo(screenTargetX, canvas.height);
            } else {
                const targetX = b.state === 'BEAM_PREP' ? b.beam.targetX : b.targetX;
                const targetY = b.state === 'BEAM_PREP' ? b.beam.targetY : b.targetY;
                ctx.lineTo(targetX - (b.x + b.width/2), targetY - (b.y + b.height/2));
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        if (b.state === 'CROSS_BEAM') {
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([10, 5]);
            // Horizontal line
            ctx.beginPath();
            ctx.moveTo(-b.x - b.width/2, b.crossY - (b.y + b.height/2));
            ctx.lineTo(canvas.width, b.crossY - (b.y + b.height/2));
            ctx.stroke();
            // Vertical line
            ctx.beginPath();
            ctx.moveTo(b.crossX - (b.x + b.width/2), -b.y - b.height/2);
            ctx.lineTo(b.crossX - (b.x + b.width/2), canvas.height);
            ctx.stroke();
            ctx.setLineDash([]);
            
            if (b.attackTimer <= 0.5 && b.attackTimer > 0) {
                ctx.lineWidth = 40 * (b.attackTimer / 0.5);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.beginPath();
                ctx.moveTo(-b.x - b.width/2, b.crossY - (b.y + b.height/2));
                ctx.lineTo(canvas.width, b.crossY - (b.y + b.height/2));
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(b.crossX - (b.x + b.width/2), -b.y - b.height/2);
                ctx.lineTo(b.crossX - (b.x + b.width/2), canvas.height);
                ctx.stroke();
            }
        }

        if (b.state === 'STALACTITE' && b.attackTimer > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.fillRect(-b.x - b.width/2, -b.y - b.height/2, canvas.width, 10);
            if (Math.floor(gameTime * 10) % 2 === 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.fillRect(-b.x - b.width/2, -b.y - b.height/2, canvas.width, 4);
            }
        }

        if (b.state === 'GRAVITY_WELL') {
            ctx.strokeStyle = b.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 150 + Math.sin(gameTime * 15) * 30, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 0.1;
            ctx.fillStyle = b.color;
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }

        // Minions draw handled recursively or via loop below but keeping the legacy box rendering as fallback (wait, we shouldn't keep the legacy box rendering if we call drawBossEntity)
        if (b.minions) {
            b.minions.forEach(m => {
                drawBossEntity(m); // Recursively call the draw function to render all minions properties the exact same way like projectiles and seekers!
            });
        }

        // Beam Attack
        if (b.state === 'BEAM_FIRE') {
            ctx.save();
            ctx.strokeStyle = b === boss ? '#00d2ff' : '#ffa502';
            ctx.lineWidth = 40 * (b.attackTimer / 1.2);
            ctx.globalAlpha = 0.8;
            ctx.shadowBlur = 30;
            ctx.shadowColor = ctx.strokeStyle;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(b.beam.targetX - (b.x + b.width/2), b.beam.targetY - (b.y + b.height/2));
            ctx.stroke();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = ctx.lineWidth * 0.4;
            ctx.stroke();
            ctx.restore();
        }

        ctx.fillStyle = b.color;
        ctx.shadowBlur = 20;
        ctx.shadowColor = b.color;
        
        if (b.state === 'DYING') {
            ctx.globalAlpha = Math.random();
        } else if (b.traits && b.traits.includes('GHOST')) {
            ctx.globalAlpha = 0.5;
        }
        
        if (b.traits && b.traits.includes('TELEPORT')) {
            ctx.translate((Math.random()-0.5)*10, (Math.random()-0.5)*10);
            if (Math.random() < 0.1) ctx.globalAlpha *= 0.5;
        }
        
        // Animation based on state (Squash, stretch, rotation)
        let stateScaleX = 1;
        let stateScaleY = 1;
        let stateAngle = 0;
        
        if (b.state === 'BURST' || b.state === 'SLAM_PREP' || b.state === 'CHARGE') {
            stateScaleX = 1.2;
            stateScaleY = 0.8;
            if (b.state === 'SLAM_PREP' && b.attackTimer < 0.5) stateScaleY = 1.5;
        } else if (b.state === 'TRIPLE_SHOT' || b.state === 'SINE') {
            stateScaleX = 0.9;
            stateScaleY = 1.1;
        } else if (b.state === 'WAVE' || b.state === 'SPIRAL') {
            stateAngle = gameTime * 5;
        } else if (b.state === 'BOUNCE' || b.state === 'DEPRESSED') {
            stateScaleX = 1.3;
            stateScaleY = 0.7;
        }

        ctx.rotate(stateAngle);

        // Hit resonance flash
        if (b.hitResonance > 0) {
            ctx.fillStyle = '#fff';
            ctx.shadowColor = '#fff';
        } else {
            let bodyColor = b.color;
            if (b.traits) {
                if (b.traits.includes('RAGE')) bodyColor = '#ff4757';
                else if (b.traits.includes('STONE')) bodyColor = '#7f8c8d';
                else if (b.traits.includes('HEAL')) bodyColor = '#2ecc71';
                else if (b.traits.includes('CHILL')) bodyColor = '#00d2ff';
                else if (b.traits.includes('GHOST')) bodyColor = 'rgba(255,255,255,0.8)';
            }
            ctx.fillStyle = bodyColor;
            ctx.shadowColor = bodyColor;
        }

        // Rhythmic Core
        const scale = 1 + Math.sin(gameTime * 5) * 0.1;
        ctx.scale(scale * stateScaleX, scale * stateScaleY);
        
        if (!b.isCheeseSub) {
            ctx.fillRect(-b.width/2, -b.height/2, b.width, b.height);
            
            // Inner flair and visual state adjustments
            ctx.fillStyle = b.state === 'BEAM_PREP' || b.state === 'BEAM_FIRE' ? (b === boss ? '#00d2ff' : '#ffa502') : '#fff';
            ctx.fillRect(-b.width/4, -b.height/4, b.width/2, b.height/2);

            // Cheese Lord visuals
            if (b.isCheeseLord) {
                // Crown
                ctx.fillStyle = '#f39c12';
                ctx.beginPath();
                ctx.moveTo(-b.width/2, -b.height/2);
                ctx.lineTo(-b.width/2, -b.height/2 - 30);
                ctx.lineTo(-b.width/4, -b.height/2 - 15);
                ctx.lineTo(0, -b.height/2 - 35);
                ctx.lineTo(b.width/4, -b.height/2 - 15);
                ctx.lineTo(b.width/2, -b.height/2 - 30);
                ctx.lineTo(b.width/2, -b.height/2);
                ctx.fill();
                // Scepter
                ctx.fillStyle = '#8e44ad';
                ctx.fillRect(b.width/2 + 5, -b.height/2 - 20, 10, b.height + 40);
                ctx.fillStyle = '#ff4757';
                ctx.beginPath();
                ctx.arc(b.width/2 + 10, -b.height/2 - 20, 15, 0, Math.PI * 2);
                ctx.fill();
            }

            // Traits Face visuals
        if (b.traits) {
            ctx.fillStyle = '#000';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.save();
            ctx.shadowBlur = 0;
            const ts = b.traits;
            
            if (ts.includes('DEPRESSED')) {
                ctx.beginPath();
                ctx.arc(-b.width/6, -b.height/6, 3, 0, Math.PI, true);
                ctx.arc(b.width/6, -b.height/6, 3, 0, Math.PI, true);
                ctx.stroke();
                ctx.fillStyle = '#00d2ff'; // tear
                ctx.fillRect(-b.width/6, 0, 3, 6);
                ctx.fillRect(b.width/6, 2, 3, 6);
            } else if (ts.includes('TRIUMVIRATE')) {
                ctx.beginPath();
                ctx.arc(-b.width/5, -b.height/6, 4, 0, Math.PI*2);
                ctx.arc(b.width/5, -b.height/6, 4, 0, Math.PI*2);
                ctx.arc(0, -b.height/3, 4, 0, Math.PI*2);
                ctx.fill();
            } else if (ts.includes('RAGE')) {
                ctx.beginPath();
                ctx.moveTo(-b.width/4, -b.height/3); ctx.lineTo(-b.width/8, -b.height/6);
                ctx.moveTo(b.width/4, -b.height/3); ctx.lineTo(b.width/8, -b.height/6);
                ctx.stroke();
                ctx.fillRect(-b.width/6, -b.height/5, 4, 4);
                ctx.fillRect(b.width/6 - 4, -b.height/5, 4, 4);
            } else if (ts.includes('HOMING')) {
                ctx.beginPath();
                ctx.arc(-b.width/6, -b.height/8, 5, 0, Math.PI*2);
                ctx.arc(b.width/6, -b.height/8, 5, 0, Math.PI*2);
                ctx.stroke();
                ctx.fillStyle = '#ff0000';
                ctx.fillRect(-b.width/6 - 1, -b.height/8 - 1, 2, 2);
                ctx.fillRect(b.width/6 - 1, -b.height/8 - 1, 2, 2);
            } else if (ts.includes('BOOMERANG')) {
                ctx.beginPath();
                ctx.arc(-b.width/6, -b.height/8, 5, 0, Math.PI, true);
                ctx.arc(b.width/6, -b.height/8, 5, 0, Math.PI, true);
                ctx.stroke();
            } else if (ts.includes('STONE')) {
                ctx.fillStyle = '#555';
                ctx.fillRect(-b.width/6, -b.height/6, 6, 6);
                ctx.fillRect(b.width/6 - 6, -b.height/6, 6, 6);
                ctx.fillRect(-b.width/4, b.height/8, b.width/2, 4);
            } else if (ts.includes('SHARP')) {
                ctx.beginPath();
                ctx.moveTo(-b.width/6, -b.height/6); ctx.lineTo(-b.width/8, -b.height/4); ctx.lineTo(-b.width/10, -b.height/6);
                ctx.moveTo(b.width/6, -b.height/6); ctx.lineTo(b.width/8, -b.height/4); ctx.lineTo(b.width/10, -b.height/6);
                ctx.fill();
            } else if (ts.includes('HEAL')) {
                ctx.fillStyle = '#2ecc71';
                ctx.fillRect(-b.width/6, -b.height/6 - 2, 4, 8);
                ctx.fillRect(-b.width/6 - 2, -b.height/6, 8, 4);
                ctx.fillRect(b.width/6, -b.height/6 - 2, 4, 8);
                ctx.fillRect(b.width/6 - 2, -b.height/6, 8, 4);
            } else if (ts.includes('CHILL')) {
                ctx.fillStyle = '#000';
                ctx.fillRect(-b.width/3, -b.height/4, b.width*0.66, 8);
            } else if (ts.includes('BOUNCY')) {
                ctx.beginPath();
                ctx.arc(-b.width/6, -b.height/6, 5, 0, Math.PI*2);
                ctx.arc(b.width/6, -b.height/6, 5, 0, Math.PI*2);
                ctx.stroke();
                ctx.fillStyle = '#e67e22';
                ctx.fill();
            } else if (ts.includes('GHOST')) {
                ctx.globalAlpha = 0.6;
                ctx.fillStyle = '#000';
                ctx.beginPath();
                ctx.arc(-b.width/6, -b.height/6, 4, 0, Math.PI*2);
                ctx.arc(b.width/6, -b.height/6, 4, 0, Math.PI*2);
                ctx.fill();
                ctx.fillRect(-b.width/4, b.height/4, b.width/2, b.height/4);
                ctx.globalAlpha = 1.0;
            }

            if (ts.includes('REACTIVE')) {
                ctx.fillStyle = '#ff4757';
                for (let i = 0; i < 4; i++) {
                    ctx.save();
                    ctx.rotate(i * Math.PI / 2);
                    ctx.fillRect(-2, -b.height/2 - 10, 4, 15);
                    ctx.restore();
                }
            }
            if (ts.includes('STATIC')) {
                ctx.strokeStyle = '#00d2ff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const ang = (i/6) * Math.PI * 2 + gameTime * 10;
                    ctx.moveTo(Math.cos(ang) * b.width/2, Math.sin(ang) * b.width/2);
                    ctx.lineTo(Math.cos(ang) * (b.width/2 + 15), Math.sin(ang) * (b.width/2 + 15));
                }
                ctx.stroke();
            }
            if (ts.includes('ORBITAL')) {
                if (b.orbitPoints) {
                    b.orbitPoints.forEach(orb => {
                        ctx.save();
                        ctx.rotate(orb.angle - stateAngle); 
                        ctx.fillStyle = '#ffa502';
                        ctx.shadowBlur = 10;
                        ctx.shadowColor = '#ffa502';
                        ctx.beginPath();
                        ctx.arc(b.width * 0.8 + 20, 0, 8, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.restore();
                    });
                }
            }
            
            ctx.restore();
        }
        }

        // State-specific visual changes
        ctx.save();
        if (b.state === 'BURST') {
            const charge = 1.5 - b.attackTimer; 
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(0, 0, b.width * (0.5 + charge), 0, Math.PI * 2);
            ctx.stroke();
        } else if (b.state === 'TRIPLE_SHOT') {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.moveTo(0, -b.height/2 - 10);
            ctx.lineTo(-20, -b.height/2 - 30);
            ctx.lineTo(20, -b.height/2 - 30);
            ctx.fill();
        } else if (b.state === 'WAVE' || b.state === 'SPIRAL') {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            const timeAng = gameTime * 10;
            for(let i=0; i<3; i++) {
                ctx.arc(0, 0, b.width/2 + 10 + i*5, timeAng + i, timeAng + i + Math.PI);
            }
            ctx.stroke();
        } else if (b.state === 'SINE') {
            ctx.strokeStyle = 'cyan';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for(let i = -b.width/2; i <= b.width/2; i+=5) {
                ctx.lineTo(i, Math.sin(gameTime * 20 + i*0.2) * 20);
            }
            ctx.stroke();
        } else if (b.state === 'BOUNCE') {
            ctx.fillStyle = '#00d2ff';
            ctx.fillRect(-b.width/3, -b.height/3 - Math.sin(gameTime*20)*10, b.width/1.5, b.height/1.5);
        } else if (b.state === 'WALL_STRIKE' || b.state === 'LASER_GRID' || b.state === 'CROSS_BEAM') {
            ctx.strokeStyle = 'yellow';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(0, -b.height); ctx.lineTo(0, b.height);
            ctx.moveTo(-b.width, 0); ctx.lineTo(b.width, 0);
            ctx.stroke();
        } else if (b.state === 'CHARGE' || b.state === 'SLAM_PREP' || b.state === 'SLAM') {
            ctx.strokeStyle = '#ff4757';
            ctx.lineWidth = Math.random() * 5 + 2;
            ctx.strokeRect(-b.width/2 - 10, -b.height/2 - 10, b.width + 20, b.height + 20);
        } else if (b.state === 'MINES' || b.state === 'SUMMON' || b.state === 'SUMMON_MINION') {
            // Draw a magic wand!
            ctx.save();
            ctx.rotate(Math.sin(gameTime * 10) * 0.5);
            ctx.fillStyle = '#8e44ad';
            ctx.fillRect(b.width/2, -b.height/2, 5, 40);
            ctx.fillStyle = '#f1c40f';
            ctx.beginPath();
            ctx.arc(b.width/2 + 2.5, -b.height/2, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else if (b.state === 'LAVA_PREP' || b.state === 'METEOR_SHOWER' || b.state === 'STALACTITE') {
            ctx.fillStyle = '#e67e22';
            ctx.beginPath();
            ctx.moveTo(0, -b.height/2 - 20 - Math.random() * 10);
            ctx.lineTo(-15, -b.height/2);
            ctx.lineTo(15, -b.height/2);
            ctx.fill();
        } else if (b.state === 'GRAVITY_WELL' || b.state === 'MAGNET' || b.state === 'RING_SHOCK') {
            ctx.strokeStyle = '#a29bfe';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(0, 0, b.width/2 + Math.abs(Math.sin(gameTime*5))*20, 0, Math.PI * 2);
            ctx.stroke();
        } else if (b.state === 'PHASE_SHIFT' || b.state === 'ORBITAL_STRIKE') {
            ctx.globalAlpha = 0.5 + Math.sin(gameTime*20)*0.5;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-b.width, -b.height, b.width*2, b.height*2);
            ctx.globalAlpha = 1.0;
        }

        ctx.restore();
        
        ctx.restore();

        // Determine opacity
        const projAlpha = (b.traits && b.traits.includes('GHOST')) ? 0.4 : 1.0;
        
        ctx.globalAlpha = projAlpha;

        // Projectiles
        b.projectiles.forEach(p => {
            ctx.fillStyle = p.type === 'LARGE' ? '#ffa502' : b.color;
            ctx.shadowBlur = 10;
            ctx.shadowColor = ctx.fillStyle;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
        });

        // Mines
        b.mines.forEach(m => {
            ctx.save();
            ctx.translate(m.x, m.y);
            if (m.state === 'READY') {
                ctx.fillStyle = b.color;
                ctx.shadowBlur = 15;
                ctx.shadowColor = b.color;
                const scale = 0.8 + Math.sin(gameTime * 8) * 0.2;
                ctx.scale(scale, scale);
                ctx.beginPath();
                ctx.arc(0, 0, m.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(0, 0, m.radius/2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillStyle = 'rgba(255, 255, 255, ' + (m.timer / 0.5) + ')';
                ctx.shadowBlur = 40;
                ctx.shadowColor = '#fff';
                ctx.beginPath();
                ctx.arc(0, 0, 60, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        });
        
        ctx.globalAlpha = 1.0;
    }

    drawBossEntity(boss);

    // Draw Seekers
    if (boss) {
        ctx.globalAlpha = (boss.traits && boss.traits.includes('GHOST')) ? 0.4 : 1.0;
        boss.seekers.forEach(s => {
            ctx.fillStyle = '#fff';
            ctx.shadowBlur = 15;
            ctx.shadowColor = boss.color;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Trail
            addTrail(s.x - s.radius, s.y - s.radius, s.radius*2, s.radius*2, boss.color);
        });
        ctx.globalAlpha = 1.0;
    }
    
    ctx.restore();
}

// --- CHARACTER CREATION & ONBOARDING ---
let creationStep = 1;
let creationStats = {
    speed: 0,
    jump: 0,
    damage: 0,
    crit: 0,
    firerate: 0
};
let creationPointsRemaining = 508;

window.nextCreationStep = function() {
    if (creationStep === 1) {
        document.getElementById('creation-step-1').style.display = 'none';
        document.getElementById('creation-step-2').style.display = 'block';
        creationStep = 2;
    } else if (creationStep === 2) {
        document.getElementById('creation-step-1').style.display = 'block';
        document.getElementById('creation-step-2').style.display = 'none';
        creationStep = 1;
    }
};

window.updateCreationStats = function() {
    const stats = ['speed', 'jump', 'damage', 'crit', 'firerate'];
    let total = 0;
    
    // First pass: calculate total
    stats.forEach(s => {
        total += parseInt(document.getElementById(`slider-${s}`).value);
    });

    // If over limit, we need to adjust the sliders
    if (total > 508) {
        // We find which slider was just changed or simply cap the values logic
        // For simplicity with sliders, we can just prevent the overflow
        // Find which one was bumped? Actually easier to just cap the slider values manually in a more "clamped" way
        // But a standard pattern is: if sum > total, subtract from others or just clamp current.
        // Let's just track old values to see which one changed.
    }
    
    // Re-calculating based on values
    // Using a simple logic: as you move a slider, if you're out of points, it pushes the others down OR just stops moving.
    // "Stopped moving" is usually better for users.
    
    let currentSum = 0;
    stats.forEach(s => {
        let val = parseInt(document.getElementById(`slider-${s}`).value);
        if (currentSum + val > 508) {
             val = 508 - currentSum;
             document.getElementById(`slider-${s}`).value = val;
        }
        currentSum += val;
        creationStats[s] = val;
        document.getElementById(`val-${s}`).innerText = val;
    });

    creationPointsRemaining = 508 - currentSum;
    document.getElementById('stat-points-remaining').innerText = creationPointsRemaining;
    
    // SFX on change
    if (Math.random() < 0.2) sfx.click();
};

function adminResetStats() {
    if (confirm("THIS WILL COMPLETELY WIPE ALL DATA: Stats, Progress, Highscores, and Customization. The app will act as if you've never visited before. Are you sure?")) {
        localStorage.clear();
        alert("Memory purged. Restarting initial sequence...");
        window.location.reload();
    }
}
window.adminResetStats = adminResetStats;

window.finalizeCreation = function() {
    // Save stats to localStorage
    localStorage.setItem('stat_speed', creationStats.speed);
    localStorage.setItem('stat_jump', creationStats.jump);
    localStorage.setItem('stat_damage', creationStats.damage);
    localStorage.setItem('stat_crit', creationStats.crit);
    localStorage.setItem('stat_firerate', creationStats.firerate);
    
    localStorage.setItem('firstTimeSetupComplete', 'true');
    
    // Apply stats to current player instance
    player.damage += creationStats.damage;
    player.crit += creationStats.crit / 100;
    playerMoveSpeed += creationStats.speed * 2;
    jumpForce -= creationStats.jump * 5;
    PLAYER_FIRE_RATE *= (1 - (creationStats.firerate / 1000));
    
    document.getElementById('creation-screen').style.display = 'none';
    gameState = 'START';
    showTitle();
    sfx.win();
};

window.cycleColor = function() {
    const colors = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#ecf0f1', '#e67e22', '#34495e'];
    let idx = colors.indexOf(player.color);
    player.color = colors[(idx + 1) % colors.length];
    localStorage.setItem('playerColor', player.color);
    renderAvatarPreview();
    sfx.click();
};

window.cycleEyes = function() {
    let idx = EYE_STYLES.indexOf(player.eyeStyle);
    player.eyeStyle = EYE_STYLES[(idx + 1) % EYE_STYLES.length];
    localStorage.setItem('playerEyeStyle', player.eyeStyle);
    renderAvatarPreview();
    sfx.click();
};

window.cycleHat = function() {
    let idx = HAT_STYLES.indexOf(player.hat);
    player.hat = HAT_STYLES[(idx + 1) % HAT_STYLES.length];
    localStorage.setItem('playerHat', player.hat);
    renderAvatarPreview();
    sfx.click();
};

function checkOnboarding() {
    if (!localStorage.getItem('firstTimeSetupComplete')) {
        gameState = 'CREATION';
        const screen = document.getElementById('creation-screen');
        if (screen) {
            screen.style.display = 'flex';
            renderAvatarPreview();
        }
    } else {
        // Load stats if they exist
        player.damage += parseInt(localStorage.getItem('stat_damage')) || 0;
        player.crit += (parseInt(localStorage.getItem('stat_crit')) || 0) / 100;
        playerMoveSpeed += (parseInt(localStorage.getItem('stat_speed')) || 0) * 2;
        jumpForce -= (parseInt(localStorage.getItem('stat_jump')) || 0) * 5;
        PLAYER_FIRE_RATE *= (1 - ((parseInt(localStorage.getItem('stat_firerate')) || 0) / 1000));
    }
}

// Expose functions for inline HTML event handlers
window.startGame = startGame;
window.resetRun = resetRun;
window.showControls = showControls;
window.showTitle = showTitle;
window.showAvatarEditor = showAvatarEditor;
window.remapKey = remapKey;
window.showAdminPanel = showAdminPanel;
window.postAnnouncement = postAnnouncement;
window.clearAnnouncement = clearAnnouncement;
window.adminLogin = adminLogin;
window.adminResetStats = adminResetStats;
window.toggleMobileMode = toggleMobileMode;
window.toggleSFX = toggleSFX;
window.setPlayerSize = setPlayerSize;
window.openDialogue = openDialogue;
window.closeDialogue = closeDialogue;

// Multiplayer Exports
window.signIn = signIn;
window.signOut = signOut;
window.showLobby = showLobby;
window.createRoom = createRoom;
window.quickJoin = quickJoin;
window.leaveRoom = leaveRoom;
window.joinRoom = joinRoom;
window.enterRoom = enterRoom;

// Initialization
checkOnboarding();
requestAnimationFrame(update);
