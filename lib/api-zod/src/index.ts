export * from './generated/api';
export * from './generated/types';
// Orval names inline request-body zod consts and their TS type models
// identically (<OperationId>Body), which makes the two star-exports above
// ambiguous for those names. The explicit re-exports below give the zod
// consts precedence; if a regen adds a new collision, typecheck fails with
// TS2308 — add the name here.
export {
  UpdateSettingsBody,
  SettingsActionBody,
  UploadLibraryFileBody,
  ComposeKnowledgeDocBody,
  UpdatePostingFiltersBody,
  UpdatePostingStatusBody,
} from './generated/api';
