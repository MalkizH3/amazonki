import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getAuth,
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,  
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBe9jWOPkH48gKbFAL5NQhED8S4kwR2rNk",
  authDomain: "ki-807c6.firebaseapp.com",
  projectId: "ki-807c6",
  storageBucket: "ki-807c6.firebasestorage.app",
  messagingSenderId: "588011077368",
  appId: "1:588011077368:web:e4cc5a219d62404842050d",
  measurementId: "G-D9HZ0JZ1QP"
};

const CARD_DISTRIBUTION = {
  3: { empty: 8, treasure: 5, trap: 2, total: 15 },
  4: { empty: 12, treasure: 6, trap: 2, total: 20 },
  5: { empty: 16, treasure: 7, trap: 2, total: 25 },
  6: { empty: 20, treasure: 8, trap: 2, total: 30 },
  7: { empty: 26, treasure: 7, trap: 2, total: 35 },
  8: { empty: 30, treasure: 8, trap: 2, total: 40 },
  9: { empty: 34, treasure: 9, trap: 2, total: 45 },
  10: { empty: 37, treasure: 10, trap: 3, total: 50 },
};

const TEAM_POOL_DISTRIBUTION = {
  3: { amazons: 2, raiders: 2 },
  4: { amazons: 2, raiders: 3 },
  5: { amazons: 2, raiders: 3 },
  6: { amazons: 2, raiders: 4 },
  7: { amazons: 3, raiders: 5 },
  8: { amazons: 3, raiders: 6 },
  9: { amazons: 3, raiders: 6 },
  10: { amazons: 4, raiders: 7 },
};

const CARD_IMAGES = {
  hidden: "images/ukryty.png",
  empty: "images/pusty.png",
  treasure: "images/skarb.png",
  trap: "images/pulapka.png",
};

const MAX_ROUNDS = 4;
const ROOM_EXPIRY_MS = 3 * 60 * 1000;
const LOCAL_ROOM_PREFIX = "gva_local_room_";
const LOCAL_UID_KEY = "gva_local_uid";
const ACTIVE_ROOM_KEY = "gva_active_room_id";

const state = {
  mode: "firebase",
  db: null,
  auth: null,
  user: null,
  roomId: null,
  room: null,
  players: [],
  roomUnsub: null,
  playersUnsub: null,
  localSyncTimer: null,
  cleanupTimer: null,
  animatedCardIds: new Set(),
  hostCleanupTriggered: false,
};

const els = {
  configWarning: document.getElementById("configWarning"),
  connectionInfo: document.getElementById("connectionInfo"),
  joinPanel: document.getElementById("joinPanel"),
  lobbyPanel: document.getElementById("lobbyPanel"),
  gamePanel: document.getElementById("gamePanel"),
  nameInput: document.getElementById("nameInput"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  saveProfileBtn: document.getElementById("saveProfileBtn"),
  playersList: document.getElementById("playersList"),
  lobbyInfo: document.getElementById("lobbyInfo"),
  roomCodeBadge: document.getElementById("roomCodeBadge"),
  startGameBtn: document.getElementById("startGameBtn"),
  copyCodeBtn: document.getElementById("copyCodeBtn"),
  statusText: document.getElementById("statusText"),
  roundValue: document.getElementById("roundValue"),
  treasureValue: document.getElementById("treasureValue"),
  trapValue: document.getElementById("trapValue"),
  keyHolderValue: document.getElementById("keyHolderValue"),
  gameStatusBadge: document.getElementById("gameStatusBadge"),
  nextRoundBtn: document.getElementById("nextRoundBtn"),
  endGameBtn: document.getElementById("endGameBtn"),
  tablePlayers: document.getElementById("tablePlayers"),
  winnerBanner: document.getElementById("winnerBanner"),
  roleModal: document.getElementById("roleModal"),
  roleModalText: document.getElementById("roleModalText"),
  roleModalOkBtn: document.getElementById("roleModalOkBtn"),
  toast: document.getElementById("toast"),
};

init();

async function init() {
  hydrateProfile();
  wireEvents();

  if (isFirebaseConfigPlaceholder(FIREBASE_CONFIG)) {
    enableLocalMode("Brak konfiguracji Firebase. Uruchomiono tryb lokalny do testów.");
    return;
  }

  try {
    const app = initializeApp(FIREBASE_CONFIG);
    state.db = getFirestore(app);
    state.auth = getAuth(app);

    showConnection("Logowanie anonimowe...");

      await setPersistence(state.auth, browserLocalPersistence);

    await signInAnonymously(state.auth);
    onAuthStateChanged(state.auth, (user) => {
      if (!user) {
        return;
      }

      state.user = user;
      hideConnection();
        void restoreActiveRoomIfAny();
      toast("Połączono jako anonimowy użytkownik Firebase.");
    });
  } catch (error) {
    enableLocalMode(`Błąd Firebase: ${error.message}. Przełączono na tryb lokalny.`);
  }
}

function wireEvents() {
  els.createRoomBtn.addEventListener("click", createRoom);
  els.joinRoomBtn.addEventListener("click", joinRoomFromInput);
  els.saveProfileBtn.addEventListener("click", saveProfile);
  els.startGameBtn.addEventListener("click", startGame);
  els.nextRoundBtn.addEventListener("click", startNextRound);
  els.endGameBtn.addEventListener("click", endGame);
  els.roleModalOkBtn.addEventListener("click", acknowledgeRoleModal);
  els.copyCodeBtn.addEventListener("click", copyRoomCode);
  els.roomCodeInput.addEventListener("input", () => {
    els.roomCodeInput.value = els.roomCodeInput.value.toUpperCase().trim();
  });
}

function hydrateProfile() {
  const savedName = localStorage.getItem("gva_name");

  if (savedName) {
    els.nameInput.value = savedName;
  }

  els.roomCodeInput.value = "";
}

function saveProfile() {
  const profile = getProfile();
  if (!profile) {
    return;
  }

  localStorage.setItem("gva_name", profile.name);
  toast("Profil zapisany lokalnie.");

  if (state.roomId && state.user) {
    upsertPlayerInRoom(state.roomId, profile).catch((error) => {
      toast(`Nie udało się zaktualizować profilu: ${error.message}`);
    });
  }
}

async function createRoom() {
  if (state.mode === "local") {
    await createRoomLocal();
    return;
  }

  if (!state.db || !state.user) {
    toast("Firebase jeszcze się łączy.");
    return;
  }

  const profile = getProfile();
  if (!profile) {
    return;
  }

  let roomId = "";
  for (let i = 0; i < 5; i += 1) {
    const candidate = randomRoomCode();
    const roomRef = doc(state.db, "rooms", candidate);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) {
      roomId = candidate;
      break;
    }
  }

  if (!roomId) {
    toast("Nie udało się wygenerować kodu pokoju, spróbuj ponownie.");
    return;
  }

  const roomRef = doc(state.db, "rooms", roomId);

  await setDoc(roomRef, {
    status: "lobby",
    hostId: state.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    gameToken: null,
    finishedAt: null,
    hostReturnedAt: null,
    maxRounds: MAX_ROUNDS,
    round: 1,
    currentKeyHolder: null,
    revealedThisRound: 0,
    revealedTreasures: 0,
    revealedTraps: 0,
    deckStats: null,
    cards: [],
    winner: null,
    winnerReason: null,
  });

  await upsertPlayerInRoom(roomId, profile);
  await subscribeToRoom(roomId);
  toast(`Utworzono pokój ${roomId}.`);
}

