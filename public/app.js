const socket = io();

let currentRoomCode = "";
let myName = "";
let myId = "";
let amIHost = false;
let currentMovieData = null;
let isActivePlayer = false;
let submittedPlayers = []; // Speichert die IDs der Spieler, die im Simultanmodus schon getippt haben
let myTimeline = [];
let player;
let isPlaying = false;
let currentRoomMode = "movies";
let maxClipDuration = 15; // Standardmäßig 15 Sekunden
let clipTimer = null;     // Hält den JavaScript-Timer
let barInterval = null; // Hält das Intervall für den visuellen Balken
let currentVolume = 100; // Standardmäßig volle Lautstärke (100%)
let currentRoomType = "classic"; // Speichert, ob normal oder simultan gespielt wird
let roundResolved = false; // Flag um zu verhindern, dass Timer startet, wenn Runde aufgelöst ist
let currentClipDuration = 15; // Duration used for the currently running round, can be extended
let clipTimerEndTime = null; // Timestamp when the current round's timer should end
let visualTimerEndTime = null;
let timerStartTimestamp = null;
let hasBoughtExtraTime = false; // Tracks whether the local player already purchased bonus time this round

function showScreen(screenId) {
    document.getElementById('screen-start').classList.add('hidden');
    document.getElementById('screen-lobby').classList.add('hidden');
    document.getElementById('screen-game').classList.add('hidden');
    document.getElementById(screenId).classList.remove('hidden');
}

// LOBBY
function createRoom() {
    myName = document.getElementById('username-input').value.trim();
    if (!myName) return alert("Bitte gib einen Namen ein!");
    socket.emit('createRoom', myName);
}

socket.on('roomCreated', ({ roomCode, players }) => {
    currentRoomCode = roomCode;
    myId = socket.id;
    amIHost = true;
    document.getElementById('room-code-display').innerText = `# ${roomCode}`;
    document.getElementById('lobby-code-display').innerText = roomCode;
    document.getElementById('start-game-btn').classList.remove('hidden');
    document.getElementById('game-mode-select').disabled = false; // Host darf wählen
    document.getElementById('clip-duration-select').disabled = false; // Host darf Dauer wählen
    document.getElementById('game-type-select').disabled = false;

    document.getElementById('start-game-btn').onclick = () => {
        // Die aktuell ausgewählten Werte aus der Lobby auslesen
        const mode = document.getElementById('game-mode-select').value; // 'movies' oder 'games'
        const type = document.getElementById('game-type-select').value; // 'classic' oder 'simultaneous'
        const winLimit = parseInt(document.getElementById('win-limit-select').value) || 10;

        // WICHTIG: Als Objekt senden, da der Server es jetzt so erwartet
        socket.emit('startGame', {
            roomCode: currentRoomCode,
            mode: mode,
            type: type,
            winLimit: winLimit
        });
    };

    updateLobbyPlayers(players);
    showScreen('screen-lobby');
});

function joinRoom() {
    myName = document.getElementById('username-input').value.trim();
    const code = document.getElementById('room-id-input').value.trim().toUpperCase();
    if (!myName || !code) return alert("Bitte Name und Code eingeben!");
    socket.emit('joinRoom', { roomCode: code, playerName: myName });
}

socket.on('joinSuccess', (roomCode) => {
    currentRoomCode = roomCode;
    myId = socket.id;
    document.getElementById('room-code-display').innerText = `# ${roomCode}`;
    document.getElementById('lobby-code-display').innerText = roomCode
    document.getElementById('game-mode-select').disabled = true; // Mitspieler dürfen NICHT wählen
    showScreen('screen-lobby');
});

socket.on('playerJoined', (players) => updateLobbyPlayers(players));

function updateLobbyPlayers(players) {
    const list = document.getElementById('lobby-players-list');
    list.innerHTML = "";
    players.forEach(p => {
        const div = document.createElement('div');
        div.className = "bg-[#20222b] px-4 py-2 rounded-xl border border-gray-800 text-sm font-medium flex justify-between";
        div.innerHTML = `<span>${p.name} ${p.id === socket.id ? ' (Du)' : ''} ${p.isHost ? '👑' : ''}</span><span class="text-[#f5a623]">Bereit</span>`;
        list.appendChild(div);
    });
}

socket.on('gameWon', (data) => {
    // Musik/Video sofort stoppen, falls es noch läuft
    if (player && typeof player.pauseVideo === 'function') {
        player.pauseVideo();
    }

    // Sieger-Pop-up anzeigen und Namen eintragen
    const winnerScreen = document.getElementById('winner-screen');
    const winnerName = document.getElementById('winner-name');

    if (winnerScreen && winnerName) {
        winnerName.innerText = data.winnerName;
        winnerScreen.classList.remove('hidden');
    }
});



// GAMEPLAY
socket.on('gameStarted', (data) => {
    showScreen('screen-game');
    document.getElementById('round-display').classList.remove('hidden');

    const me = data.players.find(p => p.id === myId);
    myTimeline = me.timeline;

    initRound(data);
});

socket.on('gameStarted', (data) => {
    showScreen('screen-game');
    document.getElementById('round-display').classList.remove('hidden');

    currentRoomType = data.gameType || "classic";

    // Eigene Timeline sicher als tiefe Kopie aus den Serverdaten übernehmen
    const me = data.players.find(p => p.id === myId);
    if (me && me.timeline) {
        myTimeline = JSON.parse(JSON.stringify(me.timeline));
    } else {
        myTimeline = [];
    }

    initRound(data);
});

