import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, doc, collection, query, where, onSnapshot, setDoc, deleteDoc, updateDoc, 
  serverTimestamp 
} from 'firebase/firestore';

// --- Configuration Setup (Using Safe Placeholders for Vercel Build) ---
// For a live environment, you MUST replace these placeholders with your actual
// Firebase configuration values gathered in Phase 2.
const VERCEL_APP_ID = 'YOUR_FIREBASE_PROJECT_ID'; 
const VERCEL_API_KEY = "AIzaSy...your-api-key..."; 
const VERCEL_AUTH_DOMAIN = "your-project-id.firebaseapp.com";
const VERCEL_PROJECT_ID = "your-project-id";
const VERCEL_STORAGE_BUCKET = "your-project-id.appspot.com";
const VERCEL_MESSAGING_SENDER_ID = "...";
const VERCEL_MEASUREMENT_ID = "G-..."; 


const firebaseConfig = {
  apiKey: VERCEL_API_KEY,
  authDomain: VERCEL_AUTH_DOMAIN,
  projectId: VERCEL_PROJECT_ID,
  storageBucket: VERCEL_STORAGE_BUCKET,
  messagingSenderId: VERCEL_MESSAGING_SENDER_ID,
  appId: VERCEL_APP_ID,
  measurementId: VERCEL_MEASUREMENT_ID
};

const initialAuthToken = ''; 

// Initialize Firebase once
let app;
let db;
let auth;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("Firebase Initialization Error:", e);
}


// Utility function to generate a unique ID if auth.currentUser?.uid is not available
const getUserId = (user) => {
  return user?.uid || crypto.randomUUID();
};


