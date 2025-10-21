import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client'; // Standard npm import for React 18
import { initializeApp } from 'firebase/app'; // Standard npm import
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth'; // Standard npm import
import { 
  getFirestore, doc, collection, query, onSnapshot, setDoc, deleteDoc 
} from 'firebase/firestore'; // Standard npm import

// NOTE: For this to work on Vercel, you must ensure 'react', 'react-dom', 
// and 'firebase' are listed as dependencies in your project's package.json file.

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
  // Use UTC components to prevent local timezone issues with habit tracking
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Custom Modal/Alert Replacement
const CustomModal = ({ title, message, onConfirm, onCancel, isVisible }) => {
    if (!isVisible) return null;

    // We use a local state for the modal visibility instead of managing it externally
    const handleClose = () => {
        if (onCancel) onCancel();
    };

    const handleConfirm = () => {
        if (onConfirm) onConfirm();
    };


    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 transform transition-all duration-300">
                <h3 className="text-xl font-bold text-gray-900 mb-3">{title}</h3>
                <p className="text-gray-700 mb-6">{message}</p>
                <div className="flex justify-end space-x-3">
                    {onCancel && (
                        <button
                            onClick={handleClose}
                            className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
                        >
                            Cancel
                        </button>
                    )}
                    {onConfirm && (
                        <button
                            onClick={handleConfirm}
                            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition"
                        >
                            Confirm
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
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

  // Modal State
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [modalAction, setModalAction] = useState(null); 
  
  // 1. Firebase Initialization and Authentication
  useEffect(() => {
    try {
      if (Object.keys(firebaseConfig).length === 0 || !firebaseConfig.apiKey) {
        // If the config is empty, we allow the app to run but flag the error later
        console.warn("Firebase configuration is missing or incomplete.");
        // This warning is fine, we still need to attempt auth for a userId
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
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(authInstance, initialAuthToken);
            } else {
              await signInAnonymously(authInstance);
            }
          } catch(e) {
            console.error("Auth Sign-In Error:", e);
            setError("Failed to sign in. Data persistence may not work.");
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
      // Use firestore collection reference
      const habitsCollectionRef = collection(db, habitsPath);
      const habitsQuery = query(habitsCollectionRef);
      
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
  
  const showLimitModal = () => {
    setModalTitle("Upgrade Required");
    setModalMessage(`You are currently tracking ${HABIT_LIMIT} habits. Upgrade to Pro to unlock unlimited slots and full analytics.`);
    setModalAction(() => () => { // Simulated upgrade action
        console.log("Simulating Pro Upgrade complete!");
        setIsModalVisible(false);
    });
    setIsModalVisible(true);
  };
  
  const addHabit = useCallback(async (name) => {
    if (!name.trim()) return;
    if (habits.length >= HABIT_LIMIT) {
      showLimitModal();
      setNewHabitName('');
      return;
    }
    if (!db || !userId) {
      setError("System not ready. Please wait or refresh.");
      return;
    }

    const habitsCollectionRef = collection(db, `/artifacts/${appId}/users/${userId}/habits`);
    const newHabitRef = doc(habitsCollectionRef); // Let Firestore generate the ID
    
    try {
      await setDoc(newHabitRef, {
        name: name.trim(),
        createdAt: new Date().toISOString(),
        // Initialize today's status as false
        [todayKey]: false, 
      });
      setNewHabitName('');
    } catch (e) {
      console.error("Error adding habit:", e);
      setError("Could not save habit. Try again.");
    }
  }, [db, userId, habits.length, todayKey]);

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
  
  const handleDeleteHabitConfirmed = useCallback(async (habitId) => {
    if (!db || !userId) {
      setError("System not ready for deletion.");
      return;
    }
    
    setIsModalVisible(false); // Close modal immediately
    
    const habitRef = doc(db, `/artifacts/${appId}/users/${userId}/habits`, habitId);
    
    try {
      await deleteDoc(habitRef);
    } catch (e) {
      console.error("Error deleting habit:", e);
      setError("Could not delete habit.");
    }
  }, [db, userId]);

  const showDeleteConfirmation = useCallback((habitId) => {
    setModalTitle("Confirm Deletion");
    setModalMessage("Are you sure you want to delete this habit? This action cannot be undone.");
    setModalAction(() => () => handleDeleteHabitConfirmed(habitId)); // Set the action to delete
    setIsModalVisible(true);
  }, [handleDeleteHabitConfirmed]);

  // --- Rendering Functions ---

  const renderHabits = () => {
    // Sort habits by creation date or name if needed, but in-memory sort is fine.
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
            onClick={() => showDeleteConfirmation(habit.id)}
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
      
      {/* Custom Modal for Confirmation / Limit Reached */}
      <CustomModal
        isVisible={isModalVisible}
        title={modalTitle}
        message={modalMessage}
        onConfirm={modalAction}
        onCancel={() => setIsModalVisible(false)}
      />

      <div className="max-w-xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-gray-900">{APP_TITLE}</h1>
          <p className="text-indigo-600 mt-2 text-xl font-semibold">Today is {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <div className="mt-4 text-sm text-gray-500">
            Current User ID: <span className="font-mono text-xs bg-gray-200 p-1 rounded break-all">{userId}</span>
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
                <button 
                    onClick={showLimitModal}
                    className="mt-4 w-full py-3 px-4 bg-indigo-500 text-white font-bold rounded-lg shadow-lg hover:bg-indigo-700 transition duration-300"
                >
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
      
      {/* Global styles for smooth rendering */}
      <style jsx global>{`
        body {
          font-family: 'Inter', sans-serif;
          margin: 0;
          padding: 0;
          overflow-x: hidden;
        }
      `}</style>
    </div>
  );
};

// --- MANDATORY REACT RENDER BLOCK ---
const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
} else {
    console.error("Root element not found (ID 'root' required).");
}
