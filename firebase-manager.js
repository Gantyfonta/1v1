import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js';
import { 
    getAuth, 
    signInWithPopup, 
    GoogleAuthProvider, 
    onAuthStateChanged,
    signOut as firebaseSignOut
} from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js';
import { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc, 
    onSnapshot, 
    collection, 
    query, 
    where, 
    updateDoc, 
    arrayUnion,
    deleteDoc,
    serverTimestamp,
    getDocs
} from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

export { onAuthStateChanged };

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  const errorJson = JSON.stringify(errInfo);
  console.error('Firestore Error: ', errorJson);
  throw new Error(errorJson);
}

// --- Auth Helpers ---
export async function loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        // Upsert user profile
        await setDoc(doc(db, 'users', user.uid), {
            displayName: user.displayName,
            photoURL: user.photoURL,
            createdAt: serverTimestamp()
        }, { merge: true });
        return user;
    } catch (error) {
        console.error("Login failed", error);
        throw error;
    }
}

export async function signOut() {
    await firebaseSignOut(auth);
}

// --- Room Logic ---
export async function createRoom() {
    const user = auth.currentUser;
    if (!user) throw new Error("Must be logged in to create a room");

    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomRef = doc(db, 'rooms', roomId);
    
    const roomData = {
        hostId: user.uid,
        status: 'waiting',
        players: [user.uid],
        playerNames: { [user.uid]: user.displayName },
        createdAt: serverTimestamp()
    };

    try {
        await setDoc(roomRef, roomData);
        return roomId;
    } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `rooms/${roomId}`);
    }
}

export async function joinRoom(roomId) {
    const user = auth.currentUser;
    if (!user) throw new Error("Must be logged in to join a room");

    const roomRef = doc(db, 'rooms', roomId);
    try {
        const roomSnap = await getDoc(roomRef);
        if (!roomSnap.exists()) throw new Error("Room not found");
        
        const data = roomSnap.data();
        if (data.status !== 'waiting' || data.players.length >= 2) {
            throw new Error("Room is full or already started");
        }

        if (!data.players.includes(user.uid)) {
            const updates = {
                players: arrayUnion(user.uid),
                [`playerNames.${user.uid}`]: user.displayName
            };
            // If there's 1 player already, adding 1 more makes it 2, so start the game
            if (data.players.length === 1) {
                updates.status = 'playing';
            }
            await updateDoc(roomRef, updates);
        }
        return data;
    } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
    }
}

export async function getOpenRooms() {
    const q = query(collection(db, 'rooms'), where('status', '==', 'waiting'));
    try {
        const snap = await getDocs(q);
        const rooms = [];
        snap.forEach(doc => {
            rooms.push({ id: doc.id, ...doc.data() });
        });
        return rooms;
    } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'rooms');
    }
}

export async function updatePlayerState(roomId, state) {
    const user = auth.currentUser;
    if (!user) return;
    const stateRef = doc(db, 'rooms', roomId, 'states', user.uid);
    try {
        await setDoc(stateRef, {
            ...state,
            updatedAt: Date.now()
        }, { merge: true });
    } catch (error) {
        // Silently fail for high-frequency updates to avoid spamming errors
    }
}

export function subscribeToRoom(roomId, callback) {
    return onSnapshot(doc(db, 'rooms', roomId), (snap) => {
        if (snap.exists()) callback({ id: snap.id, ...snap.data() });
    }, (error) => {
        handleFirestoreError(error, OperationType.GET, `rooms/${roomId}`);
    });
}

export function subscribeToPlayerStates(roomId, callback) {
    return onSnapshot(collection(db, 'rooms', roomId, 'states'), (snap) => {
        const states = {};
        snap.forEach(doc => {
            states[doc.id] = doc.data();
        });
        callback(states);
    }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `rooms/${roomId}/states`);
    });
}

export async function cleanupRoom(roomId) {
    // Optional: Delete state docs
    try {
        await deleteDoc(doc(db, 'rooms', roomId));
    } catch (e) {}
}