async function joinRoomFromInput() {
  if (state.mode === "local") {
    await joinRoomFromInputLocal();
    return;
  }

  if (!state.db || !state.user) {
    toast("Firebase jeszcze się łączy.");
    return;
  }

  const profile = getProfile();
  if (!profile) {
    return;
  }

  const roomId = els.roomCodeInput.value.trim().toUpperCase();
  if (!roomId) {
    toast("Podaj kod pokoju.");
    return;
  }

  const roomRef = doc(state.db, "rooms", roomId);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) {
    toast("Taki pokój nie istnieje.");
    return;
  }

  const roomData = roomSnap.data();
  if (roomData.status === "playing") {
    toast("Nie można dołączyć w trakcie gry. Poczekaj na lobby.");
    return;
  }

  await upsertPlayerInRoom(roomId, profile);
  await subscribeToRoom(roomId);
  toast(`Dołączono do ${roomId}.`);
}

async function upsertPlayerInRoom(roomId, profile) {
  if (state.mode === "local") {
    upsertPlayerInRoomLocal(roomId, profile);
    return;
  }

  const playerRef = doc(state.db, "rooms", roomId, "players", state.user.uid);
  await setDoc(
    playerRef,
    {
      id: state.user.uid,
      name: profile.name,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

async function subscribeToRoom(roomId) {
  if (state.mode === "local") {
    subscribeToRoomLocal(roomId);
    return;
  }

  unsubscribeRoomListeners();
  state.roomId = roomId;
  setActiveRoom(roomId);

  const roomRef = doc(state.db, "rooms", roomId);
  const playersQuery = query(
    collection(state.db, "rooms", roomId, "players"),
    orderBy("joinedAt", "asc"),
  );

  state.roomUnsub = onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) {
      toast("Pokój został usunięty.");
      clearFinishedCleanupTimer();
      clearActiveRoom();
      unsubscribeRoomListeners();
      resetRoomState();
      render();
      return;
    }

    state.room = snap.data();
    scheduleFinishedRoomCleanup();
    render();
  });

  state.playersUnsub = onSnapshot(playersQuery, (snapshot) => {
    state.players = snapshot.docs.map((d) => d.data());
    render();
  });

  els.roomCodeInput.value = roomId;
  render();
}

function unsubscribeRoomListeners() {
  if (state.localSyncTimer) {
    window.clearInterval(state.localSyncTimer);
    state.localSyncTimer = null;
  }

  clearFinishedCleanupTimer();

  if (state.roomUnsub) {
    state.roomUnsub();
  }
  if (state.playersUnsub) {
    state.playersUnsub();
  }

  state.roomUnsub = null;
  state.playersUnsub = null;
}

function resetRoomState() {
  state.roomId = null;
  state.room = null;
  state.players = [];
  state.hostCleanupTriggered = false;
  clearFinishedCleanupTimer();
}

function clearFinishedCleanupTimer() {
  if (state.cleanupTimer) {
    window.clearTimeout(state.cleanupTimer);
    state.cleanupTimer = null;
  }
}

function getTimestampMillis(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }

  return null;
}

function scheduleFinishedRoomCleanup() {
  clearFinishedCleanupTimer();

  if (!state.room || state.room.status !== "finished") {
    return;
  }

  if (state.room.hostReturnedAt) {
    return;
  }

  const finishedAt = getTimestampMillis(state.room.finishedAt);
  if (!finishedAt) {
    return;
  }

  const delay = ROOM_EXPIRY_MS - (Date.now() - finishedAt);
  if (delay <= 0) {
    void deleteExpiredFinishedRoom();
    return;
  }

  state.cleanupTimer = window.setTimeout(() => {
    void deleteExpiredFinishedRoom();
  }, delay);
}

async function deleteExpiredFinishedRoom() {
  if (!state.roomId || !state.room || state.room.status !== "finished") {
    return;
  }

  if (state.room.hostReturnedAt) {
    return;
  }

  const finishedAt = getTimestampMillis(state.room.finishedAt);
  if (!finishedAt || Date.now() - finishedAt < ROOM_EXPIRY_MS) {
    scheduleFinishedRoomCleanup();
    return;
  }

  if (state.mode === "local") {
    localStorage.removeItem(localRoomKey(state.roomId));
    clearActiveRoom();
    unsubscribeRoomListeners();
    resetRoomState();
    render();
    return;
  }

  if (!state.db) {
    return;
  }

  try {
    const roomRef = doc(state.db, "rooms", state.roomId);
    const playersSnap = await getDocs(collection(state.db, "rooms", state.roomId, "players"));
    const batch = writeBatch(state.db);

    playersSnap.forEach((playerDoc) => {
      batch.delete(playerDoc.ref);
    });

    batch.delete(roomRef);
    await batch.commit();
  } catch {
    // Best-effort cleanup after expiry.
  } finally {
    clearActiveRoom();
    unsubscribeRoomListeners();
    resetRoomState();
    render();
  }
}

