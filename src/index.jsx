import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, collection, query, setDoc, deleteDoc, updateDoc, where } from 'firebase/firestore';
import { CalendarDays, CircleCheck, Plus, Trash2, Loader2, ArrowLeft, ArrowRight } from 'lucide-react';

// ----------------------------------------------------------------------
// --- 1. CONFIGURATION ADAPTATION (UPDATED FOR VERCEL/CANVAS) ---
// ----------------------------------------------------------------------

// 1. Define fallbacks for Canvas/local testing
// These global variables are provided by the Canvas environment during development.
const canvasAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const canvasFirebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : '';

// 2. Determine the FINAL config to use based on the environment
const appId = 
  canvasAppId !== 'default-app-id' ? canvasAppId : (process.env.VITE_APP_ID || 'default-vercel-app-id');

const firebaseConfig = Object.keys(canvasFirebaseConfig).length > 0
  ? canvasFirebaseConfig // Use canvas config if present (running in development environment)
  : { // Otherwise, build the config from Vercel's Environment Variables (running in production)
      // Vercel/production variables are read from process.env.VITE_...
      apiKey: process.env.VITE_FIREBASE_API_KEY,
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.VITE_FIREBASE_APP_ID,
    };

// Constants
const HABIT_LIMIT = 3;

// ----------------------------------------------------------------------
// --- 2. UTILITY FUNCTIONS ---
// ----------------------------------------------------------------------

const formatUserId = (userId) => `${userId.substring(0, 4)}...${userId.substring(userId.length - 4)}`;

const getToday = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    // Format YYYY-MM-DD
    return d.toISOString().split('T')[0];
};

const getDayOfWeek = (dateString) => {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-US', { weekday: 'short' });
};

// ----------------------------------------------------------------------
// --- 3. FIREBASE INITIALIZATION & HOOKS ---
// ----------------------------------------------------------------------

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

function useFirebaseSetup() {
    const [userId, setUserId] = useState(null);
    const [dbInstance, setDbInstance] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    useEffect(() => {
        // 1. Setup Authentication
        const setupAuth = async () => {
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Firebase Auth Error:", error);
            }
        };

        setupAuth();

        // 2. Auth State Listener
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setUserId(user.uid);
                setDbInstance(db);
            } else {
                // Should not happen if signInAnonymously is successful, but handles logouts
                setUserId(null);
                setDbInstance(db); // Still set db even if anon, for potential future use
            }
            setIsAuthReady(true);
        });

        return () => unsubscribe();
    }, []);

    return { db: dbInstance, userId, isAuthReady, formattedUserId: userId ? formatUserId(userId) : 'Loading...' };
}

function useHabits(db, userId, isAuthReady) {
    const [habits, setHabits] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!db || !isAuthReady || !userId) {
            if (isAuthReady) setIsLoading(false);
            return;
        }

        setIsLoading(true);
        const habitsCollectionPath = `/artifacts/${appId}/users/${userId}/habits`;
        const q = query(collection(db, habitsCollectionPath));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const habitsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setHabits(habitsData.sort((a, b) => a.order - b.order));
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching habits:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [db, userId, isAuthReady]);

    return { habits, isLoading };
}

// ----------------------------------------------------------------------
// --- 4. DATA MANAGEMENT ACTIONS ---
// ----------------------------------------------------------------------

const createHabit = async (db, userId, name, order) => {
    if (!db || !userId) return console.error("Database not ready.");

    const habitsCollectionPath = `/artifacts/${appId}/users/${userId}/habits`;
    try {
        await setDoc(doc(db, habitsCollectionPath, crypto.randomUUID()), {
            name,
            createdAt: new Date().toISOString(),
            order,
            completions: {}, // { "YYYY-MM-DD": true }
        });
    } catch (e) {
        console.error("Error creating habit: ", e);
    }
};

const deleteHabit = async (db, userId, habitId) => {
    if (!db || !userId) return console.error("Database not ready.");
    
    const habitsCollectionPath = `/artifacts/${appId}/users/${userId}/habits`;
    try {
        await deleteDoc(doc(db, habitsCollectionPath, habitId));
    } catch (e) {
        console.error("Error deleting habit: ", e);
    }
};

const toggleCompletion = async (db, userId, habit) => {
    if (!db || !userId) return console.error("Database not ready.");

    const today = getToday();
    const isCompleted = habit.completions && habit.completions[today];
    
    const newCompletions = { ...habit.completions };
    if (isCompleted) {
        delete newCompletions[today];
    } else {
        newCompletions[today] = true;
    }

    const habitsCollectionPath = `/artifacts/${appId}/users/${userId}/habits`;
    try {
        await updateDoc(doc(db, habitsCollectionPath, habit.id), {
            completions: newCompletions
        });
    } catch (e) {
        console.error("Error toggling completion: ", e);
    }
};

// ----------------------------------------------------------------------
// --- 5. REACT COMPONENTS ---
// ----------------------------------------------------------------------

