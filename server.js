const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const cloudinary = require('cloudinary').v2;
const session = require('express-session');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:", "http:"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'", "ws:", "wss:"],
            frameSrc: ["'self'", "https://www.nttb-ranglijsten.nl"]
        }
    }
}));

// CORS configuration
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Upload rate limiting (more restrictive)
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit uploads to 10 per 15 minutes
    message: 'Too many uploads from this IP, please try again later.'
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_secret_key_change_in_production',
    resave: false,
    saveUninitialized: false, // Changed to false for better security
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        httpOnly: true, // Prevent XSS attacks
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Configuration validation
const requiredEnvVars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    console.error('Please set these environment variables and restart the application.');
    process.exit(1);
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer configuration with file size and type validation
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1
    },
    fileFilter: (req, file, cb) => {
        // Check if file is an image
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Default parameters with validation
let params = { 
    pID: process.env.DEFAULT_PID || '1023540', 
    wnr: process.env.DEFAULT_WNR || '92113' 
};
const PASSWORD = process.env.PASSWORD || '1234'; // Use environment variable or default

// Image order storage (in production, this should be in a database)
let imageOrder = []; // Array of public_ids in display order

// Input validation functions
function validateParams(pID, wnr) {
    const pIDRegex = /^\d+$/;
    const wnrRegex = /^\d+$/;
    return pIDRegex.test(pID) && wnrRegex.test(wnr);
}

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
}

const wss = new WebSocket.Server({ noServer: true });

// WebSocket connection tracking
const wsClients = new Set();

wss.on('connection', (ws) => {
    wsClients.add(ws);
    console.log('New WebSocket connection established');
    
    ws.on('close', () => {
        wsClients.delete(ws);
        console.log('WebSocket connection closed');
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        wsClients.delete(ws);
    });
});

async function loadImages() {
    try {
        const resources = await cloudinary.api.resources({ 
            type: 'upload', 
            prefix: 'uploads/',
            max_results: 500 // Limit results for performance
        });
        console.log(`Loaded ${resources.resources.length} images from Cloudinary`);
        
        const images = resources.resources.map(resource => ({
            url: resource.secure_url,
            public_id: resource.public_id.replace('uploads/', '')
        }));
        
        // Apply custom ordering if exists
        if (imageOrder.length > 0) {
            const orderedImages = [];
            const imageMap = new Map(images.map(img => [img.public_id, img]));
            
            // Add images in the specified order
            imageOrder.forEach(publicId => {
                if (imageMap.has(publicId)) {
                    orderedImages.push(imageMap.get(publicId));
                    imageMap.delete(publicId);
                }
            });
            
            // Add any new images that aren't in the order yet
            imageMap.forEach(image => {
                orderedImages.push(image);
                imageOrder.push(image.public_id); // Add to order for next time
            });
            
            console.log(`Applied custom ordering: ${imageOrder.join(', ')}`);
            return orderedImages;
        }
        
        // No custom order, initialize order array
        imageOrder = images.map(img => img.public_id);
        return images;
    } catch (error) {
        console.error('Error loading images:', error);
        throw new Error('Failed to load images from Cloudinary');
    }
}

function broadcast(message) {
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (error) {
                console.error('Error broadcasting to client:', error);
                wsClients.delete(client);
            }
        }
    });
}

// Routes
app.get('/images', async (req, res) => {
    try {
        const images = await loadImages();
        res.json(images);
    } catch (error) {
        console.error('Error fetching images:', error);
        res.status(500).json({ error: 'Error fetching images' });
    }
});

app.post('/upload', uploadLimiter, requireAuth, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const result = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                { 
                    folder: 'uploads',
                    quality: 'auto',
                    fetch_format: 'auto'
                }, 
                (error, result) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(result);
                    }
                }
            ).end(req.file.buffer);
        });
        
        const cleanPublicId = result.public_id.replace('uploads/', '');
        console.log('Uploaded image:', cleanPublicId);
        
        // Add to image order (at the end by default)
        if (!imageOrder.includes(cleanPublicId)) {
            imageOrder.push(cleanPublicId);
            console.log(`Added ${cleanPublicId} to image order`);
        }
        
        broadcast('refresh');
        res.json({ 
            url: result.secure_url,
            public_id: cleanPublicId
        });
    } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).json({ error: 'Error uploading image' });
    }
});

