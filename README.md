# Live Score Smash

A live score overlay application with image management and real-time updates via WebSockets.

## Features

- Live score display with customizable parameters
- Image upload and management via Cloudinary
- Real-time updates using WebSockets
- Authentication system for management access
- Rate limiting and security features

## Security Improvements

- **Helmet.js**: Security headers for XSS, clickjacking protection
- **CORS**: Configurable cross-origin resource sharing
- **Rate Limiting**: Protection against abuse and DDoS
- **Input Validation**: Proper validation for all inputs
- **Session Security**: Secure session configuration
- **Environment Variables**: All sensitive data in environment variables

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Configuration**
   - Copy `.env.example` to `.env`
   - Fill in your Cloudinary credentials
   - Set a strong password and session secret

3. **Required Environment Variables**
   ```
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   PASSWORD=your_secure_password
   SESSION_SECRET=your_very_secure_session_secret
   ```

4. **Start the Application**
   ```bash
   npm start
   ```
   
   For development with auto-restart:
   ```bash
   npm run dev
   ```

## API Endpoints

### Public Endpoints
- `GET /` - Display page
- `GET /params` - Get current parameters
- `GET /images` - Get all images
- `GET /health` - Health check
- `POST /authenticate` - Login

### Protected Endpoints (require authentication)
- `GET /manage` - Management page
- `POST /upload` - Upload image
- `DELETE /images/:public_id` - Delete image
- `POST /update-params` - Update parameters
- `POST /logout` - Logout

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLOUDINARY_CLOUD_NAME` | Yes | - | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Yes | - | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Yes | - | Cloudinary API secret |
| `PORT` | No | 3000 | Server port |
| `NODE_ENV` | No | development | Environment |
| `PASSWORD` | No | 1234 | Admin password |
| `SESSION_SECRET` | No | - | Session secret key |
| `DEFAULT_PID` | No | 1023506 | Default player ID |
| `DEFAULT_WNR` | No | 92204 | Default winner ID |
| `ALLOWED_ORIGINS` | No | - | CORS allowed origins |

### Rate Limiting

- General requests: 100 per 15 minutes per IP
- Upload requests: 10 per 15 minutes per IP

### File Upload

- Maximum file size: 10MB
- Allowed types: Images only
- Storage: Cloudinary cloud storage

## Security Features

1. **Input Validation**: All inputs are validated and sanitized
2. **Authentication**: Session-based authentication for admin functions
3. **Rate Limiting**: Prevents abuse and DDoS attacks
4. **CORS Protection**: Configurable cross-origin policies
5. **Security Headers**: Helmet.js for security headers
6. **Error Handling**: Comprehensive error handling with proper status codes

## WebSocket Events

- `refresh` - Triggers clients to reload parameters and images

## Production Deployment

1. Set `NODE_ENV=production`
2. Use a strong `SESSION_SECRET`
3. Configure HTTPS for secure cookies
4. Set appropriate `ALLOWED_ORIGINS` for CORS
5. Consider using a reverse proxy (nginx)
6. Monitor logs and set up proper logging

## Troubleshooting

### Common Issues

1. **Missing Environment Variables**: Check that all required environment variables are set
2. **Cloudinary Issues**: Verify your Cloudinary credentials
3. **Upload Failures**: Check file size (max 10MB) and file type (images only)
4. **WebSocket Connection Issues**: Ensure your reverse proxy supports WebSocket upgrades

### Logs

The application logs important events including:
- Authentication attempts
- File uploads/deletions
- WebSocket connections
- Errors and exceptions