async function startGame() {
  if (state.mode === "local") {
    startOrRestartGameLocal();
    return;
  }

  if (!state.roomId || !state.room || !isHost()) {
    return;
  }

  if (state.room.status !== "lobby" && state.room.status !== "finished") {
    toast("Gra już się rozpoczęła.");
    return;
  }

  const players = [...state.players];
  if (players.length < 3 || players.length > 10) {
    toast("Do startu potrzeba od 3 do 10 graczy.");
    return;
  }

  const deckStats = CARD_DISTRIBUTION[players.length];
  const teamPool = TEAM_POOL_DISTRIBUTION[players.length];
  if (!deckStats) {
    toast("Brak konfiguracji talii dla tej liczby graczy.");
    return;
  }
  if (!teamPool) {
    toast("Brak konfiguracji puli drużyn dla tej liczby graczy.");
    return;
  }

  const assignments = assignRandomTeams(players, teamPool);

  if (assignments.length !== players.length) {
    toast("Nie udało się przydzielić drużyn.");
    return;
  }

  const cards = buildDeck(deckStats);
  shuffle(cards);

  const playerIds = players.map((p) => p.id);
  const cardsPerPlayer = cards.length / playerIds.length;
  cards.forEach((card, index) => {
    const ownerIndex = Math.floor(index / cardsPerPlayer);
    card.ownerId = playerIds[ownerIndex];
    card.revealed = false;
    card.revealedInRound = null;
  });

  const firstKeyHolder = playerIds[Math.floor(Math.random() * playerIds.length)];

  const roomRef = doc(state.db, "rooms", state.roomId);
  const gameToken = Date.now();
  await updateDoc(roomRef, {
    status: "playing",
    updatedAt: serverTimestamp(),
    gameToken,
    finishedAt: null,
    hostReturnedAt: null,
    maxRounds: MAX_ROUNDS,
    round: 1,
    currentKeyHolder: firstKeyHolder,
    revealedThisRound: 0,
    revealedTreasures: 0,
    revealedTraps: 0,
    awaitingNextRound: false,
    deckStats,
    cards,
    winner: null,
    winnerReason: null,
  });

  const teamUpdates = assignments.map(({ id, team }) => {
    const playerRef = doc(state.db, "rooms", state.roomId, "players", id);
    return updateDoc(playerRef, {
      team,
      updatedAt: serverTimestamp(),
    });
  });
  await Promise.all(teamUpdates);

  toast(state.room.status === "finished" ? "Nowa gra wystartowała." : "Gra wystartowała.");
}

async function passKeyAndReveal(targetId) {
  if (state.mode === "local") {
    passKeyAndRevealLocal(targetId);
    return;
  }

  if (!state.roomId || !state.room || !state.user) {
    return;
  }

  const roomRef = doc(state.db, "rooms", state.roomId);
  const playerIds = state.players.map((p) => p.id);

  try {
    await runTransaction(state.db, async (tx) => {
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) {
        throw new Error("Pokój nie istnieje.");
      }

      const room = roomSnap.data();

      if (room.status !== "playing") {
        throw new Error("Gra nie jest aktywna.");
      }
      if (room.winner) {
        throw new Error("Gra już została zakończona.");
      }
      if (room.awaitingNextRound) {
        throw new Error("Czekamy na rozpoczęcie nowej rundy przez hosta.");
      }
      if (room.currentKeyHolder !== state.user.uid) {
        throw new Error("Nie masz teraz klucza.");
      }

      const cards = Array.isArray(room.cards) ? [...room.cards] : [];
      const targetIndex = cards.findIndex((card) => card.id === targetId);

      if (targetIndex < 0) {
        throw new Error("Wybrana karta nie istnieje.");
      }

      const targetCard = cards[targetIndex];
      if (targetCard.revealed) {
        throw new Error("Ta karta jest już odkryta.");
      }
      if (targetCard.ownerId === state.user.uid) {
        throw new Error("Musisz wybrać kartę innego gracza.");
      }

      const pickedCard = {
        ...targetCard,
        revealed: true,
        revealedInRound: room.round,
      };
      cards[targetIndex] = pickedCard;
      cards[targetIndex].highlighted = true;

      let revealedTreasures = room.revealedTreasures || 0;
      let revealedTraps = room.revealedTraps || 0;

      if (pickedCard.type === "treasure") {
        revealedTreasures += 1;
      }
      if (pickedCard.type === "trap") {
        revealedTraps += 1;
      }

      const deckStats = room.deckStats || { treasure: 0, trap: 0 };
      let winner = null;
      let winnerReason = null;
      let round = room.round;
      let status = room.status;
      let revealedThisRound = (room.revealedThisRound || 0) + 1;
      let awaitingNextRound = false;
      let awaitingGameEnd = Boolean(room.awaitingGameEnd);

      if (revealedTreasures >= deckStats.treasure) {
        winner = "raiders";
        winnerReason = "Odkryto wszystkie skarby.";
        awaitingGameEnd = true;
      } else if (revealedTraps >= deckStats.trap) {
        winner = "amazons";
        winnerReason = "Odkryto wszystkie pułapki.";
        awaitingGameEnd = true;
      }

      if (!winner && revealedThisRound >= playerIds.length) {
        if (round >= (room.maxRounds || MAX_ROUNDS)) {
          winner = "amazons";
          winnerReason = "Minęły 4 rundy i nie odkryto wszystkich skarbów.";
          awaitingGameEnd = true;
        } else {
          awaitingNextRound = true;
        }
      }

      tx.update(roomRef, {
        updatedAt: serverTimestamp(),
        cards,
        currentKeyHolder: targetCard.ownerId,
        revealedTreasures,
        revealedTraps,
        revealedThisRound,
        round,
        status,
        awaitingNextRound,
        awaitingGameEnd,
        winner,
        winnerReason,
      });
    });
  } catch (error) {
    toast(error.message);
  }
}

