// Firebase REST API helper - bypasses need for service account keys
// Uses Firebase Auth REST API to authenticate and Firestore REST API for data

const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";

// Cache the auth token
let cachedToken: { token: string; expiresAt: number } | null = null;

// Authenticate with email/password and get an ID token
async function getAuthToken(): Promise<string | null> {
  const email = process.env.CRON_SERVICE_EMAIL;
  const password = process.env.CRON_SERVICE_PASSWORD;

  if (!email || !password || !FIREBASE_API_KEY) {
    console.warn("Cron service credentials not configured");
    return null;
  }

  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedToken.token;
  }

  try {
    const response = await fetch(`${AUTH_URL}?key=${FIREBASE_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Auth error:", error);
      return null;
    }

    const data = await response.json();
    cachedToken = {
      token: data.idToken,
      expiresAt: Date.now() + parseInt(data.expiresIn) * 1000,
    };
    return cachedToken.token;
  } catch (error) {
    console.error("Failed to authenticate:", error);
    return null;
  }
}

// Helper to convert Firestore document to plain object
function firestoreDocToObject(doc: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const fields = doc.fields as Record<string, Record<string, unknown>> | undefined;

  if (!fields) return result;

  for (const [key, value] of Object.entries(fields)) {
    result[key] = firestoreValueToJS(value);
  }
  return result;
}

function firestoreValueToJS(value: Record<string, unknown>): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return parseInt(value.integerValue as string);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return new Date(value.timestampValue as string);
  if ("mapValue" in value) {
    const map = value.mapValue as { fields?: Record<string, Record<string, unknown>> };
    return firestoreDocToObject({ fields: map.fields || {} });
  }
  if ("arrayValue" in value) {
    const arr = value.arrayValue as { values?: Record<string, unknown>[] };
    return (arr.values || []).map(v => firestoreValueToJS(v));
  }
  return null;
}

function jsValueToFirestore(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: value.toString() };
    return { doubleValue: value };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(v => jsValueToFirestore(v)) } };
  }
  if (typeof value === "object") {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = jsValueToFirestore(v);
    }
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

// Query users where a field equals a value
export async function queryUsersWhere(
  field: string,
  op: "EQUAL" | "LESS_THAN" | "LESS_THAN_OR_EQUAL" | "GREATER_THAN" | "GREATER_THAN_OR_EQUAL",
  value: unknown
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const token = await getAuthToken();
  if (!token) return [];

  const query = {
    structuredQuery: {
      from: [{ collectionId: "users" }],
      where: {
        fieldFilter: {
          field: { fieldPath: field },
          op,
          value: jsValueToFirestore(value),
        },
      },
    },
  };

  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(query),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Query error:", error);
      return [];
    }

    const results = await response.json();
    return results
      .filter((r: Record<string, unknown>) => r.document)
      .map((r: Record<string, unknown>) => {
        const doc = r.document as { name: string; fields: Record<string, unknown> };
        const pathParts = doc.name.split("/");
        return {
          id: pathParts[pathParts.length - 1],
          data: firestoreDocToObject(doc),
        };
      });
  } catch (error) {
    console.error("Query failed:", error);
    return [];
  }
}

// Get user's favorites subcollection
export async function getUserFavorites(
  userId: string,
  type?: string
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const token = await getAuthToken();
  if (!token) return [];

  const query: Record<string, unknown> = {
    structuredQuery: {
      from: [{ collectionId: "favorites" }],
    },
  };

  if (type) {
    (query.structuredQuery as Record<string, unknown>).where = {
      fieldFilter: {
        field: { fieldPath: "type" },
        op: "EQUAL",
        value: { stringValue: type },
      },
    };
  }

  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${userId}:runQuery`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(query),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Favorites query error:", error);
      return [];
    }

    const results = await response.json();
    return results
      .filter((r: Record<string, unknown>) => r.document)
      .map((r: Record<string, unknown>) => {
        const doc = r.document as { name: string; fields: Record<string, unknown> };
        const pathParts = doc.name.split("/");
        return {
          id: pathParts[pathParts.length - 1],
          data: firestoreDocToObject(doc),
        };
      });
  } catch (error) {
    console.error("Favorites query failed:", error);
    return [];
  }
}

// Get a single user document
export async function getUser(userId: string): Promise<Record<string, unknown> | null> {
  const token = await getAuthToken();
  if (!token) return null;

  try {
    const response = await fetch(`${FIRESTORE_BASE_URL}/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) return null;
    const doc = await response.json();
    return firestoreDocToObject(doc);
  } catch {
    return null;
  }
}

// Create a document in scheduledNotifications collection (auto-generated ID)
export async function createScheduledNotification(data: Record<string, unknown>): Promise<string | null> {
  const token = await getAuthToken();
  if (!token) return null;

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    fields[key] = jsValueToFirestore(value);
  }

  try {
    const response = await fetch(`${FIRESTORE_BASE_URL}/scheduledNotifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fields }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Create notification error:", error);
      return null;
    }

    const doc = await response.json();
    const pathParts = doc.name.split("/");
    return pathParts[pathParts.length - 1];
  } catch (error) {
    console.error("Create notification failed:", error);
    return null;
  }
}

