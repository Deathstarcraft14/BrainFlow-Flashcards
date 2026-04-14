export type ReviewGrade = 0 | 1 | 2 | 3; // Again, Hard, Good, Easy

export interface Flashcard {
  id: string;
  deckId: string;
  folderId: string | null;
  type?: 'standard' | 'matching';
  front: string;
  back: string;
  createdAt: number;
  
  // SR Fields
  state: 'new' | 'learning' | 'review' | 'relearning';
  nextReview: number; // timestamp
  interval: number; // in days
  easeFactor: number;
  step: number; // for learning/relearning phases
}

export interface Folder {
  id: string;
  deckId: string;
  name: string;
  createdAt: number;
}

export interface Deck {
  id: string;
  name: string;
  description: string;
  createdAt: number;
}
