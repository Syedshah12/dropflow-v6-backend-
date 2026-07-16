// models/UserOrder.js

const mongoose = require("mongoose");

const userOrderSchema = new mongoose.Schema(
  {

    email: {
      type: String,
      required: true,
      unique: true,
    },

    orderCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserOrder", userOrderSchema);