// Keyboard navigation for timeline insert zones
window.addEventListener('keydown', (e) => {
    const container = document.getElementById('timeline-container');
    if (!container) return;
    if (container.classList.contains('hidden')) return;

    const activeButtons = Array.from(container.querySelectorAll('[data-timeline-action="insert"]'));
    const hasButtons = activeButtons.length > 0;
    if (!hasButtons) return;

    // only handle if user is likely interacting with game (avoid fighting with lobby inputs)
    const activeTag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
    const isTyping = ['input', 'textarea', 'select'].includes(activeTag) || document.activeElement?.isContentEditable;
    if (isTyping) return;

    // If timeline is frozen/disabled, do nothing
    const anyEnabled = activeButtons.some(b => !b.disabled && !b.classList.contains('cursor-not-allowed') && b.tabIndex !== -1);
    if (!anyEnabled) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = Math.min(timelineFocusIndex + 1, activeButtons.length - 1);
        setTimelineFocus(nextIndex);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = Math.max(timelineFocusIndex - 1, 0);
        setTimelineFocus(prevIndex);
    } else if (e.key === 'Home') {
        e.preventDefault();
        setTimelineFocus(0);
    } else if (e.key === 'End') {
        e.preventDefault();
        setTimelineFocus(activeButtons.length - 1);
    } else if (e.key === 'Enter') {
        if (timelineFocusIndex >= 0 && timelineFocusIndex < timelineFocusButtons.length) {
            e.preventDefault();
            timelineFocusButtons[timelineFocusIndex].click();
        }
    }
});


socket.on('leaveRoom', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    // Spieler aus dem Raum-Array entfernen
    room.players = room.players.filter(p => p.id !== socket.id);

    // Socket den Raum verlassen lassen
    socket.leave(roomCode);

    // Wenn der Raum jetzt leer ist, löschen wir ihn
    if (room.players.length === 0) {
        delete rooms[roomCode];
    } else {
        // Sonst die aktualisierte Spielerliste an die verbleibenden Spieler senden
        io.to(roomCode).emit('roomData', {
            roomCode,
            players: room.players,
            gameStarted: room.gameStarted
        });
    }
});

function initRound(data) {
    roundResolved = false; // Reset flag for new round
    if (clipTimer) clearTimeout(clipTimer);
    stopVisualTimer();
    const maxMovies = data.winLimit || 10;
    document.getElementById('round-display').innerText = `⏱️ Film ${data.round + 1}/${maxMovies}`;
    currentMovieData = data;
    currentRoomType = data.gameType || "classic";

    submittedPlayers = []; // Warte-Liste für die neue Runde leeren!
    hasBoughtExtraTime = false;
    currentClipDuration = maxClipDuration;
    clipTimerEndTime = null;
    visualTimerEndTime = null;
    timerStartTimestamp = null;

    // Im Simultanmodus sind für die Timeline ALLE Spieler aktiv
    if (currentRoomType === "simultaneous") {
        isActivePlayer = true;
    } else {
        isActivePlayer = (data.activePlayerId === myId);
    }

    updateGamePlayersList(data.players, data.activePlayerId);
    const me = data.players.find(p => p.id === myId);
    updateBuyExtraTimeButton(me ? me.coins : 0);

    const blind = document.getElementById('video-blind');
    if (blind) blind.classList.remove('curtain-open');

    const instText = document.getElementById('instruction-text');
    const playBtn = document.getElementById('play-btn');
    const overlay = document.getElementById('video-protection-overlay');

    if (currentRoomType === "simultaneous") {
        instText.innerText = "🚀 Simultan-Modus: Alle raten! Der Host startet das Video.";
        instText.className = "text-amber-400 font-bold text-lg mb-4";

        // NUR DER HOST DARF STEUERN
        if (amIHost) {
            if (playBtn) {
                playBtn.classList.remove('hidden');
                playBtn.innerText = "▶";
                playBtn.className = "absolute w-20 h-20 rounded-full bg-[#f5a623]/90 hover:bg-[#d48c16] text-black text-2xl flex items-center justify-center transition-all transform hover:scale-110 shadow-lg cursor-pointer z-20";
            }
            if (overlay) {
                overlay.onclick = () => toggleAudio();
                overlay.style.cursor = "pointer";
            }
        } else {
            if (playBtn) playBtn.classList.add('hidden');
            if (overlay) {
                overlay.onclick = null;
                overlay.style.cursor = "default";
            }
        }
    } else {
        // --- KLASSISCHER MODUS (Unverändert) ---
        if (isActivePlayer) {
            instText.innerText = "Du bist dran! Höre das Intro und ordne es in DEINE Timeline ein.";
            instText.className = "text-[#f5a623] font-semibold text-lg mb-4";
            if (playBtn) {
                playBtn.classList.remove('hidden');
                playBtn.innerText = "▶";
                playBtn.className = "absolute w-20 h-20 rounded-full bg-[#f5a623]/90 hover:bg-[#d48c16] text-black text-2xl flex items-center justify-center transition-all transform hover:scale-110 shadow-lg cursor-pointer z-20";
            }
            if (overlay) {
                overlay.onclick = () => toggleAudio();
                overlay.style.cursor = "pointer";
            }
        } else {
            const activePlayerObj = data.players.find(p => p.id === data.activePlayerId);
            instText.innerText = `${activePlayerObj.name} ist am Zug...`;
            instText.className = "text-gray-400 font-semibold text-lg mb-4";
            if (playBtn) playBtn.classList.add('hidden');
            if (overlay) {
                overlay.onclick = null;
                overlay.style.cursor = "default";
            }
        }
    }

    document.getElementById('reveal-zone').classList.add('hidden');
    isPlaying = false;

    // Video-Wrapper aktivieren
    const wrapper = document.getElementById('video-wrapper');
    if (wrapper) {
        wrapper.classList.remove('hidden');
    }

    // Blende für den Rundenstart vorschieben (Schutz vor Vorschaubild)
    //const blind = document.getElementById('video-blind');
    const blindText = document.getElementById('blind-text');
    if (blind) blind.classList.remove('hidden');
    if (blindText) blindText.innerText = "Bereit für das nächste Intro...";

    const blindIcon = blind ? blind.querySelector('span') : null;
    if (blindIcon) {
        blindIcon.innerText = (currentRoomMode === 'games') ? '🎮' : '🎬';
    }

    if (!player) {
        player = new YT.Player('yt-player', {
            height: '100%',
            width: '100%',
            videoId: data.youtubeId,
            playerVars: {
                'start': data.startAt,
                'controls': 0,
                'autoplay': 0,
                'modestbranding': 1,
                'rel': 0,
                'origin': window.location.origin
            },
            events: {
                'onStateChange': onPlayerStateChange
            }
        });
    } else {
        if (player && typeof player.loadVideoById === 'function') {
            player.loadVideoById({
                'videoId': data.youtubeId,
                'startSeconds': data.startAt || 0
            });
        } else {
            console.warn("YouTube Player ist noch nicht bereit, überspringe Laden.");
        }
        if (player && typeof player.pauseVideo === 'function') {
            player.pauseVideo();
        } else {
        }
    }

    renderTimeline(currentRoomType === "classic" ? !isActivePlayer : false);
}