const DayHeader = ({ date, isSelected, onClick }) => {
    const today = getToday();
    const dayOfWeek = getDayOfWeek(date);
    const dateParts = date.split('-');
    const dayOfMonth = dateParts[2];
    
    let colorClass = 'text-gray-600 bg-gray-100 hover:bg-gray-200';
    if (date === today) {
        colorClass = 'bg-indigo-600 text-white shadow-lg';
    } else if (isSelected) {
        colorClass = 'bg-indigo-200 text-indigo-800 hover:bg-indigo-300';
    }

    return (
        <div 
            className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all duration-200 cursor-pointer w-16 h-16 sm:w-16 sm:h-20 flex-shrink-0 ${colorClass}`}
            onClick={() => onClick(date)}
        >
            <span className={`text-xs uppercase font-medium ${date === today ? 'text-indigo-200' : ''}`}>{dayOfWeek}</span>
            <span className="text-xl font-bold">{dayOfMonth}</span>
        </div>
    );
};

const DateNavigator = ({ selectedDate, setSelectedDate }) => {
    const today = getToday();
    const dateObj = new Date(selectedDate);

    const navDate = (offset) => {
        const newDateObj = new Date(dateObj);
        newDateObj.setDate(newDateObj.getDate() + offset);
        setSelectedDate(newDateObj.toISOString().split('T')[0]);
    };

    const setToday = () => setSelectedDate(today);

    // Generate 7 days centered around the selected date
    const dates = useMemo(() => {
        const start = new Date(dateObj);
        start.setDate(start.getDate() - 3); // Start 3 days before selected
        
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            return d.toISOString().split('T')[0];
        });
    }, [selectedDate]);

    return (
        <div className="flex flex-col items-center space-y-3 p-4 bg-white rounded-2xl shadow-xl mb-6">
            <div className="flex items-center justify-between w-full max-w-lg">
                <button 
                    onClick={() => navDate(-7)} 
                    className="p-2 rounded-full text-indigo-600 hover:bg-indigo-50 transition-colors"
                    aria-label="Previous Week"
                >
                    <ArrowLeft size={20} />
                </button>
                <button 
                    onClick={setToday} 
                    className={`font-semibold px-4 py-1 rounded-full text-sm transition-all ${
                        selectedDate === today 
                        ? 'bg-indigo-600 text-white shadow-md' 
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                    {selectedDate === today ? 'Today' : 'Go To Today'}
                </button>
                <button 
                    onClick={() => navDate(7)} 
                    className="p-2 rounded-full text-indigo-600 hover:bg-indigo-50 transition-colors"
                    aria-label="Next Week"
                >
                    <ArrowRight size={20} />
                </button>
            </div>
            
            <div className="flex justify-center space-x-2 overflow-x-auto w-full">
                {dates.map(date => (
                    <DayHeader 
                        key={date}
                        date={date}
                        isSelected={date === selectedDate}
                        onClick={setSelectedDate}
                    />
                ))}
            </div>
        </div>
    );
};


const HabitItem = ({ habit, db, userId, selectedDate, isSelectedDateToday }) => {
    const isCompleted = habit.completions && habit.completions[selectedDate];

    // Disable toggling if the selected date is in the future
    const isFutureDate = selectedDate > getToday();
    const isEditable = isSelectedDateToday && !isFutureDate;

    // Determine the style for the completion icon
    let statusClass = 'text-gray-300 hover:text-gray-400';
    if (isCompleted) {
        statusClass = 'text-green-500 hover:text-green-600';
    } else if (isFutureDate) {
        statusClass = 'text-gray-200 cursor-not-allowed';
    }

    const handleToggle = (e) => {
        e.stopPropagation();
        if (isEditable) {
            toggleCompletion(db, userId, habit);
        }
    };

    const handleDelete = (e) => {
        e.stopPropagation();
        // Use a simple, non-blocking visual feedback instead of window.confirm
        if (window.confirm(`Are you sure you want to delete the habit "${habit.name}"? This cannot be undone.`)) {
             deleteHabit(db, userId, habit.id);
        }
    }

    return (
        <div 
            className={`flex items-center justify-between p-4 mb-3 bg-white rounded-xl shadow-md transition-all duration-300 ${isCompleted ? 'border-l-8 border-green-500' : 'border-l-8 border-gray-100'}`}
        >
            <div className="flex-grow">
                <p className="text-lg font-semibold text-gray-800">{habit.name}</p>
                <p className="text-xs text-gray-500 mt-1">
                    Created: {new Date(habit.createdAt).toLocaleDateString()}
                </p>
            </div>
            
            <div className="flex items-center space-x-3">
                <button 
                    onClick={handleToggle} 
                    disabled={isFutureDate || !isEditable}
                    className={`p-2 rounded-full transition-colors ${isEditable ? 'cursor-pointer' : 'cursor-default'}`}
                    aria-label={isCompleted ? "Mark Incomplete" : "Mark Complete"}
                >
                    <CircleCheck size={28} className={statusClass} fill={isCompleted ? statusClass.split('-')[0] : 'none'} />
                </button>
                
                <button 
                    onClick={handleDelete}
                    className="p-1 text-red-400 hover:text-red-600 transition-colors"
                    aria-label="Delete Habit"
                >
                    <Trash2 size={20} />
                </button>
            </div>
        </div>
    );
};

const AddHabitForm = ({ db, userId, habitsCount }) => {
    const [name, setName] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    
    const maxedOut = habitsCount >= HABIT_LIMIT;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (name.trim() && habitsCount < HABIT_LIMIT) {
            createHabit(db, userId, name.trim(), habitsCount);
            setName('');
            setIsAdding(false);
        }
    };

    if (maxedOut && !isAdding) {
        return (
            <div className="text-center p-4 bg-yellow-100 text-yellow-800 rounded-xl font-medium shadow-inner mt-4">
                Limit reached: You can track up to {HABIT_LIMIT} habits.
            </div>
        );
    }

    return (
        <div className="mt-4">
            {isAdding ? (
                <form onSubmit={handleSubmit} className="flex flex-col space-y-2 p-4 bg-white rounded-xl shadow-lg border border-indigo-200">
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter new habit name (e.g., Read 30 min)"
                        className="p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        maxLength={50}
                        required
                        autoFocus
                    />
                    <div className="flex justify-end space-x-2">
                        <button
                            type="button"
                            onClick={() => setIsAdding(false)}
                            className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-md"
                        >
                            Add Habit
                        </button>
                    </div>
                </form>
            ) : (
                <button
                    onClick={() => setIsAdding(true)}
                    className="w-full flex items-center justify-center p-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl font-semibold transition-colors shadow-md"
                >
                    <Plus size={20} className="mr-2" /> Add a New Habit
                </button>
            )}
        </div>
    );
};