// Set a document in scheduledNotifications collection with a specific ID (upsert)
// Uses PATCH with updateMask to create or update - won't overwrite existing sent=true
export async function setScheduledNotification(docId: string, data: Record<string, unknown>): Promise<boolean> {
  const token = await getAuthToken();
  if (!token) return false;

  const fields: Record<string, unknown> = {};
  const updateMask: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    fields[key] = jsValueToFirestore(value);
    updateMask.push(key);
  }

  try {
    // First check if document exists and is already sent
    const checkResponse = await fetch(
      `${FIRESTORE_BASE_URL}/scheduledNotifications/${docId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (checkResponse.ok) {
      const existingDoc = await checkResponse.json();
      const existingFields = existingDoc.fields || {};
      // If already sent, don't overwrite
      if (existingFields.sent?.booleanValue === true) {
        return true; // Already exists and was sent, consider it success
      }
    }

    // Create or update the document
    const response = await fetch(
      `${FIRESTORE_BASE_URL}/scheduledNotifications/${docId}?updateMask.fieldPaths=${updateMask.join("&updateMask.fieldPaths=")}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fields }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Set notification error:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Set notification failed:", error);
    return false;
  }
}

// Query scheduledNotifications
export async function queryScheduledNotifications(
  filters: Array<{ field: string; op: string; value: unknown }>
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const token = await getAuthToken();
  if (!token) return [];

  const where = filters.length === 1
    ? {
        fieldFilter: {
          field: { fieldPath: filters[0].field },
          op: filters[0].op,
          value: jsValueToFirestore(filters[0].value),
        },
      }
    : {
        compositeFilter: {
          op: "AND",
          filters: filters.map(f => ({
            fieldFilter: {
              field: { fieldPath: f.field },
              op: f.op,
              value: jsValueToFirestore(f.value),
            },
          })),
        },
      };

  const query = {
    structuredQuery: {
      from: [{ collectionId: "scheduledNotifications" }],
      where,
      limit: 100,
    },
  };

  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(query),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Query notifications error:", error);
      return [];
    }

    const results = await response.json();
    return results
      .filter((r: Record<string, unknown>) => r.document)
      .map((r: Record<string, unknown>) => {
        const doc = r.document as { name: string; fields: Record<string, unknown> };
        const pathParts = doc.name.split("/");
        return {
          id: pathParts[pathParts.length - 1],
          data: firestoreDocToObject(doc),
        };
      });
  } catch (error) {
    console.error("Query notifications failed:", error);
    return [];
  }
}

// Update a document
export async function updateDocument(
  collection: string,
  docId: string,
  updates: Record<string, unknown>
): Promise<boolean> {
  const token = await getAuthToken();
  if (!token) return false;

  const fields: Record<string, unknown> = {};
  const updateMask: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    fields[key] = jsValueToFirestore(value);
    updateMask.push(key);
  }

  try {
    const response = await fetch(
      `${FIRESTORE_BASE_URL}/${collection}/${docId}?updateMask.fieldPaths=${updateMask.join("&updateMask.fieldPaths=")}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fields }),
      }
    );

    return response.ok;
  } catch {
    return false;
  }
}

// Update a user document
export async function updateUser(userId: string, updates: Record<string, unknown>): Promise<boolean> {
  return updateDocument("users", userId, updates);
}

// Add a favorite to user's subcollection
export async function addUserFavorite(userId: string, data: Record<string, unknown>): Promise<string | null> {
  const token = await getAuthToken();
  if (!token) return null;

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    fields[key] = jsValueToFirestore(value);
  }

  try {
    const response = await fetch(`${FIRESTORE_BASE_URL}/users/${userId}/favorites`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fields }),
    });

    if (!response.ok) return null;
    const doc = await response.json();
    const pathParts = doc.name.split("/");
    return pathParts[pathParts.length - 1];
  } catch {
    return null;
  }
}

// Query a collection with filters
export async function queryCollection(
  collection: string,
  filters: Array<{ field: string; op: string; value: unknown }>,
  limit = 100
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const token = await getAuthToken();
  if (!token) return [];

  const where = filters.length === 1
    ? {
        fieldFilter: {
          field: { fieldPath: filters[0].field },
          op: filters[0].op,
          value: jsValueToFirestore(filters[0].value),
        },
      }
    : {
        compositeFilter: {
          op: "AND",
          filters: filters.map(f => ({
            fieldFilter: {
              field: { fieldPath: f.field },
              op: f.op,
              value: jsValueToFirestore(f.value),
            },
          })),
        },
      };

  const query = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where,
      limit,
    },
  };

  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(query),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`Query ${collection} error:`, error);
      return [];
    }

    const results = await response.json();
    return results
      .filter((r: Record<string, unknown>) => r.document)
      .map((r: Record<string, unknown>) => {
        const doc = r.document as { name: string; fields: Record<string, unknown> };
        const pathParts = doc.name.split("/");
        return {
          id: pathParts[pathParts.length - 1],
          data: firestoreDocToObject(doc),
        };
      });
  } catch (error) {
    console.error(`Query ${collection} failed:`, error);
    return [];
  }
}

// Delete a document
export async function deleteDocument(
  collection: string,
  docId: string
): Promise<boolean> {
  const token = await getAuthToken();
  if (!token) return false;

  try {
    const response = await fetch(
      `${FIRESTORE_BASE_URL}/${collection}/${docId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response.ok;
  } catch {
    return false;
  }
}

// Check if REST API is configured
export function isRestApiConfigured(): boolean {
  return !!(
    process.env.CRON_SERVICE_EMAIL &&
    process.env.CRON_SERVICE_PASSWORD &&
    FIREBASE_API_KEY &&
    FIREBASE_PROJECT_ID
  );
}
