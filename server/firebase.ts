import crypto from 'crypto';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import {
  getAuth,
  Auth,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

export const PINNED_SERVER_UID = 'ukJVtQYppkV4awTHZImYEPV7dH53';

let cachedApp: FirebaseApp | null = null;
let cachedDb: Firestore | null = null;
let cachedStorage: FirebaseStorage | null = null;
let cachedAuth: Auth | null = null;
let pendingAuthPromise: Promise<void> | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!cachedApp) {
    cachedApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  }
  return cachedApp;
}

export function getFirebaseAuth(): Auth {
  if (!cachedAuth) {
    cachedAuth = getAuth(getFirebaseApp());
  }
  return cachedAuth;
}

function getServiceAccountForFirestore(): {
  clientEmail: string;
  privateKey: string;
} | null {
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson.length > 0) {
    try {
      const decoded = rawJson.startsWith('{')
        ? rawJson
        : Buffer.from(rawJson, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded.trim());
      const projectMatches =
        !parsed.project_id || String(parsed.project_id).trim() === firebaseConfig.projectId;
      const clientEmail = String(parsed.client_email || '').trim();
      const privateKey = String(parsed.private_key || '').replace(/\\n/g, '\n').trim();
      if (projectMatches && clientEmail && privateKey.includes('PRIVATE KEY')) {
        return {
          clientEmail,
          privateKey,
        };
      }
    } catch {
      // Fall through to individual env vars
    }
  }

  const envProjectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
  if (envProjectId && envProjectId !== firebaseConfig.projectId) {
    return null;
  }

  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (clientEmail && privateKey.includes('PRIVATE KEY')) {
    return { clientEmail, privateKey };
  }

  return null;
}

function createServiceAccountCustomToken(clientEmail: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: clientEmail,
      sub: clientEmail,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: now,
      exp: now + 3600,
      uid: PINNED_SERVER_UID,
      claims: {
        serverAdmin: true,
      },
    })
  ).toString('base64url');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign(privateKey, 'base64url');
  return `${header}.${payload}.${signature}`;
}

function deriveServerAuthCredentials(): { email: string; password: string } {
  const seed = (process.env.FIREBASE_SERVER_AUTH_SECRET || '8825316434').trim();
  const derivedKey = crypto
    .pbkdf2Sync(
      seed,
      `zoya-firestore-server-auth-v1:${firebaseConfig.firestoreDatabaseId}:${firebaseConfig.appId}`,
      100_000,
      32,
      'sha256'
    )
    .toString('base64url');

  const emailHash = crypto
    .createHash('sha256')
    .update(firebaseConfig.firestoreDatabaseId)
    .digest('hex')
    .slice(0, 12);

  return {
    email: `zoya-server-${emailHash}@zoya-internal.local`,
    password: `Zy!${derivedKey}#9a`,
  };
}

/**
 * Ensures the backend Firestore client is authenticated with a privileged server-only identity
 * before any Firestore read/write operation is executed.
 */
export async function ensureServerFirestoreAuth(): Promise<Firestore> {
  const db = getDb();
  const auth = getFirebaseAuth();

  if (auth.currentUser && auth.currentUser.uid === PINNED_SERVER_UID) {
    return db;
  }

  if (!pendingAuthPromise) {
    pendingAuthPromise = (async () => {
      try {
        // 1. Prefer Service Account Custom Token when service account credentials are configured
        const serviceAccount = getServiceAccountForFirestore();
        if (serviceAccount) {
          try {
            const customToken = createServiceAccountCustomToken(
              serviceAccount.clientEmail,
              serviceAccount.privateKey
            );
            await signInWithCustomToken(auth, customToken);
            return;
          } catch {
            // Fall back to pinned server identity if custom token exchange is unavailable
          }
        }

        // 2. Authenticate as the pinned server-only Firebase Auth UID
        const { email, password } = deriveServerAuthCredentials();
        try {
          await signInWithEmailAndPassword(auth, email, password);
        } catch (err: any) {
          if (err?.code === 'auth/user-not-found') {
            await createUserWithEmailAndPassword(auth, email, password);
          } else {
            throw err;
          }
        }
      } finally {
        pendingAuthPromise = null;
      }
    })();
  }

  await pendingAuthPromise;
  return db;
}

export function getDb(): Firestore {
  if (!cachedDb) {
    const app = getFirebaseApp();
    cachedDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
  return cachedDb;
}

export function getStorageInstance(): FirebaseStorage {
  if (!cachedStorage) {
    const app = getFirebaseApp();
    const bucketName = firebaseConfig.storageBucket || `${firebaseConfig.projectId}.appspot.com`;
    cachedStorage = getStorage(app, `gs://${bucketName}`);
  }
  return cachedStorage;
}

