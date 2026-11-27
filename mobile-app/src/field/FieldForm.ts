/** Phase C.2: presentation-only primitives for existing field screens.
 * Only call real APIs from the existing business screens/controllers.
 */
export { FieldFormSection, FieldFormNotice, FieldFormReview } from './FieldFormLayout.tsx';
export type { FieldReviewItem, FieldNoticeTone } from './FieldFormLayout.tsx';
export { FieldFormTextInput, FieldFormQuantityInput, FieldFormChoice, FieldFormToggle } from './FieldFormControls.tsx';
export type { FieldFormOption } from './FieldFormControls.tsx';
export { FieldFormFeedback, FieldFormActions, FieldFormProgress } from './FieldFormFeedback.tsx';
export type { FieldFormStatus } from './FieldFormFeedback.tsx';