app.delete('/images/:public_id', requireAuth, async (req, res) => {
    try {
        const publicId = req.params.public_id;
        if (!publicId || !/^[a-zA-Z0-9_-]+$/.test(publicId)) {
            return res.status(400).json({ error: 'Invalid public_id' });
        }

        console.log('Deleting image:', publicId);
        await cloudinary.uploader.destroy(`uploads/${publicId}`);
        
        // Remove from image order
        const index = imageOrder.indexOf(publicId);
        if (index > -1) {
            imageOrder.splice(index, 1);
            console.log(`Removed ${publicId} from image order`);
        }
        
        broadcast('refresh');
        const images = await loadImages();
        res.json(images);
    } catch (error) {
        console.error('Error deleting image:', error);
        res.status(500).json({ error: 'Error deleting image' });
    }
});

app.post('/images/move', requireAuth, async (req, res) => {
    try {
        const { fromIndex, toIndex } = req.body;
        
        if (typeof fromIndex !== 'number' || typeof toIndex !== 'number') {
            return res.status(400).json({ error: 'fromIndex and toIndex must be numbers' });
        }
        
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= imageOrder.length || toIndex >= imageOrder.length) {
            return res.status(400).json({ error: 'Invalid index values' });
        }
        
        // Move the item in the order array
        const [movedItem] = imageOrder.splice(fromIndex, 1);
        imageOrder.splice(toIndex, 0, movedItem);
        
        console.log(`Moved image from position ${fromIndex} to ${toIndex}`);
        console.log(`New order: ${imageOrder.join(', ')}`);
        
        // Broadcast to all connected clients
        broadcast('refresh');
        
        // Return the reordered images
        const images = await loadImages();
        res.json(images);
    } catch (error) {
        console.error('Error moving image:', error);
        res.status(500).json({ error: 'Error moving image' });
    }
});

app.post('/update-params', requireAuth, (req, res) => {
    try {
        const { pID, wnr } = req.body;
        
        if (!pID || !wnr) {
            return res.status(400).json({ error: 'pID and wnr are required' });
        }
        
        if (!validateParams(pID, wnr)) {
            return res.status(400).json({ error: 'Invalid pID or wnr format. Only numbers are allowed.' });
        }
        
        params = { pID: pID.toString(), wnr: wnr.toString() };
        console.log('Updated params:', params);
        broadcast('refresh');
        res.json(params);
    } catch (error) {
        console.error('Error updating params:', error);
        res.status(500).json({ error: 'Error updating params' });
    }
});

app.get('/params', (req, res) => {
    res.json(params);
});

app.post('/authenticate', (req, res) => {
    try {
        const { password } = req.body;
        
        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }
        
        if (password === PASSWORD) {
            req.session.authenticated = true;
            console.log('Successful authentication');
            res.json({ authenticated: true });
        } else {
            console.log('Failed authentication attempt');
            res.status(401).json({ authenticated: false, error: 'Invalid password' });
        }
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/check-auth', (req, res) => {
    try {
        if (req.session.authenticated) {
            res.json({ authenticated: true });
        } else {
            res.json({ authenticated: false });
        }
    } catch (error) {
        console.error('Auth check error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/logout', (req, res) => {
    try {
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session:', err);
                return res.status(500).json({ error: 'Error logging out' });
            }
            res.json({ success: true });
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve the management page
app.get('/manage', (req, res) => {
    try {
        res.sendFile(path.join(__dirname, 'manage.html'));
    } catch (error) {
        console.error('Error serving manage page:', error);
        res.status(500).send('Error loading management page');
    }
});

// Serve the display page
app.get('/', (req, res) => {
    try {
        res.sendFile(path.join(__dirname, 'display.html'));
    } catch (error) {
        console.error('Error serving display page:', error);
        res.status(500).send('Error loading display page');
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: 'File upload error' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('HTTP server closed');
        wss.close(() => {
            console.log('WebSocket server closed');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('HTTP server closed');
        wss.close(() => {
            console.log('WebSocket server closed');
            process.exit(0);
        });
    });
});

server.on('upgrade', (request, socket, head) => {
    try {
        wss.handleUpgrade(request, socket, head, socket => {
            wss.emit('connection', socket, request);
        });
    } catch (error) {
        console.error('WebSocket upgrade error:', error);
        socket.destroy();
    }
});