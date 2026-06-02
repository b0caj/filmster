//let movieDatabase = [];
//let gameDatabase = [];

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
let movieDatabase = require('./movies.json');
let gameDatabase = require('./games.json'); // NEU Hier die Games laden
app.use(express.static(path.join(__dirname, 'public')));


// WICHTIG: Erlaubt dem Server, JSON-Daten von Formularen zu lesen
app.use(express.json());

// ADMIN-API: Nächsten Film ohne YouTube-ID heraussuchen
app.get('/api/admin/next-empty', (req, res) => {
    const mode = req.query.mode || 'movies'; // Standard ist movies
    const currentDb = (mode === 'games') ? gameDatabase : movieDatabase;

    const nextItem = currentDb.find(m => !m.youtubeId || m.youtubeId.trim() === "");

    if (!nextItem) {
        return res.json({ message: "Alle Einträge in dieser Liste sind vollständig! 🎉", finished: true });
    }

    // Berechne den aktuellen Fortschritt
    const filledCount = currentDb.filter(m => m.youtubeId && m.youtubeId.trim() !== "").length;

    res.json({
        title: nextItem.title,
        year: nextItem.year,
        progress: `${filledCount} / ${currentDb.length}`,
        finished: false
    });
});

// ADMIN-API: Daten speichern und die entsprechende JSON-Datei updaten
app.post('/api/admin/update', (req, res) => {
    const { title, year, youtubeId, startAt, mode } = req.body;

    const isGames = (mode === 'games');
    const currentDb = isGames ? gameDatabase : movieDatabase;
    const fileName = isGames ? 'games.json' : 'movies.json';

    // Eintrag in der Live-Datenbank suchen
    const item = currentDb.find(m => m.title === title && m.year === parseInt(year));

    if (!item) return res.status(404).json({ error: "Eintrag nicht gefunden!" });

    // Werte updaten
    item.youtubeId = youtubeId.trim();
    item.startAt = parseInt(startAt) || 0;

    // In die jeweilige JSON-Datei auf die Festplatte schreiben
    try {
        fs.writeFileSync(path.join(__dirname, fileName), JSON.stringify(currentDb, null, 2), 'utf8');
        console.log(`[Admin - ${mode.toUpperCase()}] '${title}' erfolgreich geupdatet.`);
        res.json({ success: true });
    } catch (error) {
        console.error(`Fehler beim Speichern der ${fileName}:`, error);
        res.status(500).json({ error: "Datei-Schreibfehler!" });
    }
});

// Filmdatenbank
const fs = require('fs');


try {
    const rawData = fs.readFileSync(path.join(__dirname, 'movies.json'), 'utf8');
    movieDatabase = JSON.parse(rawData);
    console.log(`Erfolgreich ${movieDatabase.length} Filme und Serien geladen!`);
} catch (error) {
    console.error("Fehler beim Laden der movies.json! Nutze leere Datenbank.", error);
    movieDatabase = [
        { title: "Notfall-Klassiker", year: 2000, youtubeId: "4wvpdBnfiZo", startAt: 0 }
    ];
}

const rooms = {};

