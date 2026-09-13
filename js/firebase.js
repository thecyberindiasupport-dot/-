// ============================================================
// FIREBASE CONFIG — ADVANCED C2 SUITE
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyC3ETW_Jo8q2yREtVsjw6xtsMb2ExPUHy4",
    authDomain: "soey-9a360.firebaseapp.com",
    databaseURL: "https://soey-9a360-default-rtdb.firebaseio.com",
    projectId: "soey-9a360",
    storageBucket: "soey-9a360.firebasestorage.app",
    messagingSenderId: "38420979856",
    appId: "1:38420979856:android:998e30d50b4f609bfd3815"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Shortcuts
const auth = firebase.auth();
const database = firebase.database();
let storage = null;
try {
    if (firebase.storage) {
        storage = firebase.storage();
    }
} catch (e) {
    console.warn("Firebase Storage unavailable:", e);
}

console.log("🔥 Firebase initialized for project:", firebaseConfig.projectId);
