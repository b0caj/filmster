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
socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;

        // Dynamisch die richtige Datenbank anhand des gewählten Modus wählen
        const chosenDatabase = (room.mode === "games") ? gameDatabase : movieDatabase;

        // Playlist filtern und mischen
        room.playlist = chosenDatabase
            .filter(m => m.youtubeId && m.youtubeId.trim() !== "")
            .sort(() => Math.random() - 0.5);

        if (room.playlist.length === 0) {
            return socket.emit('errorMsg', "Die ausgewählte Datenbank hat keine spielbaren Einträge!");
        }

        room.gameStarted = true;
        room.currentRound = 0;
        room.activePlayerIndex = 0;

        // Jedem Spieler eine Startkarte geben
        room.players.forEach(p => {
            p.timeline = [room.playlist[room.currentRound]];
            room.currentRound++;
        });

        const nextItem = room.playlist[room.currentRound];
        const activePlayer = room.players[room.activePlayerIndex];

        io.to(roomCode).emit('gameStarted', {
            round: 1,
            totalRounds: room.playlist.length,
            activePlayerId: activePlayer.id,
            youtubeId: nextItem.youtubeId,
            startAt: nextItem.startAt || 0,
            players: room.players
        });
    });

    socket.on('updateGameMode', ({ roomCode, mode }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;

        room.mode = mode;
        // Alle im Raum über den neuen Modus informieren (damit sich das Dropdown bei allen ändert)
        io.to(roomCode).emit('gameModeUpdated', mode);
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
    socket.on('submitGuess', ({ roomCode, guessedIndex }) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.activePlayerIndex >= room.players.length) {
            room.activePlayerIndex = 0;
        }

        const activePlayer = room.players[room.activePlayerIndex];
        const currentItem = room.playlist[room.currentRound];
        const playerTimeline = activePlayer.timeline;

        // Mathematisch exakte Prüfung für die Zeitleiste (inkl. gleicher Jahreszahlen)
        let correctIndex = -1;
        for (let i = 0; i < playerTimeline.length; i++) {
            if (currentItem.year >= playerTimeline[i].year) {
                correctIndex = i;
            }
        }

        const isCorrect = (guessedIndex === correctIndex);

        if (isCorrect) {
            // Karte exakt an der richtigen Stelle in die Timeline schieben
            activePlayer.timeline.splice(guessedIndex + 1, 0, currentItem);
            activePlayer.score++;

            // Prüfung auf Sieg (Standard: Wer zuerst 10 Karten hat, gewinnt)
            if (activePlayer.timeline.length >= 10) {
                io.to(roomCode).emit('gameWon', {
                    winnerName: activePlayer.name,
                    timeline: activePlayer.timeline
                });
                room.gameStarted = false;
                return;
            }
        }

        // Ergebnis an alle senden (Variablen neutral benannt, damit es für Filme & Games passt)
        io.to(roomCode).emit('roundResolved', {
            isCorrect,
            title: currentItem.title,
            year: currentItem.year,
            players: room.players,
            playerName: activePlayer.name,
            activePlayerId: activePlayer.id,
            updatedTimeline: playerTimeline
        });
    });

    // 5. NÄCHSTE RUNDE
    socket.on('requestNextRound', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;

        room.currentRound++;

        if (room.currentRound >= room.playlist.length) {
            io.to(roomCode).emit('gameOver', room.players);
            delete rooms[roomCode];
            return;
        }

        room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
        const nextMovie = room.playlist[room.currentRound];
        const activePlayer = room.players[room.activePlayerIndex];

        io.to(roomCode).emit('nextRoundStarted', {
            round: room.currentRound + 1,
            activePlayerId: activePlayer.id,
            youtubeId: nextMovie.youtubeId,
            startAt: nextMovie.startAt,
            players: room.players
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));