function updateGamePlayersList(players, activePlayerId) {
    if (!window.openTimelines) {
        window.openTimelines = {};
    }

    const list = document.getElementById('game-players-list');
    list.innerHTML = "";

    const currentMyId = socket.id;

    // 🛠️ LIVE-SCOREBOARD SORTIERUNG: 
    // Wir kopieren das Array und sortieren die Spieler absteigend nach richtig erratenen Filmen (Timeline-Länge - 2 Startkarten)
    const sortedPlayers = [...players].sort((a, b) => {
        const correctA = (a.timeline ? a.timeline.length : 2) - 1;
        const correctB = (b.timeline ? b.timeline.length : 2) - 1;
        return correctB - correctA; // Höchste Punktzahl zuerst
    });

    // Wir mappen nun über das sortierte Array (sortedPlayers statt players)
    sortedPlayers.forEach((p, rankIndex) => {
        const isCurrent = p.id === activePlayerId;
        const isMe = (p.id === currentMyId);

        if (window.openTimelines[p.id] === undefined) {
            window.openTimelines[p.id] = false;
        }

        const playerContainer = document.createElement('div');
        playerContainer.className = "flex flex-col gap-1 w-full";

        const rank = rankIndex + 1;
        const isRank1 = rank === 1;

        // Berechnung der Punkte für die Anzeige im Badge
        const correctlyPlacedCount = (p.timeline ? p.timeline.length : 2) - 1;

        const playerCard = document.createElement('div');
        playerCard.className = `filmster-leaderboard-row p-2 rounded-lg transition ${isCurrent
            ? "filmster-leaderboard-row--active"
            : "filmster-leaderboard-row--default"
            } ${isRank1 ? 'filmster-leaderboard-row--gold' : ''} ${!isMe ? 'cursor-pointer' : ''}`;

        // Rank-Pill (golden fürs #1)
        const rankPillClass = isRank1 ? 'filmster-rank-pill--gold' : 'filmster-rank-pill--default';

        if (!isMe) {
            playerCard.onclick = () => {
                const timelineDiv = document.getElementById(`external-timeline-${p.id}`);
                const arrowSpan = document.getElementById(`arrow-${p.id}`);

                if (timelineDiv.classList.contains('hidden')) {
                    timelineDiv.classList.remove('hidden');
                    window.openTimelines[p.id] = true;
                    if (arrowSpan) arrowSpan.innerText = '▲';
                } else {
                    timelineDiv.classList.add('hidden');
                    window.openTimelines[p.id] = false;
                    if (arrowSpan) arrowSpan.innerText = '▼';
                }
            };
        }

        // Den Status-Badge dynamisch berechnen
        let statusBadge = "";
        if (currentRoomType === "simultaneous") {
            if (submittedPlayers.includes(p.id)) {
                statusBadge = '<div class="text-xs text-green-300 border border-green-700/50 bg-green-900/30 px-1.5 py-0.5 rounded mt-2 w-max">✅ Fertig</div>';
            } else {
                statusBadge = '<div class="text-xs text-gray-300 border border-gray-700/60 bg-gray-800/60 px-1.5 py-0.5 rounded mt-2 w-max animate-pulse">⏳ Überlegt</div>';
            }
        } else {
            if (isCurrent) statusBadge = '<div class="text-xs text-[#f5a623] mt-2 font-semibold">Am Zug</div>';
            else statusBadge = `<div class="text-xs text-gray-500 mt-2">${isMe ? 'Deine eigene Reihe' : 'Timeline anzeigen'}</div>`;
        }

        // 💡 Leaderboard Render
        const avatarLetter = (p.name && p.name.length) ? p.name[0].toUpperCase() : '?';
        playerCard.innerHTML = `
            <div class="flex items-center gap-3 w-full">
                <div class="flex flex-col items-center justify-center mr-1">
                    <div class="${rankPillClass} filmster-rank-pill">${rank}</div>
                    ${isRank1 ? '<div class="text-[10px] text-yellow-300/90 font-bold mt-1">TOP</div>' : ''}
                </div>

                <div class="w-8 h-8 rounded-full bg-gray-800 text-white font-bold flex items-center justify-center border border-gray-700">
                    ${avatarLetter}
                </div>

                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <div class="font-bold text-sm truncate">${p.name} ${isMe ? '(Du)' : ''}</div>
                        ${!isMe ? `<span id="arrow-${p.id}" class="text-xs text-gray-500">${window.openTimelines[p.id] ? '▲' : '▼'}</span>` : ''}
                    </div>
                    <div class="text-xs text-zinc-400 font-medium mt-0.5">🎬 ${correctlyPlacedCount} richtig</div>
                    ${statusBadge}
                </div>

                <div class="flex flex-col items-end gap-1 text-right">
                    <div class="flex items-center gap-1 text-[#f5a623] font-extrabold">⭐ ${p.score}</div>
                    <div class="flex items-center gap-1 text-[#facc15] font-bold">🪙 ${p.coins || 0}</div>
                </div>
            </div>
        `;


        playerContainer.appendChild(playerCard);

        const externalTimelineDiv = document.createElement('div');
        externalTimelineDiv.id = `external-timeline-${p.id}`;

        if (!window.openTimelines[p.id]) {
            externalTimelineDiv.className = "hidden pl-4 pr-2 py-2 flex flex-col gap-1 bg-[#111217] rounded-b-lg border-x border-b border-gray-900 max-h-80 overflow-y-auto no-scrollbar";
        } else {
            externalTimelineDiv.className = "pl-4 pr-2 py-2 flex flex-col gap-1 bg-[#111217] rounded-b-lg border-x border-b border-gray-900 max-h-80 overflow-y-auto no-scrollbar";
        }

        const sortedExternalTimeline = [...p.timeline].sort((a, b) => a.year - b.year);

        if (sortedExternalTimeline.length === 0) {
            externalTimelineDiv.innerHTML = `<p class="text-xs text-gray-500 py-1">Noch keine Filme in der Timeline.</p>`;
        } else {
            sortedExternalTimeline.forEach(m => {
                const movieRow = document.createElement('div');
                movieRow.className = "flex justify-between items-center bg-[#1c1d24] p-2 rounded border border-gray-850 text-xs";
                movieRow.innerHTML = `
                    <span class="font-medium text-gray-300 truncate max-w-[130px]">${m.title}</span>
                    <span class="text-[#f5a623] font-bold font-mono">${m.year}</span>
                `;
                externalTimelineDiv.appendChild(movieRow);
            });
        }

        playerContainer.appendChild(externalTimelineDiv);
        list.appendChild(playerContainer);
    });
}