const Header = ({ formattedUserId }) => (
    <div className="flex justify-between items-center p-4 bg-white shadow-lg rounded-b-2xl mb-6">
        <h1 className="text-3xl font-extrabold text-indigo-700">Habit Forge Lite</h1>
        <div className="text-right text-xs text-gray-500">
            User ID: 
            <span title="Your unique session ID" className="block font-mono text-gray-700 text-sm">
                {formattedUserId}
            </span>
        </div>
    </div>
);

// ----------------------------------------------------------------------
// --- 6. MAIN APP COMPONENT ---
// ----------------------------------------------------------------------

const App = () => {
    const { db, userId, isAuthReady, formattedUserId } = useFirebaseSetup();
    const { habits, isLoading } = useHabits(db, userId, isAuthReady);
    const [selectedDate, setSelectedDate] = useState(getToday());

    const isSelectedDateToday = selectedDate === getToday();

    return (
        <div className="min-h-screen bg-gray-50 font-sans">
            <Header formattedUserId={formattedUserId} />
            
            <div className="container mx-auto p-4 max-w-xl">
                {/* Date Navigation */}
                <DateNavigator 
                    selectedDate={selectedDate} 
                    setSelectedDate={setSelectedDate} 
                />

                {/* Habit List */}
                <div className="mb-8">
                    <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center">
                        <CalendarDays size={20} className="mr-2 text-indigo-600" />
                        Habits for {isSelectedDateToday ? "Today" : selectedDate}
                    </h2>
                    
                    {isLoading || !isAuthReady ? (
                        <div className="flex justify-center items-center h-48 bg-white rounded-xl shadow-lg">
                            <Loader2 size={32} className="animate-spin text-indigo-500" />
                            <span className="ml-3 text-indigo-500 font-medium">Loading Data...</span>
                        </div>
                    ) : (
                        <div>
                            {habits.length === 0 ? (
                                <div className="p-6 text-center bg-gray-100 text-gray-600 rounded-xl border-dashed border-2 border-gray-300">
                                    <p className="font-semibold">No habits tracked yet.</p>
                                    <p className="text-sm mt-1">Use the button below to start building your routine!</p>
                                </div>
                            ) : (
                                habits.map(habit => (
                                    <HabitItem
                                        key={habit.id}
                                        habit={habit}
                                        db={db}
                                        userId={userId}
                                        selectedDate={selectedDate}
                                        isSelectedDateToday={isSelectedDateToday}
                                    />
                                ))
                            )}
                        </div>
                    )}
                </div>

                {/* Add Habit Form - Only visible when auth is ready */}
                {isAuthReady && !isLoading && (
                    <AddHabitForm
                        db={db}
                        userId={userId}
                        habitsCount={habits.length}
                    />
                )}
            </div>

            <footer className="py-4 text-center text-gray-400 text-sm mt-8">
                Powered by Firebase & React
            </footer>
        </div>
    );
};

export default App;

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
