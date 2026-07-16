const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

require("dotenv").config();


const User = require("./models/User");
const UserOrder = require("./models/UserOrder");
const Order = require("./models/Order");
const SkuMap = require("./models/SkuMap");
const requireAuth = require("./middleware/auth");
const ebayService = require("./services/ebay");
const app = express();

app.use(cors());
app.use(express.json());
console.log(process.env.MONGO_URI);
// Connect DB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// DELETE USER API
app.delete("/api/delete-user/:id", requireAuth, async (req, res) => {
  try {

    const { id } = req.params;

    // Find user first
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // Store email before deleting
    const userEmail = user.email;

    // Delete user
    await User.findByIdAndDelete(id);

    // Delete related order data
    await UserOrder.deleteMany({
      email: userEmail,
    });

    res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });

  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// REGISTER
app.post("/api/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      email,
      password: hashedPassword,
    });

    await user.save();

    res.status(201).json({ message: "User registered successfully" });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// LOGIN WITH DEVICE LOCK
app.post("/api/login", async (req, res) => {

  try {
    const { email, password, deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ message: "Device ID required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // 🔐 DEVICE LOCK LOGIC
    if (!user.deviceId) {
      // First login → lock device
      user.deviceId = deviceId;
      await user.save();
    } else {
      // Already locked → check device
      if (user.deviceId !== deviceId) {
        return res.status(403).json({
          message: "Account already in use on another device"
        });
      }
    }

    const token = jwt.sign(
      { id: user._id,   email: user.email, },
     
      process.env.JWT_SECRET,
{ expiresIn: "1d" }

    );

    res.json({
      message: "Login successful",
      token
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET ALL USERS WITH ORDER DETAILS
app.get("/api/users-with-orders", requireAuth, async (req, res) => {
  try {

    // Fetch all registered users
    const users = await User.find().lean();

    // Fetch all order counters
    const orderUsers = await UserOrder.find().lean();

    // Convert order data into map for fast lookup
    const orderMap = {};

    orderUsers.forEach((item) => {
      orderMap[item.email] = item;
    });

    // Merge data
    const finalUsers = users.map((user) => {

      const orderData = orderMap[user.email];

      return {
        _id: user._id,

        email: user.email,

        deviceId: user.deviceId,

        isDeviceLocked: user.isDeviceLocked,

        createdAt: user.createdAt,

        updatedAt: user.updatedAt,

        // Order details
        orderCount: orderData?.orderCount || 0,

        lastOrderPlaced:
          orderData?.updatedAt || null,
      };
    });

    // Sort by highest orders first
    finalUsers.sort((a, b) => b.orderCount - a.orderCount);

    res.status(200).json({
      success: true,
      totalUsers: finalUsers.length,
      data: finalUsers,
    });

  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// oRDER COUNTER
app.post("/api/place-order", requireAuth, async (req, res) => {
  try {
    const email = req.user.email;

    // Find existing user
    let user = await UserOrder.findOne({ email });

    if (user) {
      // Increment order count
      user.orderCount += 1;

      await user.save();
    } else {
      // Create new user with first order
      user = await UserOrder.create({
        email,
        orderCount: 1,
      });
    }

    res.status(200).json({
      success: true,
      message: "Order count updated",
      data: user,
    });

  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// UPDATE USER API
app.put("/api/update-user/:id", requireAuth, async (req, res) => {
  try {

    const { id } = req.params;

    const {
      email,
      password,
      deviceId,
      isDeviceLocked
    } = req.body;

    // Find user
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // Store old email before updating
    const oldEmail = user.email;

    // =========================
    // UPDATE EMAIL
    // =========================
    if (email !== undefined) {

      // Check duplicate email
      const existingUser = await User.findOne({
        email,
        _id: { $ne: id }
      });

      if (existingUser) {
        return res.status(400).json({
          message: "Email already in use",
        });
      }

      user.email = email;

      // ✅ UPDATE EMAIL IN USERORDER ALSO
      await UserOrder.updateMany(
        { email: oldEmail },
        { $set: { email: email } }
      );
    }

    // =========================
    // UPDATE PASSWORD
    // =========================
    if (password !== undefined) {

      // Hash new password
      const hashedPassword = await bcrypt.hash(password, 10);

      user.password = hashedPassword;
    }

    // =========================
    // UPDATE DEVICE ID
    // =========================
    if (deviceId !== undefined) {
      user.deviceId = deviceId;
    }

    // =========================
    // UPDATE DEVICE LOCK
    // =========================
    if (isDeviceLocked !== undefined) {
      user.isDeviceLocked = isDeviceLocked;
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: user,
    });

  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// RESET DEVICE — clears the device lock on the authenticated user's own account
app.post("/api/reset-device", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.deviceId = null;
    await user.save();

    res.json({ message: "Device reset successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================================================
// SKU MAP — eBay SKU -> AliExpress product/variant
// ===================================================

// LIST MY SKU MAPPINGS
app.get("/api/sku-map", requireAuth, async (req, res) => {
  try {
    const maps = await SkuMap.find({ ownerEmail: req.user.email }).sort({ updatedAt: -1 });
    res.status(200).json({ success: true, data: maps });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CREATE OR UPDATE A MAPPING (upsert by ebaySku)
app.post("/api/sku-map", requireAuth, async (req, res) => {
  try {
    const { ebaySku, aliexpressUrl, variantId, notes } = req.body;

    if (!ebaySku || !aliexpressUrl) {
      return res.status(400).json({ message: "ebaySku and aliexpressUrl are required" });
    }

    const map = await SkuMap.findOneAndUpdate(
      { ownerEmail: req.user.email, ebaySku },
      { aliexpressUrl, variantId, notes },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, data: map });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE A MAPPING
app.delete("/api/sku-map/:id", requireAuth, async (req, res) => {
  try {
    const map = await SkuMap.findOne({ _id: req.params.id, ownerEmail: req.user.email });

    if (!map) {
      return res.status(404).json({ message: "Mapping not found" });
    }

    await SkuMap.findByIdAndDelete(req.params.id);

    res.status(200).json({ success: true, message: "Mapping deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================================================
// ORDERS — queue pulled from eBay (populated starting Phase 1)
// ===================================================

app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const filter = { ownerEmail: req.user.email };

    if (req.query.status) {
      filter.status = req.query.status;
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE ORDER STATUS (e.g. after placing it on AliExpress, or after tracking arrives)
app.patch("/api/orders/:id", requireAuth, async (req, res) => {
  try {
    const { status, aliexpressOrderId, trackingNumber, carrier, exceptionReason } = req.body;

    const order = await Order.findOne({ _id: req.params.id, ownerEmail: req.user.email });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (status !== undefined) order.status = status;
    if (aliexpressOrderId !== undefined) order.aliexpressOrderId = aliexpressOrderId;
    if (trackingNumber !== undefined) order.trackingNumber = trackingNumber;
    if (carrier !== undefined) order.carrier = carrier;
    if (exceptionReason !== undefined) order.exceptionReason = exceptionReason;

    await order.save();

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CURRENT USER — used by the extension to check eBay connection status
app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      success: true,
      data: {
        email: user.email,
        ebayConnected: !!user.ebayConnected,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================================================
// EBAY OAUTH — one-time consent per seller account
// ===================================================

// Returns the eBay consent URL for the logged-in user to open in a browser tab
app.get("/api/ebay/connect", requireAuth, async (req, res) => {
  try {
    const url = ebayService.getAuthUrl(req.user.id);
    res.status(200).json({ success: true, url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// eBay redirects here after the seller approves access (no JWT available on this request —
// the user's Mongo _id travels in the "state" param we set in getAuthUrl above)
app.get("/api/ebay/oauth/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send("Missing code or state from eBay redirect");
    }

    const user = await User.findById(state);
    if (!user) {
      return res.status(404).send("Unknown user for this eBay connection");
    }

    const tokenData = await ebayService.exchangeCodeForToken(code);

    user.ebayAccessToken = tokenData.access_token;
    user.ebayRefreshToken = tokenData.refresh_token;
    user.ebayAccessTokenExpiry = new Date(Date.now() + tokenData.expires_in * 1000);
    user.ebayConnected = true;
    await user.save();

    res.send("eBay account connected successfully. You can close this tab and return to DropFlow.");
  } catch (error) {
    res.status(500).send("Failed to connect eBay account: " + error.message);
  }
});

// ===================================================
// CRON — pulls new "awaiting shipment" orders from eBay
// Triggered by an external scheduler (Vercel Hobby cron is daily-only), not a logged-in user,
// so it's protected by a shared secret instead of a JWT.
// ===================================================

app.get("/api/cron/pull-orders", async (req, res) => {
  try {
    if (req.query.secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ message: "Invalid cron secret" });
    }

    const users = await User.find({ ebayConnected: true, ebayRefreshToken: { $ne: null } });
    const summary = [];

    for (const user of users) {
      try {
        const accessToken = await ebayService.getValidAccessToken(user);

        const url = `${ebayService.getApiBase()}/sell/fulfillment/v1/order?filter=orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}&limit=50`;

        const ebayRes = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE_ID,
          },
        });

        const data = await ebayRes.json();

        if (!ebayRes.ok) {
          summary.push({ user: user.email, error: data.errors || data });
          continue;
        }

        let newCount = 0;

        for (const ebayOrder of data.orders || []) {
          const shipTo = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
          const address = shipTo?.contactAddress || {};

          const lineItems = (ebayOrder.lineItems || []).map((li) => ({
            lineItemId: li.lineItemId,
            ebayItemId: li.legacyItemId,
            sku: li.sku,
            title: li.title,
            quantity: li.quantity,
          }));

          const result = await Order.findOneAndUpdate(
            { ebayOrderId: ebayOrder.orderId },
            {
              $set: {
                ownerEmail: user.email,
                buyerName: shipTo?.fullName,
                addressLine1: address.addressLine1,
                addressLine2: address.addressLine2,
                city: address.city,
                county: address.stateOrProvince,
                postcode: address.postalCode,
                countryCode: address.countryCode,
                phone: shipTo?.primaryPhone?.phoneNumber,
                lineItems,
              },
              $setOnInsert: { status: "NEW" },
            },
            { upsert: true, new: true, rawResult: true }
          );

          if (!result.lastErrorObject?.updatedExisting) {
            newCount += 1;
          }
        }

        summary.push({ user: user.email, ordersSeen: (data.orders || []).length, newOrders: newCount });
      } catch (userError) {
        summary.push({ user: user.email, error: userError.message });
      }
    }

    res.status(200).json({ success: true, summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================================================
// TRACKING SYNC — reported by the extension once a supplier tracking
// number is known; pushes it to eBay and marks the order shipped.
//
// NOTE: this carrier map is a best-effort guess at eBay's
// ShippingCarrierCodeType enum values for common UK carriers. It has not
// been verified against a live eBay call yet — confirm/adjust these once
// we can test against a real sandbox order.
// ===================================================
const CARRIER_CODE_MAP = {
  "royal mail": "ROYAL_MAIL",
  "royalmail": "ROYAL_MAIL",
  "dpd": "DPD",
  "hermes": "HERMES",
  "evri": "HERMES",
  "dhl": "DHL",
  "ups": "UPS",
  "fedex": "FEDEX",
  "parcelforce": "PARCELFORCE",
  "yodel": "YODEL",
};

function resolveCarrierCode(carrierName) {
  if (!carrierName) return "OTHER";
  return CARRIER_CODE_MAP[carrierName.trim().toLowerCase()] || "OTHER";
}

app.post("/api/orders/tracking-sync", requireAuth, async (req, res) => {
  try {
    const { orderId, aliexpressOrderId, trackingNumber, carrier } = req.body;

    if (!trackingNumber) {
      return res.status(400).json({ message: "trackingNumber is required" });
    }

    const lookup = { ownerEmail: req.user.email };
    if (orderId) lookup._id = orderId;
    else if (aliexpressOrderId) lookup.aliexpressOrderId = aliexpressOrderId;
    else return res.status(400).json({ message: "orderId or aliexpressOrderId is required" });

    const order = await Order.findOne(lookup);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const user = await User.findById(req.user.id);
    const accessToken = await ebayService.getValidAccessToken(user);

    const lineItems = (order.lineItems || [])
      .filter((li) => li.lineItemId)
      .map((li) => ({ lineItemId: li.lineItemId, quantity: li.quantity }));

    if (!lineItems.length) {
      return res.status(400).json({ message: "This order has no eBay line item IDs to ship against" });
    }

    await ebayService.createShippingFulfillment(accessToken, order.ebayOrderId, {
      trackingNumber,
      carrierCode: resolveCarrierCode(carrier),
      lineItems,
    });

    order.status = "SHIPPED";
    order.trackingNumber = trackingNumber;
    order.carrier = carrier;
    if (aliexpressOrderId) order.aliexpressOrderId = aliexpressOrderId;
    await order.save();

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;
