const socket = io();

let currentRoomCode = "";
let myName = "";
let myId = "";
let amIHost = false;
let currentMovieData = null;
let isActivePlayer = false;

// Jedes Mal, wenn das Spiel startet, laden wir die Timeline, die der Server uns gibt
let myTimeline = [];

let player;
let isPlaying = false;

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

// GAMEPLAY
socket.on('gameStarted', (data) => {
    showScreen('screen-game');
    document.getElementById('round-display').classList.remove('hidden');
    
    // Hole meine persönliche Start-Timeline vom Server
    const me = data.players.find(p => p.id === myId);
    myTimeline = me.timeline;

    initRound(data);
});

function initRound(data) {
    document.getElementById('round-display').innerText = `⏱️ Runde ${data.round}/${data.totalRounds}`;
    currentMovieData = data;
    isActivePlayer = (data.activePlayerId === myId);

    updateGamePlayersList(data.players, data.activePlayerId);

    const instText = document.getElementById('instruction-text');
    if (isActivePlayer) {
        instText.innerText = "Du bist dran! Höre das Intro und ordne es in DEINE Timeline ein.";
        instText.className = "text-[#f5a623] font-semibold text-lg mb-4";
    } else {
        const activePlayerObj = data.players.find(p => p.id === data.activePlayerId);
        instText.innerText = `${activePlayerObj.name} ist am Zug...`;
        instText.className = "text-gray-400 font-semibold text-lg mb-4";
    }

    document.getElementById('play-btn').classList.remove('hidden');
    document.getElementById('play-btn').innerText = "▶";
    document.getElementById('reveal-zone').classList.add('hidden');
    isPlaying = false;

if (!player) {
        player = new YT.Player('yt-player', {
            height: '100%',
            width: '100%',
            videoId: data.youtubeId,
            playerVars: { 
                'start': data.startAt, 
                'controls': 1, // Bei Option A erlauben wir die Controls (oder 0, falls sie nicht spulen dürfen)
                'autoplay': 0, 
                'origin': window.location.origin 
            }
        });
    } else {
        player.loadVideoById({ videoId: data.youtubeId, startSeconds: data.startAt });
        player.pauseVideo();
    }

    // Wenn ich nicht dran bin, sind die Plus-Buttons deaktiviert
    renderTimeline(!isActivePlayer);
}

// Globale Variable, um zu speichern, welche fremden Timelines gerade OFFEN sind (damit sie beim Rundenwechsel nicht zuklappen)
let openTimelines = {};

function updateGamePlayersList(players, activePlayerId) {
    // SICHERHEITSLINIE: Falls openTimelines noch gar nicht existiert, erstellen wir es sofort
    if (!window.openTimelines) {
        window.openTimelines = {};
    }

    const list = document.getElementById('game-players-list');
    list.innerHTML = "";
    
    const currentMyId = socket.id; 

    players.forEach(p => {
        const isCurrent = p.id === activePlayerId;
        const isMe = (p.id === currentMyId);
        
        // SICHERHEITSLINIE 2: Wenn für diesen speziellen Spieler noch kein Zustand existiert, auf false (eingeklappt) setzen
        if (window.openTimelines[p.id] === undefined) {
            window.openTimelines[p.id] = false;
        }

        const playerContainer = document.createElement('div');
        playerContainer.className = "flex flex-col gap-1 w-full";
        
        const playerCard = document.createElement('div');
        playerCard.className = `p-4 rounded-lg flex items-center justify-between transition ${
            isCurrent 
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
        
        if (!window.openTimelines[p.id]) {
            externalTimelineDiv.className = "hidden pl-4 pr-2 py-2 flex flex-col gap-1 bg-[#111217] rounded-b-lg border-x border-b border-gray-900 max-h-60 overflow-y-auto";
        } else {
            externalTimelineDiv.className = "pl-4 pr-2 py-2 flex flex-col gap-1 bg-[#111217] rounded-b-lg border-x border-b border-gray-900 max-h-60 overflow-y-auto";
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

function toggleAudio() {
    if (!player || typeof player.playVideo !== 'function') return;
    if (!isPlaying) {
        player.playVideo();
        document.getElementById('play-btn').innerText = "⏸";
        isPlaying = true;
    } else {
        player.pauseVideo();
        document.getElementById('play-btn').innerText = "▶";
        isPlaying = false;
    }
}

function renderTimeline(disabled) {
    const container = document.getElementById('timeline-container');
    container.innerHTML = "";
    myTimeline.sort((a, b) => a.year - b.year);

    container.appendChild(createPlusButton(`Vor ${myTimeline[0].year}`, -1, disabled));
    for (let i = 0; i < myTimeline.length; i++) {
        container.appendChild(createMovieCard(myTimeline[i]));
        if (i === myTimeline.length - 1) {
            container.appendChild(createPlusButton(`Nach ${myTimeline[i].year}`, i, disabled));
        } else {
            container.appendChild(createPlusButton(`Zwischen ${myTimeline[i].year} & ${myTimeline[i+1].year}`, i, disabled));
        }
    }
}

function createMovieCard(movie) {
    const div = document.createElement('div');
    div.className = "w-full bg-[#20222b] border border-gray-800 p-3 rounded-xl flex items-center gap-3";
    div.innerHTML = `<div class="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center text-xl">🎬</div>
                     <div><h4 class="font-bold text-sm">${movie.title}</h4><p class="text-xs text-[#f5a623]">${movie.year}</p></div>`;
    return div;
}

function createPlusButton(text, index, disabled) {
    const btn = document.createElement('button');
    btn.className = `w-full border-2 border-dashed border-[#f5a623]/40 text-[#f5a623] text-xs py-2 rounded-lg font-medium transition ${disabled ? 'opacity-20 cursor-not-allowed' : 'hover:bg-[#f5a623]/10 cursor-pointer'}`;
    btn.innerText = `➕ ${text}`;
    if (!disabled) {
        btn.onclick = () => handleGuess(index);
    }
    return btn;
}

// TIPP ABGEBEN
function handleGuess(guessedIndex) {
    if (player) player.pauseVideo();
    // Schicke den gewählten Index an den Server zur Überprüfung
    socket.emit('submitGuess', { roomCode: currentRoomCode, guessedIndex: guessedIndex }); 
}

// AUFLÖSUNG VOM SERVER EMPFANGEN
socket.on('roundResolved', (data) => {
    if (player) player.pauseVideo();
    
    // Wenn ICH der Spieler war, der getippt hat, aktualisiere ich meine lokale Timeline mit den Daten vom Server
    if (data.activePlayerId === myId) {
        myTimeline = data.updatedTimeline;
    }
    
    // Timeline für alle einfrieren/neu rendern
    renderTimeline(true);

    // Auflösung im Player-Bereich anzeigen
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

    // Spieler-Scores live updaten
    updateGamePlayersList(data.players, data.activePlayerId);

    // Weiter-Button für den Host aktivieren
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
function onYouTubeIframeAPIReady() {}

function onYouTubeIframeAPIReady() {
    // Bleibt leer, da wir den Player dynamisch in initRound() erzeugen!
}