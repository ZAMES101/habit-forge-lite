import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, doc, collection, query, onSnapshot, setDoc, deleteDoc 
} from 'firebase/firestore';

// --- Global Variables (Canvas Runtime Provided) ---
// We use these checks to ensure the app runs both in the environment
// and potentially locally if the user hardcodes values.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : '';

// Constants
const HABIT_LIMIT = 3; // Enforce the free tier limit from the strategy
const APP_TITLE = "Habit Forge Lite";

// Utility function to get today's date key (YYYY-MM-DD)
const getTodayKey = () => {
  return new Date().toISOString().split('T')[0];
};

// Main Application Component
const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [habits, setHabits] = useState([]);
  const [newHabitName, setNewHabitName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // 1. Firebase Initialization and Authentication
  useEffect(() => {
    try {
      if (Object.keys(firebaseConfig).length === 0) {
        throw new Error("Firebase config is missing.");
      }
      
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const authInstance = getAuth(app);
      
      setDb(firestoreDb);
      setAuth(authInstance);

      // Set up authentication state listener
      const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
        if (!user) {
          // Sign in using provided token or anonymously if token is missing
          if (initialAuthToken) {
            await signInWithCustomToken(authInstance, initialAuthToken);
          } else {
            await signInAnonymously(authInstance);
          }
        }
        // Once signed in (or already signed in), set the userId
        setUserId(authInstance.currentUser?.uid || crypto.randomUUID());
        setIsLoading(false);
        console.log("Firebase Auth Ready. User ID:", authInstance.currentUser?.uid || 'Anonymous');
      });

      return () => unsubscribe(); // Cleanup auth listener
    } catch (e) {
      console.error("Firebase Initialization Error:", e);
      setError("Failed to connect to backend. Check console for details.");
      setIsLoading(false);
    }
  }, []);

  // 2. Firestore Real-Time Data Listener (onSnapshot)
  useEffect(() => {
    if (db && userId) {
      const habitsPath = `/artifacts/${appId}/users/${userId}/habits`;
      const habitsQuery = query(collection(db, habitsPath));
      
      const unsubscribe = onSnapshot(habitsQuery, (snapshot) => {
        const habitsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setHabits(habitsData);
        console.log(`Habits loaded: ${habitsData.length}`);
      }, (e) => {
        console.error("Firestore Snapshot Error:", e);
        setError("Error fetching habit data.");
      });

      return () => unsubscribe(); // Cleanup snapshot listener
    }
  }, [db, userId]);

  // --- Habit Management Logic ---

  const todayKey = useMemo(getTodayKey, []);
  
  const addHabit = useCallback(async (name) => {
    if (!name.trim()) return;
    if (habits.length >= HABIT_LIMIT) {
      alert("Upgrade to Pro to track more than 3 habits!"); // Use alert() replacement logic
      console.warn("Attempted to add more than 3 habits (Free Tier Limit).");
      return;
    }
    if (!db || !userId) {
      setError("System not ready. Please wait or refresh.");
      return;
    }

    const newHabitRef = doc(collection(db, `/artifacts/${appId}/users/${userId}/habits`));
    
    try {
      await setDoc(newHabitRef, {
        name: name.trim(),
        createdAt: new Date(),
        // Initialize today's status as false
        [todayKey]: false, 
      });
      setNewHabitName('');
    } catch (e) {
      console.error("Error adding habit:", e);
      setError("Could not save habit. Try again.");
    }
  }, [db, userId, habits, todayKey]);

  const toggleHabit = useCallback(async (habit) => {
    if (!db || !userId) return;
    
    const habitRef = doc(db, `/artifacts/${appId}/users/${userId}/habits`, habit.id);
    const isCompleted = habit[todayKey] || false;
    
    try {
      // Update only the current day's completion status
      await setDoc(habitRef, { [todayKey]: !isCompleted }, { merge: true });
    } catch (e) {
      console.error("Error toggling habit:", e);
      setError("Could not update habit status.");
    }
  }, [db, userId, todayKey]);

  const deleteHabit = useCallback(async (habitId) => {
    if (!db || !userId) return;
    
    // Custom modal replacement for confirmation (as alert is forbidden)
    if (!window.confirm("Are you sure you want to delete this habit?")) return;
    
    const habitRef = doc(db, `/artifacts/${appId}/users/${userId}/habits`, habitId);
    
    try {
      await deleteDoc(habitRef);
    } catch (e) {
      console.error("Error deleting habit:", e);
      setError("Could not delete habit.");
    }
  }, [db, userId]);

  // --- Rendering Functions ---

  const renderHabits = () => {
    return habits.map((habit) => {
      const isCompleted = habit[todayKey] || false;
      
      return (
        <div 
          key={habit.id} 
          className="flex items-center justify-between p-4 bg-white rounded-xl shadow-md mb-3 transition-all duration-300 hover:shadow-lg hover:bg-indigo-50"
        >
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => toggleHabit(habit)}
              className={`w-8 h-8 rounded-full border-2 transition-colors duration-300 flex items-center justify-center 
                ${isCompleted ? 'bg-indigo-600 border-indigo-600' : 'bg-gray-200 border-gray-300 hover:bg-indigo-200'}
              `}
              aria-label={isCompleted ? "Mark incomplete" : "Mark complete"}
            >
              <svg className={`w-4 h-4 text-white transition-opacity duration-300 ${isCompleted ? 'opacity-100' : 'opacity-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
            </button>
            <span className={`text-lg font-medium ${isCompleted ? 'text-gray-500 line-through' : 'text-gray-800'}`}>
              {habit.name}
            </span>
          </div>
          
          <button 
            onClick={() => deleteHabit(habit.id)}
            className="text-gray-400 hover:text-red-500 transition-colors duration-200 p-1"
            aria-label="Delete habit"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
      );
    });
  };

  // --- Main Render ---

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="text-xl font-medium text-indigo-600">Loading Habit Forge...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8 font-sans">
      <div className="max-w-xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-gray-900">{APP_TITLE}</h1>
          <p className="text-indigo-600 mt-2 text-xl font-semibold">Today is {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <div className="mt-4 text-sm text-gray-500">
            Current User ID: <span className="font-mono text-xs bg-gray-200 p-1 rounded">{userId}</span>
          </div>
        </header>
        
        {/* Error Display */}
        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-lg mb-6" role="alert">
            <p className="font-bold">Error</p>
            <p>{error}</p>
          </div>
        )}

        {/* Habit List */}
        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Habits ({habits.length}/{HABIT_LIMIT})</h2>
          {habits.length === 0 ? (
            <div className="p-6 bg-white rounded-xl shadow-inner text-center text-gray-500">
              <p>No habits tracked yet. Start forging one!</p>
            </div>
          ) : (
            renderHabits()
          )}
        </section>

        {/* Add New Habit Form */}
        <section>
          <h2 className="text-2xl font-bold text-gray-800 mb-4">New Habit</h2>
          <div className="bg-white p-6 rounded-xl shadow-lg">
            {habits.length >= HABIT_LIMIT ? (
              <div className="text-center p-4">
                <p className="text-xl font-semibold text-indigo-600 mb-3">Limit Reached!</p>
                <p className="text-gray-600">You're tracking 3 habits. **Upgrade to Pro** to unlock unlimited slots and full analytics.</p>
                <button className="mt-4 w-full py-3 px-4 bg-indigo-500 text-white font-bold rounded-lg shadow-lg hover:bg-indigo-700 transition duration-300">
                  Go Pro! (Simulated Button)
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); addHabit(newHabitName); }} className="flex space-x-3">
                <input
                  type="text"
                  placeholder="e.g., Read 10 Pages"
                  value={newHabitName}
                  onChange={(e) => setNewHabitName(e.target.value)}
                  className="flex-grow p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  maxLength={50}
                  required
                />
                <button
                  type="submit"
                  className="bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg shadow-lg hover:bg-indigo-700 transition duration-300 flex-shrink-0"
                >
                  Add Habit
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

// Render the App component into the root element
export default App;