async function startNextRound() {
  if (state.mode === "local") {
    startNextRoundLocal();
    return;
  }

  if (!state.roomId || !state.room || !state.user || !isHost()) {
    return;
  }

  if (!state.room.awaitingNextRound) {
    toast("Ta runda jeszcze się nie zakończyła.");
    return;
  }

  const roomRef = doc(state.db, "rooms", state.roomId);
  const playerIds = state.players.map((p) => p.id);

  await runTransaction(state.db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) {
      throw new Error("Pokój nie istnieje.");
    }

    const room = roomSnap.data();
    if (!room.awaitingNextRound) {
      throw new Error("Ta runda jeszcze się nie zakończyła.");
    }
    if (room.awaitingGameEnd) {
      throw new Error("Gra czeka już na zakończenie przez hosta.");
    }
    if (room.winner) {
      throw new Error("Gra już została zakończona.");
    }

    const cards = Array.isArray(room.cards) ? [...room.cards] : [];

    cards.forEach((card, index) => {
      if (card.revealed) {
        cards[index] = {
          ...card,
          removed: true,
          highlighted: false,
        };
      } else {
        cards[index] = {
          ...card,
          highlighted: false,
        };
      }
    });

    const unrevealedIndexes = cards
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => !card.revealed && !card.removed);

    shuffle(unrevealedIndexes);

    const cardsPerPlayer = unrevealedIndexes.length / playerIds.length;
    unrevealedIndexes.forEach(({ index }, i) => {
      const ownerIndex = Math.floor(i / cardsPerPlayer);
      cards[index] = {
        ...cards[index],
        ownerId: playerIds[ownerIndex],
      };
    });

    tx.update(roomRef, {
      updatedAt: serverTimestamp(),
      cards,
      round: (room.round || 1) + 1,
      revealedThisRound: 0,
      awaitingNextRound: false,
    });
  });
}

async function endGame() {
  if (state.mode === "local") {
    endGameLocal();
    return;
  }

  if (!state.roomId || !state.room || !state.user || !isHost()) {
    return;
  }

  if (!state.room.awaitingGameEnd) {
    toast("Gra nie jest jeszcze gotowa do zakończenia.");
    return;
  }

  const roomRef = doc(state.db, "rooms", state.roomId);
  await runTransaction(state.db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) {
      throw new Error("Pokój nie istnieje.");
    }

    const room = roomSnap.data();
    if (!room.awaitingGameEnd) {
      throw new Error("Gra nie jest jeszcze gotowa do zakończenia.");
    }

    tx.update(roomRef, {
      updatedAt: serverTimestamp(),
      status: "finished",
      awaitingGameEnd: false,
      awaitingNextRound: false,
      finishedAt: serverTimestamp(),
      hostReturnedAt: null,
    });
  });
}

function render() {
  renderPanels();
  renderLobby();
  renderGame();
  renderRoleModal();
}

function renderPanels() {
  const hasRoom = Boolean(state.roomId);
  const inLobby = Boolean(state.room && state.room.status === "lobby");
  const gameStarted = Boolean(state.room && state.room.status === "playing");
  const gameFinished = Boolean(state.room && state.room.status === "finished");

  document.body.classList.toggle("game-mode", gameStarted);

  els.joinPanel.classList.toggle("hidden", hasRoom && gameStarted);
  els.lobbyPanel.classList.toggle("hidden", !hasRoom || !(inLobby || gameFinished));
  els.gamePanel.classList.toggle(
    "hidden",
    !hasRoom || !state.room || state.room.status === "lobby" || state.room.status === "finished",
  );
}

function renderLobby() {
  if (!state.room || !state.roomId) {
    return;
  }

  const players = state.players;

  els.roomCodeBadge.textContent = `Pokój: ${state.roomId}`;
  els.lobbyInfo.textContent =
    state.room.status === "lobby"
      ? `Gracze: ${players.length}/10. Start możliwy od 3 graczy.`
      : state.room.status === "finished"
        ? "Gra zakończona. Host może rozpocząć nową grę."
        : "Gra trwa lub została zakończona.";

  const canStart = isHost() && (state.room.status === "lobby" || state.room.status === "finished");
  els.startGameBtn.classList.toggle("hidden", !canStart);
  els.startGameBtn.textContent = state.room.status === "finished" ? "Rozpocznij nową grę" : "Start gry";

  els.playersList.innerHTML = "";
  players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "player-row";

    const visibleTeam = getVisibleTeamInfo(player);
    const isMe = player.id === state.user?.uid;
    const isHostPlayer = player.id === state.room.hostId;

    row.innerHTML = `
      <strong>${escapeHtml(player.name || "Bez nazwy")}${isMe ? " (Ty)" : ""}</strong>
      <span class="player-tags">
        <span class="tag ${visibleTeam.className}">${visibleTeam.label}</span>
        ${isHostPlayer ? '<span class="tag">Host</span>' : ""}
      </span>
    `;

    els.playersList.appendChild(row);
  });
}

function renderGame() {
  if (!state.room || state.room.status === "lobby") {
    return;
  }

  const room = state.room;
  const deckStats = room.deckStats || { treasure: 0, trap: 0 };
  const keyHolder = getPlayerById(room.currentKeyHolder);

  els.gameStatusBadge.textContent =
    room.status === "finished" ? "Gra zakończona" : "Gra trwa";
  els.roundValue.textContent = `${room.round} / ${room.maxRounds || MAX_ROUNDS}`;
  els.treasureValue.textContent = `${room.revealedTreasures || 0} / ${deckStats.treasure || 0}`;
  els.trapValue.textContent = `${room.revealedTraps || 0} / ${deckStats.trap || 0}`;
  els.keyHolderValue.textContent = keyHolder ? keyHolder.name : "-";

  const myTurn = room.currentKeyHolder === state.user?.uid && room.status === "playing";
  const awaitingNextRound = Boolean(room.awaitingNextRound);
  const awaitingGameEnd = Boolean(room.awaitingGameEnd);
  const moveInfo = myTurn
    ? "Masz klucz. Kliknij konkretną zakrytą kartę innego gracza, aby ją odkryć i przekazać klucz."
    : "Czekaj na ruch posiadacza klucza.";

  els.statusText.textContent =
    room.status === "finished"
      ? "Gra zakończona."
      : awaitingGameEnd
        ? "Warunek zwycięstwa został spełniony. Host musi kliknąć Koniec."
      : awaitingNextRound
        ? "Runda zakończona. Host musi kliknąć Nowa runda."
        : `${moveInfo} Odkrycia w rundzie: ${room.revealedThisRound || 0}/${state.players.length}.`;

  els.nextRoundBtn.classList.toggle(
    "hidden",
    !isHost() || room.status !== "playing" || !awaitingNextRound,
  );
  els.endGameBtn.classList.toggle(
    "hidden",
    !isHost() || room.status !== "playing" || !awaitingGameEnd,
  );

  if (room.winner) {
    const winnerLabel = room.winner === "raiders" ? "Grabieżcy" : "Amazonki";
    els.winnerBanner.classList.remove("hidden");
    els.winnerBanner.textContent = `Wygrywają: ${winnerLabel}. ${room.winnerReason || ""}`;
  } else {
    els.winnerBanner.classList.add("hidden");
    els.winnerBanner.textContent = "";
  }

  renderPlayerPanels();
}

