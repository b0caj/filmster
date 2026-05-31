const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// Filmdatenbank
const movieDatabase = [
    { title: "Star Wars", year: 1977, youtubeId: "4wvpdBnfiZo", startAt: 5 },
    { title: "König der Löwen", year: 1994, youtubeId: "GibiNy4d4gc", startAt: 0 },
    { title: "Game of Thrones", year: 2011, youtubeId: "TZE9gVF1QbA", startAt: 0 },
    { title: "Stranger Things", year: 2016, youtubeId: "b9EkMc79ZSU", startAt: 0 }
];

const rooms = {};

// Funktion, um jedem Spieler zwei unterschiedliche Start-Filme zu geben
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
                timeline: createInitialTimeline() // Eigene Timeline für den Host
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
            timeline: createInitialTimeline() // Eigene Timeline für den neuen Spieler
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

    // 4. TIPP AUSWERTEN (Echte Logik basierend auf der Timeline des Spielers!)
    socket.on('submitGuess', ({ roomCode, guessedIndex }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const activePlayer = room.players[room.activePlayerIndex];
        const currentMovie = room.playlist[room.currentRound];
        const playerTimeline = activePlayer.timeline;

        // Mathematische Prüfung: Wo muss der neue Film in der Timeline des Spielers landen?
        let correctIndex = -1;
        for (let i = 0; i < playerTimeline.length; i++) {
            if (currentMovie.year > playerTimeline[i].year) {
                correctIndex = i;
            }
        }

        const isCorrect = (guessedIndex === correctIndex);

        if (isCorrect) {
            activePlayer.score++;
            // Nur wenn es richtig war, wird der Film fest in die Timeline des Spielers eingetragen
            playerTimeline.push({ title: currentMovie.title, year: currentMovie.year });
            playerTimeline.sort((a, b) => a.year - b.year);
        }

        // Ergebnis an alle senden, inklusive der aktualisierten Spielerdaten
        io.to(roomCode).emit('roundResolved', {
            isCorrect,
            title: currentMovie.title,
            year: currentMovie.year,
            players: room.players,
            playerName: activePlayer.name,
            activePlayerId: activePlayer.id,
            updatedTimeline: playerTimeline // Schickt die neue Timeline zurück
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