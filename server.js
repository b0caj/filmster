const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// WICHTIG: Erlaubt dem Server, JSON-Daten von Formularen zu lesen
app.use(express.json());

// ADMIN-API: Nächsten Film ohne YouTube-ID heraussuchen
app.get('/api/admin/next-empty', (req, res) => {
    const nextMovie = movieDatabase.find(m => !m.youtubeId || m.youtubeId.trim() === "");
    if (!nextMovie) {
        return res.json({ message: "Alle Filme sind vollständig! 🎉", finished: true });
    }
    // Berechne auch kurz, wie weit wir schon sind
    const filledCount = movieDatabase.filter(m => m.youtubeId && m.youtubeId.trim() !== "").length;
    res.json({
        title: nextMovie.title,
        year: nextMovie.year,
        progress: `${filledCount} / ${movieDatabase.length}`,
        finished: false
    });
});

// ADMIN-API: Filmdaten speichern und movies.json updaten
app.post('/api/admin/update', (req, res) => {
    const { title, year, youtubeId, startAt } = req.body;
    
    // Film in der Live-Datenbank suchen
    const movie = movieDatabase.find(m => m.title === title && m.year === parseInt(year));
    
    if (!movie) return res.status(404).json({ error: "Film nicht gefunden!" });

    // Werte updaten
    movie.youtubeId = youtubeId.trim();
    movie.startAt = parseInt(startAt) || 0;

    // In die movies.json Datei auf der Festplatte schreiben
    try {
        fs.writeFileSync(path.join(__dirname, 'movies.json'), JSON.stringify(movieDatabase, null, 2), 'utf8');
        console.log(`[Admin] '${title}' erfolgreich geupdatet.`);
        res.json({ success: true });
    } catch (error) {
        console.error("Fehler beim Speichern der movies.json:", error);
        res.status(500).json({ error: "Datei-Schreibfehler!" });
    }
});

// Filmdatenbank
const fs = require('fs');
let movieDatabase = [];

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
            playlist: [...movieDatabase].sort(() => Math.random() - 0.5),
            currentRound: 0,
            activePlayerIndex: 0
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

        room.gameStarted = true;
        const currentMovie = room.playlist[room.currentRound];
        const activePlayer = room.players[room.activePlayerIndex];

        io.to(roomCode).emit('gameStarted', {
            round: room.currentRound + 1,
            totalRounds: room.playlist.length,
            activePlayerId: activePlayer.id,
            youtubeId: currentMovie.youtubeId,
            startAt: currentMovie.startAt,
            players: room.players
        });
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

    // 4. TIPP AUSWERTEN
    socket.on('submitGuess', ({ roomCode, guessedIndex }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const activePlayer = room.players[room.activePlayerIndex];
        const currentMovie = room.playlist[room.currentRound];
        const playerTimeline = activePlayer.timeline;

        let correctIndex = -1;
        for (let i = 0; i < playerTimeline.length; i++) {
            if (currentMovie.year > playerTimeline[i].year) {
                correctIndex = i;
            }
        }

        const isCorrect = (guessedIndex === correctIndex);

        if (isCorrect) {
            activePlayer.score++;
            playerTimeline.push({ title: currentMovie.title, year: currentMovie.year });
            playerTimeline.sort((a, b) => a.year - b.year);
        }

        io.to(roomCode).emit('roundResolved', {
            isCorrect,
            title: currentMovie.title,
            year: currentMovie.year,
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