function renderPlayerPanels() {
  els.tablePlayers.innerHTML = "";

  const cards = Array.isArray(state.room?.cards) ? state.room.cards : [];
  const myId = state.user?.uid;

  state.players.forEach((player) => {
    const panel = document.createElement("article");
    panel.className = "player-panel";

    const playerCards = cards.filter((card) => card.ownerId === player.id && !card.removed);
    const hiddenCount = playerCards.filter((card) => !card.revealed).length;
    const summary = getCardSummary(playerCards);

    const visibleTeam = getVisibleTeamInfo(player);
    const keyMark = state.room.currentKeyHolder === player.id ? " [KLUCZ]" : "";

    panel.innerHTML = `
      <div class="player-panel-head">
        <h3>${escapeHtml(player.name || "Bez nazwy")}${keyMark}</h3>
        <small>${visibleTeam.label} • ukryte: ${hiddenCount}</small>
      </div>
      ${
        player.id === myId
          ? `
        <div class="player-report">
          <span>Złoto: ${summary.treasure}</span>
          <span>Pułapki: ${summary.trap}</span>
          <span>Puste: ${summary.empty}</span>
        </div>
      `
          : ""
      }
      <div class="player-cards"></div>
      <div class="player-actions"></div>
    `;

    const cardsWrap = panel.querySelector(".player-cards");

    if (playerCards.length === 0) {
      const emptyCard = document.createElement("div");
      emptyCard.className = "card back";
      emptyCard.textContent = "Brak kart";
      cardsWrap.appendChild(emptyCard);
    } else {
      playerCards.forEach((card) => {
        const canReveal =
          state.room.status === "playing" &&
          !state.room.awaitingNextRound &&
          !state.room.awaitingGameEnd &&
          state.room.currentKeyHolder === myId &&
          player.id !== myId &&
          !card.revealed;

        const cardEl = document.createElement(canReveal ? "button" : "div");
        if (canReveal) {
          cardEl.type = "button";
        }

        const visible = card.revealed;
        const cardImage = visible ? getCardImagePath(card.type) : getCardImagePath("hidden");
        const cardAlt = visible ? cardTypeLabel(card.type) : "Ukryta karta";
        if (!visible) {
          cardEl.className = "card card-button back";
        } else {
          cardEl.className = `card ${cardTypeClass(card.type)}`;
        }

        cardEl.innerHTML = `<img class="card-image" src="${cardImage}" alt="${cardAlt}" />`;

        if (card.highlighted) {
          cardEl.classList.add("revealed-lifted");

          if (!state.animatedCardIds.has(card.id)) {
            cardEl.classList.add("revealed-animate");
            state.animatedCardIds.add(card.id);
          }
        }

        if (canReveal) {
          cardEl.addEventListener("click", () => passKeyAndReveal(card.id));
        }

        cardsWrap.appendChild(cardEl);
      });
    }

    els.tablePlayers.appendChild(panel);
  });
}

function cardTypeLabel(type) {
  if (type === "treasure") {
    return "Skarb";
  }
  if (type === "trap") {
    return "Pułapka";
  }
  return "Pusta";
}

function getCardImagePath(type) {
  if (type in CARD_IMAGES) {
    return CARD_IMAGES[type];
  }

  return CARD_IMAGES.empty;
}

function cardTypeClass(type) {
  if (type === "treasure") {
    return "treasure";
  }
  if (type === "trap") {
    return "trap";
  }
  return "empty";
}

function buildDeck(stats) {
  const cards = [];
  let idCounter = 1;

  for (let i = 0; i < stats.empty; i += 1) {
    cards.push(makeCard(idCounter, "empty"));
    idCounter += 1;
  }
  for (let i = 0; i < stats.treasure; i += 1) {
    cards.push(makeCard(idCounter, "treasure"));
    idCounter += 1;
  }
  for (let i = 0; i < stats.trap; i += 1) {
    cards.push(makeCard(idCounter, "trap"));
    idCounter += 1;
  }

  return cards;
}

function makeCard(id, type) {
  return {
    id,
    type,
    ownerId: null,
    revealed: false,
    revealedInRound: null,
    highlighted: false,
    removed: false,
  };
}

function randomRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getProfile() {
  const name = els.nameInput.value.trim();

  if (!name) {
    toast("Podaj nick.");
    return null;
  }

  localStorage.setItem("gva_name", name);

  return { name };
}

function enableLocalMode(message) {
  state.mode = "local";
  state.user = { uid: getOrCreateLocalUid() };
  disableGameplayButtons(false);
  els.configWarning.classList.remove("hidden");
  showConnection(message);
  toast("Tryb lokalny aktywny.");

  window.addEventListener("storage", (event) => {
    if (!state.roomId) {
      return;
    }

    if (event.key === localRoomKey(state.roomId)) {
      loadLocalRoom(state.roomId);
    }
  });
}

function setActiveRoom(roomId) {
  localStorage.setItem(ACTIVE_ROOM_KEY, roomId);
}

function clearActiveRoom() {
  localStorage.removeItem(ACTIVE_ROOM_KEY);
}

