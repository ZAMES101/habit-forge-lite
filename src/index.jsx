import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app'; // <-- Correct Import for initializeApp
import { 
    getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';
import { 
    getFirestore, doc, collection, query, onSnapshot, updateDoc, addDoc, 
    deleteDoc, serverTimestamp 
} from 'firebase/firestore'; // <-- Removed initializeApp from here

// --- Global Variable Access Handlers (MANDATORY in this environment) ---
const getAppId = () => typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const getInitialAuthToken = () => typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : '';
const getFirebaseConfig = () => {
    try {
        // MUST use the global configuration object
        return typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
    } catch (e) {
        console.error("Failed to parse Firebase Config:", e);
        return {};
    }
};

// Utility function to get today's date in UTC YYYY-MM-DD format for reliable streak tracking
const getTodayDateString = () => {
    const today = new Date();
    // Use UTC date string for consistent daily rollover globally
    return today.toISOString().split('T')[0];
};

// --- Firebase Initialization Hook (Ensures single, correct setup) ---
function useFirebaseServices() {
    const [services, setServices] = useState(null);

    useEffect(() => {
        const firebaseConfig = getFirebaseConfig();
        
        if (Object.keys(firebaseConfig).length === 0) {
            console.error("Firebase config is empty. Cannot initialize.");
            return;
        }

        // Initialize App
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        
        setServices({ app, auth, db });
    }, []);

    return services;
}

// --- Authentication Hook ---
function useAuthStatus(auth) { 
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const initialAuthToken = getInitialAuthToken();

  useEffect(() => {
    if (!auth) return;

    const attemptSignIn = async () => {
        try {
            if (initialAuthToken && initialAuthToken !== "") {
                await signInWithCustomToken(auth, initialAuthToken);
            } else {
                await signInAnonymously(auth);
            }
        } catch (error) {
            console.error("Authentication Error:", error);
        }
    };
    attemptSignIn();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [auth, initialAuthToken]);

  return { user, loading };
}


// --- Component Definition ---

const HABITS_COLLECTION_NAME = 'habits';
const MAX_FREE_HABITS = 3; 

const HabitTracker = () => {
    // 1. Get Firebase Services
    const firebaseServices = useFirebaseServices();
    const auth = firebaseServices?.auth;
    const db = firebaseServices?.db;

    // 2. Get Auth Status
    const { user, loading: authLoading } = useAuthStatus(auth);
    const userId = user?.uid;

    const [habits, setHabits] = useState([]);
    const [newHabitName, setNewHabitName] = useState('');
    const [isLoadingData, setIsLoadingData] = useState(true);
    const [error, setError] = useState(null);
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    
    const isHabitLimitReached = habits.length >= MAX_FREE_HABITS;

    // --- Data Fetching (Real-time Listener) ---
    useEffect(() => {
        if (authLoading || !user || !db) return; 

        setIsLoadingData(true);
        const appId = getAppId();
        
        // Firestore Path: /artifacts/{appId}/users/{userId}/habits
        const collectionPath = `/artifacts/${appId}/users/${user.uid}/${HABITS_COLLECTION_NAME}`;
        const habitsRef = collection(db, collectionPath);
        const q = query(habitsRef); 

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const habitsList = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data.name,
                    // lastCheckIn is a YYYY-MM-DD string
                    lastCheckIn: data.lastCheckIn || '', 
                    streak: data.streak || 0,
                    // Use Firestore Timestamp for sorting, convert to Date if needed later
                    createdAt: data.createdAt?.toDate() || new Date(), 
                };
            }).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      
            setHabits(habitsList);
            setIsLoadingData(false);
        }, (err) => {
            console.error("Firestore Snapshot Error:", err);
            setError("Failed to load habits. Check console for details.");
            setIsLoadingData(false);
        });

        return () => unsubscribe();
    }, [user, authLoading, db]);

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
            lastCheckIn: '', // YYYY-MM-DD string
            streak: 0,
            userId: userId,
        };

        try {
            const appId = getAppId();
            const habitsCollectionRef = collection(db, 
                `artifacts/${appId}/users/${userId}/${HABITS_COLLECTION_NAME}`
            );
            
            // Use addDoc for auto-generated IDs
            await addDoc(habitsCollectionRef, newHabit); 
            setNewHabitName('');
        } catch (e) {
            console.error("Error adding document: ", e);
            setError("Failed to add habit.");
        }
    };

    const handleToggleHabit = async (habit) => {
        const todayString = getTodayDateString();
        const isCompletedToday = habit.lastCheckIn === todayString;

        if (isCompletedToday) return; // Prevent double check-in/undo for simplicity

        let newStreak = habit.streak;

        try {
            const lastCheckIn = habit.lastCheckIn;
            
            // Calculate yesterday's date string for streak check
            const yesterdayDate = new Date();
            yesterdayDate.setDate(yesterdayDate.getDate() - 1);
            const yesterdayString = yesterdayDate.toISOString().split('T')[0];

            if (lastCheckIn === yesterdayString) {
                // Continued streak
                newStreak += 1;
            } else {
                // Streak broken or first check-in
                newStreak = 1;
            }

            const appId = getAppId();
            const habitDocRef = doc(db, 
                `artifacts/${appId}/users/${userId}/${HABITS_COLLECTION_NAME}`, 
                habit.id
            );

            await updateDoc(habitDocRef, {
                lastCheckIn: todayString,
                streak: newStreak,
            });
            
        } catch (e) {
            console.error("Error updating document: ", e);
            setError("Failed to update habit status.");
        }
    };

    const handleDeleteHabit = async (id) => {
        try {
            const appId = getAppId();
            const habitDocRef = doc(db, 
                `artifacts/${appId}/users/${userId}/${HABITS_COLLECTION_NAME}`, 
                id
            );
            await deleteDoc(habitDocRef);
        } catch (e) {
            console.error("Error deleting document: ", e);
            setError("Failed to delete habit.");
        }
    };

    const getCompletionStatus = useCallback((lastCheckIn) => {
        return lastCheckIn === getTodayDateString();
    }, []);

    const dayStatus = useMemo(() => {
        return habits.map(habit => ({
            id: habit.id,
            isCompleted: getCompletionStatus(habit.lastCheckIn),
            streak: habit.streak,
            name: habit.name,
        }));
    }, [habits, getCompletionStatus]);

    if (isLoadingData || authLoading || !firebaseServices) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <div className="text-xl font-medium text-indigo-600 animate-pulse">
                    Loading your Habit Forge...
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center p-4 sm:p-8 font-inter">
            {/* Tailwind is assumed available, no script tag needed in React */}
            <style>
                {/* Removed Tailwind CDN script and kept only custom styles */}
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
                    User ID: <span className="font-mono text-gray-600 break-all">{userId || 'N/A'}</span>
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
                {habits.length === 0 && !isLoadingData && (
                    <p className="text-center text-gray-500 p-8 bg-white rounded-xl shadow-md">
                        No habits yet. Start tracking your first one!
                    </p>
                )}
                
                {dayStatus.map(habit => (
                    <div key={habit.id} className="habit-card flex items-center justify-between p-4 bg-white rounded-xl border-l-4 border-indigo-500 shadow-lg">
                        <div className="flex items-center flex-grow min-w-0">
                            <button
                                onClick={() => handleToggleHabit(habits.find(h => h.id === habit.id))}
                                className={`w-10 h-10 flex items-center justify-center rounded-full transition-all duration-300 transform active:scale-95 ${
                                    habit.isCompleted
                                        ? 'bg-green-500 text-white shadow-lg cursor-not-allowed' // Make completed button look and act disabled
                                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                }`}
                                title={habit.isCompleted ? "Completed Today (Cannot Undo)" : "Mark Complete"}
                                disabled={habit.isCompleted}
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
                                    Streak: <span className="font-bold text-indigo-600">{habit.streak}</span> days 🔥
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
                            You've hit the **{MAX_FREE_HABITS}-habit limit** on the free tier. To track unlimited habits and view your streak history, you'll need to subscribe.
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
