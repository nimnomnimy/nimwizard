import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore'

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
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()

// Enable offline persistence so writes are queued when the user is offline
// and replayed when connectivity returns. Errors here are non-fatal.
enableIndexedDbPersistence(db).catch(err => {
  if (err.code === 'failed-precondition') {
    // Multiple tabs open — persistence only works in one tab at a time
    console.warn('[firebase] Offline persistence unavailable: multiple tabs open')
  } else if (err.code === 'unimplemented') {
    // Browser doesn't support persistence
    console.warn('[firebase] Offline persistence not supported in this browser')
  }
})
