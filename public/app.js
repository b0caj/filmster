const socket = io();

let currentRoomCode = "";
let myName = "";
let myId = "";
let amIHost = false;
let currentMovieData = null;
let isActivePlayer = false;

let myTimeline = [];
let player;
let isPlaying = false;
let currentRoomMode = "movies";
let maxClipDuration = 15; // Standardmäßig 15 Sekunden
let clipTimer = null;     // Hält den JavaScript-Timer

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

    document.getElementById('start-game-btn').onclick = () => {
        socket.emit('startGame', currentRoomCode);
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

function initRound(data) {
    if (clipTimer) clearTimeout(clipTimer);
    document.getElementById('round-display').innerText = `⏱️ Runde ${data.round}/${data.totalRounds}`;
    currentMovieData = data;
    isActivePlayer = (data.activePlayerId === myId);

    updateGamePlayersList(data.players, data.activePlayerId);

    const instText = document.getElementById('instruction-text');
    const playBtn = document.getElementById('play-btn');
    const overlay = document.getElementById('video-protection-overlay');

    if (isActivePlayer) {
        instText.innerText = "Du bist dran! Höre das Intro und ordne es in DEINE Timeline ein.";
        instText.className = "text-[#f5a623] font-semibold text-lg mb-4";

        // Aktiver Spieler: Sieht den Button und darf aufs Overlay klicken
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

        // Passiver Spieler: Sieht KEINEN Play-Button und darf nicht klicken
        if (playBtn) playBtn.classList.add('hidden');
        if (overlay) {
            overlay.onclick = null;
            overlay.style.cursor = "default";
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
    const blind = document.getElementById('video-blind');
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
        player.loadVideoById({ videoId: data.youtubeId, startSeconds: data.startAt });
        player.pauseVideo();
    }

    renderTimeline(!isActivePlayer);
}

function updateGamePlayersList(players, activePlayerId) {
    if (!window.openTimelines) {
        window.openTimelines = {};
    }

    const list = document.getElementById('game-players-list');
    list.innerHTML = "";

    const currentMyId = socket.id;

    players.forEach(p => {
        const isCurrent = p.id === activePlayerId;
        const isMe = (p.id === currentMyId);

        if (window.openTimelines[p.id] === undefined) {
            window.openTimelines[p.id] = false;
        }

        const playerContainer = document.createElement('div');
        playerContainer.className = "flex flex-col gap-1 w-full";

        const playerCard = document.createElement('div');
        playerCard.className = `p-4 rounded-lg flex items-center justify-between transition ${isCurrent
            ? "bg-[#241e17] border border-[#f5a623]"
            : "bg-[#20222b] border border-gray-800 hover:border-gray-700"
            } ${!isMe ? 'cursor-pointer' : ''}`;

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

        playerCard.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-gray-700 text-white font-bold flex items-center justify-center">${p.name[0]}</div>
                <div>
                    <div class="font-bold text-sm flex items-center gap-1">
                        ${p.name} ${isMe ? '(Du)' : ''} 
                        ${!isMe ? `<span id="arrow-${p.id}" class="text-xs text-gray-500">${window.openTimelines[p.id] ? '▲' : '▼'}</span>` : ''}
                    </div>
                    ${isCurrent ? '<div class="text-xs text-[#f5a623]">Am Zug</div>' : `<div class="text-xs text-gray-500">${isMe ? 'Deine eigene Reihe' : 'Timeline anzeigen'}</div>`}
                </div>
            </div>
            <div class="flex items-center gap-1 text-[#f5a623] font-bold">⭐ ${p.score}</div>
        `;

        playerContainer.appendChild(playerCard);

        const externalTimelineDiv = document.createElement('div');
        externalTimelineDiv.id = `external-timeline-${p.id}`;

        // KORREKTUR: max-h-80 und no-scrollbar hinzugefügt 🛠️
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
    
    player.playVideo();
    isPlaying = true;

    const playBtn = document.getElementById('play-btn');
    const blind = document.getElementById('video-blind');
    const blindText = document.getElementById('blind-text');

    if (blindText) blindText.innerText = "Intro wird geladen...";
    if (blind) blind.classList.remove('hidden');

    if (blindTimeout) clearTimeout(blindTimeout);
    blindTimeout = setTimeout(() => {
        if (blind && isPlaying) {
            blind.classList.add('hidden');
        }
    }, 5000);

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

    // Timer sofort löschen, da das Video gestoppt wurde
    if (clipTimer) clearTimeout(clipTimer);

    // NEU: Sofort im Hintergrund an den Runden-Anfang zurückspringen!
    if (currentMovieData && typeof currentMovieData.startAt !== 'undefined') {
        player.seekTo(currentMovieData.startAt, true);
    }

    const playBtn = document.getElementById('play-btn');
    const blind = document.getElementById('video-blind');
    
    if (playBtn && isActivePlayer) {
        playBtn.innerText = "▶";
        playBtn.className = "absolute w-20 h-20 rounded-full bg-[#f5a623]/90 hover:bg-[#d48c16] text-black text-2xl flex items-center justify-center transition-all transform hover:scale-110 shadow-lg cursor-pointer z-20";
    }

    // Blindfeld wieder anzeigen, damit niemand das Standbild sieht
    if (blind) blind.classList.remove('hidden');
    
    const blindText = document.getElementById('blind-text');
    if (blindText) blindText.innerText = "Gestoppt. Nächster Versuch startet wieder von vorn!";
}

// NETZWERK-LISTENER: Wenn der Server sagt, dass ein anderer Spieler gestartet/pausiert hat
socket.on('onSyncPlay', () => {
    localPlay();
});

socket.on('onSyncPause', () => {
    localPause();
});

function renderTimeline(disabled) {
    const container = document.getElementById('timeline-container');
    if (!container) return;

    container.innerHTML = "";
    myTimeline.sort((a, b) => a.year - b.year);

    // Abstand auf gap-2 verringert für Kompaktheit
    container.className = "flex flex-col items-center gap-2 max-h-[650px] overflow-y-auto no-scrollbar";

    container.appendChild(createPlusButton(`Vor ${myTimeline[0].year}`, -1, disabled));
    for (let i = 0; i < myTimeline.length; i++) {
        container.appendChild(createMovieCard(myTimeline[i]));
        if (i === myTimeline.length - 1) {
            container.appendChild(createPlusButton(`Nach ${myTimeline[i].year}`, i, disabled));
        } else {
            container.appendChild(createPlusButton(`Zwischen ${myTimeline[i].year} & ${myTimeline[i + 1].year}`, i, disabled));
        }
    }

    // Automatischer Scroll-Effekt: Scrollt sanft nach unten, wenn ein neues Element dazukommt
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 50);
}

// NACHHER (KORRIGIERT 🎮):
function createMovieCard(movie) {
    const div = document.createElement('div');
    div.className = "w-full bg-[#20222b] border border-gray-800 p-2 rounded-xl flex items-center gap-2 shadow-sm shrink-0";

    // Dynamisches Icon basierend auf dem aktuellen Modus
    const modeIcon = (currentRoomMode === 'games') ? '🎮' : '🎬';

    div.innerHTML = `<div class="w-8 h-8 bg-gray-800 rounded-lg flex items-center justify-center text-md shrink-0">${modeIcon}</div>
                     <div class="truncate"><h4 class="font-bold text-xs text-white truncate max-w-[150px]">${movie.title}</h4><p class="text-[10px] text-[#f5a623] font-mono mt-0.5">${movie.year}</p></div>`;
    return div;
}

function createPlusButton(text, index, disabled) {
    const btn = document.createElement('button');
    btn.className = `w-full border border-dashed border-[#f5a623]/30 text-[#f5a623] text-[11px] py-1.5 rounded-lg font-medium transition shrink-0 ${disabled ? 'opacity-10 cursor-not-allowed' : 'hover:bg-[#f5a623]/10 cursor-pointer'}`;
    btn.innerText = `➕ ${text}`;
    if (!disabled) {
        btn.onclick = () => handleGuess(index);
    }
    return btn;
}

function handleGuess(guessedIndex) {
    if (blindTimeout) clearTimeout(blindTimeout);
    if (player) player.pauseVideo();

    // Blende komplett verstecken bei der Auflösung, damit JEDER das Video sehen kann!
    const blind = document.getElementById('video-blind');
    if (blind) blind.classList.add('hidden');
    socket.emit('submitGuess', { roomCode: currentRoomCode, guessedIndex: guessedIndex });
}

socket.on('roundResolved', (data) => {
    if (player) player.pauseVideo();

    if (data.activePlayerId === myId) {
        myTimeline = data.updatedTimeline;
    }

    renderTimeline(true);

    document.getElementById('play-btn').classList.add('hidden');
    document.getElementById('revealed-title').innerText = data.title;
    document.getElementById('revealed-year').innerText = data.year;
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
        players: data.players
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

function onPlayerStateChange(event) {
    // 1 = YT.PlayerState.PLAYING
    if (event.data === 1) {
        isPlaying = true;

        // Falls noch ein alter Timer läuft, löschen
        if (clipTimer) clearTimeout(clipTimer);

        // Wenn maxClipDuration auf 0 steht, ist es unbegrenzt
        if (maxClipDuration > 0) {
            clipTimer = setTimeout(() => {
                if (player && typeof player.stopVideo === 'function') {
                    player.stopVideo(); // Video stoppen
                }
                isPlaying = false;

                // Blindfeld wieder anzeigen und Text ändern
                const blind = document.getElementById('video-blind');
                const blindText = document.getElementById('blind-text');
                if (blind) blind.classList.remove('hidden');
                if (blindText) blindText.innerText = "⏱️ Zeit abgelaufen! Platziere jetzt deine Karte.";

                console.log("Clip-Dauer erreicht. Video automatisch gestoppt.");
            }, maxClipDuration * 1000); // Sekunden in Millisekunden umrechnen
        }
    } else {
        // Wenn das Video pausiert oder gestoppt wird, löschen wir den Timer ebenfalls zur Sicherheit
        if (event.data === 2 || event.data === 0) {
            if (clipTimer) clearTimeout(clipTimer);
        }
        isPlaying = false;
    }
}