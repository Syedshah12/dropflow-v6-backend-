const SCOPE = "https://api.ebay.com/oauth/api_scope/sell.fulfillment";

function isSandbox() {
  return (process.env.EBAY_ENV || "sandbox").toLowerCase() !== "production";
}

function getConfig() {
  const sandbox = isSandbox();

  return {
    sandbox,
    clientId: sandbox ? process.env.EBAY_SANDBOX_CLIENT_ID : process.env.EBAY_PROD_CLIENT_ID,
    clientSecret: sandbox ? process.env.EBAY_SANDBOX_CLIENT_SECRET : process.env.EBAY_PROD_CLIENT_SECRET,
    ruName: sandbox ? process.env.EBAY_SANDBOX_RUNAME : process.env.EBAY_PROD_RUNAME,
    authBase: sandbox ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com",
    apiBase: sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com",
  };
}

function getAuthUrl(state) {
  const { authBase, clientId, ruName } = getConfig();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: ruName,
    response_type: "code",
    scope: SCOPE,
    state: state || "",
  });

  return `${authBase}/oauth2/authorize?${params.toString()}`;
}

async function requestToken(bodyParams) {
  const { apiBase, clientId, clientSecret } = getConfig();

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${apiBase}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: bodyParams.toString(),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error_description || data.error || "eBay token request failed");
  }

  return data;
}

// Exchanges the one-time authorization code (from the OAuth redirect) for an access + refresh token
function exchangeCodeForToken(code) {
  const { ruName } = getConfig();

  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: ruName,
    })
  );
}

// Uses the stored refresh token to get a new short-lived access token
function refreshAccessToken(refreshToken) {
  return requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: SCOPE,
    })
  );
}

// Returns a valid access token for this user, refreshing it first if it's expired or close to it
async function getValidAccessToken(user) {
  const bufferMs = 2 * 60 * 1000; // refresh a bit before actual expiry

  if (
    user.ebayAccessToken &&
    user.ebayAccessTokenExpiry &&
    user.ebayAccessTokenExpiry.getTime() - bufferMs > Date.now()
  ) {
    return user.ebayAccessToken;
  }

  if (!user.ebayRefreshToken) {
    throw new Error("User has not connected their eBay account");
  }

  const data = await refreshAccessToken(user.ebayRefreshToken);

  user.ebayAccessToken = data.access_token;
  user.ebayAccessTokenExpiry = new Date(Date.now() + data.expires_in * 1000);
  await user.save();

  return user.ebayAccessToken;
}

function getApiBase() {
  return getConfig().apiBase;
}

// Marks an eBay order as shipped with tracking info.
// lineItems: [{ lineItemId, quantity }] — required by eBay so it knows which items shipped.
async function createShippingFulfillment(accessToken, ebayOrderId, { trackingNumber, carrierCode, lineItems }) {
  const { apiBase } = getConfig();

  const res = await fetch(`${apiBase}/sell/fulfillment/v1/order/${ebayOrderId}/shipping_fulfillment`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE_ID,
    },
    body: JSON.stringify({
      lineItems,
      shippedDate: new Date().toISOString(),
      shippingCarrierCode: carrierCode,
      trackingNumber,
    }),
  });

  if (res.status === 204) {
    return { success: true };
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error((data.errors && data.errors[0]?.message) || "eBay shipping fulfillment call failed");
  }

  return data;
}

module.exports = {
  getAuthUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getValidAccessToken,
  getApiBase,
  createShippingFulfillment,
};
