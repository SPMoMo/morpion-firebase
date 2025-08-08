// app.js — Morpion multijoueur (Firebase CDN) - entièrement commenté (FR)
// IMPORTANT: Remplacez firebaseConfig par votre configuration depuis la console Firebase
// Le code utilise la SDK Web modulaire via CDN.
// Voir DEPLOY_IN_BROWSER.md pour instructions étape-par-étape.

// ---- Imports depuis CDN (modulaire) ----
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc,
  onSnapshot, query, where, orderBy, limit, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// -----------------------------
// CONFIGURATION FIREBASE
// -----------------------------
// Remplacez les valeurs ci-dessous par celles de votre projet Firebase (console → Paramètres du projet → Vos applications)
const firebaseConfig = {
  apiKey: "AIzaSyDrDSDoWgbNGEk-CtcVAdF3yeQj-B1AVfA",
  authDomain: "morpion-demo.firebaseapp.com",
  projectId: "morpion-demo",
  storageBucket: "morpion-demo.firebasestorage.app",
  messagingSenderId: "537089836930",
  appId: "1:537089836930:web:2d6e5cef729a2c9113719b"
};

// Initialise Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---- Variables globales d'interface et d'état ----
let currentUser = null;
let currentGameId = null;
let currentGame = null;
let mySymbol = null; // 'X' ou 'O' ou 'SPECTATOR'
let localNickname = '';
let ui = { boardEl: null, statusEl: null, playersEl: null, timerX: null, timerO: null };

// --- DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  ui.boardEl = document.getElementById('board');
  ui.statusEl = document.getElementById('status');
  ui.playersEl = document.getElementById('players');
  ui.timerX = document.getElementById('timerX');
  ui.timerO = document.getElementById('timerO');

  // Render 9 cells
  for (let i=0;i<9;i++){
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.index = i;
    cell.addEventListener('click', () => handleCellClick(i));
    ui.boardEl.appendChild(cell);
  }

  // Wire up controls
  document.getElementById('quickMatchBtn').addEventListener('click', quickMatch);
  document.getElementById('createInviteBtn').addEventListener('click', createInvite);
  document.getElementById('joinBtn').addEventListener('click', () => {
    const val = document.getElementById('joinInput').value.trim();
    if(val) joinByIdOrLink(val);
  });
  document.getElementById('copyInvite').addEventListener('click', copyInvite);
  document.getElementById('restartBtn').addEventListener('click', restartLocal);
  document.getElementById('leaveBtn').addEventListener('click', leaveGame);

  // Nickname change
  document.getElementById('nickname').addEventListener('change', (e)=>{ localNickname = e.target.value.trim() || 'Anon'; });

  // Sign-in anonymement (nécessaire pour règles de sécurité et identification)
  signInAnonymously(auth).catch(err => {
    console.error('Erreur auth:', err);
    alert('Impossible de se connecter anonymement : ' + err.message);
  });

  onAuthStateChanged(auth, user => {
    currentUser = user;
    if(user){
      console.log('Utilisateur connecté (anonyme):', user.uid);
      localNickname = document.getElementById('nickname').value.trim() || ('User-'+user.uid.slice(0,5));
      ui.statusEl.textContent = 'Connecté — prêt';
      // Si l'URL contient ?gameId=... tenter de rejoindre
      const urlParams = new URLSearchParams(window.location.search);
      const gameId = urlParams.get('gameId') || urlParams.get('id');
      if(gameId) joinByIdOrLink(gameId);
    } else {
      ui.statusEl.textContent = 'Déconnecté';
    }
  });
});

// -----------------------------
// MODELS & HELPERS
// -----------------------------

// Crée l'objet initial d'une partie
function createInitialGameDoc({creatorUid, creatorName, mode='multiplayer', timePerPlayer=0, aiLevel='hard'}) {
  return {
    createdAt: serverTimestamp(),
    creator: { uid: creatorUid, name: creatorName },
    players: { X: { uid: creatorUid, name: creatorName }, O: null },
    board: ['', '', '', '', '', '', '', '', ''],
    turn: 'X',
    status: mode === 'ai' ? 'playing' : 'waiting',
    mode: mode, // 'multiplayer' | 'ai'
    aiLevel: aiLevel,
    moveCount: 0,
    winner: null,
    isTimed: timePerPlayer>0,
    timePerPlayerSec: timePerPlayer,
    timers: timePerPlayer>0 ? { X: timePerPlayer * 1000, O: timePerPlayer * 1000 } : { X: 0, O: 0 },
    turnStartedAt: Date.now(), // client-side approx (pour le chrono) — voir README pour limites
    lastMoveAt: null
  };
}