function createInitialTimeline() {
    return [
        { title: "The Godfather", year: 1972 },
        { title: "Dune", year: 2021 }
    ].sort((a, b) => a.year - b.year);
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {

    // 1. RAUM ERSTELLEN
    socket.on('createRoom', (playerName) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            host: socket.id,
            players: [{
                id: socket.id,
                name: playerName,
                score: 0,
                isHost: true,
                timeline: createInitialTimeline()
            }],
            gameStarted: false,
            playlist: movieDatabase
                .filter(m => m.youtubeId && m.youtubeId.trim() !== "")
                .sort(() => Math.random() - 0.5),
            currentRound: 0,
            activePlayerIndex: 0,
            mode: "movies"
        };
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
    });

    // 2. RAUM BEITRETEN
    socket.on('joinRoom', ({ roomCode, playerName }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('errorMsg', 'Raum nicht gefunden!');
        if (room.gameStarted) return socket.emit('errorMsg', 'Spiel läuft bereits!');

        rooms[roomCode].players.push({
            id: socket.id,
            name: playerName,
            score: 0,
            isHost: false,
            timeline: createInitialTimeline()
        });

        socket.join(roomCode);
        io.to(roomCode).emit('playerJoined', room.players);
        socket.emit('joinSuccess', roomCode);
    });

    // 3. SPIEL STARTEN
    // Event für Spiel-Ablauf-Wechsel
    socket.on('updateGameType', ({ roomCode, type }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;
        room.gameType = type;
        io.to(roomCode).emit('gameTypeUpdated', type);
    });

    // 3. SPIEL STARTEN (KUGELSICHER)
    // 3. SPIEL STARTEN (Vom Host ausgelöst)
    socket.on('startGame', (data) => {
        // Falls der Client ein Objekt sendet, entpacken wir es, ansonsten nutzen wir es als roomCode (Fallback)
        const roomCode = (data && data.roomCode) ? data.roomCode : data;

        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;

        // Einstellungen aus dem Objekt im Raum speichern (oder Standardwerte nutzen)
        room.gameStarted = true;
        room.mode = (data && data.mode) ? data.mode : "movies";
        room.gameType = (data && data.type) ? data.type : "classic";
        room.winLimit = (data && data.winLimit) ? parseInt(data.winLimit) : 10;

        // Die richtige Datenbank wählen (Spiele oder Filme)
        const chosenDatabase = (room.mode === "games") ? gameDatabase : movieDatabase;

        // Playlist erstellen: Nur Einträge mit gültiger YouTube-ID
        const validItems = chosenDatabase.filter(m => m.youtubeId && m.youtubeId.trim() !== "");

        if (validItems.length === 0) {
            console.log("Fehler: Keine gültigen Einträge in der gewählten Datenbank gefunden!");
            return;
        }

        // Playlist zufällig mischen
        room.playlist = [...validItems].sort(() => Math.random() - 0.5);
        room.currentRound = 0;
        room.submittedGuesses = {}; // Für den Simultanmodus zurücksetzen

        // Timelines aller Spieler mit der ersten Karte befüllen
        const firstMovie = room.playlist[room.currentRound];
        room.players.forEach(p => {
            p.timeline = [{ ...firstMovie }];
            p.score = 0;
        });

        // Nächsten Film vorbereiten (Runde 1 im Spiel wird Index 1 der Playlist sein)
        room.currentRound = 1;
        const nextMovie = room.playlist[room.currentRound];

        // Aktiven Spieler bestimmen (für den klassischen Modus)
        room.activePlayerIndex = 0;
        const activePlayer = room.players[room.activePlayerIndex];

        // Event an alle Clients senden, dass das Spiel startet
        io.to(roomCode).emit('gameStarted', {
            round: room.currentRound,
            activePlayerId: activePlayer.id,
            youtubeId: nextMovie.youtubeId,
            startAt: nextMovie.startAt || 0,
            players: room.players,
            gameType: room.gameType,
            totalRounds: room.playlist.length,
            winLimit: room.winLimit // Sendet das Limit ans Frontend
        });
    });

    // Event für Spielmodus-Wechsel (hast du schon)
    socket.on('updateGameMode', ({ roomCode, mode }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;
        room.mode = mode;
        io.to(roomCode).emit('gameModeUpdated', mode);
    });

    // NEU: Event für die Änderung der Clip-Dauer ⏱️
    socket.on('updateClipDuration', ({ roomCode, duration }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;
        room.clipDuration = duration; // Auf dem Server speichern
        io.to(roomCode).emit('clipDurationUpdated', duration);
    });

    socket.on('updateWinLimit', ({ roomCode, limit }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;
        room.winLimit = limit; // Auf dem Server speichern
        io.to(roomCode).emit('winLimitUpdated', limit);
    });

    socket.on('syncPlay', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        // Optional: Hier prüfen, ob der Sender wirklich der aktive Spieler ist
        socket.to(roomCode).emit('onSyncPlay');
    });

    // SYNC: Video pausieren für alle im Raum
    socket.on('syncPause', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        socket.to(roomCode).emit('onSyncPause');
    });

    // 4. TIPP AUSWERTEN (WASSERDICHTE LOGIK FÜR JAHRGÄNGE 🛠️)
    // 4. TIPP AUSWERTEN (DIE WEICHE FÜR BEIDE MODI)
    socket.on('submitGuess', ({ roomCode, guessedIndex }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const currentItem = room.playlist[room.currentRound];

        if (room.gameType === "simultaneous") {
            // --- 🚀 SIMULTAN-MODUS LOGIK ---
            room.submittedGuesses[socket.id] = guessedIndex;

            const totalPlayers = room.players.length;
            const totalGuesses = Object.keys(room.submittedGuesses).length;

            if (totalGuesses >= totalPlayers) {
                const results = room.players.map(p => {
                    const pGuess = room.submittedGuesses[p.id];

                    const leftYear = pGuess >= 0 ? p.timeline[pGuess].year : -Infinity;
                    const rightYear = (pGuess + 1) < p.timeline.length ? p.timeline[pGuess + 1].year : Infinity;

                    const isCorrect = (currentItem.year >= leftYear && currentItem.year <= rightYear);

                    if (isCorrect) {
                        p.timeline.splice(pGuess + 1, 0, { ...currentItem });
                        p.score++;
                    }

                    return {
                        id: p.id,
                        name: p.name,
                        isCorrect,
                        updatedTimeline: p.timeline
                    };
                });

                // 1. ZUERST: Runde auflösen, damit alle Clients die neue Karte sehen
                io.to(roomCode).emit('simultaneousRoundResolved', {
                    title: currentItem.title,
                    year: currentItem.year,
                    players: room.players,
                    results: results,
                    winLimit: room.winLimit
                });

                // 2. DANACH: Kurz warten (z.B. 1,5 Sekunden), damit die Animation durchlaufen kann, dann auf Sieg prüfen
                setTimeout(() => {
                    const winner = room.players.find(p => p.timeline.length >= room.winLimit);
                    if (winner) {
                        io.to(roomCode).emit('gameWon', {
                            winnerName: winner.name,
                            timeline: winner.timeline
                        });
                        room.gameStarted = false;
                    }
                }, 1500); // 1500 Millisekunden Verzögerung (kannst du an deine CSS-Animation anpassen)
            } else {
                io.to(roomCode).emit('playerSubmittedStatus', Object.keys(room.submittedGuesses));
            }

        } else {
            // --- 🎬 KLASSISCHER MODUS LOGIK ---
            if (room.activePlayerIndex >= room.players.length) {
                room.activePlayerIndex = 0;
            }

            const activePlayer = room.players[room.activePlayerIndex];
            const playerTimeline = activePlayer.timeline;

            const leftYear = guessedIndex >= 0 ? playerTimeline[guessedIndex].year : -Infinity;
            const rightYear = (guessedIndex + 1) < playerTimeline.length ? playerTimeline[guessedIndex + 1].year : Infinity;

            const isCorrect = (currentItem.year >= leftYear && currentItem.year <= rightYear);

            if (isCorrect) {
                activePlayer.timeline.splice(guessedIndex + 1, 0, { ...currentItem });
                activePlayer.score++;
            }

            // 1. ZUERST: Das Runden-Ergebnis senden, damit die Karte in die Timeline rutscht
            io.to(roomCode).emit('roundResolved', {
                isCorrect,
                title: currentItem.title,
                year: currentItem.year,
                players: room.players,
                playerName: activePlayer.name,
                activePlayerId: activePlayer.id,
                updatedTimeline: playerTimeline
            });

            // 2. DANACH: Mit einer kleinen Verzögerung prüfen, ob das Spiel vorbei ist
            setTimeout(() => {
                if (activePlayer.timeline.length >= room.winLimit) {
                    io.to(roomCode).emit('gameWon', {
                        winnerName: activePlayer.name,
                        timeline: activePlayer.timeline
                    });
                    room.gameStarted = false;
                }
            }, 1500); // Gibt dem Client Zeit für die Einrast-Animation
        }
    });

    // 5. NÄCHSTE RUNDE
    socket.on('requestNextRound', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;

        room.currentRound++;

        // Sind wir am Ende der Playlist angekommen?
        if (room.currentRound >= room.playlist.length) {
            io.to(roomCode).emit('gameOver', room.players);
            delete rooms[roomCode];
            return;
        }

        // Simultan-Tipps für die neue Runde zurücksetzen!
        room.submittedGuesses = {};

        room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
        const nextMovie = room.playlist[room.currentRound];
        const activePlayer = room.players[room.activePlayerIndex];

        io.to(roomCode).emit('nextRoundStarted', {
            round: room.currentRound, // Die Runde entspricht unserem Index (startet bei 1)
            activePlayerId: activePlayer.id,
            youtubeId: nextMovie.youtubeId,
            startAt: nextMovie.startAt || 0,
            players: room.players,
            gameType: room.gameType, // Wichtig für den Client!
            winLimit: room.winLimit
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));