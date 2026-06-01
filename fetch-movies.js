const fs = require('fs');
const path = require('path');

// ==========================================
// HIER DEINEN TMDB API-KEY REINKOPIEREN!
// ==========================================
const API_KEY = "f8ad9f5d1827f009612603f7bd11e603"; 

const TARGET_FILE = path.join(__dirname, 'movies.json');
let allMedia = [];

async function fetchFromTMDB(endpoint, queryParams, page) {
    const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${API_KEY}&language=de-DE&page=${page}&${queryParams}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Fehler: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error(`Fehler beim Abrufen von Seite ${page}:`, error);
        return null;
    }
}

async function startImport() {
    console.log("🎬 Starte optimierten TMDB-Datenimport (Fokus auf Klassiker & Blockbuster)...");

    // FILTER FÜR FILME: 
    // - Sortiert nach der Anzahl der Stimmen (Garantie für bekannte Filme)
    // - Mindestens 800 Stimmen (schließt Indie-/Auslands-Nischen aus)
    // - Erstveröffentlichung vor dem aktuellen Jahr (keine unfertigen 2026+ Filme)
    const movieFilters = "sort_by=vote_count.desc&vote_count.gte=800&release_date.lte=2025-12-31&with_original_language=en|de|fr|es";
    
    console.log("⏳ Lade die 700 bekanntesten Blockbuster herunter...");
    for (let page = 1; page <= 35; page++) {
        const data = await fetchFromTMDB('discover/movie', movieFilters, page);
        if (data && data.results) {
            data.results.forEach(item => {
                if (item.title && item.release_date) {
                    const year = new Date(item.release_date).getFullYear();
                    if (!isNaN(year) && year <= 2025) {
                        allMedia.push({
                            title: item.title,
                            year: year,
                            youtubeId: "", 
                            startAt: 0
                        });
                    }
                }
            });
        }
    }

    // FILTER FÜR SERIEN:
    // - Sortiert nach Stimmenanzahl
    // - Mindestens 150 Stimmen (Serien haben generell weniger Bewertungen auf TMDB als Filme)
    const tvFilters = "sort_by=vote_count.desc&vote_count.gte=150&first_air_date.lte=2025-12-31&with_original_language=en|de";

    console.log("⏳ Lade die 300 bekanntesten Serien herunter...");
    for (let page = 1; page <= 15; page++) {
        const data = await fetchFromTMDB('discover/tv', tvFilters, page);
        if (data && data.results) {
            data.results.forEach(item => {
                if (item.name && item.first_air_date) {
                    const year = new Date(item.first_air_date).getFullYear();
                    if (!isNaN(year) && year <= 2025) {
                        allMedia.push({
                            title: item.name,
                            year: year,
                            youtubeId: "",
                            startAt: 0
                        });
                    }
                }
            });
        }
    }

    // Doppelte Einträge filtern
    const uniqueMedia = Array.from(new Set(allMedia.map(m => JSON.stringify(m)))).map(s => JSON.parse(s));

    // Liste mischen, damit die Top 10 nicht direkt hintereinander hängen
    uniqueMedia.sort(() => Math.random() - 0.5);

    try {
        fs.writeFileSync(TARGET_FILE, JSON.stringify(uniqueMedia, null, 2), 'utf8');
        console.log(`✅ Fertig! Insgesamt ${uniqueMedia.length} perfekt vorsortierte Blockbuster & Serien in 'movies.json' gespeichert!`);
    } catch (err) {
        console.error("Fehler beim Schreiben der Datei:", err);
    }
}

if (API_KEY === "DEIN_TMDB_API_KEY_HIER_EINSETZEN") {
    console.error("❌ Bitte trage zuerst deinen echten TMDB API-Key ein!");
} else {
    startImport();
}