// Utility: format ms to mm:ss
function formatMs(ms){
  if(ms == null) return '--:--';
  ms = Math.max(0, Math.floor(ms));
  const s = Math.floor(ms/1000);
  const mm = Math.floor(s/60).toString().padStart(2,'0');
  const ss = (s%60).toString().padStart(2,'0');
  return `${mm}:${ss}`;
}

// -----------------------------
// MATCHMAKING & INVITES
// -----------------------------

async function quickMatch(){
  if(!currentUser){ alert('Pas encore connecté'); return; }
  const mode = document.getElementById('modeSelect').value;
  const timed = parseInt(document.getElementById('timedSelect').value,10) || 0;
  const aiLevel = document.getElementById('aiLevel').value;

  // If AI mode, create local AI game
  if(mode === 'ai'){
    const gameRef = await createGame({mode:'ai', timePerPlayer:timed, aiLevel});
    // Immediately start (player is X, AI is O)
    watchGame(gameRef.id);
    return;
  }

  // For multiplayer: try to find a waiting game to join
  ui.statusEl.textContent = 'Recherche d\'adversaire...';
  // Query recent waiting games
  const gamesCol = collection(db,'games');
  const q = query(gamesCol, where('status','==','waiting'), orderBy('createdAt'), limit(10));
  // We won't abuse reads — try to find a candidate and then use transaction to join
  const snap = await getDocsSafe(q);
  let joined = false;
  for(const docSnap of snap){
    const gd = docSnap.data();
    if(gd.players && gd.players.O == null){
      try {
        // attempt to join via transaction (atomic)
        await runTransaction(db, async (tx) => {
          const gRef = doc(db,'games',docSnap.id);
          const gDoc = await tx.get(gRef);
          if(!gDoc.exists()) throw 'No doc';
          const data = gDoc.data();
          if(data.status !== 'waiting') throw 'Not waiting';
          if(data.players && data.players.O) throw 'Taken';
          // join as O
          const newPlayers = Object.assign({}, data.players, { O: { uid: currentUser.uid, name: localNickname }});
          tx.update(gRef, {
            players: newPlayers,
            status: 'playing',
            turnStartedAt: Date.now(),
            lastMoveAt: serverTimestamp()
          });
        });
        // success
        currentGameId = docSnap.id;
        watchGame(currentGameId);
        joined = true;
        break;
      } catch(e){
        // someone else joined first — try next candidate
        console.warn('transaction join failed', e);
      }
    }
  }
  if(!joined){
    // create a new waiting game
    const gameRef = await createGame({mode:'multiplayer', timePerPlayer:timed, aiLevel});
    currentGameId = gameRef.id;
    // show invite link
    showInviteLink(gameRef.id);
    watchGame(gameRef.id);
  }
}

// Helper to safely get docs from query (workaround: not importing getDocs at top)
async function getDocsSafe(q){
  // dynamic import to avoid long import list at top
  const mod = await import('https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js');
  return mod.getDocs(q);
}

// Create a new game doc in Firestore
async function createGame({mode='multiplayer', timePerPlayer=0, aiLevel='hard'} = {}) {
  const gamesCol = collection(db,'games');
  const initial = createInitialGameDoc({creatorUid: currentUser.uid, creatorName: localNickname, mode, timePerPlayer, aiLevel});
  // Use addDoc to get an ID
  const docRef = await addDoc(gamesCol, initial);
  // If AI mode, immediately set players.O to AI marker so UI knows
  if(mode === 'ai'){
    await updateDoc(docRef, { players: { X: { uid: currentUser.uid, name: localNickname }, O: { uid: 'AI', name: 'Computer ('+aiLevel+')' } }});
  }
  return docRef;
}

// Create invite link (creates a waiting game if needed)
async function createInvite(){
  if(!currentUser){ alert('En attente de connexion...'); return; }
  const timed = parseInt(document.getElementById('timedSelect').value,10) || 0;
  const mode = 'multiplayer';
  const gameRef = await createGame({mode, timePerPlayer:timed, aiLevel: document.getElementById('aiLevel').value});
  currentGameId = gameRef.id;
  showInviteLink(gameRef.id);
  watchGame(gameRef.id);
}

