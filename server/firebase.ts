import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

let cachedApp: FirebaseApp | null = null;
let cachedDb: Firestore | null = null;
let cachedStorage: FirebaseStorage | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!cachedApp) {
    cachedApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  }
  return cachedApp;
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