let blindTimeout = null;

function toggleAudio() {
    if (!player || typeof player.playVideo !== 'function') return;

    if (!isPlaying) {
        // Lokal abspielen
        localPlay();
        // Server informieren, damit alle anderen mitziehen!
        socket.emit('syncPlay', currentRoomCode);
    } else {
        // Lokal pausieren
        localPause();
        // Server informieren, damit alle anderen pausieren!
        socket.emit('syncPause', currentRoomCode);
    }
}

function localPlay() {
    if (!player) return;
    // Ensure the player is loaded at the designated start time.
    // Use loadVideoById with startSeconds to force the correct start position
    if (currentMovieData && currentMovieData.youtubeId) {
        try {
            if (typeof player.loadVideoById === 'function') {
                player.loadVideoById({
                    videoId: currentMovieData.youtubeId,
                    startSeconds: currentMovieData.startAt || 0
                });
            } else if (typeof player.seekTo === 'function' && typeof currentMovieData.startAt !== 'undefined') {
                player.seekTo(currentMovieData.startAt, true);
            }
        } catch (e) {
            // Fallback: try to seek if load failed
            if (typeof player.seekTo === 'function' && typeof currentMovieData.startAt !== 'undefined') {
                player.seekTo(currentMovieData.startAt, true);
            }
        }
    }

    // Small delay to let the player apply the start position reliably, then play
    setTimeout(() => {
        if (player && typeof player.playVideo === 'function') {
            player.playVideo();
        }
    }, 150);
    isPlaying = true;

    const playBtn = document.getElementById('play-btn');
    const blind = document.getElementById('video-blind');
    const blindText = document.getElementById('blind-text');

    // NEU: Text ändern, während der Vorhang noch die 3 Sekunden zu ist
    if (blindText) blindText.innerText = "🎬 Film ab! Die Vorstellung beginnt gleich...";

    // Der Vorhang triggert das Öffnen (wartet nun dank CSS 3 Sekunden)
    if (blind) blind.classList.add('curtain-open');

    if (playBtn && isActivePlayer) {
        playBtn.innerText = "⏸";
        playBtn.className = "absolute bottom-4 left-4 w-10 h-10 rounded-full bg-[#f5a623]/80 hover:bg-[#d48c16] text-black text-sm flex items-center justify-center transition-all shadow-lg cursor-pointer z-20";
    }
}
// Hilfsfunktion: Video lokal pausieren
function localPause() {
    if (!player) return;
    player.pauseVideo();
    isPlaying = false;

    stopVisualTimer();

    if (clipTimer) clearTimeout(clipTimer);
    clipTimerEndTime = null;
    visualTimerEndTime = null;


    if (currentMovieData && typeof currentMovieData.startAt !== 'undefined') {
        player.seekTo(currentMovieData.startAt, true);
    }

    const playBtn = document.getElementById('play-btn');
    const blind = document.getElementById('video-blind');
    const blindText = document.getElementById('blind-text');

    if (playBtn && isActivePlayer) {
        playBtn.innerText = "▶";
        playBtn.className = "absolute w-20 h-20 rounded-full bg-[#f5a623]/90 hover:bg-[#d48c16] text-black text-2xl flex items-center justify-center transition-all transform hover:scale-110 shadow-lg cursor-pointer z-20";
    }

    // Der Vorhang schließt sich wieder
    if (blind) blind.classList.remove('curtain-open');
    if (blindText) blindText.innerText = "Gestoppt. Nächster Versuch startet wieder von vorn!";
}

// NETZWERK-LISTENER: Wenn der Server sagt, dass ein anderer Spieler gestartet/pausiert hat
socket.on('onSyncPlay', () => {
    localPlay();
});

socket.on('onSyncPause', () => {
    localPause();
});

let timelineFocusIndex = -1;
let timelineFocusButtons = [];

function setupTimelineKeyboardNavigation(disabled) {
    const container = document.getElementById('timeline-container');
    if (!container) return;

    timelineFocusButtons = Array.from(container.querySelectorAll('[data-timeline-action="insert"]'));

    // Reset focus if current index is out of bounds or disabled
    if (disabled) {
        timelineFocusIndex = -1;
    } else {
        if (timelineFocusIndex < 0 || timelineFocusIndex >= timelineFocusButtons.length) {
            timelineFocusIndex = Math.max(0, timelineFocusButtons.length - 1);
        }
    }

    setTimelineFocus(timelineFocusIndex);
}

function setTimelineFocus(index) {
    const container = document.getElementById('timeline-container');
    if (!container) return;

    // remove old active state
    timelineFocusButtons.forEach(btn => btn.classList.remove('timeline-insert--focused'));

    if (index < 0 || index >= timelineFocusButtons.length) return;

    timelineFocusIndex = index;
    const btn = timelineFocusButtons[index];
    btn.classList.add('timeline-insert--focused');

    // keep in view
    const btnRect = btn.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    if (btnRect.top < contRect.top + 8) {
        container.scrollTop -= (contRect.top + 8 - btnRect.top);
    } else if (btnRect.bottom > contRect.bottom - 8) {
        container.scrollTop += (btnRect.bottom - (contRect.bottom - 8));
    }
}

