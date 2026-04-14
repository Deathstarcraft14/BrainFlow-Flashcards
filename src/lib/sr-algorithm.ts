import { Flashcard, ReviewGrade } from '../types';
import { addMinutes, addDays, startOfDay, endOfDay } from 'date-fns';

/**
 * Professional Spaced Repetition Algorithm (Anki-inspired SM-2)
 */
export function updateCardReview(card: Flashcard, grade: ReviewGrade): Flashcard {
  const now = Date.now();
  let { state, interval, easeFactor, step, nextReview } = card;

  // Learning steps (in minutes): 1, 10
  const learningSteps = [1, 10];

  if (state === 'new' || state === 'learning') {
    if (grade === 0) { // Again
      step = 0;
      nextReview = addMinutes(now, learningSteps[0]).getTime();
      state = 'learning';
    } else if (grade === 1) { // Hard
      // Hard in learning: stay in current step but delay slightly
      nextReview = addMinutes(now, 5).getTime();
      state = 'learning';
    } else if (grade === 2) { // Good
      if (step === 0) {
        step = 1;
        nextReview = addMinutes(now, learningSteps[1]).getTime();
        state = 'learning';
      } else {
        // Graduate to review
        state = 'review';
        interval = 1; // 1 day
        nextReview = addDays(startOfDay(now), 1).getTime();
      }
    } else if (grade === 3) { // Easy
      state = 'review';
      interval = 4; // Graduate to 4 days (Anki default)
      nextReview = addDays(startOfDay(now), 4).getTime();
      easeFactor = Math.min(5.0, easeFactor + 0.15);
    }
  } else if (state === 'review') {
    if (grade === 0) { // Again
      state = 'relearning';
      step = 0;
      easeFactor = Math.max(1.3, easeFactor - 0.2);
      interval = 0;
      nextReview = addMinutes(now, 10).getTime(); // 10 min relearning
    } else {
      // SM-2 logic
      if (grade === 1) { // Hard
        easeFactor = Math.max(1.3, easeFactor - 0.15);
        interval = Math.max(1, interval * 1.2);
      } else if (grade === 2) { // Good
        interval = Math.max(1, interval * easeFactor);
      } else if (grade === 3) { // Easy
        easeFactor = Math.min(5.0, easeFactor + 0.15);
        interval = Math.max(1, interval * easeFactor * 1.3);
      }
      
      // Add a bit of fuzz (1-5%) to prevent cards from sticking together
      const fuzz = 1 + (Math.random() * 0.05);
      nextReview = addDays(startOfDay(now), Math.round(interval * fuzz)).getTime();
    }
  } else if (state === 'relearning') {
    if (grade === 0) {
      step = 0;
      nextReview = addMinutes(now, 10).getTime();
    } else if (grade === 2 || grade === 3) {
      state = 'review';
      interval = 1;
      nextReview = addDays(startOfDay(now), 1).getTime();
    }
  }

  return {
    ...card,
    state,
    interval,
    easeFactor,
    step,
    nextReview,
  };
}

/**
 * Returns a human-readable maturity level based on interval
 */
export function getCardMaturity(card: Flashcard): 'New' | 'Learning' | 'Young' | 'Mature' {
  if (card.state === 'new') return 'New';
  if (card.state === 'learning' || card.state === 'relearning') return 'Learning';
  if (card.interval < 21) return 'Young';
  return 'Mature';
}

export function getInitialCard(deckId: string, folderId: string | null, front: string, back: string, type: 'standard' | 'matching' = 'standard'): Flashcard {
  return {
    id: crypto.randomUUID(),
    deckId,
    folderId,
    type,
    front,
    back,
    createdAt: Date.now(),
    state: 'new',
    nextReview: Date.now(),
    interval: 0,
    easeFactor: 2.5,
    step: 0,
  };
}
