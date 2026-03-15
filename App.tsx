
import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { AppTab, MarketRate, UserProfile } from './types';
import { 
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  doc, setDoc, getDoc, collection, addDoc, query, where, orderBy, limit, onSnapshot 
} from './firebase';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

// Error Boundary Component
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0D1111] flex flex-col items-center justify-center p-6 text-center">
          <i className="fas fa-exclamation-triangle text-amber-500 text-5xl mb-4"></i>
          <h2 className="text-2xl font-bold mb-2">Something went wrong</h2>
          <p className="text-gray-400 mb-6">We encountered an unexpected error. Please try refreshing the app.</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-emerald-500 text-white px-8 py-3 rounded-full font-bold"
          >
            Refresh App
          </button>
          {process.env.NODE_ENV !== 'production' && (
            <pre className="mt-8 p-4 bg-black/40 rounded-xl text-xs text-red-400 text-left overflow-auto max-w-full">
              {this.state.error?.toString()}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [displayText, setDisplayText] = useState("Tap the mic and tell me what's on your mind.");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [marketData, setMarketData] = useState<MarketRate[]>([]);
  const [searchLang, setSearchLang] = useState("");
  
  // Firebase State
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(false);

  const recognitionRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const chatRef = useRef<any>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);

  const languages = [
    { name: "Hindi", native: "हिन्दी", code: "hi-IN" },
    { name: "English", native: "English", code: "en-IN" },
    { name: "Bengali", native: "বাংলা", code: "bn-IN" },
    { name: "Marathi", native: "मराठी", code: "mr-IN" },
    { name: "Tamil", native: "தமிழ்", code: "ta-IN" },
    { name: "Telugu", native: "తెలుగు", code: "te-IN" },
  ];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      if (currentUser) {
        fetchUserProfile(currentUser.uid);
      } else {
        setProfile(null);
      }
    });

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    chatRef.current = ai.chats.create({
      model: 'gemini-3-flash-preview',
      config: {
        systemInstruction: "You are BhashaSetu Elite, an ultra-fast Agri-AI. Your mission: provide instant, precise farming solutions. 1. Detect language. 2. Respond in that language. 3. Keep it brief and actionable. Return a JSON with key 'response_text' and 'lang_code' (e.g. 'hi-IN', 'en-IN', 'mr-IN'). No fluff.",
        responseMimeType: "application/json",
      },
    });

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      
      recognitionRef.current.onresult = (e: any) => {
        const text = e.results[0][0].transcript;
        setDisplayText(text);
        if (e.results[0].isFinal) {
          handleQuery(text);
          setIsListening(false);
        }
      };
      
      recognitionRef.current.onend = () => setIsListening(false);
      recognitionRef.current.onerror = () => setIsListening(false);
    }

    fetchMarketRates();
    
    return () => {
      unsubscribe();
      window.speechSynthesis.cancel();
    };
  }, []);

  const fetchUserProfile = async (uid: string) => {
    setIsProfileLoading(true);
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
      } else {
        // Create default profile
        const defaultProfile: UserProfile = {
          name: auth.currentUser?.displayName || "Farmer",
          location: "",
          farmSize: "",
          primaryCrop: "",
          email: auth.currentUser?.email || "",
          uid: uid
        };
        await setDoc(docRef, defaultProfile);
        setProfile(defaultProfile);
      }
    } catch (e) {
      console.error("Error fetching profile:", e);
    } finally {
      setIsProfileLoading(false);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error("Login failed:", e);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setActiveTab('home');
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  const saveChatHistory = async (queryText: string, responseText: string, langCode: string) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'chats'), {
        userId: user.uid,
        query: queryText,
        response: responseText,
        timestamp: new Date().toISOString(),
        langCode: langCode
      });
    } catch (e) {
      console.error("Error saving chat:", e);
    }
  };

  const updateProfile = async (updatedProfile: Partial<UserProfile>) => {
    if (!user) return;
    try {
      const newProfile = { ...profile, ...updatedProfile } as UserProfile;
      await setDoc(doc(db, 'users', user.uid), newProfile);
      setProfile(newProfile);
    } catch (e) {
      console.error("Error updating profile:", e);
    }
  };

  const fetchMarketRates = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: "Current mandi rates for Cotton, Soybean, Wheat, Onion in Maharashtra. JSON array: commodity, price, trend, location.",
        config: { tools: [{ googleSearch: {} }], responseMimeType: "application/json" }
      });
      const data = JSON.parse(response.text);
      setMarketData(Array.isArray(data) ? data : []);
    } catch (e) {
      setMarketData([
        { commodity: "Cotton", price: "₹7,200/q", trend: "up", location: "Nagpur Mandi" },
        { commodity: "Soybean", price: "₹4,850/q", trend: "down", location: "Wardha Mandi" },
        { commodity: "Wheat", price: "₹2,600/q", trend: "stable", location: "Pune Mandi" },
        { commodity: "Onion", price: "₹1,900/q", trend: "up", location: "Lasalgaon Mandi" }
      ]);
    }
  };

  const speakText = (text: string, langCode: string = 'hi-IN') => {
    if (!('speechSynthesis' in window)) return;
    
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langCode;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    speechRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const handleQuery = async (query: string) => {
    if (!query.trim()) return;
    setIsLoading(true);
    window.speechSynthesis.cancel();
    
    try {
      const response = await chatRef.current.sendMessage({ message: query });
      const data = JSON.parse(response.text);
      const answer = data.response_text || response.text;
      const langCode = data.lang_code || 'hi-IN';
      setDisplayText(answer);
      
      // Save to Firebase
      saveChatHistory(query, answer, langCode);
      
      // Auto-play TTS with detected language code
      speakText(answer, langCode);
    } catch (e) {
      setDisplayText("I encountered a connection hiccup. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleListening = () => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      window.speechSynthesis.cancel();
      setDisplayText("I'm listening...");
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const Header = () => (
    <div className="flex justify-between items-start pt-6 px-6 mb-4">
      <div>
        <p className="text-[10px] font-black tracking-[0.2em] text-emerald-500 uppercase">BhashaSetu</p>
        <h1 className="text-2xl font-bold">Agri <span className="elite-text-gradient">Elite</span></h1>
      </div>
      <div className="flex items-center space-x-2 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 backdrop-blur-md">
        <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-amber-500' : 'bg-emerald-500'} animate-pulse`}></div>
        <span className="text-[10px] font-bold tracking-widest uppercase">{isSpeaking ? 'Speaking' : 'Live'}</span>
      </div>
    </div>
  );

  const TabHome = () => (
    <div className="flex flex-col items-center justify-between h-full px-6 py-8 animate-fade-in">
      <div className="w-full flex-1 flex flex-col items-center justify-center text-center space-y-6">
        <div className={`w-24 h-24 rounded-full transition-all duration-500 flex items-center justify-center mb-4 relative ${isSpeaking ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
          <i className={`fas fa-quote-left absolute -top-2 -left-2 text-3xl transition-colors duration-500 ${isSpeaking ? 'text-amber-500/20' : 'text-emerald-500/20'}`}></i>
          {isSpeaking ? (
             <div className="flex space-x-1 items-end h-8">
               {[...Array(4)].map((_, i) => (
                 <div key={i} className="w-1.5 bg-amber-500 rounded-full animate-voice-wave" style={{ animationDelay: `${i * 0.1}s`, height: '100%' }}></div>
               ))}
             </div>
          ) : (
            <i className="fas fa-comment-dots text-emerald-500 text-4xl"></i>
          )}
        </div>
        
        {isLoading ? (
          <div className="flex space-x-2 items-center justify-center py-4">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
          </div>
        ) : (
          <div className="max-h-[30vh] overflow-y-auto no-scrollbar">
            <p className="text-xl md:text-2xl font-medium leading-relaxed italic text-gray-200 transition-all duration-300">
              "{displayText}"
            </p>
          </div>
        )}
      </div>

      <div className="relative flex flex-col items-center justify-center pb-24 w-full">
        {/* Animated Waves Background */}
        <div className="absolute inset-0 flex items-center justify-center -z-10 overflow-hidden">
          {(isListening || isSpeaking) && (
            <div className="flex items-center justify-center space-x-1 h-32 w-full opacity-30">
              {[...Array(16)].map((_, i) => (
                <div 
                  key={i} 
                  className={`w-1 rounded-full transition-all duration-500 ${isSpeaking ? 'bg-amber-500' : 'bg-emerald-500'} animate-voice-wave`}
                  style={{ 
                    height: `${Math.random() * 80 + 20}%`,
                    animationDelay: `${i * 0.08}s` 
                  }}
                ></div>
              ))}
            </div>
          )}
        </div>

        {/* The Big Mic Button */}
        <button 
          onClick={toggleListening}
          className={`group relative w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl active:scale-95
            ${isSpeaking ? 'bg-amber-600 shadow-[0_0_60px_rgba(245,158,11,0.4)]' : 
              isListening ? 'bg-red-500' : 'bg-[#10B981] shadow-[0_0_60px_rgba(16,185,129,0.3)] hover:shadow-[0_0_80px_rgba(16,185,129,0.5)]'}`}
        >
          <div className="absolute inset-2 border-2 border-white/20 rounded-full group-hover:scale-110 transition-transform"></div>
          <i className={`fas ${isSpeaking ? 'fa-volume-up' : isListening ? 'fa-stop' : 'fa-microphone'} text-white text-4xl md:text-5xl`}></i>
          {(isListening || isSpeaking) && (
             <div className={`absolute -inset-4 rounded-full border-2 animate-ping ${isSpeaking ? 'border-amber-500/30' : 'border-red-500/30'}`}></div>
          )}
        </button>
        
        <p className={`mt-6 text-xs font-black uppercase tracking-[0.4em] transition-colors duration-500 ${
          isSpeaking ? 'text-amber-500' : isListening ? 'text-red-500' : 'text-emerald-500'
        }`}>
          {isSpeaking ? "Tap to Stop Voice" : isListening ? "Listening..." : "Tap to Speak"}
        </p>
      </div>
    </div>
  );

  const TabScan = () => (
    <div className="px-6 animate-fade-in flex flex-col items-center pb-24 h-full justify-center">
      <h2 className="text-2xl font-bold mb-8 italic">Crop <span className="text-emerald-500">Scanner</span></h2>
      <div className="relative w-full aspect-square rounded-[3rem] overflow-hidden bg-black/40 border border-white/5 flex items-center justify-center group shadow-inner">
        {!capturedImage && (
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="absolute inset-0 w-full h-full object-cover opacity-60" 
            onLoadedMetadata={() => videoRef.current?.play()}
          />
        )}
        <div className="z-10 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-full border-2 border-white/10 flex items-center justify-center mb-4">
             <i className="fas fa-expand text-emerald-500 animate-pulse text-2xl"></i>
          </div>
          <p className="text-[10px] font-black tracking-[0.4em] uppercase text-gray-500">Align with crop</p>
        </div>
        {!capturedImage && (
           <div className="absolute inset-0 pointer-events-none border-[40px] border-black/10">
              <div className="w-full h-full border-2 border-amber-500/40 relative rounded-2xl">
                 <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-amber-500"></div>
                 <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-amber-500"></div>
                 <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-amber-500"></div>
                 <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-amber-500"></div>
                 <div className="absolute left-0 w-full h-0.5 bg-amber-500/30 scan-line shadow-[0_0_15px_rgba(245,158,11,0.5)]"></div>
              </div>
           </div>
        )}
      </div>
      
      <div className="mt-12 flex flex-col items-center">
        <button 
          onClick={async () => {
            const canvas = document.createElement('canvas');
            if (videoRef.current) {
                canvas.width = videoRef.current.videoWidth;
                canvas.height = videoRef.current.videoHeight;
                canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
                const base64 = canvas.toDataURL('image/jpeg');
                setCapturedImage(base64);
                
                // OCR / Crop Analysis
                setIsLoading(true);
                setDisplayText("Analyzing sample...");
                try {
                   const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
                   const response = await ai.models.generateContent({
                     model: 'gemini-3-flash-preview',
                     contents: {
                       parts: [
                         { inlineData: { data: base64.split(',')[1], mimeType: 'image/jpeg' } },
                         { text: "Analyze this agricultural image. Identify crop health, diseases, or transcribe text if it's a document. Respond concisely in JSON with key 'response_text' and 'lang_code'." }
                       ]
                     },
                     config: { responseMimeType: 'application/json' }
                   });
                   const data = JSON.parse(response.text);
                   setDisplayText(data.response_text);
                   setActiveTab('home');
                   speakText(data.response_text, data.lang_code);
                } catch(e) {
                   setDisplayText("Could not read the scan. Try again.");
                } finally {
                   setIsLoading(false);
                   setCapturedImage(null);
                }
            }
          }}
          className="w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-xl active:scale-90 transition-transform border-[6px] border-black"
        >
          <div className="w-4 h-4 rounded-full bg-red-600"></div>
        </button>
        <p className="mt-4 text-[10px] font-black tracking-[0.2em] text-gray-500 uppercase">Capture Sample</p>
      </div>
    </div>
  );

  const NavButton = ({ tab, icon, label }: { tab: AppTab, icon: string, label: string }) => (
    <button 
      onClick={() => {
        setActiveTab(tab);
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
        if (tab === 'scan') {
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then(stream => { if(videoRef.current) videoRef.current.srcObject = stream; })
            .catch(err => console.error(err));
        }
      }} 
      className={`flex flex-col items-center transition-all px-2 ${activeTab === tab ? 'scale-110' : 'opacity-40 hover:opacity-100'}`}
    >
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${activeTab === tab ? 'bg-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.2)]' : ''}`}>
        <i className={`fas ${icon} text-lg ${activeTab === tab ? 'text-emerald-500' : 'text-white'}`}></i>
      </div>
      {activeTab === tab && <span className="text-[7px] font-black uppercase tracking-widest text-emerald-500 mt-1">{label}</span>}
    </button>
  );

  return (
    <div className="min-h-screen flex flex-col relative max-w-md mx-auto bg-[#0D1111] overflow-hidden">
      <Header />
      
      <main className="flex-grow overflow-hidden relative">
        {activeTab === 'home' && <TabHome />}
        {activeTab === 'market' && (
          <div className="px-6 animate-fade-in overflow-y-auto h-full no-scrollbar pb-32 pt-2">
            <h2 className="text-2xl font-bold mb-6">Market Trends</h2>
            <div className="space-y-4">
              {marketData.map((item, i) => (
                <div key={i} className="market-card rounded-3xl p-5 flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-xl">
                      {item.commodity === 'Cotton' ? '☁️' : item.commodity === 'Soybean' ? '📦' : item.commodity === 'Wheat' ? '🌾' : '🧅'}
                    </div>
                    <div>
                      <h4 className="font-bold text-base leading-tight">{item.commodity}</h4>
                      <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">{item.location}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black">{item.price}</p>
                    <p className={`text-[9px] font-bold flex items-center justify-end ${item.trend === 'up' ? 'text-emerald-500' : 'text-red-500'}`}>
                      <i className={`fas fa-arrow-trend-${item.trend === 'up' ? 'up' : 'down'} mr-1`}></i>
                      {item.trend === 'up' ? 'Bullish' : 'Bearish'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'scan' && <TabScan />}
        {activeTab === 'profile' && (
           <div className="flex flex-col items-center px-6 animate-fade-in pt-4 h-full overflow-y-auto no-scrollbar">
              {!user ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-20">
                  <div className="w-24 h-24 rounded-full bg-emerald-500/10 flex items-center justify-center mb-6">
                    <i className="fas fa-user-shield text-emerald-500 text-4xl"></i>
                  </div>
                  <h2 className="text-2xl font-bold mb-2">Secure Access</h2>
                  <p className="text-gray-400 mb-8 text-sm">Sign in to save your profile, track crop health, and get personalized advice.</p>
                  <button 
                    onClick={handleLogin}
                    className="w-full bg-white text-black font-bold py-4 rounded-2xl flex items-center justify-center space-x-3 active:scale-95 transition-all"
                  >
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                    <span>Continue with Google</span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative mb-6">
                    <div className="w-28 h-28 rounded-full p-1 elite-gradient">
                      <img 
                        src={user.photoURL || `https://ui-avatars.com/api/?name=${profile?.name || user.displayName}&background=random`} 
                        className="w-full h-full rounded-full object-cover border-4 border-[#0D1111]" 
                        alt="Profile"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="absolute bottom-1 right-1 w-8 h-8 bg-[#0D1111] border-2 border-emerald-500 rounded-full flex items-center justify-center">
                      <i className="fas fa-check text-emerald-500 text-xs"></i>
                    </div>
                  </div>
                  <h2 className="text-2xl font-bold mb-1">{profile?.name || user.displayName}</h2>
                  <p className="text-emerald-500 text-[10px] font-black tracking-[0.3em] uppercase mb-10">Elite Member</p>

                  <div className="w-full space-y-6 pb-32">
                    <div className="space-y-4">
                      <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                        <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Location</label>
                        <input 
                          type="text" 
                          value={profile?.location || ""}
                          onChange={(e) => updateProfile({ location: e.target.value })}
                          placeholder="Village, District"
                          className="w-full bg-transparent text-white font-medium focus:outline-none"
                        />
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                        <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 block mb-2">Primary Crop</label>
                        <input 
                          type="text" 
                          value={profile?.primaryCrop || ""}
                          onChange={(e) => updateProfile({ primaryCrop: e.target.value })}
                          placeholder="e.g. Cotton, Wheat"
                          className="w-full bg-transparent text-white font-medium focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="relative">
                      <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm"></i>
                      <input 
                        type="text" 
                        placeholder="Search Languages..." 
                        className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm focus:outline-none focus:border-emerald-500/50 transition-all text-white"
                        value={searchLang}
                        onChange={(e) => setSearchLang(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {languages.map((l) => (
                        <button 
                          key={l.name} 
                          onClick={() => speakText(`You selected ${l.name}`, l.code)}
                          className={`p-4 rounded-2xl border text-left transition-all hover:border-emerald-500/30 ${l.name === 'Hindi' ? 'bg-emerald-500/5 border-emerald-500/50' : 'bg-white/5 border-white/5 opacity-60'}`}
                        >
                          <h4 className={`text-lg font-bold ${l.name === 'Hindi' ? 'text-amber-500' : 'text-white'}`}>{l.native}</h4>
                          <p className="text-[9px] font-medium text-gray-400 uppercase tracking-widest">{l.name}</p>
                        </button>
                      ))}
                    </div>

                    <button 
                      onClick={handleLogout}
                      className="w-full py-4 rounded-2xl border border-red-500/30 text-red-500 font-bold text-sm hover:bg-red-500/5 transition-all"
                    >
                      Sign Out
                    </button>
                  </div>
                </>
              )}
           </div>
        )}
      </main>

      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] glass-nav rounded-[2.5rem] py-2 px-4 flex justify-between items-center z-50 shadow-2xl">
        <NavButton tab="home" icon="fa-microphone" label="Ask" />
        <NavButton tab="scan" icon="fa-camera" label="Scan" />
        <NavButton tab="market" icon="fa-chart-line" label="Rates" />
        <NavButton tab="profile" icon="fa-user" label="Elite" />
      </nav>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes voiceWave { 0%, 100% { height: 20%; opacity: 0.3; } 50% { height: 100%; opacity: 1; } }
        .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }
        .animate-voice-wave { animation: voiceWave 0.8s ease-in-out infinite; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};

export default function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