function renderTimeline(disabled) {
    const container = document.getElementById('timeline-container');
    if (!container) return;

    container.innerHTML = "";
    myTimeline.sort((a, b) => a.year - b.year);

    // Abstand auf gap-2 verringert für Kompaktheit
    container.className = "flex flex-col items-center gap-2 max-h-[650px] overflow-y-auto no-scrollbar";

    // Top insertion zone
    container.appendChild(createPlusButton(`Vor ${myTimeline[0].year}`, -1, disabled, true));
    for (let i = 0; i < myTimeline.length; i++) {
        container.appendChild(createMovieCard(myTimeline[i]));
        if (i === myTimeline.length - 1) {
            container.appendChild(createPlusButton(`Nach ${myTimeline[i].year}`, i, disabled, false));
        } else {
            container.appendChild(createPlusButton(`Zwischen ${myTimeline[i].year} & ${myTimeline[i + 1].year}`, i, disabled, false));
        }
    }

    // Setup keyboard navigation after DOM is built
    setupTimelineKeyboardNavigation(disabled);

    // Automatischer Scroll-Effekt: Scrollt sanft nach unten, wenn ein neues Element dazukommt
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 50);
}


function requestExtraTime() {
    if (currentRoomType !== 'simultaneous') return;
    if (hasBoughtExtraTime) return;
    socket.emit('buyExtraTime', { roomCode: currentRoomCode });
}

function updateBuyExtraTimeButton(coins) {
    const button = document.getElementById('buy-extra-time-btn');
    if (!button) return;

    const canBuy = currentRoomType === 'simultaneous' && !roundResolved && !submittedPlayers.includes(myId) && !hasBoughtExtraTime;
    const hasEnough = (coins || 0) >= 4;

    if (canBuy && hasEnough) {
        button.classList.remove('hidden');
        button.disabled = false;
        button.innerText = '🪙 +5 Sek. für 4 Coins';
    } else if (currentRoomType === 'simultaneous' && !roundResolved && !submittedPlayers.includes(myId) && !hasBoughtExtraTime) {
        button.classList.remove('hidden');
        button.disabled = true;
        button.innerText = '🪙 Nicht genug Coins';
    } else {
        button.classList.add('hidden');
    }
}

function onRoundTimerExpired() {
    if (player && typeof player.stopVideo === 'function') {
        player.stopVideo();
    }
    isPlaying = false;

    const blind = document.getElementById('video-blind');
    const blindText = document.getElementById('blind-text');

    if (blind) blind.classList.remove('curtain-open');
    if (blindText) blindText.innerText = "⏱️ Zeit abgelaufen! Platziere jetzt deine Karte.";
}

function resetClipTimer() {
    if (!clipTimerEndTime) return;
    if (clipTimer) clearTimeout(clipTimer);

    const remainingMs = Math.max(0, clipTimerEndTime - Date.now());
    clipTimer = setTimeout(() => {
        onRoundTimerExpired();
    }, remainingMs);
}

// NACHHER (KORRIGIERT 🎮):
function createMovieCard(movie) {
    const div = document.createElement('div');
    div.className = "w-full bg-[#20222b] border border-gray-800 p-1.5 rounded-xl flex items-center gap-2 shadow-sm shrink-0";

    // Dynamisches Icon basierend auf dem aktuellen Modus
    const modeIcon = (currentRoomMode === 'games') ? '🎮' : '🎬';

    div.innerHTML = `<div class="w-7 h-7 bg-gray-800 rounded-lg flex items-center justify-center text-[13px] shrink-0">${modeIcon}</div>
                     <div class="truncate flex-1 min-w-0"><h4 class="font-bold text-[11px] text-white truncate">${movie.title}</h4><p class="text-[10px] text-[#f5a623] font-mono mt-0.5">${movie.year}</p></div>`;
    return div;
}

function createPlusButton(text, index, disabled, isInitial) {
    const btn = document.createElement('button');
    btn.className = `timeline-insert w-full border border-dashed border-[#f5a623]/30 text-[#f5a623] text-[11px] py-1 rounded-lg font-medium transition shrink-0 ${disabled ? 'opacity-10 cursor-not-allowed' : 'hover:bg-[#f5a623]/10 cursor-pointer'}`;
    btn.dataset.timelineAction = 'insert';
    btn.dataset.insertIndex = String(index);
    btn.type = 'button';

    btn.innerHTML = `➕ <span class="timeline-insert__label">${text}</span>`;

    // keyboard focus for the initial insert zone
    if (!disabled && isInitial) {
        // will be adjusted by setupTimelineKeyboardNavigation()
    }

    if (!disabled) {
        btn.onclick = () => handleGuess(index);
    }
    return btn;
}


function handleGuess(guessedIndex) {
    if (blindTimeout) clearTimeout(blindTimeout);

    // Die eigene Timeline SOFORT einfrieren (versteckt die Buttons)
    renderTimeline(true);

    // stop any keyboard focus
    timelineFocusButtons = [];
    timelineFocusIndex = -1;

    if (currentRoomType === "simultaneous") {

        const instText = document.getElementById('instruction-text');
        if (instText) {
            instText.innerText = "⏳ Tipp eingeloggt! Warte auf die restlichen Spieler...";
            instText.className = "text-yellow-500 font-semibold text-lg mb-4 animate-pulse";
        }
    } else {
        const blind = document.getElementById('video-blind');
        if (blind) blind.classList.add('hidden');
    }

    socket.emit('submitGuess', { roomCode: currentRoomCode, guessedIndex: guessedIndex });
}

