const mongoose = require("mongoose");

const skuMapSchema = new mongoose.Schema(
  {
    ownerEmail: {
      type: String,
      required: true,
      index: true,
    },
    ebaySku: {
      type: String,
      required: true,
    },
    aliexpressUrl: {
      type: String,
      required: true,
    },
    variantId: String,
    notes: String,
  },
  { timestamps: true }
);

skuMapSchema.index({ ownerEmail: 1, ebaySku: 1 }, { unique: true });

module.exports = mongoose.model("SkuMap", skuMapSchema);
