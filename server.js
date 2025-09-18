/*

  What this server does:
   1) Connects to MongoDB (for Users/Products).
   2) Configures core Express middlewares (logging, JSON parsing, CORS, cookies, sessions).
   3) Initializes Passport (Google OAuth 2.0) via a side-effect import of ./config/passport.js.
   4) Mounts routes for authentication (/auth) and product APIs (/products).
   5) Exposes simple health and root endpoints.
   6) Starts the HTTP server and handles graceful shutdown.
 */

//   1) IMPORTS
 

import 'dotenv/config.js';           // Loads variables from .env into process.env at startup
import express from 'express';       // Web framework
import morgan from 'morgan';         // Dev-friendly request logger
import cors from 'cors';             // Cross-Origin Resource Sharing (frontend <-> backend)
import cookieParser from 'cookie-parser';   // Parses cookies into req.cookies
import session from 'express-session';      // Server-side sessions (required by Passport's login session)
import mongoose from 'mongoose';     // MongoDB ODM
import passport from 'passport';     // Authentication framework

// Side-effect import: sets up Google OAuth2 strategy, serialize/deserialize, etc.
//serialize means to convert from json to strin g and deserialize means to convert from string to json
import './config/passport.js';

// Route modules (organized separately for clarity; keep server.js as the "wiring" file)
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';



 //  2) ENVIRONMENT & CONFIG
 

// Pull values from process.env with sensible defaults for local dev
//These are environment variables that can be set in a .env file or in the deployment environment.
const {
  PORT = '3000',
  NODE_ENV = 'development',
  BASE_URL = 'http://localhost:3000',

  // Mongo
  MONGO_URI = 'mongodb://localhost:27017/merchant_client_demo',

  // Sessions/JWT (JWT used inside middleware/auth.js; session secret is for express-session)
  SESSION_SECRET,

  // OAuth2 (consumed by ./config/passport.js)
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK_URL = `${BASE_URL}/auth/google/callback`,
} = process.env;

// Minimal safety checks that help us catch misconfiguration early
if (!SESSION_SECRET) {
  console.warn(' SESSION_SECRET is not set. Define it in .env for proper session security.');
}
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.warn(' Google OAuth credentials are missing. Login via /auth/google will fail until set.');
}



 // 3) DATABASE CONNECTION

// Connect to MongoDB. We do not block server startup if it’s slow; we log state.
mongoose
  .connect(MONGO_URI, { dbName: 'merchant_client_demo' })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => {
    console.error(' MongoDB connection error:', err.message); // Log the error but continue starting the server.
    // You can `process.exit(1)` here if you prefer hard-fail on missing DB.
  });



 //  4) EXPRESS APP & MIDDLEWARES
 

const app = express();

// Helpful trust proxy if you later deploy behind a reverse proxy (e.g., Nginx, Render, Fly, Railway)
// app.set('trust proxy', 1);

// Log every request like: "GET /products 200 8.123 ms - 123"
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// CORS allows your browser-based frontend to call this API from another origin.
// Here we allow credentials so browser can send cookies if needed.
app.use(
  cors({
    origin: true,              // In dev, reflect request origin. For production, set to your exact frontend URL.
    credentials: true,         // Allow cookies/authorization headers to be sent
  })
);

// Parse JSON and URL-encoded bodies into req.body
//req.body contains the parsed body of the request, which can be in JSON or URL-encoded format.
//req.body is commonly used to access data sent by the client in POST or PUT requests, and send it to the backend for processing.
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

// Parse cookies (useful for session, CSRF tokens, etc.)
//CSRF (Cross-Site Request Forgery) tokens are used to protect against CSRF attacks by ensuring that requests made to the server are legitimate and originate from the authenticated user.
//By parsing cookies, the server can access and validate CSRF tokens stored in cookies, enhancing the security of the application.
//In this code, cookieParser middleware is used to parse cookies from incoming requests, allowing the server to access and validate CSRF tokens stored in cookies for enhanced security.
app.use(cookieParser());

/**
  express-session:
  - Required by Passport when you want login "sessions" (so req.user exists across requests after OAuth).
  - Stores a session ID in a signed cookie sent to the browser.
  - In production, you should use a persistent store (e.g., connect-mongo) instead of the default MemoryStore.
 */
app.use(
  session({
    secret: SESSION_SECRET || 'dev_insecure_secret_change_me',
    resave: false,             // Don’t save session if unmodified
    saveUninitialized: false,  // Don’t create session until something stored
    cookie: {
      httpOnly: true,          // JS on the page can’t read the cookie (mitigates XSS)
      secure: false,           // Set true if you serve over HTTPS (required in production with HTTPS)
      sameSite: 'lax',         // CSRF protection tradeoff; adjust to your app needs
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
    },
  })
);

// Initialize Passport (adds req.login, req.logout, etc.)
app.use(passport.initialize());

// If you want login sessions (so req.user persists across HTTP requests), enable session support:
app.use(passport.session());



 //  5) ROUTES


/*
  Root endpoint: quick smoke-test and helpful meta response.
  Hitting GET / should return a JSON payload confirming the server runs.
 */
app.get('/', (req, res) => {
  res.json({
    ok: true,
    env: NODE_ENV,
    now: new Date().toISOString(),
    message: 'Merchant/Client OAuth2 RBAC demo is running ',
    docs: {
      health: '/health',
      auth_google: '/auth/google',
      products_list: '/products',
      products_create: 'POST /products (merchant role + Bearer JWT)',
    },
  });
});

/*
  Health endpoint:
  Often used by orchestration/monitoring (Docker, Kubernetes, UptimeRobot, etc.).
  Returns process uptime and a quick DB connectivity hint.
 */
app.get('/health', async (_req, res) => {
  const dbState = mongoose.connection.readyState; // 0=disconnected 1=connected 2=connecting 3=disconnecting
  res.status(200).json({
    status: 'ok',
    uptime_seconds: process.uptime().toFixed(2),
    db_connected: dbState === 1,
    db_state: dbState,
  });
});

// Mount feature modules. These files encapsulate business logic and controllers.
// - /auth handles OAuth2 login, role selection, and token issuing.
// - /products demonstrates RBAC-protected and public routes.
app.use('/auth', authRoutes); 
app.use('/products', productRoutes);



 //  6) NOT-FOUND & ERROR HANDLING
 

// 404 handler (for any route not matched above)
app.use((req, res, _next) => {
  res.status(404).json({
    error: 'Not Found',
    method: req.method,
    path: req.originalUrl, // The original URL requested by the client
  });
});

// Centralized error handler (Express detects functions with (err, req, res, next) signature)
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});



 //  7) START SERVER
 

const port = Number(PORT) || 3000;

const server = app.listen(port, () => {
  console.log(`\n Server running at ${BASE_URL || `http://localhost:${port}`}`);
  console.log(`   - Env: ${NODE_ENV}`);
  console.log(`   - Try: ${BASE_URL || `http://localhost:${port}`}/auth/google`);
});



 //  8) GRACEFUL SHUTDOWN

 // Close the HTTP server and DB connection on process signals to avoid dangling resources.
 

const shutdown = async (signal) => {
  try {
    console.log(`\n Received ${signal}. Shutting down gracefully...`);
    server.close(() => console.log('HTTP server closed.'));
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
  } catch (e) {
    console.error('Error during shutdown:', e);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C
process.on('SIGTERM', () => shutdown('SIGTERM')); // e.g., from orchestrator
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