socket.on('roundResolved', (data) => {
    roundResolved = true; // Prevent timer from starting
    // Video continues playing in background during results
    // Resume playback if it was paused by timer
    if (player && typeof player.playVideo === 'function') {
        player.playVideo();
    }
    isPlaying = true;

    // Deactivate timer so full clip can be seen
    if (clipTimer) clearTimeout(clipTimer);
    stopVisualTimer();

    if (data.activePlayerId === myId) {
        myTimeline = data.updatedTimeline;
    }

    renderTimeline(true);

    document.getElementById('play-btn').classList.add('hidden');
    document.getElementById('revealed-title').innerText = data.title;
    const revealedYear = document.getElementById('revealed-year');
    revealedYear.innerText = data.year;

    revealedYear.style.color = data.isCorrect ? '#22c55e' : '#ef4444';
    revealedYear.style.borderColor = data.isCorrect ? '#22c55e' : '#ef4444';
    revealedYear.style.backgroundColor = data.isCorrect ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';

    const revealedType = document.getElementById('revealed-type');
    if (revealedType) {
        revealedType.innerText = (currentRoomMode === 'games') ? '🎮 Spiel' : '🎬 Film';
    }

    document.getElementById('reveal-zone').classList.remove('hidden');

    const instText = document.getElementById('instruction-text');
    if (data.isCorrect) {
        instText.innerText = `🎉 Richtig! ${data.playerName} ordnet '${data.title}' (${data.year}) erfolgreich ein!`;
        instText.className = "text-green-500 font-semibold text-md mb-4";
    } else {
        instText.innerText = `😢 Falsch! '${data.title}' (${data.year}) passt nicht an diese Stelle.`;
        instText.className = "text-red-500 font-semibold text-md mb-4";
    }

    updateGamePlayersList(data.players, data.activePlayerId);

    const nextBtn = document.getElementById('next-round-btn');
    if (amIHost) {
        nextBtn.innerText = "Nächste Runde ➡️";
        nextBtn.className = "mt-4 bg-white text-black px-6 py-2 rounded-lg font-bold hover:bg-gray-200 cursor-pointer";
        nextBtn.onclick = () => socket.emit('requestNextRound', currentRoomCode);
    } else {
        nextBtn.innerText = "Warte auf Host...";
        nextBtn.onclick = null;
        nextBtn.className = "mt-4 bg-gray-700 text-gray-400 px-6 py-2 rounded-lg font-bold cursor-not-allowed";
    }
});

socket.on('nextRoundStarted', (data) => {
    initRound({
        round: data.round,
        totalRounds: currentMovieData.totalRounds,
        activePlayerId: data.activePlayerId,
        youtubeId: data.youtubeId,
        startAt: data.startAt,
        players: data.players,
        gameType: data.gameType
    });
});

socket.on('gameOver', (players) => {
    alert("Spiel vorbei! Danke fürs Spielen.");
    window.location.reload();
});

socket.on('errorMsg', (msg) => alert(msg));

// Funktion, um den Sieger-Bildschirm zu verlassen und das Spiel zurückzusetzen
function goToLobby() {
    // Pop-up wieder verstecken
    const winnerScreen = document.getElementById('winner-screen');
    if (winnerScreen) winnerScreen.classList.add('hidden');

    // UI zurück auf die Lobby oder den Startbildschirm setzen
    // Je nachdem, wie deine Ansichten benannt sind (z.B. 'lobby-screen' anzeigen, 'game-screen' verstecken)
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');

    // Dem Server optional sagen, dass wir zurück in der Lobby sind
    // socket.emit('backToLobby', currentRoomCode);
}

function onYouTubeIframeAPIReady() {
    // Bleibt leer, da wir den Player dynamisch in initRound() erzeugen!
}

// Hilfsfunktion um den Raumcode in die Zwischenablage zu kopieren
function copyRoomCode() {
    if (!currentRoomCode) return;
    navigator.clipboard.writeText(currentRoomCode);
}

function changeGameMode() {
    if (!amIHost) return;
    const selectedMode = document.getElementById('game-mode-select').value;
    socket.emit('updateGameMode', { roomCode: currentRoomCode, mode: selectedMode });
}

function changeGameType() {
    if (!amIHost) return;
    const selectedType = document.getElementById('game-type-select').value;
    socket.emit('updateGameType', { roomCode: currentRoomCode, type: selectedType });
}

socket.on('gameTypeUpdated', (type) => {
    currentRoomType = type;
    const select = document.getElementById('game-type-select');
    if (select) select.value = type;
});

// Server teilt allen im Raum mit, dass der Modus geändert wurde
socket.on('gameModeUpdated', (mode) => {
    currentRoomMode = mode;
    document.getElementById('game-mode-select').value = mode;

    const icon = (mode === 'games') ? '🎮' : '🎬';
    const headerIcon = document.getElementById('header-logo-icon');
    const statusIcon = document.getElementById('status-icon');

    if (headerIcon) headerIcon.innerText = icon;
    if (statusIcon) statusIcon.innerText = icon;
});

function changeClipDuration() {
    if (!amIHost) return;
    const selectedDuration = parseInt(document.getElementById('clip-duration-select').value);
    socket.emit('updateClipDuration', { roomCode: currentRoomCode, duration: selectedDuration });
}

// Server teilt allen im Raum mit, dass die Zeit geändert wurde
socket.on('clipDurationUpdated', (duration) => {
    maxClipDuration = duration;
    document.getElementById('clip-duration-select').value = duration;
});

function changeWinLimit() {
    if (!amIHost) return;
    const selectedLimit = parseInt(document.getElementById('win-limit-select').value);
    socket.emit('updateWinLimit', { roomCode: currentRoomCode, limit: selectedLimit });
}

socket.on('winLimitUpdated', (limit) => {
    winLimit = limit;
    document.getElementById('win-limit-select').value = limit;
})

