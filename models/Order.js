const mongoose = require("mongoose");

const lineItemSchema = new mongoose.Schema(
  {
    lineItemId: String, // eBay's fulfillment-API line item id, needed to mark it shipped
    ebayItemId: String, // eBay's legacy item id (for display/reference only)
    sku: String,
    title: String,
    quantity: { type: Number, default: 1 },
    aliexpressUrl: String,
    variantId: String,
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    ownerEmail: {
      type: String,
      required: true,
      index: true,
    },
    ebayOrderId: {
      type: String,
      required: true,
      unique: true,
    },
    buyerName: String,
    addressLine1: String,
    addressLine2: String,
    city: String,
    county: String,
    postcode: String,
    countryCode: String,
    phone: String,
    lineItems: [lineItemSchema],
    status: {
      type: String,
      enum: ["NEW", "QUEUED", "ALI_ORDERED", "SHIPPED", "EXCEPTION", "CANCELLED"],
      default: "NEW",
      index: true,
    },
    aliexpressOrderId: String,
    trackingNumber: String,
    carrier: String,
    exceptionReason: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);
