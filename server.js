const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const cloudinary = require('cloudinary').v2;
const session = require('express-session');
const cookieParser = require('cookie-parser');
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));
app.use(cookieParser());
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

let params = { pID: '1022898', wnr: '92117' };
const PASSWORD = process.env.PASSWORD || '1234'; // Use environment variable or default

const wss = new WebSocket.Server({ noServer: true });

async function loadImages() {
    try {
        const resources = await cloudinary.api.resources({ type: 'upload', prefix: 'uploads/' });
        console.log('Loaded images:', resources.resources);
        return resources.resources.map(resource => resource.secure_url);
    } catch (error) {
        console.error('Error loading images:', error);
        return [];
    }
}

function broadcast(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

app.get('/images', async (req, res) => {
    try {
        const images = await loadImages();
        res.json(images);
    } catch (error) {
        res.status(500).send('Error fetching images');
    }
});

app.post('/upload', upload.single('image'), async (req, res) => {
    try {
        const result = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream({ folder: 'uploads' }, (error, result) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            }).end(req.file.buffer);
        });
        console.log('Uploaded image:', result);
        broadcast('refresh');
        res.json(result.secure_url);
    } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).send('Error uploading image');
    }
});

app.delete('/images/:public_id', async (req, res) => {
    try {
        console.log('Deleting image:', req.params.public_id);
        await cloudinary.uploader.destroy(`uploads/${req.params.public_id}`);
        broadcast('refresh');
        res.json(await loadImages());
    } catch (error) {
        console.error('Error deleting image:', error);
        res.status(500).send('Error deleting image');
    }
});

app.post('/images/move', async (req, res) => {
    try {
        // Cloudinary does not support reordering images directly
        broadcast('refresh');
        res.json(await loadImages());
    } catch (error) {
        console.error('Error moving image:', error);
        res.status(500).send('Error moving image');
    }
});

app.post('/update-params', (req, res) => {
    try {
        params = req.body;
        broadcast('refresh');
        res.json(params);
    } catch (error) {
        console.error('Error updating params:', error);
        res.status(500).send('Error updating params');
    }
});

app.get('/params', (req, res) => {
    res.json(params);
});

app.post('/authenticate', (req, res) => {
    const { password } = req.body;
    if (password === PASSWORD) {
        req.session.authenticated = true;
        res.json({ authenticated: true });
    } else {
        res.json({ authenticated: false });
    }
});

app.get('/check-auth', (req, res) => {
    if (req.session.authenticated) {
        res.json({ authenticated: true });
    } else {
        res.json({ authenticated: false });
    }
});

// Serve the management page
app.get('/manage', (req, res) => {
    res.sendFile(path.join(__dirname, 'manage.html'));
});

// Serve the display page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'display.html'));
});

const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, socket => {
        wss.emit('connection', socket, request);
    });
});