function buildInviteUrl(gameId){
  const loc = window.location;
  return `${loc.origin}${loc.pathname}?gameId=${gameId}`;
}
function showInviteLink(gameId){
  const box = document.getElementById('inviteBox');
  box.classList.remove('hidden');
  const inviteInput = document.getElementById('inviteLink');
  inviteInput.value = buildInviteUrl(gameId);
}

// Copy invite
function copyInvite(){
  const v = document.getElementById('inviteLink').value;
  navigator.clipboard?.writeText(v);
  alert('Lien copié !');
}

// Join by ID or by full link
async function joinByIdOrLink(val){
  // extract id if full url
  try{
    if(val.includes('gameId=')) {
      const u = new URL(val);
      const id = u.searchParams.get('gameId');
      if(id) return joinGame(id);
    }
  }catch(e){}
  // else treat as direct id
  return joinGame(val);
}

// Core: join an existing game
async function joinGame(gameId){
  if(!currentUser) { alert('Connexion nécessaire'); return; }
  const gRef = doc(db,'games',gameId);
  try{
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(gRef);
      if(!snap.exists()) throw 'Partie introuvable';
      const data = snap.data();
      if(data.mode === 'ai') throw 'Impossible de rejoindre une IA';
      if(data.status === 'finished') throw 'Partie terminée';
      if(data.players && data.players.O && data.players.X && data.players.X.uid && data.players.O.uid) {
        // full — spectator
        // simply attach as spectator (no write)
        return;
      }
      if(!data.players || !data.players.O){
        const newPlayers = Object.assign({}, data.players || {}, { O: { uid: currentUser.uid, name: localNickname }});
        tx.update(gRef, { players: newPlayers, status: 'playing', turnStartedAt: Date.now(), lastMoveAt: serverTimestamp() });
      }
    });
    currentGameId = gameId;
    watchGame(gameId);
  }catch(e){
    alert('Erreur en rejoignant : '+e);
    console.error(e);
  }
}

// Leave game (unsubscribe + optionally set spectator)
function leaveGame(){
  if(currentGameId) {
    // we don't delete the game doc; just stop listening and reset UI
    stopWatching();
    currentGameId = null;
    currentGame = null;
    mySymbol = null;
    ui.statusEl.textContent = 'Hors partie';
    renderBoard(['','','','','','','','','']);
  }
}

let unsub = null;
function stopWatching(){
  if(unsub) { unsub(); unsub = null; }
}

// Watch game for realtime updates
function watchGame(gameId){
  stopWatching();
  const gRef = doc(db,'games',gameId);
  unsub = onSnapshot(gRef, async (snap) => {
    if(!snap.exists()){ ui.statusEl.textContent = 'Partie supprimée'; return; }
    const data = snap.data();
    currentGame = Object.assign({ id: snap.id }, data);
    // deduce mySymbol
    if(currentUser && data.players){
      if(data.players.X && data.players.X.uid === currentUser.uid) mySymbol = 'X';
      else if(data.players.O && data.players.O.uid === currentUser.uid) mySymbol = 'O';
      else mySymbol = 'SPECTATOR';
    } else {
      mySymbol = null;
    }
    // Render UI
    renderGameFromData(currentGame);
    // If AI turn, and mode == 'ai' and it's AI's move, run AI move locally
    if(currentGame.mode === 'ai' && currentGame.status === 'playing'){
      const aiIsO = currentGame.players && currentGame.players.O && currentGame.players.O.uid === 'AI';
      const currentTurn = currentGame.turn;
      if(aiIsO && currentTurn === 'O'){
        // small delay so UI updates
        setTimeout(()=> aiMakeMoveIfNeeded(currentGame), 400);
      }
      // If AI is X (player chose to play as O) this code supports both but default we make player X.
    }

  }, (err) => {
    console.error('snapshot error', err);
  });
}

// Render game snapshot into UI
function renderGameFromData(data){
  ui.statusEl.textContent = `Partie: ${data.status.toUpperCase()} — Tour: ${data.turn}`;
  ui.playersEl.textContent = `X: ${data.players?.X?.name||'—'}  —  O: ${data.players?.O?.name||'—'}`;
  renderBoard(data.board || ['','','','','','','','','']);
  // timers
  if(data.isTimed){
    // compute remaining timers from document fields
    ui.timerX.textContent = formatMs(data.timers?.X || 0);
    ui.timerO.textContent = formatMs(data.timers?.O || 0);
  } else {
    ui.timerX.textContent = '--:--';
    ui.timerO.textContent = '--:--';
  }
  // If finished, show winner
  if(data.status === 'finished'){
    if(data.winner === 'draw') ui.statusEl.textContent = 'Partie terminée — Match nul';
    else ui.statusEl.textContent = `Partie terminée — Vainqueur: ${data.winner}`;
  }

  // Disable board for spectators or when not your turn
  const cells = ui.boardEl.querySelectorAll('.cell');
  cells.forEach((c,i)=>{
    if(data.status !== 'playing') c.classList.add('disabled');
    else if(mySymbol === 'SPECTATOR') c.classList.add('disabled');
    else {
      if(data.turn !== mySymbol) c.classList.add('disabled');
      else c.classList.remove('disabled');
    }
    c.textContent = data.board?.[i] || '';
  });
}