const HabitTracker = () => {
  const [habits, setHabits] = useState([]);
  const [newHabitName, setNewHabitName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  
  const MAX_FREE_HABITS = 3;
  const isHabitLimitReached = habits.length >= MAX_FREE_HABITS;

  // --- Auth & Firebase Setup ---
  useEffect(() => {
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        // Sign in anonymously if no token is provided or user is logged out
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
          } else {
            await signInAnonymously(auth);
          }
        } catch (authError) {
          setError(`Authentication failed: ${authError.message}`);
          setIsLoading(false);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // --- Data Fetching (Real-time Listener) ---
  useEffect(() => {
    if (!db || !user) {
      // Wait for Firebase and user to be initialized
      setIsLoading(true);
      return;
    }

    const userId = getUserId(user);
    const appId = VERCEL_PROJECT_ID; // Using project ID as a substitute for __app_id

    // Firestore Path: /artifacts/{appId}/users/{userId}/habits
    const habitsCollectionRef = collection(db, 
      `artifacts/${appId}/users/${userId}/habits`
    );

    // Set up real-time listener
    const q = query(habitsCollectionRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedHabits = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name,
          // Deserialize dates and handle potential nulls/missing fields
          lastCompleted: data.lastCompleted?.toDate() || null,
          streak: data.streak || 0,
          createdAt: data.createdAt?.toDate() || new Date(),
        };
      }).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); // Sort by creation date
      
      setHabits(fetchedHabits);
      setIsLoading(false);
    }, (err) => {
      // eslint-disable-next-line no-console
      console.error("Firestore Snapshot Error:", err);
      setError("Failed to load habits. Please check connection.");
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [user]); // Re-run effect when user changes

  // --- Core Habit Logic ---

  const handleAddHabit = async (e) => {
    e.preventDefault();
    if (newHabitName.trim() === '') return;

    if (isHabitLimitReached) {
      setShowUpgradeModal(true);
      return;
    }

    const newHabit = {
      name: newHabitName.trim(),
      createdAt: serverTimestamp(),
      lastCompleted: null,
      streak: 0,
    };

    try {
      const userId = getUserId(user);
      const appId = VERCEL_PROJECT_ID; 
      const habitsCollectionRef = collection(db, 
        `artifacts/${appId}/users/${userId}/habits`
      );
      
      await setDoc(doc(habitsCollectionRef), newHabit);
      setNewHabitName('');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Error adding document: ", e);
      setError("Failed to add habit.");
    }
  };

  const handleToggleHabit = async (habit) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const isCompletedToday = habit.lastCompleted && habit.lastCompleted >= today;
    
    // Check if habit was completed yesterday to continue streak
    let newStreak = habit.streak;
    let newLastCompleted = habit.lastCompleted;

    if (!isCompletedToday) {
      // COMPLETE THE HABIT
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      // If last completion was yesterday, increment streak
      if (habit.lastCompleted && habit.lastCompleted >= yesterday) {
        newStreak = habit.streak + 1;
      } else {
        // Otherwise, start a new streak
        newStreak = 1;
      }
      newLastCompleted = serverTimestamp(); // Mark as completed now
      
    } else {
      // UNDO THE HABIT (Only allow undo if it was the current streak-keeping day)
      // This is complex, so for an MVP, we prevent undoing completion from today
      // to keep the logic simple and prevent streak manipulation exploits.
      // For simplicity in this MVP, we will treat the button as purely 'Complete'.
      return; 
    }

    try {
      const userId = getUserId(user);
      const appId = VERCEL_PROJECT_ID; 
      const habitDocRef = doc(db, 
        `artifacts/${appId}/users/${userId}/habits`, 
        habit.id
      );

      await updateDoc(habitDocRef, {
        lastCompleted: newLastCompleted,
        streak: newStreak,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Error updating document: ", e);
      setError("Failed to update habit status.");
    }
  };

  const handleDeleteHabit = async (id) => {
    try {
      const userId = getUserId(user);
      const appId = VERCEL_PROJECT_ID; 
      const habitDocRef = doc(db, 
        `artifacts/${appId}/users/${userId}/habits`, 
        id
      );
      await deleteDoc(habitDocRef);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Error deleting document: ", e);
      setError("Failed to delete habit.");
    }
  };

  const getCompletionStatus = (habit) => {
    if (!habit.lastCompleted) return false;

    // Check if the habit was completed today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return habit.lastCompleted.getTime() >= today.getTime();
  };

  const getDayStatus = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return habits.map(habit => {
      const isCompleted = getCompletionStatus(habit);
      return {
        id: habit.id,
        isCompleted: isCompleted,
        streak: habit.streak,
        name: habit.name,
      };
    });
  }, [habits]);


  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-xl font-medium text-indigo-600">Loading your habits...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-4 sm:p-8 font-inter">
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        {`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        .font-inter { font-family: 'Inter', sans-serif; }
        .habit-card {
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            transition: all 0.2s;
        }
        .habit-card:hover {
             box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
        .pro-banner {
            background: linear-gradient(135deg, #4c51bf 0%, #667eea 100%);
            color: white;
        }
        `}
      </style>

      {/* Header and User ID Display */}
      <header className="w-full max-w-lg text-center mb-8">
        <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">Habit Forge Lite</h1>
        <p className="text-sm text-gray-500 mt-1">Minimalist Tracker (MVP)</p>
        <p className="text-xs text-gray-400 mt-2">
          User ID: <span className="font-mono text-gray-600 break-all">{user?.uid || 'N/A'}</span>
        </p>
      </header>

      {/* Error Message Display */}
      {error && (
        <div className="w-full max-w-lg p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-lg shadow-md" role="alert">
          {error}
        </div>
      )}

      {/* Habit Creation Form */}
      <form onSubmit={handleAddHabit} className="w-full max-w-lg mb-8 p-4 bg-white rounded-xl shadow-lg border border-gray-100">
        <div className="flex space-x-2">
          <input
            type="text"
            value={newHabitName}
            onChange={(e) => setNewHabitName(e.target.value)}
            placeholder={isHabitLimitReached ? "Upgrade to add more habits..." : "Enter new habit name (e.g., Read for 30 min)"}
            className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-50"
            disabled={isHabitLimitReached}
          />
          <button
            type="submit"
            className={`px-4 py-3 rounded-lg font-semibold text-white transition-colors duration-200 shadow-md ${
              isHabitLimitReached
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800'
            }`}
          >
            {isHabitLimitReached ? 'PRO' : 'Add'}
          </button>
        </div>
        {isHabitLimitReached && (
          <p className="mt-2 text-sm text-red-500 text-center font-medium">
            Free tier limited to {MAX_FREE_HABITS} habits.
          </p>
        )}
      </form>

      {/* Habit List */}
      <div className="w-full max-w-lg space-y-4">
        {habits.length === 0 && !isLoading && (
          <p className="text-center text-gray-500 p-8 bg-white rounded-xl shadow-md">
            No habits yet. Start tracking your first one!
          </p>
        )}
        
        {getDayStatus.map(habit => (
          <div key={habit.id} className="habit-card flex items-center justify-between p-4 bg-white rounded-xl border-l-4 border-indigo-500 shadow-lg">
            <div className="flex items-center flex-grow min-w-0">
              <button
                onClick={() => handleToggleHabit(habits.find(h => h.id === habit.id))}
                className={`w-10 h-10 flex items-center justify-center rounded-full transition-all duration-300 transform active:scale-95 ${
                  habit.isCompleted
                    ? 'bg-green-500 text-white shadow-lg'
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                }`}
                title={habit.isCompleted ? "Completed Today" : "Mark Complete"}
              >
                {habit.isCompleted ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                )}
              </button>
              
              <div className="ml-4 flex-grow min-w-0">
                <p className={`font-semibold text-lg truncate ${habit.isCompleted ? 'text-gray-500 line-through' : 'text-gray-800'}`}>
                  {habit.name}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Streak: <span className="font-bold text-indigo-600">{habit.streak}</span> days
                </p>
              </div>
            </div>

            {/* Delete Button */}
            <button
              onClick={() => handleDeleteHabit(habit.id)}
              className="ml-4 text-gray-400 hover:text-red-500 p-2 rounded-full transition-colors duration-200"
              title="Delete Habit"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.86 12.04A2 2 0 0116.14 21H7.86a2 2 0 01-1.99-1.96L5 7m5 4v6m4-6v6M4 7h16" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      
      {/* Monetization Banner (The Main Goal!) */}
      <div className="w-full max-w-lg mt-8 p-6 pro-banner rounded-xl shadow-2xl text-center">
        <h3 className="text-2xl font-bold mb-2">Ready to Go Pro?</h3>
        <p className="text-sm opacity-90 mb-4">
          Unlock **Unlimited Habits**, full history analytics, and custom themes to supercharge your tracking.
        </p>
        <button
          onClick={() => setShowUpgradeModal(true)}
          className="w-full py-3 bg-yellow-400 text-indigo-900 font-bold rounded-lg shadow-lg hover:bg-yellow-300 transition-colors transform active:scale-95"
        >
          UPGRADE TO PRO (Click to see what happens!)
        </button>
      </div>


      {/* Custom Modal for Upgrade (instead of alert()) */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50 transition-opacity duration-300">
          <div className="bg-white rounded-xl p-6 sm:p-8 w-full max-w-sm shadow-2xl transform transition-transform duration-300">
            <h4 className="text-2xl font-bold text-indigo-600 mb-4">Pro Feature Locked 🔒</h4>
            <p className="text-gray-700 mb-6">
              You've hit the **3-habit limit** on the free tier. To track unlimited habits and view your streak history, you'll need to subscribe.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700"
              >
                Start Free Trial
              </button>
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="w-full py-3 text-gray-500 font-semibold rounded-lg border border-gray-300 hover:bg-gray-100"
              >
                Close and Go Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HabitTracker;