async function restoreActiveRoomIfAny() {
  if (state.roomId || !state.user) {
    return;
  }

  const roomId = localStorage.getItem(ACTIVE_ROOM_KEY);
  if (!roomId) {
    return;
  }

  const profile = getProfile();
  if (state.mode === "local") {
    const payload = readLocalRoomPayload(roomId);
    if (!payload) {
      clearActiveRoom();
      return;
    }

    const localFinishedAt = getTimestampMillis(payload.room?.finishedAt);
    if (
      payload.room?.status === "finished" &&
      localFinishedAt &&
      Date.now() - localFinishedAt >= ROOM_EXPIRY_MS
    ) {
      localStorage.removeItem(localRoomKey(roomId));
      clearActiveRoom();
      return;
    }

    subscribeToRoomLocal(roomId);
    toast(`Przywrócono pokój ${roomId}.`);
    return;
  }

  if (!state.db) {
    return;
  }

  const roomRef = doc(state.db, "rooms", roomId);
  const roomSnap = await getDoc(roomRef);

  if (!roomSnap.exists()) {
    clearActiveRoom();
    return;
  }

  const roomData = roomSnap.data();
  const finishedAt = getTimestampMillis(roomData.finishedAt);
  if (
    roomData.status === "finished" &&
    finishedAt &&
    Date.now() - finishedAt >= ROOM_EXPIRY_MS
  ) {
    try {
      const playersSnap = await getDocs(collection(state.db, "rooms", roomId, "players"));
      const batch = writeBatch(state.db);
      playersSnap.forEach((playerDoc) => batch.delete(playerDoc.ref));
      batch.delete(roomRef);
      await batch.commit();
    } catch {
      // Best-effort cleanup when the finished room has expired.
    }

    clearActiveRoom();
    return;
  }

  if (profile) {
    try {
      await upsertPlayerInRoom(roomId, profile);
    } catch {
      // If the player doc can't be refreshed yet, we still try to reconnect.
    }
  }

  await subscribeToRoom(roomId);

  if (
    state.room?.status === "finished" &&
    isHost() &&
    !state.room.hostReturnedAt &&
    finishedAt &&
    Date.now() - finishedAt < ROOM_EXPIRY_MS
  ) {
    await updateDoc(roomRef, {
      hostReturnedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  toast(`Przywrócono pokój ${roomId}.`);
}

function getOrCreateLocalUid() {
  const existing = sessionStorage.getItem(LOCAL_UID_KEY);
  if (existing) {
    return existing;
  }

  const generated = `local_${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(LOCAL_UID_KEY, generated);
  return generated;
}

function localRoomKey(roomId) {
  return `${LOCAL_ROOM_PREFIX}${roomId}`;
}

function readLocalRoomPayload(roomId) {
  const raw = localStorage.getItem(localRoomKey(roomId));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLocalRoomPayload(roomId, payload) {
  localStorage.setItem(localRoomKey(roomId), JSON.stringify(payload));
}

async function createRoomLocal() {
  const profile = getProfile();
  if (!profile) {
    return;
  }

  let roomId = "";
  for (let i = 0; i < 8; i += 1) {
    const candidate = randomRoomCode();
    if (!readLocalRoomPayload(candidate)) {
      roomId = candidate;
      break;
    }
  }

  if (!roomId) {
    toast("Nie udało się wygenerować kodu pokoju, spróbuj ponownie.");
    return;
  }

  const now = Date.now();
  const payload = {
    room: {
      status: "lobby",
      hostId: state.user.uid,
      createdAt: now,
      updatedAt: now,
      maxRounds: MAX_ROUNDS,
      round: 1,
      currentKeyHolder: null,
      revealedThisRound: 0,
      revealedTreasures: 0,
      revealedTraps: 0,
      deckStats: null,
      cards: [],
      winner: null,
      winnerReason: null,
      finishedAt: null,
      hostReturnedAt: null,
    },
    players: [
      {
        id: state.user.uid,
        name: profile.name,
        team: null,
        joinedAt: now,
        updatedAt: now,
      },
    ],
  };
  writeLocalRoomPayload(roomId, payload);
  subscribeToRoomLocal(roomId);
  setActiveRoom(roomId);
  toast(`Utworzono pokój ${roomId} (tryb lokalny).`);
}

async function joinRoomFromInputLocal() {
  const profile = getProfile();
  if (!profile) {
    return;
  }

  const roomId = els.roomCodeInput.value.trim().toUpperCase();
  if (!roomId) {
    toast("Podaj kod pokoju.");
    return;
  }

  const payload = readLocalRoomPayload(roomId);
  if (!payload) {
    toast("Taki pokój nie istnieje w trybie lokalnym.");
    return;
  }

  if (payload.room && payload.room.status === "playing") {
    toast("Nie można dołączyć w trakcie gry. Poczekaj na lobby.");
    return;
  }

  upsertPlayerInRoomLocal(roomId, profile);
  subscribeToRoomLocal(roomId);
  setActiveRoom(roomId);
  toast(`Dołączono do ${roomId} (tryb lokalny).`);
}

function upsertPlayerInRoomLocal(roomId, profile) {
  const payload = readLocalRoomPayload(roomId);
  if (!payload) {
    throw new Error("Pokój nie istnieje.");
  }

  const now = Date.now();
  const players = Array.isArray(payload.players) ? [...payload.players] : [];
  const existingIndex = players.findIndex((p) => p.id === state.user.uid);

  if (existingIndex >= 0) {
    players[existingIndex] = {
      ...players[existingIndex],
      name: profile.name,
      updatedAt: now,
    };
  } else {
    players.push({
      id: state.user.uid,
      name: profile.name,
      team: null,
      joinedAt: now,
      updatedAt: now,
    });
  }

  payload.players = players;
  payload.room.updatedAt = now;
  writeLocalRoomPayload(roomId, payload);
}

function subscribeToRoomLocal(roomId) {
  unsubscribeRoomListeners();
  state.roomId = roomId;
  els.roomCodeInput.value = roomId;
  setActiveRoom(roomId);

  loadLocalRoom(roomId);
  state.localSyncTimer = window.setInterval(() => {
    loadLocalRoom(roomId);
  }, 1000);
}

function loadLocalRoom(roomId) {
  const payload = readLocalRoomPayload(roomId);

  if (!payload) {
    toast("Pokój został usunięty.");
    clearActiveRoom();
    unsubscribeRoomListeners();
    resetRoomState();
    render();
    return;
  }

  state.room = payload.room || null;
  state.players = (payload.players || []).slice().sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  scheduleFinishedRoomCleanup();
  render();
}

function startOrRestartGameLocal() {
  if (!state.roomId || !state.room || !isHost()) {
    return;
  }

  if (state.room.status !== "lobby" && state.room.status !== "finished") {
    toast("Gra już się rozpoczęła.");
    return;
  }

  const payload = readLocalRoomPayload(state.roomId);
  if (!payload) {
    toast("Pokój nie istnieje.");
    return;
  }

  const players = Array.isArray(payload.players) ? [...payload.players] : [];
  if (players.length < 3 || players.length > 10) {
    toast("Do startu potrzeba od 3 do 10 graczy.");
    return;
  }

  const deckStats = CARD_DISTRIBUTION[players.length];
  const teamPool = TEAM_POOL_DISTRIBUTION[players.length];
  if (!deckStats || !teamPool) {
    toast("Brak konfiguracji gry dla tej liczby graczy.");
    return;
  }

  const assignments = assignRandomTeams(players, teamPool);
  const cards = buildDeck(deckStats);
  shuffle(cards);

  const playerIds = players.map((p) => p.id);
  const cardsPerPlayer = cards.length / playerIds.length;
  cards.forEach((card, index) => {
    const ownerIndex = Math.floor(index / cardsPerPlayer);
    card.ownerId = playerIds[ownerIndex];
    card.revealed = false;
    card.revealedInRound = null;
  });

  const firstKeyHolder = playerIds[Math.floor(Math.random() * playerIds.length)];
  const now = Date.now();

  payload.room = {
    ...payload.room,
    status: "playing",
    updatedAt: now,
    gameToken: now,
    finishedAt: null,
    hostReturnedAt: null,
    maxRounds: MAX_ROUNDS,
    round: 1,
    currentKeyHolder: firstKeyHolder,
    revealedThisRound: 0,
    revealedTreasures: 0,
    revealedTraps: 0,
    deckStats,
    cards,
    winner: null,
    winnerReason: null,
    awaitingNextRound: false,
    awaitingGameEnd: false,
  };

  payload.players = players.map((player) => {
    const found = assignments.find((a) => a.id === player.id);
    return {
      ...player,
      team: found ? found.team : null,
      updatedAt: now,
    };
  });

  writeLocalRoomPayload(state.roomId, payload);
  loadLocalRoom(state.roomId);
  toast(state.room.status === "finished" ? "Nowa gra wystartowała." : "Gra wystartowała.");
}

function passKeyAndRevealLocal(targetId) {
  if (!state.roomId || !state.room || !state.user) {
    return;
  }

  const payload = readLocalRoomPayload(state.roomId);
  if (!payload || !payload.room) {
    toast("Pokój nie istnieje.");
    return;
  }

  const room = payload.room;
  const players = Array.isArray(payload.players) ? payload.players : [];
  const playerIds = players.map((p) => p.id);

  if (room.status !== "playing") {
    toast("Gra nie jest aktywna.");
    return;
  }
  if (room.winner) {
    toast("Gra już została zakończona.");
    return;
  }
  if (room.awaitingNextRound) {
    toast("Czekamy na rozpoczęcie nowej rundy przez hosta.");
    return;
  }
  if (room.awaitingGameEnd) {
    toast("Gra czeka na zakończenie przez hosta.");
    return;
  }
  if (room.currentKeyHolder !== state.user.uid) {
    toast("Nie masz teraz klucza.");
    return;
  }

  const cards = Array.isArray(room.cards) ? [...room.cards] : [];
  const targetIndex = cards.findIndex((card) => card.id === targetId);

  if (targetIndex < 0) {
    toast("Wybrana karta nie istnieje.");
    return;
  }

  const targetCard = cards[targetIndex];
  if (targetCard.revealed) {
    toast("Ta karta jest już odkryta.");
    return;
  }
  if (targetCard.ownerId === state.user.uid) {
    toast("Musisz wybrać kartę innego gracza.");
    return;
  }

  const pickedCard = {
    ...targetCard,
    revealed: true,
    revealedInRound: room.round,
  };
  cards[targetIndex] = pickedCard;
  cards[targetIndex].highlighted = true;

  let revealedTreasures = room.revealedTreasures || 0;
  let revealedTraps = room.revealedTraps || 0;

  if (pickedCard.type === "treasure") {
    revealedTreasures += 1;
  }
  if (pickedCard.type === "trap") {
    revealedTraps += 1;
  }

  const deckStats = room.deckStats || { treasure: 0, trap: 0 };
  let winner = null;
  let winnerReason = null;
  let round = room.round;
  let status = room.status;
  let revealedThisRound = (room.revealedThisRound || 0) + 1;
  let awaitingNextRound = false;
  let awaitingGameEnd = Boolean(room.awaitingGameEnd);

  if (revealedTreasures >= deckStats.treasure) {
    winner = "raiders";
    winnerReason = "Odkryto wszystkie skarby.";
    awaitingGameEnd = true;
  } else if (revealedTraps >= deckStats.trap) {
    winner = "amazons";
    winnerReason = "Odkryto wszystkie pułapki.";
    awaitingGameEnd = true;
  }

  if (!winner && revealedThisRound >= playerIds.length) {
    if (round >= (room.maxRounds || MAX_ROUNDS)) {
      winner = "amazons";
      winnerReason = "Minęły 4 rundy i nie odkryto wszystkich skarbów.";
      awaitingGameEnd = true;
    } else {
          awaitingNextRound = true;
    }
  }

  payload.room = {
    ...room,
    updatedAt: Date.now(),
    cards,
    currentKeyHolder: targetCard.ownerId,
    revealedTreasures,
    revealedTraps,
    revealedThisRound,
    round,
    status,
    awaitingNextRound,
    awaitingGameEnd,
    winner,
    winnerReason,
  };

  writeLocalRoomPayload(state.roomId, payload);
  loadLocalRoom(state.roomId);
}

function startNextRoundLocal() {
  if (!state.roomId || !state.room || !state.user || !isHost()) {
    return;
  }

  if (!state.room.awaitingNextRound) {
    toast("Ta runda jeszcze się nie zakończyła.");
    return;
  }

  const payload = readLocalRoomPayload(state.roomId);
  if (!payload || !payload.room) {
    toast("Pokój nie istnieje.");
    return;
  }

  const room = payload.room;
  const players = Array.isArray(payload.players) ? payload.players : [];
  const playerIds = players.map((p) => p.id);
  const cards = Array.isArray(room.cards) ? [...room.cards] : [];

  cards.forEach((card, index) => {
    if (card.revealed) {
      cards[index] = {
        ...card,
        removed: true,
        highlighted: false,
      };
    } else {
      cards[index] = {
        ...card,
        highlighted: false,
      };
    }
  });

  const unrevealedIndexes = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !card.revealed && !card.removed);

  shuffle(unrevealedIndexes);

  const cardsPerPlayer = unrevealedIndexes.length / playerIds.length;
  unrevealedIndexes.forEach(({ index }, i) => {
    const ownerIndex = Math.floor(i / cardsPerPlayer);
    cards[index] = {
      ...cards[index],
      ownerId: playerIds[ownerIndex],
    };
  });

  payload.room = {
    ...room,
    updatedAt: Date.now(),
    cards,
    round: (room.round || 1) + 1,
    revealedThisRound: 0,
    awaitingNextRound: false,
    awaitingGameEnd: false,
  };

  writeLocalRoomPayload(state.roomId, payload);
  loadLocalRoom(state.roomId);
}

function endGameLocal() {
  if (!state.roomId || !state.room || !state.user || !isHost()) {
    return;
  }

  if (!state.room.awaitingGameEnd) {
    toast("Gra nie jest jeszcze gotowa do zakończenia.");
    return;
  }

  const payload = readLocalRoomPayload(state.roomId);
  if (!payload || !payload.room) {
    toast("Pokój nie istnieje.");
    return;
  }

  payload.room = {
    ...payload.room,
    status: "finished",
    awaitingGameEnd: false,
    awaitingNextRound: false,
    finishedAt: Date.now(),
    hostReturnedAt: null,
  };

  writeLocalRoomPayload(state.roomId, payload);
  loadLocalRoom(state.roomId);
}

function assignRandomTeams(players, teamPool) {
  const roles = [];

  for (let i = 0; i < teamPool.amazons; i += 1) {
    roles.push("amazons");
  }
  for (let i = 0; i < teamPool.raiders; i += 1) {
    roles.push("raiders");
  }

  shuffle(roles);

  const assignments = players.map((player, index) => ({
    id: player.id,
    team: roles[index] || null,
  }));

  return assignments;
}

function getTeamLabel(team) {
  if (team === "raiders") {
    return "Grabieżcy";
  }
  if (team === "amazons") {
    return "Amazonki";
  }
  return "Nieprzydzielona";
}

function getVisibleTeamInfo(player) {
  if (player.id === state.user?.uid) {
    return {
      label: `Twoja drużyna: ${getTeamLabel(player.team)}`,
      className: player.team || "pending",
    };
  }

  return {
    label: "Drużyna: Nieznana",
    className: "pending",
  };
}

function getCardSummary(cards) {
  return cards.reduce(
    (accumulator, card) => {
      if (card.type === "treasure") {
        accumulator.treasure += 1;
      } else if (card.type === "trap") {
        accumulator.trap += 1;
      } else {
        accumulator.empty += 1;
      }

      return accumulator;
    },
    { treasure: 0, trap: 0, empty: 0 },
  );
}

function renderRoleModal() {
  const me = state.user ? getPlayerById(state.user.uid) : null;

  if (!state.room || !state.roomId || !me) {
    els.roleModal.classList.add("hidden");
    return;
  }

  const isGameStart = state.room.status === "playing" && state.room.round === 1;
  if (!isGameStart || !me.team) {
    els.roleModal.classList.add("hidden");
    return;
  }

  const ackKey = getRoleAckKey();
  if (localStorage.getItem(ackKey) === "1") {
    els.roleModal.classList.add("hidden");
    return;
  }

  const startMessage = state.room?.status === "playing" && state.room?.round === 1
    ? "Drużyny zostały wylosowane ponownie."
    : "";
  const roleText =
    me.team === "amazons"
      ? `Jesteś Amazonką. ${startMessage} Zachowaj swoją rolę w tajemnicy.`
      : `Jesteś Grabieżcą. ${startMessage} Zachowaj swoją rolę w tajemnicy.`;

  els.roleModalText.textContent = roleText.trim();
  els.roleModal.classList.remove("hidden");
}

function acknowledgeRoleModal() {
  const ackKey = getRoleAckKey();
  if (!ackKey) {
    els.roleModal.classList.add("hidden");
    return;
  }

  localStorage.setItem(ackKey, "1");
  els.roleModal.classList.add("hidden");
}

function getRoleAckKey() {
  if (!state.roomId || !state.room) {
    return null;
  }

  const token = state.room.gameToken != null ? String(state.room.gameToken) : "unknown";

  return `gva_role_ack_${state.roomId}_${token}`;
}

function isHost() {
  return Boolean(state.user && state.room && state.room.hostId === state.user.uid);
}

function getPlayerById(id) {
  return state.players.find((p) => p.id === id) || null;
}

function copyRoomCode() {
  if (!state.roomId) {
    return;
  }

  navigator.clipboard
    .writeText(state.roomId)
    .then(() => toast("Kod pokoju skopiowany."))
    .catch(() => toast("Nie udało się skopiować kodu."));
}

function showConnection(text) {
  els.connectionInfo.textContent = text;
  els.connectionInfo.classList.remove("hidden");
}

function hideConnection() {
  els.connectionInfo.classList.add("hidden");
}

function disableGameplayButtons(disabled) {
  els.createRoomBtn.disabled = disabled;
  els.joinRoomBtn.disabled = disabled;
  els.saveProfileBtn.disabled = disabled;
  els.startGameBtn.disabled = disabled;
}

function toast(message) {
  if (!message) {
    return;
  }

  els.toast.textContent = message;
  els.toast.classList.remove("hidden");

  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 3000);
}

toast.timer = null;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function isFirebaseConfigPlaceholder(config) {
  return (
    !config ||
    [
      config.apiKey,
      config.authDomain,
      config.projectId,
      config.storageBucket,
      config.messagingSenderId,
      config.appId,
    ].some((v) => !v || v.startsWith("UZUPELNIJ_"))
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
