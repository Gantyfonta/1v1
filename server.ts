import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

// Simple memory-based storage
let highscores = [
    { userName: "Speedy", time: 45000, createdAt: new Date() },
    { userName: "ProGamer", time: 52000, createdAt: new Date() },
    { userName: "Newbie", time: 120000, createdAt: new Date() }
];

let globalAnnouncement = {
    message: "Neutralize the Core. Good luck, Commander.",
    active: true,
    createdAt: new Date()
};

// Highscore Endpoints
app.get('/api/highscores', (req, res) => {
    const sorted = [...highscores].sort((a, b) => a.time - b.time);
    res.json(sorted);
});

app.post('/api/highscores', (req, res) => {
    const { userName, time } = req.body;
    if (!userName || typeof time !== 'number') {
        return res.status(400).json({ error: "Invalid data" });
    }
    const newScore = { userName, time, createdAt: new Date() };
    highscores.push(newScore);
    res.status(201).json(newScore);
});

app.delete('/api/highscores/:index', (req, res) => {
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0 || index >= highscores.length) {
        return res.status(400).json({ error: "Invalid index" });
    }
    highscores.splice(index, 1);
    res.json({ success: true });
});

// Announcement Endpoints
app.get('/api/announcement', (req, res) => {
    res.json(globalAnnouncement);
});

app.post('/api/announcement', (req, res) => {
    const { message, active } = req.body;
    globalAnnouncement = {
        message,
        active: active !== undefined ? active : true,
        createdAt: new Date()
    };
    res.json(globalAnnouncement);
});

app.delete('/api/announcement', (req, res) => {
    globalAnnouncement = { message: "", active: false, createdAt: new Date() };
    res.json(globalAnnouncement);
});

// Fallback for the editor or other html files if needed
app.get('/editor', (req, res) => {
    res.sendFile(path.join(__dirname, 'editor.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
});