function onPlayerStateChange(event) {
    // 1 = YT.PlayerState.PLAYING
    if (event.data === 1) {
        isPlaying = true;

        startVisualTimer();
        if (player && typeof player.setVolume === 'function') {
            player.setVolume(currentVolume);
        }

        // Falls noch ein alter Timer läuft, löschen
        if (clipTimer) clearTimeout(clipTimer);

        // Wenn currentClipDuration auf 0 steht, ist es unbegrenzt
        // Aber: Kein Timer starten, wenn die Runde bereits aufgelöst ist
        if (currentClipDuration > 0 && !roundResolved) {
            // RECHNUNG: Eingestellte Zeit (z.B. 15s * 1000 = 15000ms) + 4,6 Sekunden Vorhang-Wartezeit (4600ms)
            const totalDurationMs = (currentClipDuration * 1000) + 4600;
            clipTimerEndTime = Date.now() + totalDurationMs;
            visualTimerEndTime = clipTimerEndTime;
            timerStartTimestamp = Date.now();
            resetClipTimer();
        }
    } else {
        // Wenn das Video pausiert oder gestoppt wird, löschen wir den Timer ebenfalls zur Sicherheit
        if (event.data === 2 || event.data === 0) {
            if (clipTimer) clearTimeout(clipTimer);
            // Vorhang wieder schließen und Text ändern
            const blind = document.getElementById('video-blind');
            const blindText = document.getElementById('blind-text');

            if (blind) {
                blind.classList.remove('curtain-open');
            }
            if (blindText) {
                blindText.innerText = "⏱️ Zeit abgelaufen! Platziere jetzt deine Karte.";
            }
        }
        isPlaying = false;

    }
}

function startVisualTimer() {
    const timerBarContainer = document.getElementById('timer-bar-container');
    const timerBar = document.getElementById('timer-bar');
    const statusText = document.getElementById('timer-status-text');
    const percentText = document.getElementById('timer-percentage-text');

    if (!timerBar || !timerBarContainer || currentClipDuration <= 0) return;

    if (barInterval) clearInterval(barInterval);

    const curtainDelay = 4600; // 4,6 Sekunden Vorhangzeit
    const playDuration = currentClipDuration * 1000; // Reine Spielzeit in ms
    const totalDuration = playDuration + curtainDelay;

    // Keep the timer bar hidden for the first 4.6 seconds (curtain is closed)
    timerBarContainer.classList.add('hidden');

    // After curtain delay, show the timer and start the visual countdown
    setTimeout(() => {
        timerBarContainer.classList.remove('hidden');
        timerBar.style.width = '100%';
        timerBar.className = "h-full w-full rounded-full transition-all duration-100 ease-linear timer-glow-orange";

        if (statusText) statusText.innerText = "Film ab! Raten läuft...";
        if (percentText) percentText.innerText = "100%";

        barInterval = setInterval(() => {
            const now = Date.now();
            const remainingMs = Math.max(0, visualTimerEndTime - now);
            const totalMs = Math.max(1, visualTimerEndTime - (timerStartTimestamp + curtainDelay));
            const elapsedSinceVisible = now - (timerStartTimestamp + curtainDelay);

            const remainingPercent = Math.max(0, (remainingMs / totalMs) * 100);
            timerBar.style.width = `${remainingPercent}%`;
            if (percentText) percentText.innerText = `${Math.ceil(remainingPercent)}%`;

            if (remainingPercent < 30) {
                timerBar.className = "h-full w-full rounded-full transition-all duration-100 ease-linear timer-glow-red";
                if (statusText) statusText.className = "text-red-500 animate-pulse font-bold";
                if (percentText) percentText.className = "font-mono text-red-500 animate-pulse font-bold";
                if (statusText) statusText.innerText = "🚨 Schnell! Die Zeit läuft ab!";
            }

            if (remainingMs <= 0) {
                clearInterval(barInterval);
            }
        }, 100);
    }, curtainDelay);
}

function stopVisualTimer() {
    if (barInterval) clearInterval(barInterval);
    const timerBarContainer = document.getElementById('timer-bar-container');
    if (timerBarContainer) timerBarContainer.classList.add('hidden');
    visualTimerEndTime = null;
    clipTimerEndTime = null;

    // Text-Klassen wieder auf Standard setzen für den nächsten Durchlauf
    const statusText = document.getElementById('timer-status-text');
    const percentText = document.getElementById('timer-percentage-text');
    if (statusText) statusText.className = "flex items-center gap-1";
    if (percentText) percentText.className = "font-mono text-[#f5a623]";
}

function changeVolume(value) {
    currentVolume = parseInt(value);

    // 1. YouTube-Player sofort anpassen, falls er existiert
    if (player && typeof player.setVolume === 'function') {
        player.setVolume(currentVolume);
    }

    // 2. Textanzeige (z.B. "75%") aktualisieren
    const volumeText = document.getElementById('volume-text');
    if (volumeText) volumeText.innerText = `${currentVolume}%`;

    // 3. Icon dynamisch anpassen (Stumm / Leise / Laut)
    const volumeIcon = document.getElementById('volume-icon');
    if (volumeIcon) {
        if (currentVolume === 0) volumeIcon.innerText = "🔇";
        else if (currentVolume < 40) volumeIcon.innerText = "🔈";
        else if (currentVolume < 75) volumeIcon.innerText = "🔉";
        else volumeIcon.innerText = "🔊";
    }
}

// --- NEUE EVENTS FÜR SIMULTAN-MODUS ---

// --- NEUE EVENTS FÜR SIMULTAN-MODUS ---

// 1. Live-Status: Jemand hat getippt!
socket.on('playerSubmittedStatus', (submittedIds) => {
    submittedPlayers = submittedIds;
    // Liste sofort neu zeichnen, damit die ⏳ zu ✅ werden
    if (currentMovieData && currentMovieData.players) {
        updateGamePlayersList(currentMovieData.players, currentMovieData.activePlayerId);
    }
    const me = currentMovieData?.players?.find(p => p.id === myId);
    updateBuyExtraTimeButton(me ? me.coins : 0);
});

socket.on('timeExtensionGranted', (data) => {
    if (!data || typeof data.extraSeconds !== 'number') return;

    if (data.playerId === myId) {
        currentClipDuration += data.extraSeconds;
        if (clipTimerEndTime) {
            clipTimerEndTime += data.extraSeconds * 1000;
            visualTimerEndTime += data.extraSeconds * 1000;
            resetClipTimer();
        }
        hasBoughtExtraTime = true;
    }

    if (data.players) {
        updateGamePlayersList(data.players, currentMovieData?.activePlayerId);
    }

    const button = document.getElementById('buy-extra-time-btn');
    if (button) {
        if (data.playerId === myId) {
            button.classList.add('hidden');
        } else {
            const me = data.players?.find(p => p.id === myId);
            updateBuyExtraTimeButton(me ? me.coins : 0);
        }
    }

    const instText = document.getElementById('instruction-text');
    if (instText) {
        instText.innerText = `🪙 ${data.playerName} hat 5 Extra-Sekunden gekauft!`;
        instText.className = "text-amber-400 font-bold text-lg mb-4";
    }
});