// Render board blank or with array
function renderBoard(boardArr){
  const cells = ui.boardEl.querySelectorAll('.cell');
  cells.forEach((c,i)=>{
    c.textContent = boardArr?.[i] || '';
    c.classList.toggle('disabled', !boardArr);
  });
}

// Handle click on a cell (index)
async function handleCellClick(index){
  if(!currentGame || currentGame.status !== 'playing') { alert('Aucune partie active'); return; }
  if(mySymbol === 'SPECTATOR' || mySymbol == null){ alert('Vous êtes spectateur'); return; }
  if(currentGame.turn !== mySymbol){ alert('Pas votre tour'); return; }
  // Attempt to make move using transaction (atomique)
  const gRef = doc(db,'games',currentGame.id);
  try{
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(gRef);
      if(!snap.exists()) throw 'Partie supprimée';
      const data = snap.data();
      if(data.status !== 'playing') throw 'La partie n\'est pas en cours';
      if(data.turn !== mySymbol) throw 'Ce n\'est pas votre tour';
      if(data.board[index]) throw 'Case déjà prise';
      // Timer deduction (approx, client-side)
      if(data.isTimed){
        const now = Date.now();
        const turnStartedAt = data.turnStartedAt || now;
        const elapsed = now - turnStartedAt;
        const timers = Object.assign({}, data.timers || { X:0, O:0 });
        timers[mySymbol] = Math.max(0, (timers[mySymbol] || 0) - elapsed);
        if(timers[mySymbol] <= 0){
          // timeout -> other player wins
          tx.update(gRef, { status: 'finished', winner: (mySymbol==='X'?'O':'X'), timers, lastMoveAt: serverTimestamp() });
          return;
        }
        // apply move
        const newBoard = Array.from(data.board);
        newBoard[index] = mySymbol;
        const winner = computeWinner(newBoard);
        const nextTurn = (winner || data.moveCount+1 >= 9) ? null : (mySymbol === 'X' ? 'O' : 'X');
        const newStatus = winner ? 'finished' : ((data.moveCount+1)>=9 ? 'finished' : 'playing');
        const winnerVal = winner ? winner : ((data.moveCount+1)>=9 ? 'draw' : null);
        // Update timers: subtract elapsed from current player, start next turn timestamp
        const updates = {
          board: newBoard,
          moveCount: (data.moveCount||0) + 1,
          turn: nextTurn,
          status: newStatus,
          winner: winnerVal,
          timers,
          turnStartedAt: Date.now(),
          lastMoveAt: serverTimestamp()
        };
        tx.update(gRef, updates);
      } else {
        // Non-timed simple move
        const newBoard = Array.from(data.board);
        newBoard[index] = mySymbol;
        const winner = computeWinner(newBoard);
        const nextTurn = (winner || data.moveCount+1 >= 9) ? null : (mySymbol === 'X' ? 'O' : 'X');
        const newStatus = winner ? 'finished' : ((data.moveCount+1)>=9 ? 'finished' : 'playing');
        const winnerVal = winner ? winner : ((data.moveCount+1)>=9 ? 'draw' : null);
        tx.update(gRef, {
          board: newBoard,
          moveCount: (data.moveCount||0) + 1,
          turn: nextTurn,
          status: newStatus,
          winner: winnerVal,
          lastMoveAt: serverTimestamp()
        });
      }
    });
  }catch(e){
    console.error('Erreur au transaction move', e);
    alert('Impossible de jouer : ' + e);
  }
}

// -----------------------------
// GAME LOGIC: GAGNANT, MINIMAX AI
// -----------------------------

