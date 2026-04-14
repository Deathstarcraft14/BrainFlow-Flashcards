import { useState, useEffect } from 'react';
import { Deck, Folder, Flashcard } from '../types';
import { 
  db, 
  auth, 
  collection, 
  doc, 
  setDoc, 
  getDocs,
  onSnapshot, 
  query, 
  where, 
  deleteDoc, 
  updateDoc,
  writeBatch
} from './firebase';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const STORAGE_KEY = 'brainflow_data';

interface AppData {
  decks: Deck[];
  folders: Folder[];
  cards: Flashcard[];
}

const initialData: AppData = {
  decks: [],
  folders: [],
  cards: [],
};

export function useBrainFlowStore() {
  const [data, setData] = useState<AppData>(initialData);
  const [user, setUser] = useState(auth.currentUser);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  // Sync from Firestore when logged in
  useEffect(() => {
    if (!user) {
      // If not logged in, use local storage
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setData(JSON.parse(saved));
      return;
    }

    const unsubDecks = onSnapshot(query(collection(db, 'decks'), where('userId', '==', user.uid)), (snap) => {
      const decks = snap.docs.map(d => d.data() as Deck);
      setData(prev => ({ ...prev, decks }));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'decks');
    });

    const unsubFolders = onSnapshot(query(collection(db, 'folders'), where('userId', '==', user.uid)), (snap) => {
      const folders = snap.docs.map(d => d.data() as Folder);
      setData(prev => ({ ...prev, folders }));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'folders');
    });

    const unsubCards = onSnapshot(query(collection(db, 'cards'), where('userId', '==', user.uid)), (snap) => {
      const cards = snap.docs.map(d => d.data() as Flashcard);
      setData(prev => ({ ...prev, cards }));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'cards');
    });

    return () => {
      unsubDecks();
      unsubFolders();
      unsubCards();
    };
  }, [user]);

  // Save to local storage only if NOT logged in
  useEffect(() => {
    if (!user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  }, [data, user]);

  // Auto-migrate local data if user logs in
  useEffect(() => {
    if (user) {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        migrateLocalToCloud(user.uid);
      }
    }
  }, [user]);

  const addDeck = async (name: string, description: string) => {
    const newDeck: Deck = {
      id: crypto.randomUUID(),
      name,
      description,
      createdAt: Date.now(),
    };

    if (user) {
      try {
        await setDoc(doc(db, 'decks', newDeck.id), { ...newDeck, userId: user.uid });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `decks/${newDeck.id}`);
      }
    } else {
      setData(prev => ({ ...prev, decks: [...prev.decks, newDeck] }));
    }
    return newDeck;
  };

  const addFolder = async (deckId: string, name: string) => {
    const newFolder: Folder = {
      id: crypto.randomUUID(),
      deckId,
      name,
      createdAt: Date.now(),
    };

    if (user) {
      try {
        await setDoc(doc(db, 'folders', newFolder.id), { ...newFolder, userId: user.uid });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `folders/${newFolder.id}`);
      }
    } else {
      setData(prev => ({ ...prev, folders: [...prev.folders, newFolder] }));
    }
    return newFolder;
  };

  const addCard = async (card: Flashcard) => {
    if (user) {
      try {
        await setDoc(doc(db, 'cards', card.id), { ...card, userId: user.uid });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `cards/${card.id}`);
      }
    } else {
      setData(prev => ({ ...prev, cards: [...prev.cards, card] }));
    }
  };

  const updateCard = async (updatedCard: Flashcard) => {
    if (user) {
      try {
        await setDoc(doc(db, 'cards', updatedCard.id), { ...updatedCard, userId: user.uid });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `cards/${updatedCard.id}`);
      }
    } else {
      setData(prev => ({
        ...prev,
        cards: prev.cards.map(c => c.id === updatedCard.id ? updatedCard : c),
      }));
    }
  };

  const deleteDeck = async (id: string) => {
    if (user) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'decks', id));
        
        // Also delete related folders and cards in Firestore
        const foldersSnap = await getDocs(query(
          collection(db, 'folders'), 
          where('deckId', '==', id),
          where('userId', '==', user.uid)
        ));
        foldersSnap.forEach(d => batch.delete(d.ref));
        
        const cardsSnap = await getDocs(query(
          collection(db, 'cards'), 
          where('deckId', '==', id),
          where('userId', '==', user.uid)
        ));
        cardsSnap.forEach(d => batch.delete(d.ref));
        
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `decks/${id}`);
      }
    } else {
      setData(prev => ({
        ...prev,
        decks: prev.decks.filter(d => d.id !== id),
        folders: prev.folders.filter(f => f.deckId !== id),
        cards: prev.cards.filter(c => c.deckId !== id),
      }));
    }
  };

  const deleteFolder = async (id: string) => {
    if (user) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'folders', id));
        
        const cardsSnap = await getDocs(query(
          collection(db, 'cards'), 
          where('folderId', '==', id),
          where('userId', '==', user.uid)
        ));
        cardsSnap.forEach(d => batch.delete(d.ref));
        
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `folders/${id}`);
      }
    } else {
      setData(prev => ({
        ...prev,
        folders: prev.folders.filter(f => f.id !== id),
        cards: prev.cards.filter(c => c.folderId !== id),
      }));
    }
  };

  const deleteCard = async (id: string) => {
    if (user) {
      try {
        await deleteDoc(doc(db, 'cards', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `cards/${id}`);
      }
    } else {
      setData(prev => ({
        ...prev,
        cards: prev.cards.filter(c => c.id !== id),
      }));
    }
  };

  const migrateLocalToCloud = async (userId: string) => {
    const saved = localStorage.getItem(STORAGE_KEY);
    
    if (saved) {
      try {
        const localData: AppData = JSON.parse(saved);
        // Only migrate if there's actually something to migrate
        if (localData.decks.length > 0 || localData.cards.length > 0) {
          const batch = writeBatch(db);
          localData.decks.forEach(d => batch.set(doc(db, 'decks', d.id), { ...d, userId }));
          localData.folders.forEach(f => batch.set(doc(db, 'folders', f.id), { ...f, userId }));
          localData.cards.forEach(c => batch.set(doc(db, 'cards', c.id), { ...c, userId }));
          await batch.commit();
        }
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        console.error("Migration failed", e);
        handleFirestoreError(e, OperationType.WRITE, 'migration');
      }
    } else {
      try {
        // Check if user already has decks in cloud before creating sample
        const decksSnap = await getDocs(query(collection(db, 'decks'), where('userId', '==', userId)));
        if (decksSnap.empty) {
          const batch = writeBatch(db);
          const deckId = crypto.randomUUID();
          const folderId = crypto.randomUUID();
          const now = Date.now();

          const sampleDeck: Deck = {
            id: deckId,
            name: "Sample Deck",
            description: "Welcome to BrainFlow! Here are some sample cards to get you started.",
            createdAt: now,
          };

          const sampleFolder: Folder = {
            id: folderId,
            deckId: deckId,
            name: "Getting Started",
            createdAt: now,
          };

          const sampleCards: Flashcard[] = [
            {
              id: crypto.randomUUID(),
              deckId,
              folderId,
              front: "What is Spaced Repetition?",
              back: "A learning technique that incorporates increasing intervals of time between subsequent review of previously learned material.",
              createdAt: now,
              state: 'new',
              nextReview: now,
              interval: 0,
              easeFactor: 2.5,
              step: 0,
            },
            {
              id: crypto.randomUUID(),
              deckId,
              folderId,
              front: "How do I add a new card?",
              back: "Click the 'Add Card' button in the deck view.",
              createdAt: now,
              state: 'new',
              nextReview: now,
              interval: 0,
              easeFactor: 2.5,
              step: 0,
            }
          ];

          batch.set(doc(db, 'decks', deckId), { ...sampleDeck, userId });
          batch.set(doc(db, 'folders', folderId), { ...sampleFolder, userId });
          sampleCards.forEach(c => batch.set(doc(db, 'cards', c.id), { ...c, userId }));
          await batch.commit();
        }
      } catch (e) {
        console.error("Sample creation failed", e);
        handleFirestoreError(e, OperationType.WRITE, 'sample_creation');
      }
    }
  };

  return {
    ...data,
    user,
    addDeck,
    addFolder,
    addCard,
    updateCard,
    deleteDeck,
    deleteFolder,
    deleteCard,
    migrateLocalToCloud,
  };
}
