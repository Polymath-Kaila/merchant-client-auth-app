/*
  models/User.js — Mongoose model for application users.
 
  WHAT THIS FILE DEFINES
  
  The shape of a "User" document saved in MongoDB. It stores:
   - Identity from Google OAuth (googleId, email, name)
   - Application-level role (merchant | client | null)
 
  WHY A USER MODEL?
  
  OAuth2 authenticates WHO the user is. Your app still needs a local record to
  remember WHAT the user can do (roles/permissions) and any domain data you add
  later (profile settings, billing, etc.).
 
  KEY DESIGN NOTES
  
  - `role` starts as null on first login so the app can ask the user to choose.
  - `email` is optional (some Google profiles hide it if scope not granted),
    so the unique index is marked `sparse` to avoid collisions on "missing" values.
  - `toJSON` transform renames `_id` -> `id` and hides internal fields for clean API responses.
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    /*
      googleId
      i
      The stable identifier Google gives for the account. We index it for fast lookups.
     */
    googleId: {
      type: String,
      index: true,
    },

    /*
      email

      - `unique: true` ensures no two users share the same email.
      - `sparse: true` allows multiple docs with NO email (null/undefined) without violating uniqueness.
      - Always stored lowercase + trimmed for consistent matching.
     */
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },

    /*
      name
     
      Display name as provided by Google (or later editable in your app).
    */
    name: {
      type: String,
      trim: true,
    },

    /*
      role
      ----
      Application-level role chosen at first login/signup:
       - "merchant" can create products
       - "client"   can browse products
       - null       means the user hasn't chosen yet (we’ll prompt)
     
      NOTE: If you later want users to hold multiple roles, introduce:
        roles: [{ type: String, enum: ['merchant', 'client'] }]
      and optionally an `activeRole` field to switch contexts like Upwork.
    */
    role: {
      type: String,
      enum: ['merchant', 'client', null],
      default: null,
    },
  },
  {
    /*
      timestamps
     
      Adds createdAt/updatedAt automatically. Super hielpful for auditing.
     */
    timestamps: true,

    /*
      toJSON / toObject
     
      - Include virtuals in outputs (e.g., computed fields)
      - Remove Mongo-specific noise (`_id`, `__v`) and expose `id` instead.
     */
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

/*
  Indexes
 
  Mongoose will also build the unique+sparse index for email from the field definition,
  but declaring it explicitly here is a clear signal of intent.
 */
UserSchema.index({ email: 1 }, { unique: true, sparse: true });

/*
  Instance helpers (nice ergonomics in controllers)

  Small convenience methods you can use like: `if (user.isMerchant()) { ... }`
 */
UserSchema.methods.isMerchant = function () {
  return this.role === 'merchant';
};
UserSchema.methods.isClient = function () {
  return this.role === 'client';
};

export default mongoose.model('User', UserSchema);
