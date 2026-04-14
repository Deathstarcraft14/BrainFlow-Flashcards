import React, { useState, useMemo, useCallback, useRef } from 'react';
import { 
  Plus, 
  ChevronLeft, 
  MoreVertical, 
  Clock, 
  BookOpen, 
  Folder as FolderIcon, 
  Layers,
  Search,
  Trash2,
  Edit2,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Zap,
  Upload,
  FileText,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, isAfter, isBefore, addDays, startOfDay, endOfDay, isSameDay } from 'date-fns';
import { useBrainFlowStore } from './lib/store';
import { Flashcard, Deck, Folder, ReviewGrade } from './types';
import { getInitialCard, updateCardReview, getCardMaturity } from './lib/sr-algorithm';
import { auth, signInWithPopup, signOut, googleProvider } from './lib/firebase';
import { Button, buttonVariants } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Progress } from './components/ui/progress';
import { ScrollArea } from './components/ui/scroll-area';
import { Textarea } from './components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from './components/ui/dialog';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from './components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { Separator } from './components/ui/separator';
import { cn } from './lib/utils';
import Papa from 'papaparse';

type View = 'dashboard' | 'deck' | 'study';

export default function App() {
  const store = useBrainFlowStore();
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedBuckets, setSelectedBuckets] = useState<string[]>([]);
  const [isStudyMode, setIsStudyMode] = useState(false);
  const [studyCards, setStudyCards] = useState<Flashcard[]>([]);
  const [currentStudyIndex, setCurrentStudyIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  // Modal states
  const [isAddDeckOpen, setIsAddDeckOpen] = useState(false);
  const [isAddFolderOpen, setIsAddFolderOpen] = useState(false);
  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const [isEditCardOpen, setIsEditCardOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importFolderId, setImportFolderId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importFormat, setImportFormat] = useState<'delimited' | 'twoline' | 'blankline'>('delimited');
  const frontInputRef = useRef<HTMLTextAreaElement>(null);

  // Form states
  const [newDeckName, setNewDeckName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [newCardFront, setNewCardFront] = useState('');
  const [newCardBack, setNewCardBack] = useState('');

  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editCardFront, setEditCardFront] = useState('');
  const [editCardBack, setEditCardBack] = useState('');
  const [editCardFolderId, setEditCardFolderId] = useState<string | null>(null);

  const selectedDeck = useMemo(() => 
    store.decks.find(d => d.id === selectedDeckId), 
    [store.decks, selectedDeckId]
  );

  const deckFolders = useMemo(() => 
    store.folders.filter(f => f.deckId === selectedDeckId),
    [store.folders, selectedDeckId]
  );

  const deckCards = useMemo(() => 
    store.cards.filter(c => c.deckId === selectedDeckId),
    [store.cards, selectedDeckId]
  );

  const filteredCards = useMemo(() => {
    if (selectedFolderId) {
      return deckCards.filter(c => c.folderId === selectedFolderId);
    }
    return deckCards;
  }, [deckCards, selectedFolderId]);

  // Buckets calculation
  const buckets = useMemo(() => {
    const now = Date.now();
    const tomorrow = addDays(startOfDay(now), 1).getTime();
    const nextWeek = addDays(startOfDay(now), 7).getTime();

    return {
      new: filteredCards.filter(c => c.state === 'new'),
      now: filteredCards.filter(c => c.state !== 'new' && c.nextReview <= now),
      within24h: filteredCards.filter(c => c.nextReview > now && c.nextReview <= tomorrow),
      tomorrow: filteredCards.filter(c => c.nextReview > tomorrow && c.nextReview <= addDays(tomorrow, 1).getTime()),
      withinWeek: filteredCards.filter(c => c.nextReview > addDays(tomorrow, 1).getTime() && c.nextReview <= nextWeek),
      future: filteredCards.filter(c => c.nextReview > nextWeek),
    };
  }, [filteredCards]);

  const toggleBucket = (label: string) => {
    setSelectedBuckets(prev => 
      prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
    );
  };

  const getCardsFromSelectedBuckets = () => {
    let cards: Flashcard[] = [];
    if (selectedBuckets.includes('New')) cards = [...cards, ...buckets.new];
    if (selectedBuckets.includes('Now')) cards = [...cards, ...buckets.now];
    if (selectedBuckets.includes('<24hr')) cards = [...cards, ...buckets.within24h];
    if (selectedBuckets.includes('Tmrw')) cards = [...cards, ...buckets.tomorrow];
    if (selectedBuckets.includes('<1wk')) cards = [...cards, ...buckets.withinWeek];
    if (selectedBuckets.includes('Future')) cards = [...cards, ...buckets.future];
    return cards;
  };

  const handleFileUpload = async (file: File) => {
    setImportError(null);
    if (!selectedDeckId) {
      setImportError("Please select a deck first.");
      return;
    }

    Papa.parse(file, {
      complete: (results) => {
        try {
          let count = 0;
          results.data.forEach((row: any) => {
            // Support various row formats: [front, back] or {front: ..., back: ...}
            let front = "";
            let back = "";

            if (Array.isArray(row)) {
              if (row.length >= 2) {
                front = row[0]?.toString().trim();
                back = row[1]?.toString().trim();
              }
            } else if (typeof row === 'object' && row !== null) {
              // Try common header names
              front = (row.front || row.Front || row.question || row.Question || "").toString().trim();
              back = (row.back || row.Back || row.answer || row.Answer || "").toString().trim();
            }

            if (front && back) {
              const card = getInitialCard(selectedDeckId, importFolderId, front, back);
              store.addCard(card);
              count++;
            }
          });

          if (count > 0) {
            setIsImportOpen(false);
          } else {
            setImportError("No valid cards found. Ensure your file has two columns (Front and Back).");
          }
        } catch (err) {
          setImportError("Failed to process the parsed data.");
        }
      },
      error: (err) => {
        setImportError(`Failed to parse file: ${err.message}`);
      },
      header: false, // We'll handle both header and non-header cases manually for better flexibility
      skipEmptyLines: true,
    });
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, [selectedDeckId]);

  const startStudy = (cardsToStudy: Flashcard[]) => {
    if (cardsToStudy.length === 0) return;
    // Shuffle cards
    const shuffled = [...cardsToStudy].sort(() => Math.random() - 0.5);
    setStudyCards(shuffled);
    setCurrentStudyIndex(0);
    setShowAnswer(false);
    setIsStudyMode(true);
  };

  const handleGrade = (grade: ReviewGrade) => {
    const currentCard = studyCards[currentStudyIndex];
    const updatedCard = updateCardReview(currentCard, grade);
    store.updateCard(updatedCard);

    if (currentStudyIndex < studyCards.length - 1) {
      setCurrentStudyIndex(prev => prev + 1);
      setShowAnswer(false);
    } else {
      setIsStudyMode(false);
    }
  };

  const handleAddDeck = () => {
    if (!newDeckName.trim()) return;
    store.addDeck(newDeckName, '');
    setNewDeckName('');
    setIsAddDeckOpen(false);
  };

  const handleAddFolder = () => {
    if (!newFolderName.trim() || !selectedDeckId) return;
    store.addFolder(selectedDeckId, newFolderName);
    setNewFolderName('');
    setIsAddFolderOpen(false);
  };

  const handleAddCard = () => {
    if (!newCardFront.trim() || !newCardBack.trim() || !selectedDeckId) return;
    const card = getInitialCard(selectedDeckId, selectedFolderId, newCardFront, newCardBack);
    store.addCard(card);
    setNewCardFront('');
    setNewCardBack('');
    // Focus back to front input for continuous adding
    frontInputRef.current?.focus();
  };

  const handleEditCard = () => {
    if (!editingCardId || !editCardFront.trim() || !editCardBack.trim()) return;
    store.updateCard({
      ...store.cards.find(c => c.id === editingCardId)!,
      front: editCardFront,
      back: editCardBack,
      folderId: editCardFolderId
    });
    setIsEditCardOpen(false);
    setEditingCardId(null);
  };

  const openEditCard = (card: Flashcard) => {
    setEditingCardId(card.id);
    setEditCardFront(card.front);
    setEditCardBack(card.back);
    setEditCardFolderId(card.folderId);
    setIsEditCardOpen(true);
  };

  if (isStudyMode) {
    const currentCard = studyCards[currentStudyIndex];
    const progress = ((currentStudyIndex) / studyCards.length) * 100;

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-10">
          <Button variant="ghost" size="sm" onClick={() => setIsStudyMode(false)}>
            <ChevronLeft className="w-4 h-4 mr-1" />
            Quit
          </Button>
          <div className="flex-1 mx-4">
            <Progress value={progress} className="h-2" />
          </div>
          <span className="text-xs font-medium text-slate-500">
            {currentStudyIndex + 1} / {studyCards.length}
          </span>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center p-4 max-w-2xl mx-auto w-full">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentCard.id}
              initial={{ opacity: 0, y: 10, rotateY: -5 }}
              animate={{ opacity: 1, y: 0, rotateY: 0 }}
              exit={{ opacity: 0, y: -10, rotateY: 5 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="w-full aspect-[4/3] relative perspective-1000"
            >
              <Card className="w-full h-full flex flex-col items-center justify-center text-center p-8 shadow-xl border-2">
                <div className="absolute top-4 left-4 flex gap-2">
                  <Badge variant="outline" className="capitalize">
                    {currentCard.state}
                  </Badge>
                  <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-100">
                    {getCardMaturity(currentCard)}
                  </Badge>
                </div>
                <div className="flex flex-col gap-6 w-full">
                  <div className={cn(
                    "text-2xl font-medium text-slate-800 transition-all duration-300 whitespace-pre-wrap",
                    showAnswer ? "text-lg text-slate-500" : "text-2xl"
                  )}>
                    {currentCard.front}
                  </div>
                  {showAnswer && (
                    <>
                      <Separator className="bg-slate-100" />
                      <div className="text-2xl font-bold text-blue-600 animate-in fade-in slide-in-from-top-2 duration-300 whitespace-pre-wrap">
                        {currentCard.back}
                      </div>
                    </>
                  )}
                </div>
              </Card>
            </motion.div>
          </AnimatePresence>

          <div className="mt-8 w-full space-y-4">
            {!showAnswer ? (
              <Button 
                className="w-full h-16 text-lg font-semibold shadow-lg"
                onClick={() => setShowAnswer(true)}
              >
                Show Answer
              </Button>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                <Button 
                  variant="destructive" 
                  className="flex flex-col h-20 gap-1"
                  onClick={() => handleGrade(0)}
                >
                  <RotateCcw className="w-4 h-4" />
                  <span className="text-xs">Again</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="flex flex-col h-20 gap-1 border-orange-200 text-orange-600 hover:bg-orange-50"
                  onClick={() => handleGrade(1)}
                >
                  <Clock className="w-4 h-4" />
                  <span className="text-xs">Hard</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="flex flex-col h-20 gap-1 border-blue-200 text-blue-600 hover:bg-blue-50"
                  onClick={() => handleGrade(2)}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-xs">Good</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="flex flex-col h-20 gap-1 border-green-200 text-green-600 hover:bg-green-50"
                  onClick={() => handleGrade(3)}
                >
                  <Zap className="w-4 h-4" />
                  <span className="text-xs">Easy</span>
                </Button>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Navigation */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          {selectedDeckId && (
            <Button variant="ghost" size="icon" onClick={() => {
              if (selectedFolderId) setSelectedFolderId(null);
              else setSelectedDeckId(null);
            }}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
          )}
          <h1 className="text-lg font-bold tracking-tight uppercase flex items-center gap-2">
            {selectedDeckId ? (
              <>
                <span className="text-slate-400 text-sm font-medium">DECKS</span>
                <span className="text-slate-300">/</span>
                <span>{selectedDeck?.name}</span>
                {selectedFolderId && (
                  <>
                    <span className="text-slate-300">/</span>
                    <span className="text-slate-500">{store.folders.find(f => f.id === selectedFolderId)?.name}</span>
                  </>
                )}
              </>
            ) : (
              "BRAINFLOW"
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {store.user ? (
            <div className="flex items-center gap-2">
              <img 
                src={store.user.photoURL || `https://ui-avatars.com/api/?name=${store.user.displayName}`} 
                className="w-8 h-8 rounded-full border"
                referrerPolicy="no-referrer"
              />
              <DropdownMenu>
                <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}>
                  <MoreVertical className="w-5 h-5 text-slate-500" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => signOut(auth)}>
                    <RotateCcw className="w-4 h-4 mr-2" /> Logout
                  </DropdownMenuItem>
                  <Separator className="my-1" />
                  <DropdownMenuItem onClick={() => setIsAddDeckOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" /> New Deck
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsImportOpen(true)}>
                    <Layers className="w-4 h-4 mr-2" /> Import Decks
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <Button size="sm" onClick={async () => {
              try {
                const result = await signInWithPopup(auth, googleProvider);
                if (result.user) {
                  await store.migrateLocalToCloud(result.user.uid);
                }
              } catch (error) {
                console.error("Login failed", error);
              }
            }}>
              Login
            </Button>
          )}
        </div>
      </header>

      <main className="p-4 max-w-5xl mx-auto">
        {!selectedDeckId ? (
          /* Dashboard - Deck List */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {store.decks.map((deck) => {
                const now = Date.now();
                const deckCards = store.cards.filter(c => c.deckId === deck.id);
                const dueCount = deckCards.filter(c => c.state === 'new' || c.nextReview <= now).length;
                return (
                  <motion.div
                    key={deck.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                  >
                    <Card 
                      className="group cursor-pointer hover:border-blue-400 transition-all shadow-sm hover:shadow-md"
                      onClick={() => setSelectedDeckId(deck.id)}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex justify-between items-start">
                          <CardTitle className="text-xl">{deck.name}</CardTitle>
                          <Badge variant={dueCount > 0 ? "destructive" : "secondary"}>
                            {dueCount} due
                          </Badge>
                        </div>
                        <CardDescription>
                          {store.cards.filter(c => c.deckId === deck.id).length} cards
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1" onClick={(e) => {
                            e.stopPropagation();
                            const now = Date.now();
                            const due = store.cards.filter(c => 
                              c.deckId === deck.id && 
                              (c.state === 'new' || c.nextReview <= now)
                            );
                            startStudy(due);
                          }}>
                            Study Now
                          </Button>
                          <Button variant="outline" size="icon" onClick={(e) => {
                            e.stopPropagation();
                            store.deleteDeck(deck.id);
                          }}>
                            <Trash2 className="w-4 h-4 text-slate-400" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            <Button 
              variant="outline" 
              className="h-full min-h-[160px] border-dashed border-2 flex flex-col gap-2 text-slate-500 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50"
              onClick={() => setIsAddDeckOpen(true)}
            >
              <Plus className="w-8 h-8" />
              <span className="font-semibold">Create New Deck</span>
            </Button>
          </div>
        ) : (
          /* Deck View */
          <div className="space-y-6">
            {/* Buckets Dashboard */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Review Buckets</h2>
                {selectedBuckets.length > 0 && (
                  <Button 
                    size="sm" 
                    className="bg-blue-600 hover:bg-blue-700"
                    onClick={() => startStudy(getCardsFromSelectedBuckets())}
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    Study {getCardsFromSelectedBuckets().length} Selected
                  </Button>
                )}
              </div>
              <ScrollArea className="w-full whitespace-nowrap pb-4">
                <div className="flex gap-4">
                  {[
                    { label: 'New', color: 'bg-blue-500', cards: buckets.new },
                    { label: 'Now', color: 'bg-red-500', cards: buckets.now },
                    { label: '<24hr', color: 'bg-orange-400', cards: buckets.within24h },
                    { label: 'Tmrw', color: 'bg-yellow-400', cards: buckets.tomorrow },
                    { label: '<1wk', color: 'bg-indigo-400', cards: buckets.withinWeek },
                    { label: 'Future', color: 'bg-green-500', cards: buckets.future },
                  ].map((bucket) => {
                    const isSelected = selectedBuckets.includes(bucket.label);
                    return (
                      <div 
                        key={bucket.label} 
                        className="flex flex-col items-center gap-2 min-w-[120px] cursor-pointer group"
                        onClick={() => toggleBucket(bucket.label)}
                      >
                        <div className={cn(
                          "w-full aspect-square rounded-xl flex items-center justify-center text-3xl font-bold text-white shadow-sm transition-all duration-200",
                          bucket.color,
                          bucket.cards.length === 0 && !isSelected && "opacity-40 grayscale",
                          isSelected ? "ring-4 ring-offset-2 ring-blue-600 scale-105" : "group-hover:scale-105"
                        )}>
                          {bucket.cards.length}
                        </div>
                        <span className={cn(
                          "text-xs font-bold uppercase tracking-wider transition-colors",
                          isSelected ? "text-blue-600" : "text-slate-500"
                        )}>
                          {bucket.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            <Separator />

            {/* Folders & Cards */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Layers className="w-5 h-5 text-blue-500" />
                  Folders
                </h2>
                <Button variant="outline" size="sm" onClick={() => setIsAddFolderOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> New Folder
                </Button>
              </div>

              <ScrollArea className="w-full whitespace-nowrap">
                <div className="flex gap-2 pb-3">
                  <Button 
                    variant={selectedFolderId === null ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setSelectedFolderId(null);
                      setSelectedBuckets([]);
                    }}
                  >
                    All Cards
                  </Button>
                  {deckFolders.map(folder => (
                    <div key={folder.id} className="flex items-center gap-1">
                      <Button 
                        variant={selectedFolderId === folder.id ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setSelectedFolderId(folder.id);
                          setSelectedBuckets([]);
                        }}
                      >
                        <FolderIcon className="w-3 h-3 mr-1" />
                        {folder.name}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8")}>
                          <MoreVertical className="w-3 h-3" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => {
                            const folderCards = store.cards.filter(c => c.folderId === folder.id);
                            startStudy(folderCards);
                          }}>
                            <Zap className="w-4 h-4 mr-2" /> Study Folder
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => store.deleteFolder(folder.id)}>
                            <Trash2 className="w-4 h-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <div className="flex items-center justify-between pt-4">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-green-500" />
                  Cards
                  <span className="text-slate-400 text-sm font-normal">({filteredCards.length})</span>
                </h2>
                <Button size="sm" onClick={() => setIsAddCardOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Add Card
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <AnimatePresence>
                  {filteredCards.map(card => (
                    <motion.div
                      key={card.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                    >
                      <Card className="h-full flex flex-col border-l-4 border-l-blue-500">
                        <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between space-y-0">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="w-fit text-[10px] uppercase">
                                {card.state}
                              </Badge>
                              <Badge variant="secondary" className="w-fit text-[10px] uppercase bg-blue-50 text-blue-700 border-blue-100">
                                {getCardMaturity(card)}
                              </Badge>
                              {card.folderId && (
                                <Badge variant="secondary" className="w-fit text-[10px] uppercase flex items-center gap-1">
                                  <FolderIcon className="w-2 h-2" />
                                  {store.folders.find(f => f.id === card.folderId)?.name}
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {format(card.nextReview, 'MMM d, p')}
                            </span>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8")}>
                              <MoreVertical className="w-4 h-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditCard(card)}>
                                <Edit2 className="w-4 h-4 mr-2" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                className="text-red-600 focus:text-red-600"
                                onClick={() => store.deleteCard(card.id)}
                              >
                                <Trash2 className="w-4 h-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 flex-1 flex flex-col justify-center min-h-[100px]">
                          <p className="text-sm font-medium text-slate-700 line-clamp-3">
                            {card.front}
                          </p>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      <Dialog open={isAddDeckOpen} onOpenChange={setIsAddDeckOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Deck</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Deck Name</label>
              <Input 
                placeholder="e.g. Computer Science, Spanish..." 
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddDeck()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDeckOpen(false)}>Cancel</Button>
            <Button onClick={handleAddDeck}>Create Deck</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddFolderOpen} onOpenChange={setIsAddFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Folder Name</label>
              <Input 
                placeholder="e.g. Chapter 1, Vocabulary..." 
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddFolder()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddFolderOpen(false)}>Cancel</Button>
            <Button onClick={handleAddFolder}>Create Folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddCardOpen} onOpenChange={setIsAddCardOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add New Flashcard</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Folder (Optional)</label>
              <div className="flex flex-wrap gap-2">
                <Button 
                  variant={selectedFolderId === null ? "default" : "outline"}
                  size="xs"
                  onClick={() => setSelectedFolderId(null)}
                >
                  None
                </Button>
                {deckFolders.map(f => (
                  <Button 
                    key={f.id}
                    variant={selectedFolderId === f.id ? "default" : "outline"}
                    size="xs"
                    onClick={() => setSelectedFolderId(f.id)}
                  >
                    {f.name}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Front (Question)</label>
              <Textarea 
                ref={frontInputRef}
                placeholder="What is the capital of France?" 
                value={newCardFront}
                onChange={(e) => setNewCardFront(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleAddCard();
                  }
                }}
                className="min-h-[100px]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Back (Answer)</label>
              <Textarea 
                placeholder="Paris" 
                value={newCardBack}
                onChange={(e) => setNewCardBack(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleAddCard();
                  }
                }}
                className="min-h-[80px]"
              />
              <p className="text-[10px] text-slate-400 italic">Tip: Press Ctrl+Enter (or ⌘+Enter) to save and add another</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddCardOpen(false)}>Done</Button>
            <Button onClick={handleAddCard}>Add Card</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditCardOpen} onOpenChange={setIsEditCardOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Flashcard</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Folder (Optional)</label>
              <div className="flex flex-wrap gap-2">
                <Button 
                  variant={editCardFolderId === null ? "default" : "outline"}
                  size="xs"
                  onClick={() => setEditCardFolderId(null)}
                >
                  None
                </Button>
                {deckFolders.map(f => (
                  <Button 
                    key={f.id}
                    variant={editCardFolderId === f.id ? "default" : "outline"}
                    size="xs"
                    onClick={() => setEditCardFolderId(f.id)}
                  >
                    {f.name}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Front (Question)</label>
              <Textarea 
                placeholder="Question" 
                value={editCardFront}
                onChange={(e) => setEditCardFront(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Back (Answer)</label>
              <Textarea 
                placeholder="Answer" 
                value={editCardBack}
                onChange={(e) => setEditCardBack(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditCardOpen(false)}>Cancel</Button>
            <Button onClick={handleEditCard}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isImportOpen} onOpenChange={(open) => {
        setIsImportOpen(open);
        if (!open) setImportError(null);
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Import Cards</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">1. Select Target Deck</label>
              <select 
                className="w-full p-2 border rounded-md bg-white"
                onChange={(e) => setSelectedDeckId(e.target.value)}
                value={selectedDeckId || ''}
              >
                <option value="" disabled>Select a deck...</option>
                {store.decks.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">2. Select Target Folder (Optional)</label>
              <select 
                className="w-full p-2 border rounded-md bg-white"
                onChange={(e) => setImportFolderId(e.target.value === 'none' ? null : e.target.value)}
                value={importFolderId || 'none'}
                disabled={!selectedDeckId}
              >
                <option value="none">No Folder (Root)</option>
                {store.folders.filter(f => f.deckId === selectedDeckId).map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">3. Upload File or Paste Data</label>
              
              <Tabs defaultValue="upload" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="upload">File Upload</TabsTrigger>
                  <TabsTrigger value="paste">Paste Text</TabsTrigger>
                </TabsList>
                
                <TabsContent value="upload" className="mt-4">
                  <div
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    className={cn(
                      "border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer",
                      isDragging ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    )}
                    onClick={() => document.getElementById('file-upload')?.click()}
                  >
                    <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold">Click or drag file to upload</p>
                      <p className="text-xs text-slate-500 mt-1">Supports .txt, .csv (Front;Back)</p>
                      <p className="text-[10px] text-slate-400 mt-2 italic">For .apkg, please export from Anki as "Notes in Plain Text (.txt)" first.</p>
                    </div>
                    <input 
                      id="file-upload" 
                      type="file" 
                      className="hidden" 
                      accept=".txt,.csv"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file);
                      }}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="paste" className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Import Format</label>
                    <div className="grid grid-cols-3 gap-2">
                      <Button 
                        variant={importFormat === 'delimited' ? 'default' : 'outline'} 
                        size="xs" 
                        onClick={() => setImportFormat('delimited')}
                        className="text-[10px]"
                      >
                        Delimited (; , \t)
                      </Button>
                      <Button 
                        variant={importFormat === 'twoline' ? 'default' : 'outline'} 
                        size="xs" 
                        onClick={() => setImportFormat('twoline')}
                        className="text-[10px]"
                      >
                        2 Lines / Card
                      </Button>
                      <Button 
                        variant={importFormat === 'blankline' ? 'default' : 'outline'} 
                        size="xs" 
                        onClick={() => setImportFormat('blankline')}
                        className="text-[10px]"
                      >
                        Blank Line Sep
                      </Button>
                    </div>
                  </div>

                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 text-[11px] text-blue-800 flex gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <div>
                      {importFormat === 'delimited' && <p>Format: "Front;Back" or "Front,Back" (one per line)</p>}
                      {importFormat === 'twoline' && <p>Format: Line 1: Front, Line 2: Back (repeating)</p>}
                      {importFormat === 'blankline' && <p>Format: Front \n Back (can be multi-line) \n [Blank Line] \n Next Front...</p>}
                    </div>
                  </div>
                  <textarea 
                    className="w-full h-32 p-2 border rounded-md font-mono text-xs"
                    placeholder={
                      importFormat === 'delimited' ? "Question;Answer\nNext Question;Next Answer" :
                      importFormat === 'twoline' ? "Question 1\nAnswer 1\nQuestion 2\nAnswer 2" :
                      "Question 1\nAnswer Line 1\nAnswer Line 2\n\nQuestion 2\nAnswer 2"
                    }
                    id="import-data"
                  />
                  <Button className="w-full" onClick={() => {
                    const textarea = document.getElementById('import-data') as HTMLTextAreaElement;
                    const data = textarea.value;
                    
                    if (!selectedDeckId) {
                      setImportError("Please select a deck first.");
                      return;
                    }
                    if (!data.trim()) {
                      setImportError("Please paste some data to import.");
                      return;
                    }
                    
                    let count = 0;
                    
                    if (importFormat === 'delimited') {
                      const lines = data.split(/\r?\n/);
                      lines.forEach(line => {
                        const trimmed = line.trim();
                        if (!trimmed) return;
                        const delimiter = trimmed.includes(';') ? ';' : (trimmed.includes('\t') ? '\t' : ',');
                        const parts = trimmed.split(delimiter).map(p => p.trim()).filter(p => p !== "");
                        if (parts.length >= 2) {
                          // If there are more than 2 parts, treat all but the last as the front (question + choices)
                          // and the last part as the back (answer)
                          const back = parts[parts.length - 1];
                          const front = parts.slice(0, parts.length - 1).join('\n');
                          
                          if (front && back) {
                            const card = getInitialCard(selectedDeckId, importFolderId, front, back);
                            store.addCard(card);
                            count++;
                          }
                        }
                      });
                    } else if (importFormat === 'twoline') {
                      const lines = data.split(/\r?\n/).map(l => l.trim()).filter(l => l !== "");
                      for (let i = 0; i < lines.length; i += 2) {
                        if (i + 1 < lines.length) {
                          const front = lines[i];
                          const back = lines[i+1];
                          const card = getInitialCard(selectedDeckId, importFolderId, front, back);
                          store.addCard(card);
                          count++;
                        }
                      }
                    } else if (importFormat === 'blankline') {
                      const blocks = data.split(/\r?\n\s*\r?\n/);
                      blocks.forEach(block => {
                        const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l !== "");
                        if (lines.length >= 2) {
                          // Treat the last line as the answer, and everything else as the question/choices
                          const back = lines[lines.length - 1];
                          const front = lines.slice(0, lines.length - 1).join('\n');
                          const card = getInitialCard(selectedDeckId, importFolderId, front, back);
                          store.addCard(card);
                          count++;
                        }
                      });
                    }

                    if (count > 0) {
                      setIsImportOpen(false);
                      textarea.value = '';
                    } else {
                      setImportError("No valid cards found for the selected format.");
                    }
                  }}>Import Pasted Cards</Button>
                </TabsContent>
              </Tabs>
            </div>

            {importError && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {importError}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