// Check winner: returns 'X' or 'O' or null
function computeWinner(board){
  const wins = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for(const [a,b,c] of wins){
    if(board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
  }
  return null;
}

// AI: drive AI moves (for mode ai)
async function aiMakeMoveIfNeeded(gameData){
  if(!gameData) return;
  if(gameData.mode !== 'ai') return;
  const aiPlayer = 'O'; // we set AI as O in createGame
  if(gameData.turn !== aiPlayer) return;
  // Choose level
  const level = gameData.aiLevel || 'hard';
  const moveIndex = chooseAiMove(gameData.board, aiPlayer, level);
  if(moveIndex == null) return;
  // perform local "move" — use same transaction flow as human did
  const gRef = doc(db,'games',gameData.id);
  try{
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(gRef);
      if(!snap.exists()) throw 'Partie supprimée';
      const data = snap.data();
      if(data.turn !== aiPlayer) throw 'Pas le tour AI';
      if(data.board[moveIndex]) throw 'Case déjà prise';
      const newBoard = Array.from(data.board);
      newBoard[moveIndex] = aiPlayer;
      const winner = computeWinner(newBoard);
      const nextTurn = (winner || data.moveCount+1 >= 9) ? null : (aiPlayer === 'X' ? 'O' : 'X');
      const newStatus = winner ? 'finished' : ((data.moveCount+1)>=9 ? 'finished' : 'playing');
      const winnerVal = winner ? winner : ((data.moveCount+1)>=9 ? 'draw' : null);
      tx.update(gRef, {
        board: newBoard,
        moveCount: (data.moveCount||0) + 1,
        turn: nextTurn,
        status: newStatus,
        winner: winnerVal,
        lastMoveAt: serverTimestamp(),
        turnStartedAt: Date.now()
      });
    });
  }catch(e){
    console.warn('AI move failed', e);
  }
}

// Choose AI move based on level
function chooseAiMove(board, aiPlayer, level='hard'){
  const empty = board.map((v,i)=> v? null:i).filter(v=>v!==null);
  if(level === 'easy'){
    // random
    const empties = board.map((v,i)=> v? null:i).filter(v=>v!==null);
    if(empties.length === 0) return null;
    return empties[Math.floor(Math.random()*empties.length)];
  }
  // medium: shallow minimax depth 3
  const depthLimit = (level==='medium')?3:9;
  const best = minimax(board, aiPlayer, aiPlayer, depthLimit);
  return best.index;
}

// Minimax implementation (returns {score, index})
function minimax(board, player, aiPlayer, depth){
  // board is array of 9
  const avail = board.map((v,i)=> v? null:i).filter(v=>v!==null);
  const winner = computeWinner(board);
  if(winner === aiPlayer) return { score: 10 };
  if(winner && winner !== aiPlayer) return { score: -10 };
  if(avail.length === 0) return { score: 0 };
  if(depth === 0) return { score: 0 }; // depth-limited: neutral

  const moves = [];
  for(const i of avail){
    const newBoard = board.slice();
    newBoard[i] = player;
    const nextPlayer = (player === 'X') ? 'O' : 'X';
    const result = minimax(newBoard, nextPlayer, aiPlayer, depth-1);
    moves.push({ index: i, score: result.score });
  }
  // choose max for aiPlayer, min for opponent
  let bestMove = null;
  if(player === aiPlayer){
    let bestScore = -Infinity;
    for(const m of moves) if(m.score > bestScore){ bestScore = m.score; bestMove = m; }
  } else {
    let bestScore = Infinity;
    for(const m of moves) if(m.score < bestScore){ bestScore = m.score; bestMove = m; }
  }
  return bestMove;
}

// -----------------------------
// MISC: restart, UI helpers, simple QA helpers
// -----------------------------

async function restartLocal(){
  if(!currentGameId) return alert('Aucune partie active');
  // Only allow restart by creator (simple rule)
  const gRef = doc(db,'games', currentGameId);
  try{
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(gRef);
      if(!snap.exists()) throw 'Partie supprimée';
      const data = snap.data();
      if(data.creator?.uid !== currentUser.uid) throw 'Seul le créateur peut relancer';
      tx.update(gRef, {
        board: ['', '', '', '', '', '', '', '', ''],
        status: data.mode==='ai' ? 'playing' : 'waiting',
        winner: null,
        moveCount: 0,
        turn: 'X',
        turnStartedAt: Date.now(),
        lastMoveAt: serverTimestamp()
      });
    });
  }catch(e){
    alert('Impossible de relancer: '+e);
  }
}

// Simple leave and cleanup (does not delete game doc)
function leaveGameLocal(){
  leaveGame();
}

// -----------------------------
// Helper: compute absolute path for joining link
// -----------------------------

// -----------------------------
// END OF FILE
// -----------------------------
