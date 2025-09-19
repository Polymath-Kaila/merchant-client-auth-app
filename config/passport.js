/*
  config/passport.js — Google OAuth 2.0 strategy configuration for Passport.
 
  HOW THIS FILE IS USED
  
    server.js imports this file for its SIDE EFFECTS only:
      import './config/passport.js';
    That means we don't export anything—just configure Passport here.
 
  WHAT THIS FILE DOES
  
  1) Registers `serializeUser` and `deserializeUser` to store a small session
     identifier in the cookie (the MongoDB _id of the user).
  2) Configures the Google OAuth 2.0 Strategy:
     - When Google redirects back to us, we look up or create the user record.
     - We leave `role` as null on first login so the app can ask the user to
       choose `merchant` or `client` (the Upwork-style step).
 
  PREREQUISITES
  
  - Ensure these env vars are set (e.g., in your .env file):
      GOOGLE_CLIENT_ID=...
      GOOGLE_CLIENT_SECRET=...
      GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
  - The `User` model must exist (see models/User.js).
 */

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';

/* 
  1) SESSION SERIALIZATION
  
  Passport uses these to store and retrieve the logged-in user from the session.
  - serializeUser: choose WHAT to store in the cookie-based session (kept small)
  - deserializeUser: given that ID, fetch the full user from the DB for req.user
*/

passport.serializeUser((user, done) => {
  // Store only the MongoDB ObjectId in the session to keep cookies small.
  // `user.id` is a Mongoose shortcut for `user._id.toString()`.
  
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    // Fetch the full user object for each incoming request that has a session.
    const u = await User.findById(id);
    done(null, u || false); // if user not found, pass false (logged out)
  } catch (err) {
    done(err);
  }
});

/*
  2) GOOGLE OAUTH 2.0 STRATEGY
  
  When the user clicks "Log in with Google", Passport will:
    A) Redirect them to Google (scopes: profile + email configured at the route)
    B) After consent, Google calls our callback URL with an auth code
    C) Passport exchanges the code for tokens and calls this verify callback
 
  In this verify callback we:
    - Extract primary email & name from the Google profile
    - Look up a user by googleId (or fallback by email to "link" accounts)
    - Create a new user if none exists yet
    - DO NOT set a role here—let the app ask the user on first login
*/

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK_URL,
} = process.env;

// Guard against missing configuration (will throw here otherwise)
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
  // We warn loudly so you know what's wrong during development.
  // Without these, starting Google OAuth will fail.
  console.warn(
    '  Google OAuth env vars missing. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL.'
  );
}

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_CALLBACK_URL,

      /*
        passReqToCallback (false by default):
        - If set to true, we would receive (req, accessToken, refreshToken, profile, done)
        - Not needed for this demo, so we keep it default/false.
     */
    },

    /*
      VERIFY CALLBACK
      
      This function is called by Passport after Google has authenticated the user.
      We get tokens (unused here), and the user's Google profile.
      Our job is to find or create a local user record, then call `done(null, user)`.
    */
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        // Primary email (if consented). We request 'email' scope at the route level.
        const email =
          profile.emails && profile.emails[0] && profile.emails[0].value
            ? profile.emails[0].value.toLowerCase()
            : undefined;

        // Some users may hide email or you might forget to request the scope.
        // For a production app, handle the case where `email` is undefined.
        // This demo assumes you requested 'email' and it is present.

        // Try to find a user by Google ID first (fast path).
        let user = await User.findOne({ googleId: profile.id });

        // If not found by googleId, try "linking" by email (in case they signed up locally earlier).
        if (!user && email) {
          user = await User.findOne({ email });
          if (user) {
            // Link this Google account to the existing email-based account.
            user.googleId = profile.id;
            await user.save();
          }
        }

        // If still not found, create a brand new user.
        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email: email, // may be undefined if not provided
            name: profile.displayName || 'Google User',
            role: null,   // <-- We want the app to ask: merchant or client?
          });
        }

        // Hand off to Passport—this becomes req.user (and gets serialized)
        return done(null, user);
      } catch (err) {
        // Any DB errors, etc.
        return done(err);
      }
    }
  )
);

/*
  NOTE ON SCOPES

  We do NOT specify scopes here. Instead, we request them in the route:
    passport.authenticate('google', { scope: ['profile', 'email'] })
  Keeping scopes at the route makes it explicit per-entrypoint, which is a
  common practice (you might have different routes with different scopes).
 */

/* 
  THAT'S IT.
 
   No exports. The act of importing this file configures Passport globally.
   From now on, server.js can mount routes that call:
      passport.authenticate('google', ...);
    and they'll use this strategy.
*/
