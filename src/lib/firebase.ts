import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: 'AIzaSyBfplg36UT63r1oJzCPNKWakK6r3e7cv_o',
  authDomain: 'nimwizard2026.firebaseapp.com',
  projectId: 'nimwizard2026',
  storageBucket: 'nimwizard2026.firebasestorage.app',
  messagingSenderId: '672934681241',
  appId: '1:672934681241:web:93b5e0c1dcc410dd9ab608',
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
export const storage = getStorage(app)

// Use the new cache API — supports multiple tabs natively, no deprecation warning
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})
