// The reasons a monthly subscriber can pick when canceling, stored in racingcoach."CancellationReason".
// Each maps to the closest of Stripe's cancellation_details.feedback values so the Stripe Dashboard
// shows it too. Dependency-free so the cancel modal and the API route can share it.
export const CANCELLATION_REASONS = [
  { label: 'Too expensive', stripeFeedback: 'too_expensive' },
  { label: 'Coaching and analytics not helpful', stripeFeedback: 'low_quality' },
  { label: 'Not racing enough to use it', stripeFeedback: 'unused' },
  { label: 'Missing features I need', stripeFeedback: 'missing_features' },
  { label: 'Switched to another coaching tool', stripeFeedback: 'switched_service' },
  { label: 'Other', stripeFeedback: 'other' },
] as const;

export type CancellationReasonLabel = (typeof CANCELLATION_REASONS)[number]['label'];

export const MAX_CANCELLATION_NOTES = 2000;

// What the cancel route returns once Stripe has canceled the subscription
export type CancellationConfirmation = {
  // The Stripe subscription ID, which Stripe support can look the cancellation up by
  confirmationNumber: string;
  // ISO 8601: when Stripe recorded the cancellation, and the end of the paid month
  canceledAt: string;
  subscriptionEndDate: string | null;
};