// 2. Das große Finale: Alle haben getippt!
socket.on('simultaneousRoundResolved', (data) => {
    roundResolved = true; // Prevent timer from starting
    // Video continues playing in background during results
    // Resume playback if it was paused by timer
    if (player && typeof player.playVideo === 'function') {
        player.playVideo();
    }
    isPlaying = true;

    // Deactivate timer so full clip can be seen
    if (clipTimer) clearTimeout(clipTimer);
    stopVisualTimer();

    // 1. Deine aktualisierte Karte aus den Serverdaten holen
    const myResult = data.results.find(r => r.id === myId);
    if (myResult) {
        myTimeline = myResult.updatedTimeline;
    }
    renderTimeline(true);

    // 2. Video für alle freilegen
    document.getElementById('play-btn').classList.add('hidden');
    const blind = document.getElementById('video-blind');
    if (blind) blind.classList.add('hidden');

    document.getElementById('revealed-title').innerText = data.title;
    const revealedYear = document.getElementById('revealed-year');
    revealedYear.innerText = data.year;

    const anyCorrect = data.results.some(r => r.isCorrect);
    // Visual hint: year pill color based on correctness
    revealedYear.style.color = myResult.isCorrect ? '#22c55e' : '#ef4444';
    revealedYear.style.borderColor = myResult.isCorrect ? '#22c55e' : '#ef4444';
    revealedYear.style.backgroundColor = myResult.isCorrect ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';

    const revealedType = document.getElementById('revealed-type');
    if (revealedType) {
        revealedType.innerText = (currentRoomMode === 'games') ? '🎮 Spiel' : '🎬 Film';
    }

    document.getElementById('reveal-zone').classList.remove('hidden');

    // 3. Auswertungs-Text bauen
    const instText = document.getElementById('instruction-text');
    const winners = data.results.filter(r => r.isCorrect).map(r => r.name);

    if (winners.length > 0) {
        const coinsText = data.results
            .filter(r => r.isCorrect)
            .map(r => `${r.name} +${r.coinsEarned}🪙`)
            .join(', ');

        instText.innerText = `🌟 Richtig getippt von: ${winners.join(', ')}! ${coinsText}`;
        instText.className = "text-green-500 font-bold text-lg mb-4";
    } else {
        instText.innerText = `😢 Niemand lag richtig!`;
        instText.className = "text-red-500 font-bold text-lg mb-4";
    }

    // Punkte aktualisieren
    updateGamePlayersList(data.players, null);

    // Host-Steuerung für nächste Runde
    const nextBtn = document.getElementById('next-round-btn');
    if (amIHost) {
        nextBtn.innerText = "Nächste Runde ➡️";
        nextBtn.className = "mt-4 bg-white text-black px-6 py-2 rounded-lg font-bold hover:bg-gray-200 cursor-pointer";
        nextBtn.onclick = () => socket.emit('requestNextRound', currentRoomCode);
    } else {
        nextBtn.innerText = "Warte auf Host...";
        nextBtn.className = "mt-4 bg-gray-700 text-gray-400 px-6 py-2 rounded-lg font-bold cursor-not-allowed";
        nextBtn.onclick = null;
    }
});

function leaveAndGoHome() {
    // 1. Dem Server sagen, dass wir den Raum verlassen
    if (currentRoomCode) {
        socket.emit('leaveRoom', { roomCode: currentRoomCode });
    }

    // 2. Clientseitige Variablen zurücksetzen
    currentRoomCode = "";
    myTimeline = [];
    amIHost = false;
    isActivePlayer = false;

    // 3. Ansichten zurücksetzen
    // Falls das Video noch läuft, stoppen
    if (player && typeof player.pauseVideo === 'function') {
        player.pauseVideo();
    }

    // Siegerscreen verstecken (da dieser "fixed fixed-0" liegt und showScreen überlagern würde)
    const winnerScreen = document.getElementById('winner-screen');
    if (winnerScreen) winnerScreen.classList.add('hidden');

    // Rundenzähler oben im Header verstecken
    document.getElementById('round-display').classList.add('hidden');
    document.getElementById('room-code-display').innerText = "# DEIN_CODE";

    // Zurück zum Startbildschirm wechseln
    showScreen('screen-start');
}

// Event-Listener registrieren, sobald das Dokument bereit ist
window.addEventListener('DOMContentLoaded', () => {
    // 1. Filmklappe & Schriftzug oben links ("Filmster") klickbar machen
    // Da das Icon und das H1 in einem gemeinsamen flex-Container liegen, greifen wir den Container:
    const headerLogo = document.querySelector('header .flex.items-center.gap-2');
    if (headerLogo) {
        headerLogo.style.cursor = 'pointer';
        headerLogo.addEventListener('click', () => {
            // Sicherheitsabfrage, falls man sich gerade mitten im Spiel befindet
            const gameScreen = document.getElementById('screen-game');
            if (gameScreen && !gameScreen.classList.contains('hidden')) {
                if (confirm("Möchtest du das laufende Spiel wirklich verlassen? Du verlierst deinen Fortschritt.")) {
                    leaveAndGoHome();
                }
            } else {
                // Aus der Lobby oder dem Siegerscreen direkt ohne Abfrage zurück
                leaveAndGoHome();
            }
        });
    }

    // 2. "Zurück zur Lobby"-Button auf dem Siegerscreen aktivieren
    const backToLobbyBtn = document.getElementById('back-to-lobby-btn');
    if (backToLobbyBtn) {
        backToLobbyBtn.addEventListener('click', () => {
            leaveAndGoHome();
        });
    }
});