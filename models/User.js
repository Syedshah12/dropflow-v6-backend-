  // models/User.js
  const mongoose = require("mongoose");

  const userSchema = new mongoose.Schema(
    {
      email: {
        type: String,
        required: true,
        unique: true,
      },
      password: {
        type: String,
        required: true,
      },
      deviceId: {
        type: String,
        default: null,
      },
      isDeviceLocked: {
        type: Boolean,
        default: false,
      },
      ebayAccessToken: {
        type: String,
        default: null,
      },
      ebayRefreshToken: {
        type: String,
        default: null,
      },
      ebayAccessTokenExpiry: {
        type: Date,
        default: null,
      },
      ebayConnected: {
        type: Boolean,
        default: false,
      },
    },
    { timestamps: true }
  );


  // ⚠️ IMPORTANT: export MODEL, not schema
  module.exports = mongoose.model("User", userSchema);